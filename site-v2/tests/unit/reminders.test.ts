import { describe, it, expect } from "vitest";
import {
  localMoment,
  withinSendingHours,
  daysBetween,
  ruleFor,
  highestPriority,
  eventKey,
  nextAttemptAt,
  RULE_PRIORITY,
  MAX_ATTEMPTS,
  type ReminderCandidate,
} from "@/lib/reminders";

/*
 * AC-046 — reminder rule selection.
 *
 * "Local date at due-3, due day, overdue and 08:59/09:00. Evaluate rules with
 * fixed clock including DST timezone. Only correct local date/rule eligible in
 * 09:00–17:59; no duplicate local-day send after DST offset change."
 *
 * Every test states its instants in UTC and its expectations in the learner's
 * own timezone, because that gap is the whole subject.
 */

const MADRID = "Europe/Madrid";
const AUCKLAND = "Pacific/Auckland";

const candidate = (overrides: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  enrollmentId: "11111111-1111-4111-8111-111111111111",
  timezone: MADRID,
  dueAt: "2026-09-20T17:00:00Z",
  startsAt: "2026-09-01T09:00:00Z",
  lastActivityAt: "2026-09-19T10:00:00Z",
  lastInactivityAt: null,
  ...overrides,
});

describe("AC-046 the learner's own clock", () => {
  it("reads the local date and hour in the learner's timezone", () => {
    // 07:30 UTC in September is 09:30 in Madrid and 19:30 in Auckland — and in
    // Auckland it is already the NEXT day.
    const instant = "2026-09-15T07:30:00Z";
    expect(localMoment(instant, MADRID)).toEqual({ date: "2026-09-15", hour: 9, minute: 30 });
    expect(localMoment(instant, AUCKLAND)).toEqual({ date: "2026-09-15", hour: 19, minute: 30 });
    expect(localMoment("2026-09-15T13:30:00Z", AUCKLAND).date).toBe("2026-09-16");
  });

  it("normalises midnight to hour zero rather than twenty-four", () => {
    expect(localMoment("2026-09-15T22:00:00Z", MADRID).hour).toBe(0);
    expect(localMoment("2026-09-15T22:00:00Z", MADRID).date).toBe("2026-09-16");
  });

  it("follows the offset across a DST change rather than assuming one", () => {
    // Madrid is +02:00 in September and +01:00 in November.
    expect(localMoment("2026-09-15T12:00:00Z", MADRID).hour).toBe(14);
    expect(localMoment("2026-11-15T12:00:00Z", MADRID).hour).toBe(13);
  });
});

describe("AC-046 the sending window", () => {
  it("opens at 09:00 and not at 08:59", () => {
    expect(withinSendingHours({ date: "2026-09-15", hour: 8, minute: 59 })).toBe(false);
    expect(withinSendingHours({ date: "2026-09-15", hour: 9, minute: 0 })).toBe(true);
  });

  it("includes 17:59 and excludes 18:00", () => {
    expect(withinSendingHours({ date: "2026-09-15", hour: 17, minute: 59 })).toBe(true);
    expect(withinSendingHours({ date: "2026-09-15", hour: 18, minute: 0 })).toBe(false);
  });

  it("is decided in local time, so the same instant differs by learner", () => {
    // 07:00 UTC: 09:00 in Madrid, inside the window; 19:00 in Auckland, outside.
    const instant = "2026-09-15T07:00:00Z";
    expect(withinSendingHours(localMoment(instant, MADRID))).toBe(true);
    expect(withinSendingHours(localMoment(instant, AUCKLAND))).toBe(false);
  });

  it("is closed all night", () => {
    for (const hour of [0, 3, 6, 8, 18, 21, 23]) {
      expect(withinSendingHours({ date: "2026-09-15", hour, minute: 0 })).toBe(false);
    }
  });
});

