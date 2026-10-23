/*
 * The manager's staff list, for the PG Learn launch.
 *
 * Managers see one list of their organization's people instead of cohorts.
 * Underneath, people still belong to cohorts (learning is assigned to a
 * cohort), and their progress comes from the enrollment report. This module
 * joins the two — every person once per program they were assigned, and once
 * with "Not assigned" if they have nothing yet — then filters and sorts the
 * result the way the screen's controls ask. It is pure, so it is tested
 * without a database.
 */

/** The cohort new staff join; created on the first addition. */
export const STAFF_COHORT_NAME = "Staff";

export interface StaffMember {
  user_id: string;
  display_name: string;
  email: string;
  membership_status: "invited" | "active" | "removed";
}

/** The ReportRow fields the list uses. */
export interface StaffEnrollment {
  enrollment_id: string;
  program: string;
  version_number?: number;
  learner_name: string;
  learner_email: string;
  invitation_state: "pending" | "accepted" | "expired" | "cancelled" | "none";
  state: "not_started" | "in_progress" | "completed" | "cancelled";
  due_at: string;
  required_completed: number;
  required_total: number;
  progress_percent: number;
  last_activity_at: string | null;
  completed_at: string | null;
  on_time: boolean | null;
}

export type StaffStatus = StaffEnrollment["state"] | "not_assigned";

export interface StaffRow {
  key: string;
  name: string;
  email: string;
  /** Whether they have joined yet: "invited" until the invitation is accepted. */
  account: "invited" | "active" | "removed";
  program: string | null;
  /** The program version the enrollment is on, when there is one. */
  version: number | null;
  status: StaffStatus;
  progress: number | null;
  requiredCompleted: number | null;
  requiredTotal: number | null;
  dueAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
  onTime: boolean | null;
  overdue: boolean;
}

