import { describe, it, expect } from "vitest";
import { assignmentProblem } from "@/lib/assignment";

const grant = { startsAt: "2026-10-23T00:00:00.000Z", endsAt: "2026-12-31T23:59:59.000Z" };
const day = (d: string, end = false) => `${d}T${end ? "23:59:59" : "00:00:00"}.000Z`;

describe("assignmentProblem", () => {
  it("accepts dates inside the grant, with access ending the same day as the due date", () => {
    expect(assignmentProblem(grant, day("2026-10-23"), day("2026-11-01", true), day("2026-11-01", true))).toBeNull();
    expect(assignmentProblem(grant, day("2026-10-23"), day("2026-11-01", true), null)).toBeNull();
  });

  it("refuses a due date not after the start", () => {
    expect(assignmentProblem(grant, day("2026-11-01"), day("2026-10-30", true), null)).toMatch(/after the start/);
  });

  it("refuses access ending before the due date", () => {
    expect(assignmentProblem(grant, day("2026-10-23"), day("2026-11-05", true), day("2026-11-01", true))).toMatch(
      /before the due date/
    );
  });

  it("refuses a start before the organization's access begins", () => {
    expect(assignmentProblem(grant, day("2026-10-22"), day("2026-11-01", true), null)).toMatch(/from Oct 23, 2026/);
  });

  it("refuses a due date or access end after the organization's access ends", () => {
    expect(assignmentProblem(grant, day("2026-10-23"), day("2027-01-05", true), null)).toMatch(/a due date before/);
    expect(assignmentProblem(grant, day("2026-10-23"), day("2026-12-01", true), day("2027-01-05", true))).toMatch(
      /an access end before/
    );
  });

  it("has nothing to check against when the grant's dates are unknown", () => {
    expect(assignmentProblem({}, day("2020-01-01"), day("2030-01-01", true), null)).toBeNull();
  });
});