describe("AC-046 which rule applies", () => {
  it("is due_soon exactly three local days before the due date", () => {
    const choice = ruleFor(candidate(), "2026-09-17T10:00:00Z");
    expect(choice?.rule).toBe("due_soon");
    // Due 2026-09-20 local; today 2026-09-17 local.
    expect(daysBetween("2026-09-17", "2026-09-20")).toBe(3);
  });

  it("is not due_soon four days out, nor two", () => {
    expect(ruleFor(candidate(), "2026-09-16T10:00:00Z")?.rule).not.toBe("due_soon");
    expect(ruleFor(candidate(), "2026-09-18T10:00:00Z")?.rule).not.toBe("due_soon");
  });

  it("is due_today on the due date while the moment has not passed", () => {
    const choice = ruleFor(candidate(), "2026-09-20T10:00:00Z");
    expect(choice?.rule).toBe("due_today");
  });

  it("is still due_today at exactly the due moment, because due is inclusive", () => {
    expect(ruleFor(candidate(), "2026-09-20T17:00:00Z")?.rule).toBe("due_today");
  });

  it("is overdue one millisecond later", () => {
    expect(ruleFor(candidate(), "2026-09-20T17:00:00.001Z")?.rule).toBe("overdue");
  });

  it("counts the due DAY in the learner's timezone, not in UTC", () => {
    /*
     * Due 2026-09-20T23:30Z is still the 20th in UTC but already the 21st in
     * Auckland. A learner there should not be told a deadline is "today" on
     * what is, to them, the day after.
     */
    const auckland = candidate({ timezone: AUCKLAND, dueAt: "2026-09-20T23:30:00Z" });
    const localDue = localMoment("2026-09-20T23:30:00Z", AUCKLAND);
    expect(localDue.date).toBe("2026-09-21");
    // At 2026-09-21 local, which is the due date there, it is due_today.
    expect(ruleFor(auckland, "2026-09-20T21:00:00Z")?.rule).toBe("due_today");
  });
});

describe("AC-046 inactivity", () => {
  const idle = (overrides: Partial<ReminderCandidate> = {}) =>
    candidate({
      dueAt: "2026-12-31T17:00:00Z",
      lastActivityAt: "2026-09-10T10:00:00Z",
      ...overrides,
    });

  it("waits seventy-two hours from the last activity", () => {
    expect(ruleFor(idle(), "2026-09-13T09:59:00Z")).toBeNull();
    expect(ruleFor(idle(), "2026-09-13T10:00:00Z")?.rule).toBe("inactivity");
  });

  it("measures from the start when there has been no activity at all", () => {
    const never = idle({ lastActivityAt: null, startsAt: "2026-09-10T10:00:00Z" });
    expect(ruleFor(never, "2026-09-13T09:00:00Z")).toBeNull();
    expect(ruleFor(never, "2026-09-13T11:00:00Z")?.rule).toBe("inactivity");
  });

  it("says nothing before the enrollment has started", () => {
    const future = idle({ startsAt: "2027-01-01T09:00:00Z", lastActivityAt: null });
    expect(ruleFor(future, "2026-09-20T10:00:00Z")).toBeNull();
  });

  it("does not repeat within seven days of the last accepted send", () => {
    const repeated = idle({ lastInactivityAt: "2026-09-13T10:00:00Z" });
    expect(ruleFor(repeated, "2026-09-19T10:00:00Z")).toBeNull();
    expect(ruleFor(repeated, "2026-09-20T10:01:00Z")?.rule).toBe("inactivity");
  });

  it("gives each seven-day interval its own campaign key", () => {
    const first = ruleFor(idle(), "2026-09-13T10:00:00Z");
    const later = ruleFor(idle({ lastInactivityAt: "2026-09-13T10:00:00Z" }), "2026-09-21T10:00:00Z");
    expect(first?.campaignKey).not.toBe(later?.campaignKey);
    // The second nudge is a new campaign, not a duplicate of the first.
    expect(first?.eventKey).not.toBe(later?.eventKey);
  });
});

describe("AC-046 no duplicate after a DST change", () => {
  it("gives the same local date one campaign key, whatever the offset", () => {
    /*
     * Madrid's clocks go back on 2026-10-25. 00:30Z and 01:30Z that morning
     * are 02:30 and 02:30 local — the same wall-clock time twice. Both must
     * belong to the same local DATE, so the daily claim catches the second.
     */
    const before = localMoment("2026-10-25T00:30:00Z", MADRID);
    const after = localMoment("2026-10-25T01:30:00Z", MADRID);
    expect(before.date).toBe("2026-10-25");
    expect(after.date).toBe("2026-10-25");
    expect(before.hour).toBe(2);
    expect(after.hour).toBe(2);
  });

  it("keeps one event key across the whole of a repeated local day", () => {
    const dst = candidate({ dueAt: "2026-10-28T17:00:00Z" });
    const morning = ruleFor(dst, "2026-10-25T08:00:00Z"); // 09:00 local
    const afternoon = ruleFor(dst, "2026-10-25T15:00:00Z"); // 16:00 local
    expect(morning?.localDate).toBe("2026-10-25");
    expect(afternoon?.localDate).toBe("2026-10-25");
    // Same rule, same campaign, same key: the outbox's unique constraint and
    // the daily claim both see one message, not two.
    expect(morning?.eventKey).toBe(afternoon?.eventKey);
  });

  it("starts a new campaign when the due date itself moves", () => {
    const original = ruleFor(candidate(), "2026-09-17T10:00:00Z");
    const moved = ruleFor(candidate({ dueAt: "2026-09-27T17:00:00Z" }), "2026-09-24T10:00:00Z");
    expect(original?.eventKey).not.toBe(moved?.eventKey);
  });
});