export const SORT_KEYS = ["name", "program", "status", "progress", "due", "completed", "activity"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface StaffQuery {
  q?: string;
  status?: StaffStatus;
  overdue?: boolean;
  program?: string;
  sort?: SortKey;
  dir?: "asc" | "desc";
}

const key = (email: string) => email.trim().toLowerCase();

function accountFrom(invitation: StaffEnrollment["invitation_state"]): StaffRow["account"] {
  if (invitation === "accepted" || invitation === "none") return "active";
  if (invitation === "cancelled") return "removed";
  return "invited";
}

export function buildStaffRows(
  members: StaffMember[],
  enrollments: StaffEnrollment[],
  now: Date
): StaffRow[] {
  const rows: StaffRow[] = [];
  const byEmail = new Map<string, StaffEnrollment[]>();
  for (const enrollment of enrollments) {
    const list = byEmail.get(key(enrollment.learner_email)) ?? [];
    list.push(enrollment);
    byEmail.set(key(enrollment.learner_email), list);
  }

  // One person can sit in several cohorts; they are listed once.
  const seen = new Set<string>();
  for (const member of members) {
    const email = key(member.email);
    if (seen.has(email)) continue;
    seen.add(email);
    if (member.membership_status === "removed" && !byEmail.has(email)) continue;
    if (!byEmail.has(email)) {
      rows.push({
        key: `member:${member.user_id}`,
        name: member.display_name,
        email: member.email,
        account: member.membership_status,
        program: null,
        version: null,
        status: "not_assigned",
        progress: null,
        requiredCompleted: null,
        requiredTotal: null,
        dueAt: null,
        completedAt: null,
        lastActivityAt: null,
        onTime: null,
        overdue: false,
      });
    }
  }

  // Everybody with an enrollment, whether or not a cohort listing found them.
  for (const [email, list] of byEmail) {
    const member = members.find((m) => key(m.email) === email);
    for (const enrollment of list) {
      const open = enrollment.state === "not_started" || enrollment.state === "in_progress";
      rows.push({
        key: `enrollment:${enrollment.enrollment_id}`,
        name: member?.display_name ?? enrollment.learner_name,
        email: member?.email ?? enrollment.learner_email,
        account: member?.membership_status ?? accountFrom(enrollment.invitation_state),
        program: enrollment.program,
        version: enrollment.version_number ?? null,
        status: enrollment.state,
        progress: enrollment.progress_percent,
        requiredCompleted: enrollment.required_completed,
        requiredTotal: enrollment.required_total,
        dueAt: enrollment.due_at,
        completedAt: enrollment.completed_at,
        lastActivityAt: enrollment.last_activity_at,
        onTime: enrollment.on_time,
        overdue: open && Date.parse(enrollment.due_at) < now.getTime(),
      });
    }
  }

  return rows;
}

const STATUS_ORDER: Record<StaffStatus, number> = {
  not_assigned: 0,
  not_started: 1,
  in_progress: 2,
  completed: 3,
  cancelled: 4,
};

function compare(a: StaffRow, b: StaffRow, sort: SortKey): number {
  const text = (x: string | null, y: string | null) => (x ?? "").localeCompare(y ?? "", "en", { sensitivity: "base" });
  // Empty values sort last whichever way the column is ordered; see sortRows.
  const num = (x: number | null, y: number | null) => (x ?? -Infinity) - (y ?? -Infinity);
  const time = (x: string | null, y: string | null) => num(x ? Date.parse(x) : null, y ? Date.parse(y) : null);
  switch (sort) {
    case "name":
      return text(a.name, b.name);
    case "program":
      return text(a.program, b.program);
    case "status":
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case "progress":
      return num(a.progress, b.progress);
    case "due":
      return time(a.dueAt, b.dueAt);
    case "completed":
      return time(a.completedAt, b.completedAt);
    case "activity":
      return time(a.lastActivityAt, b.lastActivityAt);
  }
}

function isEmpty(row: StaffRow, sort: SortKey): boolean {
  switch (sort) {
    case "program":
      return row.program === null;
    case "progress":
      return row.progress === null;
    case "due":
      return row.dueAt === null;
    case "completed":
      return row.completedAt === null;
    case "activity":
      return row.lastActivityAt === null;
    default:
      return false;
  }
}

export function queryStaff(rows: StaffRow[], query: StaffQuery): StaffRow[] {
  const q = query.q?.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (q && !row.name.toLowerCase().includes(q) && !row.email.toLowerCase().includes(q)) return false;
    if (query.status && row.status !== query.status) return false;
    if (query.overdue !== undefined && row.overdue !== query.overdue) return false;
    if (query.program && row.program !== query.program) return false;
    return true;
  });

  const sort = query.sort ?? "name";
  const sign = query.dir === "desc" ? -1 : 1;
  return filtered.sort((a, b) => {
    // Rows with no value for the column stay at the bottom in both directions.
    const emptyA = isEmpty(a, sort);
    const emptyB = isEmpty(b, sort);
    if (emptyA !== emptyB) return emptyA ? 1 : -1;
    return sign * compare(a, b, sort) || a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}

/*
 * One row per person on the screen: a person learning several programs is
 * listed once, with one line per program in each column. The program-level
 * filters (status, overdue, program) choose which of their lines show, and a
 * person with none left is not listed; the search matches the person.
 * Sorting compares people by their lines: the highest progress, the earliest
 * due date, the latest completion or activity.
 */
export interface StaffPerson {
  key: string;
  name: string;
  email: string;
  account: StaffRow["account"];
  entries: StaffRow[];
}

function group(rows: StaffRow[]): StaffPerson[] {
  const people = new Map<string, StaffPerson>();
  for (const row of rows) {
    const id = row.email.trim().toLowerCase();
    const person = people.get(id);
    if (person) {
      person.entries.push(row);
      // Accepted anywhere means they have an account.
      if (row.account === "active") person.account = "active";
    } else {
      people.set(id, { key: `person:${id}`, name: row.name, email: row.email, account: row.account, entries: [row] });
    }
  }
  return [...people.values()];
}

function pick(values: (string | number | null)[], want: "max" | "min"): number | null {
  const numbers = values
    .filter((v): v is string | number => v !== null)
    .map((v) => (typeof v === "number" ? v : Date.parse(v)));
  if (numbers.length === 0) return null;
  return want === "max" ? Math.max(...numbers) : Math.min(...numbers);
}

function personKey(person: StaffPerson, sort: SortKey): string | number | null {
  const e = person.entries;
  switch (sort) {
    case "name":
      return person.name;
    case "program":
      return e.map((r) => r.program ?? "").sort()[0] || null;
    case "status":
      return Math.min(...e.map((r) => STATUS_ORDER[r.status]));
    case "progress":
      return pick(e.map((r) => r.progress), "max");
    case "due":
      return pick(e.map((r) => r.dueAt), "min");
    case "completed":
      return pick(e.map((r) => r.completedAt), "max");
    case "activity":
      return pick(e.map((r) => r.lastActivityAt), "max");
  }
}

export function queryPeople(rows: StaffRow[], query: StaffQuery): StaffPerson[] {
  // Lines first, by every filter but the search, each person's in program order.
  const lines = queryStaff(rows, { ...query, q: undefined, sort: "program", dir: "asc" });
  const q = query.q?.trim().toLowerCase();
  const people = group(lines).filter(
    (person) => !q || person.name.toLowerCase().includes(q) || person.email.toLowerCase().includes(q)
  );

  const sort = query.sort ?? "name";
  const sign = query.dir === "desc" ? -1 : 1;
  return people.sort((a, b) => {
    const ka = personKey(a, sort);
    const kb = personKey(b, sort);
    // People with no value for the column stay at the bottom in both directions.
    if ((ka === null) !== (kb === null)) return ka === null ? 1 : -1;
    let order = 0;
    if (ka !== null && kb !== null) {
      order =
        typeof ka === "number" && typeof kb === "number"
          ? ka - kb
          : String(ka).localeCompare(String(kb), "en", { sensitivity: "base" });
    }
    return sign * order || a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}
