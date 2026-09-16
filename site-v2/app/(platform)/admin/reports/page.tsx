import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { RpcError } from "@/lib/rpc";
import { listOrganizations } from "@/features/organizations/organizations";
import { reportEnrollments, type ReportFilters } from "@/features/reporting/reports";
import { AppShell } from "@/components/layout/AppShell";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * spec/04 /admin/reports: "Organization selector plus manager report filters.
 * Explicit All organizations choice; personal rows labeled Personal."
 *
 * The admin's report is the manager's with the organization bound loosened: an
 * admin may ask about everybody, which is the one scope a manager can never
 * have. Personal enrollments — which belong to no organization, and which no
 * manager can see at all — appear here, labelled as such.
 */

export const metadata: Metadata = { title: "Reports" };

type Search = Record<string, string | string[] | undefined>;

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  if (!(await verifiedUser())) redirect("/login?next=/admin/reports");

  /*
   * Established, not inferred. list_programs deliberately answers a MANAGER
   * too — they need to know what they may assign — so a refusal is not a
   * reliable signal that somebody is an administrator.
   */
  if (!(await getMe()).platform_admin) return <NoAccess />;
  const search = await searchParams;

  const organizationId =
    typeof search.organization_id === "string" && search.organization_id.length > 0
      ? search.organization_id
      : undefined;

  const filters: ReportFilters = {
    organization_id: organizationId,
    state: (typeof search.state === "string" && search.state.length > 0
      ? search.state
      : undefined) as ReportFilters["state"],
    overdue: search.overdue === "true" ? true : search.overdue === "false" ? false : undefined,
    limit: 50,
  };

  let report;
  let organizations;
  try {
    [report, organizations] = await Promise.all([
      reportEnrollments(filters),
      listOrganizations(100),
    ]);
  } catch (err) {
    if (err instanceof RpcError && err.code === "FORBIDDEN") return <NoAccess />;
    throw err;
  }

  const { summary } = report;

  return (
    <AppShell active="admin">
      <main className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="font-display text-h2-sm text-ink-800">Reports</h1>
        <p className="mt-2 text-body-sm text-steel-500">
          Every organization, and the individuals who hold a personal grant.
        </p>

        <form method="get" className="mt-8 flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="organization_id" className="block text-label uppercase text-steel-500">
              Organization
            </label>
            <select
              id="organization_id"
              name="organization_id"
              defaultValue={organizationId ?? ""}
              className="mt-1 rounded-lg border border-steel-300 p-2 text-body-sm"
            >
              {/* spec/04: "Explicit All organizations choice." */}
              <option value="">All organizations</option>
              {organizations.items.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="state" className="block text-label uppercase text-steel-500">
              Status
            </label>
            <select
              id="state"
              name="state"
              defaultValue={(search.state as string) ?? ""}
              className="mt-1 rounded-lg border border-steel-300 p-2 text-body-sm"
            >
              <option value="">All active</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label htmlFor="overdue" className="block text-label uppercase text-steel-500">
              Overdue
            </label>
            <select
              id="overdue"
              name="overdue"
              defaultValue={(search.overdue as string) ?? ""}
              className="mt-1 rounded-lg border border-steel-300 p-2 text-body-sm"
            >
              <option value="">Any</option>
              <option value="true">Overdue only</option>
              <option value="false">Not overdue</option>
            </select>
          </div>

          <Button type="submit" variant="primary" size="sm">
            Apply filters
          </Button>
          <Button variant="subtle" size="sm" asChild>
            <a
              href={`/api/v1/reports/enrollments.csv${
                organizationId ? `?organization_id=${organizationId}` : ""
              }`}
            >
              Export CSV
            </a>
          </Button>
        </form>

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
          </Card>
        ) : (
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-body-sm">
              <caption className="sr-only">Enrollments across every organization</caption>
              <thead>
                <tr className="border-b border-steel-300 text-left">
                  <Th>Learner</Th>
                  <Th>Where</Th>
                  <Th>Program</Th>
                  <Th>Status</Th>
                  <Th>Progress</Th>
                  <Th>Due</Th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((row) => (
                  <tr key={row.enrollment_id} className="border-b border-steel-200">
                    <td className="py-3 pr-4">
                      <span className="text-ink-800">{row.learner_name}</span>
                      <br />
                      <span className="text-steel-500">{row.learner_email}</span>
                    </td>
                    <td className="py-3 pr-4">
                      {/* spec/04: "personal rows labeled Personal." */}
                      {row.organization ?? <Badge variant="outline">Personal</Badge>}
                    </td>
                    <td className="py-3 pr-4">
                      {row.program} <span className="text-steel-500">v{row.version_number}</span>
                    </td>
                    <td className="py-3 pr-4">{row.state.replace("_", " ")}</td>
                    <td className="tabular py-3 pr-4">{row.progress_percent}%</td>
                    <td className="py-3">
                      {new Intl.DateTimeFormat("en-CA", {
                        dateStyle: "medium",
                        timeZone: "UTC",
                      }).format(new Date(row.due_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </AppShell>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="py-2 pr-4 text-label uppercase text-steel-500">
      {children}
    </th>
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
      <h1 className="font-display text-h2-sm text-ink-800">This page is not available</h1>
      <Alert variant="info" className="mt-6">
        Platform-wide reporting is for platform administrators.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
