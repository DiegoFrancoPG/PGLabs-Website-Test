import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { verifiedUser } from "@/lib/auth";
import { RpcError } from "@/lib/rpc";
import { listOrganizations } from "@/features/organizations/organizations";
import { listCohorts, listCohortMembers } from "@/features/organizations/cohorts";
import { listGrants } from "@/features/organizations/grants";
import { listPrograms } from "@/features/content/content";
import { reportEnrollments, type ReportRow } from "@/features/reporting/reports";
import { listOfferings } from "@/features/content/enrollment";
import {
  SORT_KEYS,
  STAFF_COHORT_NAME,
  buildStaffRows,
  queryPeople,
  type SortKey,
  type StaffQuery,
  type StaffPerson,
  type StaffRow,
  type StaffStatus,
} from "@/lib/staff";
import { AppShell } from "@/components/layout/AppShell";
import { AddStaff } from "@/components/manage/AddStaff";
import { AssignProgram } from "@/components/manage/AssignProgram";
import { ProgramDates, type ProgramSchedule } from "@/components/manage/ProgramDates";
import { Alert } from "@/components/pglearn/ui/alert";
import { Badge } from "@/components/pglearn/ui/badge";
import { Button } from "@/components/pglearn/ui/button";
import { Card } from "@/components/pglearn/ui/card";
import { Progress } from "@/components/pglearn/ui/progress";
import { pageContainer } from "@/components/pglearn/layout";

/*
 * spec/04 /manage/[orgId], cut down for the PG Learn launch: no cohorts. The
 * organization's totals, and directly below them the staff list — everybody
 * in the organization with each program's progress — with the two actions a
 * manager needs: add people and assign a program.
 *
 * The list's filters and sort live in the URL, like the reports screen, so a
 * view can be shared and the CSV export is the same report.
 *
 * Behind the list sit the cohorts the data model still requires (lib/staff
 * explains the join). The cohort and reports routes remain reachable by URL.
 */

export const metadata: Metadata = { title: "Organization" };

type Search = Record<string, string | string[] | undefined>;

const STATUSES: { value: StaffStatus; label: string }[] = [
  { value: "not_assigned", label: "Not assigned" },
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label])) as Record<
  StaffStatus,
  string
>;

