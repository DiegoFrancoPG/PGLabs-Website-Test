import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { RpcError } from "@/lib/rpc";
import { listOrganizations } from "@/features/organizations/organizations";
import { listOfferings } from "@/features/content/enrollment";
import { reportEnrollments, type ReportFilters, type ReportRow } from "@/features/reporting/reports";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * spec/04 /manage/[orgId]/reports: "Offering/status/overdue filters,
 * completion date range, progress table, CSV export. Explain date filter
 * basis; CSV uses same filters; empty table+zero/null metrics; failed export
 * offers retry."
 *
 * The filters live in the URL rather than in component state, so a manager can
 * send a colleague the exact view they are looking at, and so the CSV link is
 * literally the same query string — "CSV uses same filters" by construction
 * rather than by two pieces of code agreeing.
 */

export const metadata: Metadata = { title: "Reports" };

type Search = Record<string, string | string[] | undefined>;

function filtersFrom(search: Search, orgId: string): ReportFilters {
  const one = (key: string) => {
    const value = search[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  return {
    organization_id: orgId,
    offering_id: one("offering_id"),
    state: one("state") as ReportFilters["state"],
    overdue: one("overdue") === "true" ? true : one("overdue") === "false" ? false : undefined,
    completed_from: one("completed_from") ? `${one("completed_from")}T00:00:00Z` : undefined,
    completed_to: one("completed_to") ? `${one("completed_to")}T00:00:00Z` : undefined,
    cursor: one("cursor"),
    limit: 20,
  };
}

function queryString(search: Search): string {
  const params = new URLSearchParams();
  for (const key of ["offering_id", "state", "overdue", "completed_from", "completed_to"]) {
    const value = search[key];
    if (typeof value === "string" && value.length > 0) params.set(key, value);
  }
  return params.toString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<Search>;
}) {
  const { orgId } = await params;
  const search = await searchParams;
  if (!(await verifiedUser())) redirect(`/login?next=/manage/${orgId}/reports`);

  const filters = filtersFrom(search, orgId);

  let report;
  let organizations;
  let offerings;
  try {
    [report, organizations, offerings] = await Promise.all([
      reportEnrollments(filters),
      listOrganizations(100),
      listOfferings(orgId),
    ]);
  } catch (err) {
    if (err instanceof RpcError && (err.code === "FORBIDDEN" || err.code === "NOT_FOUND")) {
      return <NoAccess />;
    }
    throw err;
  }

  const organization = organizations.items.find((o) => o.id === orgId);
  const query = queryString(search);
  const { summary } = report;

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <p className="text-body-sm">
        <Link href={`/manage/${orgId}`} className="text-brand-600 underline underline-offset-4">
          {organization?.name ?? "Organization"}
        </Link>
      </p>
      <h1 className="mt-4 font-display text-h2-sm text-ink-800">Reports</h1>
      {/*
        * spec/04: "show the selected name in all manager screens and export
        * context". Labelled, so the context is announced rather than being a
        * loose line of text — and so a test can name it without competing with
        * the breadcrumb and the table caption.
        */}
      <p className="mt-2 text-body-sm text-steel-500">
        <span className="text-steel-500">Organization: </span>
        <span aria-label="Selected organization">{organization?.name}</span>
      </p>

      <form method="get" className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Offering" htmlFor="offering_id">
          <select
            id="offering_id"
            name="offering_id"
            defaultValue={(search.offering_id as string) ?? ""}
            className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
          >
            <option value="">All offerings</option>
            {/*
              * Labelled by its dates. The contract's Offering carries ids and
              * dates and no titles, and inventing a lookup here would mean a
              * manager fetching the catalog they have no business reading.
              */}
            {offerings.items.map((offering) => (
              <option key={offering.id} value={offering.id}>
                Starts {formatDateTime(offering.starts_at)}, due{" "}
                {formatDateTime(offering.due_at)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Status" htmlFor="state">
          <select
            id="state"
            name="state"
            defaultValue={(search.state as string) ?? ""}
            className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
          >
            <option value="">All active</option>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </Field>

        <Field label="Overdue" htmlFor="overdue">
          <select
            id="overdue"
            name="overdue"
            defaultValue={(search.overdue as string) ?? ""}
            className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
          >
            <option value="">Any</option>
            <option value="true">Overdue only</option>
            <option value="false">Not overdue</option>
          </select>
        </Field>

        <Field label="Completed from" htmlFor="completed_from">
          <input
            id="completed_from"
            name="completed_from"
            type="date"
            defaultValue={(search.completed_from as string) ?? ""}
            className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
          />
        </Field>

        <Field label="Completed before" htmlFor="completed_to">
          <input
            id="completed_to"
            name="completed_to"
            type="date"
            defaultValue={(search.completed_to as string) ?? ""}
            className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
          />
        </Field>

        <div className="flex items-end gap-3 lg:col-span-5">
          <Button type="submit" variant="primary" size="sm">
            Apply filters
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/manage/${orgId}/reports`}>Clear</Link>
          </Button>
          {/* The same query string the table used, so the file matches the screen. */}
          <Button variant="subtle" size="sm" asChild>
            <a
              href={`/api/v1/reports/enrollments.csv?organization_id=${orgId}${query ? `&${query}` : ""}`}
            >
              Export CSV
            </a>
          </Button>
        </div>
      </form>

      {/* spec/04: "Explain date filter basis." */}
      <p className="mt-3 text-body-sm text-steel-500">
        Date filters apply to when a learner completed the program, in UTC. From is inclusive and
        before is exclusive, and both exclude anybody who has not finished.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Assigned" value={summary.assigned} />
        <Metric label="Not started" value={summary.not_started} />
        <Metric label="In progress" value={summary.in_progress} />
        <Metric label="Completed" value={summary.completed} />
        <Metric label="Overdue" value={summary.overdue} />
        <Metric
          label="Completion"
          value={summary.completion_rate === null ? "—" : `${summary.completion_rate}%`}
        />
      </div>

      {report.items.length === 0 ? (
        <Card className="mt-8 p-8">
          <p className="text-body-lg">No enrollments match these filters.</p>
          <p className="mt-2 text-body-sm text-steel-500">
            Clear the filters, or choose a different offering.
          </p>
        </Card>
      ) : (
        /* spec/04: "table horizontal scrolling is acceptable on mobile". */
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[56rem] border-collapse text-body-sm">
            <caption className="sr-only">
              Enrollments for {organization?.name}, matching the selected filters
            </caption>
            <thead>
              <tr className="border-b border-steel-300 text-left">
                <Th>Learner</Th>
                <Th>Program</Th>
                <Th>Status</Th>
                <Th>Progress</Th>
                <Th>Due</Th>
                <Th>Completed</Th>
                <Th>Access</Th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((row) => (
                <Row key={row.enrollment_id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.next_cursor && (
        <div className="mt-6">
          <Button variant="outline" size="sm" asChild>
            <Link
              href={`/manage/${orgId}/reports?${query ? `${query}&` : ""}cursor=${encodeURIComponent(report.next_cursor)}`}
            >
              Next page
            </Link>
          </Button>
        </div>
      )}
    </main>
  );
}

function Row({ row }: { row: ReportRow }) {
  return (
    <tr className="border-b border-steel-200">
      <td className="py-3 pr-4">
        <span className="text-ink-800">{row.learner_name}</span>
        <br />
        <span className="text-steel-500">{row.learner_email}</span>
        {row.invitation_state !== "accepted" && (
          <>
            {" "}
            <Badge variant="outline">Invitation {row.invitation_state}</Badge>
          </>
        )}
      </td>
      <td className="py-3 pr-4">
        {row.program} <span className="text-steel-500">v{row.version_number}</span>
      </td>
      <td className="py-3 pr-4">{row.state.replace("_", " ")}</td>
      <td className="tabular py-3 pr-4">
        {row.progress_percent}%{" "}
        <span className="text-steel-500">
          ({row.required_completed}/{row.required_total})
        </span>
      </td>
      <td className="py-3 pr-4">{formatDateTime(row.due_at)}</td>
      <td className="py-3 pr-4">
        {row.completed_at ? (
          <>
            {formatDateTime(row.completed_at)}
            {row.on_time === false && <span className="text-coral-600"> late</span>}
          </>
        ) : (
          "—"
        )}
      </td>
      {/* "availability separately tells manager whether action is possible". */}
      <td className="py-3">{row.availability.replace("_", " ")}</td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="py-2 pr-4 text-label uppercase text-steel-500">
      {children}
    </th>
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
      <label htmlFor={htmlFor} className="text-label uppercase text-steel-500">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <p className="text-label uppercase text-steel-500">{label}</p>
      <p className="tabular mt-1 font-display text-h4 text-ink-800">{value}</p>
    </Card>
  );
}

function NoAccess() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">This organization is not available</h1>
      <Alert variant="info" className="mt-6">
        You are not a manager of it, or it may no longer be active.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