describe("AC-045 one message, the highest priority one", () => {
  const withRule = (enrollmentId: string, overrides: Partial<ReminderCandidate>, now: string) => {
    const c = candidate({ enrollmentId, ...overrides });
    const choice = ruleFor(c, now);
    return choice ? { candidate: c, choice } : null;
  };

  it("prefers overdue over due_today, due_soon and inactivity", () => {
    expect(RULE_PRIORITY.overdue).toBeLessThan(RULE_PRIORITY.due_today);
    expect(RULE_PRIORITY.due_today).toBeLessThan(RULE_PRIORITY.due_soon);
    expect(RULE_PRIORITY.due_soon).toBeLessThan(RULE_PRIORITY.inactivity);
  });

  it("chooses the overdue enrollment when a learner has several", () => {
    const now = "2026-09-20T10:00:00Z";
    const choices = [
      withRule("aaaaaaaa-1111-4111-8111-111111111111", { dueAt: "2026-09-20T17:00:00Z" }, now),
      withRule("bbbbbbbb-1111-4111-8111-111111111111", { dueAt: "2026-09-18T17:00:00Z" }, now),
    ].filter((x): x is NonNullable<typeof x> => x !== null);

    const winner = highestPriority(choices);
    expect(winner?.choice.rule).toBe("overdue");
    expect(winner?.candidate.enrollmentId.startsWith("bbbb")).toBe(true);
  });

  it("breaks a tie by the earliest due date, then by enrollment id", () => {
    const now = "2026-09-25T10:00:00Z";
    const a = withRule("cccccccc-1111-4111-8111-111111111111", { dueAt: "2026-09-21T17:00:00Z" }, now)!;
    const b = withRule("bbbbbbbb-1111-4111-8111-111111111111", { dueAt: "2026-09-20T17:00:00Z" }, now)!;
    expect(highestPriority([a, b])?.candidate.enrollmentId.startsWith("bbbb")).toBe(true);

    // Same due date: the uuid decides, so the choice is stable across runs.
    const sameDue = "2026-09-20T17:00:00Z";
    const c = withRule("cccccccc-1111-4111-8111-111111111111", { dueAt: sameDue }, now)!;
    const d = withRule("bbbbbbbb-1111-4111-8111-111111111111", { dueAt: sameDue }, now)!;
    expect(highestPriority([c, d])?.candidate.enrollmentId.startsWith("bbbb")).toBe(true);
    expect(highestPriority([d, c])?.candidate.enrollmentId.startsWith("bbbb")).toBe(true);
  });

  it("returns nothing when nothing is due", () => {
    expect(highestPriority([])).toBeNull();
  });

  it("names the event key exactly as spec/03 does", () => {
    expect(eventKey("11111111-1111-4111-8111-111111111111", "overdue", "2026-09-20T17:00:00Z")).toBe(
      "learning/11111111-1111-4111-8111-111111111111/overdue/2026-09-20T17:00:00Z"
    );
  });
});

describe("AC-048 the retry schedule", () => {
  it("backs off 1, 5, 15 and 60 minutes", () => {
    const from = "2026-09-15T12:00:00Z";
    expect(nextAttemptAt(1, from)?.toISOString()).toBe("2026-09-15T12:01:00.000Z");
    expect(nextAttemptAt(2, from)?.toISOString()).toBe("2026-09-15T12:05:00.000Z");
    expect(nextAttemptAt(3, from)?.toISOString()).toBe("2026-09-15T12:15:00.000Z");
    expect(nextAttemptAt(4, from)?.toISOString()).toBe("2026-09-15T13:00:00.000Z");
  });

  it("stops after five attempts in total", () => {
    expect(nextAttemptAt(MAX_ATTEMPTS, "2026-09-15T12:00:00Z")).toBeNull();
    expect(nextAttemptAt(MAX_ATTEMPTS + 1, "2026-09-15T12:00:00Z")).toBeNull();
  });
});