function one(search: Search, name: string): string | undefined {
  const value = search[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function queryFrom(search: Search): StaffQuery {
  const status = one(search, "status");
  const sort = one(search, "sort");
  const overdue = one(search, "overdue");
  return {
    q: one(search, "q"),
    status: STATUSES.some((s) => s.value === status) ? (status as StaffStatus) : undefined,
    overdue: overdue === "true" ? true : overdue === "false" ? false : undefined,
    program: one(search, "program"),
    sort: (SORT_KEYS as readonly string[]).includes(sort ?? "") ? (sort as SortKey) : "name",
    dir: one(search, "dir") === "desc" ? "desc" : "asc",
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

/*
 * Every enrollment in the organization, or in one assignment, page by page
 * (the RPC caps a page at 100).
 */
async function allEnrollments(orgId: string, offeringId?: string) {
  const scope = offeringId ? { offering_id: offeringId } : { organization_id: orgId };
  const first = await reportEnrollments({ ...scope, limit: 100 });
  const items: ReportRow[] = [...first.items];
  let cursor = first.next_cursor;
  for (let page = 0; cursor && page < 50; page += 1) {
    const next = await reportEnrollments({ ...scope, limit: 100, cursor });
    items.push(...next.items);
    cursor = next.next_cursor;
  }
  return { summary: first.summary, items };
}

export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Search>;
}) {
  const { orgId } = await params;
  const search = await searchParams;
  if (!(await verifiedUser())) redirect(`/login?next=/manage/${orgId}`);

  let report;
  let organizations;
  let cohorts;
  let grants;
  let programs;
  let offerings;
  try {
    [report, organizations, cohorts, grants, programs, offerings] = await Promise.all([
      allEnrollments(orgId),
      listOrganizations(100),
      listCohorts(orgId),
      listGrants(orgId),
      listPrograms(),
      listOfferings(orgId),
    ]);
  } catch (err) {
    // The database refuses an organization the caller does not manage, so this
    // is the "no org available" access page rather than a broken screen.
    if (err instanceof RpcError && (err.code === "FORBIDDEN" || err.code === "NOT_FOUND")) {
      return <NoAccess />;
    }
    throw err;
  }

  const live = cohorts.items.filter((cohort) => !cohort.archived_at);
  // New people join the "Staff" cohort; an organization set up with cohorts
  // before the launch keeps using its first one.
  const staffCohort =
    live.find((cohort) => cohort.name.toLowerCase() === STAFF_COHORT_NAME.toLowerCase()) ?? live[0] ?? null;
  const memberLists = await Promise.all(live.map((cohort) => listCohortMembers(cohort.id)));
  const members = memberLists.flatMap((list) => list.items);
  const staffMembers = staffCohort ? memberLists[live.indexOf(staffCohort)].items : [];

  const organization = organizations.items.find((o) => o.id === orgId);
  const { summary } = report;

  const allRows = buildStaffRows(members, report.items, new Date());
  const query = queryFrom(search);
  // One row per person; a person in several programs gets a line per program.
  const people = queryPeople(allRows, query);
  const programNames = [...new Set(allRows.map((row) => row.program).filter((p): p is string => !!p))].sort();
  const peopleTotal = new Set(allRows.map((row) => row.email.toLowerCase())).size;
  const filtered = Boolean(query.q || query.status || query.overdue !== undefined || query.program);

  const activeGrants = grants.items.filter((grant) => grant.status === "active");

  /*
   * D-17: each assignment's dates, editable. An assignment nobody is on any
   * more (everybody moved to a newer version, or cancelled) is left out.
   */
  const schedules: ProgramSchedule[] = (
    await Promise.all(
      offerings.items
        .filter((offering) => offering.status === "active")
        .map(async (offering) => {
          const rows = (await allEnrollments(orgId, offering.id)).items;
          return {
            offeringId: offering.id,
            programTitle: programs.items.find((p) => p.id === offering.program_id)?.title ?? "A program",
            version: rows[0]?.version_number ?? null,
            startsAt: offering.starts_at,
            dueAt: offering.due_at,
            accessEndsAt: offering.access_ends_at,
            openEnrollmentIds: rows
              .filter((row) => row.state === "not_started" || row.state === "in_progress")
              .map((row) => row.enrollment_id),
            people: rows.length,
          };
        })
    )
  )
    .filter((schedule) => schedule.people > 0)
    .sort((a, b) => a.programTitle.localeCompare(b.programTitle) || (b.version ?? 0) - (a.version ?? 0));

  return (
    <AppShell active="manage">
      <main className={`${pageContainer} py-8 sm:py-10`}>
        <p className="flex items-center gap-3 text-ui-eyebrow uppercase text-ui-muted-foreground">
          <span aria-hidden className="h-px w-8 bg-ui-brand" />
          Organization
        </p>
        <h1 className="mt-3 font-heading text-ui-title text-ui-foreground">
          {organization?.name ?? "Organization"}
        </h1>
        <p className="mt-2 text-ui-body text-ui-muted-foreground">
          How your staff are progressing through their assigned programs.
        </p>

        <section aria-label="Organization totals" className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Total label="Staff" value={peopleTotal} />
          <Total label="Assigned" value={summary.assigned} />
          <Total label="In progress" value={summary.in_progress} />
          <Total label="Completed" value={summary.completed} />
          <Total label="Overdue" value={summary.overdue} />
          {/* spec/04: "Zero denominator displayed '—'". */}
          <Total
            label="Completion rate"
            value={summary.completion_rate === null ? "—" : `${summary.completion_rate}%`}
          />
        </section>

        {schedules.length > 0 && (
          <section aria-labelledby="programs-title" className="mt-10">
            <h2 id="programs-title" className="font-heading text-ui-heading text-ui-foreground">
              Assigned programs
            </h2>
            <p className="mt-1 text-ui-body text-ui-muted-foreground">
              When each program starts, when it is due, and when access ends.
            </p>
            <Card className="mt-4 px-5 py-2">
              <ul className="flex flex-col divide-y divide-ui-border">
                {schedules.map((schedule) => (
                  <ProgramDates key={schedule.offeringId} schedule={schedule} />
                ))}
              </ul>
            </Card>
          </section>
        )}

        <section aria-labelledby="staff-title" className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="staff-title" className="font-heading text-ui-heading text-ui-foreground">
                Staff
              </h2>
              <p className="mt-1 text-ui-body text-ui-muted-foreground">
                Add people, assign them a program, and follow each person&rsquo;s progress.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/v1/reports/enrollments.csv?organization_id=${orgId}`}>
                  <Download aria-hidden />
                  Export CSV
                </a>
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3">
            <AddStaff organizationId={orgId} cohortId={staffCohort?.id ?? null} />
            {staffCohort &&
              (activeGrants.length === 0 ? (
                <Alert variant="info">
                  This organization has no programs to assign yet. PG Labs will make them available.
                </Alert>
              ) : (
                <AssignProgram
                  cohortId={staffCohort.id}
                  grants={activeGrants.map((grant) => {
                    const program = programs.items.find((p) => p.id === grant.program_id);
                    return {
                      id: grant.id,
                      programId: grant.program_id,
                      programTitle: program?.title ?? "A program",
                      // Only a PUBLISHED version can be assigned.
                      versionId: program?.latest_published_version_id ?? null,
                    };
                  })}
                  members={staffMembers
                    .filter((member) => member.status === "active")
                    .map((member) => ({
                      userId: member.user_id,
                      name: member.display_name,
                      email: member.email,
                    }))}
                />
              ))}
          </div>

          <form method="get" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
            <Field label="Search" htmlFor="q">
              <input
                id="q"
                name="q"
                type="search"
                placeholder="Name or email"
                defaultValue={query.q ?? ""}
                className="w-full pglearn-field"
              />
            </Field>
            <Field label="Status" htmlFor="status">
              <select id="status" name="status" defaultValue={query.status ?? ""} className="w-full pglearn-field">
                <option value="">All statuses</option>
                {STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Overdue" htmlFor="overdue">
              <select
                id="overdue"
                name="overdue"
                defaultValue={query.overdue === undefined ? "" : String(query.overdue)}
                className="w-full pglearn-field"
              >
                <option value="">Any</option>
                <option value="true">Overdue only</option>
                <option value="false">Not overdue</option>
              </select>
            </Field>
            <Field label="Program" htmlFor="program">
              <select id="program" name="program" defaultValue={query.program ?? ""} className="w-full pglearn-field">
                <option value="">All programs</option>
                {programNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            {/* Keep the chosen sort when filters change. */}
            <input type="hidden" name="sort" value={query.sort} />
            <input type="hidden" name="dir" value={query.dir} />
            <div className="flex items-end gap-2">
              <Button type="submit" variant="primary" size="sm">
                Apply
              </Button>
              {filtered && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/manage/${orgId}`}>Clear</Link>
                </Button>
              )}
            </div>
          </form>

          {allRows.length === 0 ? (
            <Card className="mt-6 p-8">
              <p className="text-ui-lead text-ui-foreground">Nobody has been added yet.</p>
              <p className="mt-2 text-ui-body text-ui-muted-foreground">
                Add the people in your organization, then assign them a program.
              </p>
            </Card>
          ) : people.length === 0 ? (
            <Card className="mt-6 p-8">
              <p className="text-ui-lead text-ui-foreground">Nobody matches these filters.</p>
              <p className="mt-2 text-ui-body text-ui-muted-foreground">
                <Link href={`/manage/${orgId}`} className="pglearn-link">
                  Clear the filters
                </Link>
              </p>
            </Card>
          ) : (
            /* spec/04: "table horizontal scrolling is acceptable on mobile". */
            <Card className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[60rem] border-collapse text-ui-body">
                <caption className="sr-only">
                  Staff of {organization?.name}, {people.length} {people.length === 1 ? "person" : "people"}
                </caption>
                <thead>
                  <tr className="border-b border-ui-border text-left">
                    <SortHeader label="Person" column="name" query={query} search={search} orgId={orgId} />
                    <SortHeader label="Program" column="program" query={query} search={search} orgId={orgId} />
                    <SortHeader label="Status" column="status" query={query} search={search} orgId={orgId} />
                    <SortHeader label="Progress" column="progress" query={query} search={search} orgId={orgId} />
                    <SortHeader label="Due" column="due" query={query} search={search} orgId={orgId} />
                    <SortHeader label="Completed" column="completed" query={query} search={search} orgId={orgId} />
                    <SortHeader label="Last activity" column="activity" query={query} search={search} orgId={orgId} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ui-border">
                  {people.map((person) => (
                    <PersonRow key={person.key} person={person} />
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {people.length > 0 && (
            <p className="mt-3 text-ui-caption text-ui-muted-foreground">
              Showing {people.length} of {peopleTotal} {peopleTotal === 1 ? "person" : "people"}. Dates are
              in UTC.
            </p>
          )}
        </section>
      </main>
    </AppShell>
  );
}

/*
 * One person, once. Every column after the first holds one line per program
 * they are assigned, in the same order and height, so a program's status,
 * progress and dates read across.
 */
function PersonRow({ person }: { person: StaffPerson }) {
  const lines = (render: (row: StaffRow) => React.ReactNode) => (
    <div className="flex flex-col divide-y divide-ui-border">
      {person.entries.map((row) => (
        <div key={row.key} className="flex min-h-11 items-center py-1.5">
          {render(row)}
        </div>
      ))}
    </div>
  );

  return (
    <tr className="align-top">
      <td className="px-5 py-3">
        <span className="font-semibold text-ui-foreground">{person.name}</span>
        {person.account === "invited" && (
          <>
            {" "}
            <Badge variant="outline">Invited</Badge>
          </>
        )}
        {person.account === "removed" && (
          <>
            {" "}
            <Badge variant="outline">Removed</Badge>
          </>
        )}
        <br />
        <span className="text-ui-muted-foreground">{person.email}</span>
      </td>
      <td className="px-5 py-1.5">
        {lines((row) =>
          row.program ? (
            <span>
              {row.program}
              {row.version !== null && <span className="text-ui-muted-foreground"> · v{row.version}</span>}
            </span>
          ) : (
            <span className="text-ui-muted-foreground">—</span>
          )
        )}
      </td>
      <td className="px-5 py-1.5">
        {lines((row) => (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <Badge
              variant={
                row.status === "completed" ? "azure" : row.status === "not_assigned" ? "outline" : "secondary"
              }
            >
              {STATUS_LABEL[row.status]}
            </Badge>
            {row.overdue && <Badge variant="coral">Overdue</Badge>}
          </span>
        ))}
      </td>
      <td className="px-5 py-1.5">
        {lines((row) =>
          row.progress === null ? (
            <span className="text-ui-muted-foreground">—</span>
          ) : (
            <div className="flex min-w-[8rem] flex-1 items-center gap-3">
              <Progress
                value={row.progress}
                className="flex-1"
                aria-label={`${person.name}, ${row.program ?? "program"} progress`}
              />
              <span className="tabular w-10 text-right text-ui-foreground">{row.progress}%</span>
            </div>
          )
        )}
      </td>
      <td className="tabular px-5 py-1.5">{lines((row) => formatDate(row.dueAt))}</td>
      <td className="tabular px-5 py-1.5">
        {lines((row) => (
          <>
            {formatDate(row.completedAt)}
            {row.onTime === false && <span className="text-ui-destructive">&nbsp;late</span>}
          </>
        ))}
      </td>
      <td className="tabular px-5 py-1.5">{lines((row) => formatDate(row.lastActivityAt))}</td>
    </tr>
  );
}

/* A column header that sorts by its column, and reverses when already sorted by it. */
function SortHeader({
  label,
  column,
  query,
  search,
  orgId,
}: {
  label: string;
  column: SortKey;
  query: StaffQuery;
  search: Search;
  orgId: string;
}) {
  const current = query.sort === column;
  const params = new URLSearchParams();
  for (const name of ["q", "status", "overdue", "program"]) {
    const value = one(search, name);
    if (value) params.set(name, value);
  }
  params.set("sort", column);
  params.set("dir", current && query.dir === "asc" ? "desc" : "asc");
  const Icon = query.dir === "desc" ? ArrowDown : ArrowUp;

  return (
    <th
      scope="col"
      aria-sort={current ? (query.dir === "desc" ? "descending" : "ascending") : undefined}
      className="px-5 py-3 text-ui-eyebrow uppercase text-ui-muted-foreground"
    >
      <Link
        href={`/manage/${orgId}?${params.toString()}`}
        className="inline-flex items-center gap-1 hover:text-ui-foreground"
      >
        {label}
        {current && <Icon aria-hidden className="size-3" />}
      </Link>
    </th>
  );
}

function Total({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-5">
      <p className="text-ui-eyebrow uppercase text-ui-muted-foreground">{label}</p>
      <p className="tabular mt-2 font-heading text-ui-heading text-ui-foreground">{value}</p>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-ui-eyebrow uppercase text-ui-muted-foreground">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function NoAccess() {
  return (
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-ui-title text-ui-foreground">This organization is not available</h1>
      <Alert variant="info" className="mt-6">
        You are not a manager of it, or it may no longer be active.
      </Alert>
      <p className="mt-8 text-ui-body">
        <Link href="/learn" className="pglearn-link">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
