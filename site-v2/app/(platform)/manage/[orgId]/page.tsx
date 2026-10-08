import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { RpcError } from "@/lib/rpc";
import { listOrganizations } from "@/features/organizations/organizations";
import { listCohorts } from "@/features/organizations/cohorts";
import { AppShell } from "@/components/layout/AppShell";
import { NewCohort } from "@/components/manage/NewCohort";
import { reportEnrollments } from "@/features/reporting/reports";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";
import { Card } from "@/components/pglearn/ui/card";
import { pageContainer } from "@/components/pglearn/layout";

/*
 * spec/04 /manage/[orgId]: "Assigned/started/completed/overdue totals, cohorts,
 * reports. Zero denominator displayed '—'; no org available gives access page;
 * no personal data."
 *
 * The last clause is why this page shows counts and nothing else. Names,
 * addresses and progress belong on the reports screen, which a manager opens
 * deliberately.
 */

export const metadata: Metadata = { title: "Organization" };

export default async function ManagePage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!(await verifiedUser())) redirect(`/login?next=/manage/${orgId}`);

  let report;
  let organizations;
  let cohorts;
  try {
    [report, organizations, cohorts] = await Promise.all([
      reportEnrollments({ organization_id: orgId }),
      listOrganizations(100),
      listCohorts(orgId),
    ]);
  } catch (err) {
    // The database refuses an organization the caller does not manage, so this
    // is the "no org available" access page rather than a broken screen.
    if (err instanceof RpcError && (err.code === "FORBIDDEN" || err.code === "NOT_FOUND")) {
      return <NoAccess />;
    }
    throw err;
  }

  const organization = organizations.items.find((o) => o.id === orgId);
  const { summary } = report;

  return (
    <AppShell active="manage">
    <main className={`${pageContainer} py-12 [&>*]:max-w-4xl`}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">{organization?.name ?? "Organization"}</h1>
      <p className="mt-2 text-sm text-ui-muted-foreground">
        Learning across this organization. Individual records are on the reports screen.
      </p>

      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Total label="Assigned" value={summary.assigned} />
        <Total label="Started" value={summary.in_progress} />
        <Total label="Completed" value={summary.completed} />
        <Total label="Overdue" value={summary.overdue} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* spec/04: "Zero denominator displayed '—'". */}
        <Total
          label="Completion rate"
          value={summary.completion_rate === null ? "—" : `${summary.completion_rate}%`}
        />
        <Total
          label="Average progress"
          value={summary.average_progress === null ? "—" : `${summary.average_progress}%`}
        />
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button variant="primary" size="sm" asChild>
          <Link href={`/manage/${orgId}/reports`}>Reports</Link>
        </Button>
      </div>

      <section className="mt-12 border-t border-ui-border pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold text-ui-foreground">Cohorts</h2>
          <NewCohort organizationId={orgId} />
        </div>

        {cohorts.items.length === 0 ? (
          <p className="mt-3 text-sm text-ui-muted-foreground">
            No cohorts yet. A cohort is a group of learners who are assigned the same programme on
            the same dates.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {cohorts.items.map((cohort) => (
              <li key={cohort.id}>
                <Link
                  href={`/manage/${orgId}/cohorts/${cohort.id}`}
                  className="text-base leading-relaxed pglearn-link"
                >
                  {cohort.name}
                </Link>
                {cohort.archived_at && (
                  <span className="ml-2 text-sm text-ui-muted-foreground">archived</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
    </AppShell>
  );
}

function Total({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-ui-muted-foreground">{label}</p>
      <p className="tabular mt-2 font-heading text-xl font-semibold text-ui-foreground">{value}</p>
    </Card>
  );
}

function NoAccess() {
  return (
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">This organization is not available</h1>
      <Alert variant="info" className="mt-6">
        You are not a manager of it, or it may no longer be active.
      </Alert>
      <p className="mt-8 text-sm">
        <Link href="/learn" className="pglearn-link">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
