import { describe, it, expect } from "vitest";
import { buildStaffRows, queryPeople, queryStaff, type StaffEnrollment, type StaffMember } from "@/lib/staff";

/*
 * The manager's staff list (PG Learn launch): cohort members joined to their
 * enrollments, then filtered and sorted as the screen asks.
 */

const now = new Date("2026-10-22T12:00:00Z");

const member = (id: string, name: string, email: string, status: StaffMember["membership_status"] = "active"): StaffMember => ({
  user_id: `00000000-0000-4000-8000-00000000000${id}`,
  display_name: name,
  email,
  membership_status: status,
});

const enrollment = (id: string, email: string, patch: Partial<StaffEnrollment> = {}): StaffEnrollment => ({
  enrollment_id: id,
  program: "AI Foundations",
  learner_name: "From report",
  learner_email: email,
  invitation_state: "accepted",
  state: "in_progress",
  due_at: "2026-11-01T23:59:59Z",
  required_completed: 2,
  required_total: 9,
  progress_percent: 22,
  last_activity_at: "2026-10-20T10:00:00Z",
  completed_at: null,
  on_time: null,
  ...patch,
});

const members = [
  member("1", "Amber Ito", "amber@example.org"),
  member("2", "Bo Diaz", "BO@example.org", "invited"),
  member("3", "Cy Lee", "cy@example.org"),
];
const enrollments = [
  enrollment("e1", "amber@example.org", {
    state: "completed",
    progress_percent: 100,
    completed_at: "2026-10-10T00:00:00Z",
    on_time: true,
  }),
  enrollment("e2", "bo@example.org", { due_at: "2026-10-01T23:59:59Z", progress_percent: 10 }),
];

describe("buildStaffRows", () => {
  const rows = buildStaffRows([...members, members[0]], enrollments, now);

  it("lists each person once per enrollment, and once as not assigned without one", () => {
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.email === "cy@example.org")?.status).toBe("not_assigned");
  });

  it("matches enrollments to members by email regardless of case and keeps the member's name", () => {
    const bo = rows.find((r) => r.program && r.email === "BO@example.org");
    expect(bo?.name).toBe("Bo Diaz");
    expect(bo?.account).toBe("invited");
  });

  it("marks open enrollments past due as overdue, never completed ones", () => {
    expect(rows.find((r) => r.name === "Bo Diaz")?.overdue).toBe(true);
    expect(rows.find((r) => r.name === "Amber Ito")?.overdue).toBe(false);
  });

  it("keeps people with an enrollment but no cohort listing", () => {
    const extra = buildStaffRows([], [enrollment("e3", "dee@example.org", { invitation_state: "pending" })], now);
    expect(extra[0]).toMatchObject({ name: "From report", account: "invited" });
  });
});

describe("queryStaff", () => {
  const rows = buildStaffRows(members, enrollments, now);

  it("filters by status, overdue and search", () => {
    expect(queryStaff(rows, { status: "completed" }).map((r) => r.name)).toEqual(["Amber Ito"]);
    expect(queryStaff(rows, { overdue: true }).map((r) => r.name)).toEqual(["Bo Diaz"]);
    expect(queryStaff(rows, { q: "CY@" }).map((r) => r.name)).toEqual(["Cy Lee"]);
  });

  it("sorts by progress either way with empty values last", () => {
    expect(queryStaff(rows, { sort: "progress", dir: "asc" }).map((r) => r.name)).toEqual([
      "Bo Diaz",
      "Amber Ito",
      "Cy Lee",
    ]);
    expect(queryStaff(rows, { sort: "progress", dir: "desc" }).map((r) => r.name)).toEqual([
      "Amber Ito",
      "Bo Diaz",
      "Cy Lee",
    ]);
  });
});

describe("queryPeople", () => {
  // Amber learns two programs; she must be listed once, with a line for each.
  const rows = buildStaffRows(
    members,
    [
      ...enrollments,
      enrollment("e4", "amber@example.org", { program: "Data Basics", version_number: 2, progress_percent: 40 }),
    ],
    now
  );

  it("lists each person once, with one line per program in program order", () => {
    const people = queryPeople(rows, {});
    expect(people.map((p) => p.name)).toEqual(["Amber Ito", "Bo Diaz", "Cy Lee"]);
    const amber = people[0];
    expect(amber.entries.map((e) => e.program)).toEqual(["AI Foundations", "Data Basics"]);
    expect(amber.entries[1].version).toBe(2);
  });

  it("keeps only the lines a program filter matches, and drops people with none", () => {
    const people = queryPeople(rows, { program: "Data Basics" });
    expect(people.map((p) => p.name)).toEqual(["Amber Ito"]);
    expect(people[0].entries).toHaveLength(1);
    expect(queryPeople(rows, { status: "completed" }).map((p) => p.name)).toEqual(["Amber Ito"]);
  });

  it("searches people and sorts them by their best line", () => {
    expect(queryPeople(rows, { q: "bo@" }).map((p) => p.name)).toEqual(["Bo Diaz"]);
    expect(queryPeople(rows, { sort: "progress", dir: "desc" }).map((p) => p.name)).toEqual([
      "Amber Ito",
      "Bo Diaz",
      "Cy Lee",
    ]);
    expect(queryPeople(rows, { sort: "progress", dir: "asc" }).map((p) => p.name)).toEqual([
      "Bo Diaz",
      "Amber Ito",
      "Cy Lee",
    ]);
  });
});
