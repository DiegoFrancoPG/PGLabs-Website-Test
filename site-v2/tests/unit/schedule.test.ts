import { describe, it, expect } from "vitest";
import {
  learningState,
  hasStarted,
  accessHasEnded,
  isOverdue,
  completedOnTime,
  acceptsLearningWrites,
  progressPercent,
  type EnrollmentSchedule,
} from "@/lib/schedule";

/*
 * AC-022 — time boundaries.
 *
 * "GIVEN Start S, due D, hard end E, active grant. WHEN Read/write at S, D,
 * D+1ms, E. THEN S permits access; completion at D is on time; D+1ms may
 * complete late; E rejects new learning writes."
 *
 * The three boundaries behave differently on purpose (ADR-10): start inclusive,
 * due inclusive for on-time completion, hard end EXCLUSIVE. Every case below is
 * pinned at the exact millisecond, because that is the only place the
 * difference between these rules is visible.
 */
const S = "2026-09-01T09:00:00.000Z";
const D = "2026-09-13T17:00:00.000Z";
const E = "2026-10-01T00:00:00.000Z";

const at = (iso: string, offsetMs = 0) => new Date(new Date(iso).getTime() + offsetMs).toISOString();

const base: EnrollmentSchedule = {
  status: "active",
  startsAt: S,
  dueAt: D,
  accessEndsAt: E,
  startedAt: null,
  completedAt: null,
};

describe("AC-022 the start boundary is inclusive", () => {
  it("does not permit access one millisecond before the start", () => {
    expect(hasStarted(base, at(S, -1))).toBe(false);
    expect(acceptsLearningWrites(base, at(S, -1))).toBe(false);
  });

  it("permits access at exactly the start", () => {
    expect(hasStarted(base, S)).toBe(true);
    expect(acceptsLearningWrites(base, S)).toBe(true);
  });
});

describe("AC-022 the due boundary is inclusive for completion", () => {
  it("is not overdue at exactly the due moment", () => {
    expect(isOverdue(base, D)).toBe(false);
  });

  it("is overdue one millisecond later", () => {
    expect(isOverdue(base, at(D, 1))).toBe(true);
  });

  it("counts a completion at exactly the due moment as on time", () => {
    expect(completedOnTime({ ...base, startedAt: S, completedAt: D })).toBe(true);
  });

  it("counts a completion one millisecond later as late", () => {
    expect(completedOnTime({ ...base, startedAt: S, completedAt: at(D, 1) })).toBe(false);
  });

  it("still permits learning after the due date, while access lasts", () => {
    // spec/03: "Completion after due is allowed if still accessible."
    expect(acceptsLearningWrites(base, at(D, 1))).toBe(true);
    expect(acceptsLearningWrites(base, at(E, -1))).toBe(true);
  });

  it("never calls a completed enrollment overdue", () => {
    const late = { ...base, startedAt: S, completedAt: at(D, 60_000) };
    expect(isOverdue(late, at(D, 120_000))).toBe(false);
  });
});

describe("AC-022 the hard end is exclusive", () => {
  it("still accepts a write one millisecond before the end", () => {
    expect(accessHasEnded(base, at(E, -1))).toBe(false);
    expect(acceptsLearningWrites(base, at(E, -1))).toBe(true);
  });

  it("rejects a write at exactly the end", () => {
    // The opposite of the start, which permits at exactly its boundary.
    expect(accessHasEnded(base, E)).toBe(true);
    expect(acceptsLearningWrites(base, E)).toBe(false);
  });

  it("treats an absent hard end as never ending", () => {
    const open = { ...base, accessEndsAt: null };
    expect(accessHasEnded(open, "2099-01-01T00:00:00.000Z")).toBe(false);
    expect(acceptsLearningWrites(open, "2099-01-01T00:00:00.000Z")).toBe(true);
  });
});

describe("derived learning state", () => {
  it.each([
    ["not_started", { ...base }],
    ["in_progress", { ...base, startedAt: S }],
    ["completed", { ...base, startedAt: S, completedAt: D }],
    ["cancelled", { ...base, status: "cancelled" as const, startedAt: S }],
  ])("reads as %s", (expected, enrollment) => {
    expect(learningState(enrollment)).toBe(expected);
  });

  it("puts cancelled ahead of completed, as spec/03 orders them", () => {
    const both = { ...base, status: "cancelled" as const, startedAt: S, completedAt: D };
    expect(learningState(both)).toBe("cancelled");
  });

  it("accepts no learning write while cancelled, whatever the dates say", () => {
    const cancelled = { ...base, status: "cancelled" as const };
    expect(acceptsLearningWrites(cancelled, D)).toBe(false);
    expect(isOverdue(cancelled, at(D, 1))).toBe(false);
  });
});

describe("progress is measured over required classes", () => {
  it.each([
    [0, 3, 0],
    [2, 3, 66.7],
    [3, 3, 100],
    [1, 4, 25],
  ])("%i of %i required is %f percent", (done, total, expected) => {
    expect(progressPercent(done, total)).toBe(expected);
  });

  it("matches the fixture's expected row percentages exactly", () => {
    // These are the numbers T16 will be measured against.
    expect(progressPercent(0, 3)).toBe(0);
    expect(progressPercent(2, 3)).toBe(66.7);
    expect(progressPercent(3, 3)).toBe(100);
  });

  it("does not divide by zero when a version has no required classes", () => {
    // Publication forbids this, but the calculation must not explode if it
    // ever sees one.
    expect(progressPercent(0, 0)).toBe(0);
  });
});
