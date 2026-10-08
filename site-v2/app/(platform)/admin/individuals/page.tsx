import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { RpcError } from "@/lib/rpc";
import { listPrograms } from "@/features/content/content";
import { reportEnrollments } from "@/features/reporting/reports";
import { AppShell } from "@/components/layout/AppShell";
import { InviteIndividual } from "@/components/admin/InviteIndividual";
import { Alert } from "@/components/pglearn/ui/alert";
import { Badge } from "@/components/pglearn/ui/badge";
import { Card } from "@/components/pglearn/ui/card";
import { pageContainer } from "@/components/pglearn/layout";

/*
 * spec/04 /admin/individuals: "Invite individual email/name; choose individual
 * grant, program version and dates; enroll. Show identity invitation state and
 * assigned program; no fake organization required."
 *
 * That last clause is the design. An individual learner has no organization at
 * all — their grant names them directly, their enrollment has a null
 * organization_id, and no manager can ever see them. Inventing a one-person
 * organization to make the model fit would have made them visible to whoever
 * managed it.
 */

export const metadata: Metadata = { title: "Individuals" };

export default async function IndividualsPage() {
  if (!(await verifiedUser())) redirect("/login?next=/admin/individuals");

  /*
   * Established, not inferred. list_programs deliberately answers a MANAGER
   * too — they need to know what they may assign — so a refusal is not a
   * reliable signal that somebody is an administrator.
   */
  if (!(await getMe()).platform_admin) return <NoAccess />;

  let programs;
  let report;
  try {
    [programs, report] = await Promise.all([
      listPrograms(),
      // Everything, then narrowed to the rows that belong to no organization.
      reportEnrollments({ limit: 100 }),
    ]);
  } catch (err) {
    if (err instanceof RpcError && err.code === "FORBIDDEN") return <NoAccess />;
    throw err;
  }

  const individuals = report.items.filter((row) => row.organization === null);
  const assignable = programs.items.filter(
    (program) => !program.archived && program.latest_published_version_id !== null
  );

  return (
    <AppShell active="admin">
      <main className={`${pageContainer} py-12 [&>*]:max-w-4xl`}>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">Individuals</h1>
        <p className="mt-2 text-sm text-ui-muted-foreground">
          Learners who hold a programme in their own right rather than through an organization. No
          organization is created for them, and no manager can see their record.
        </p>

        <div className="mt-8">
          {assignable.length === 0 ? (
            <Alert variant="info">
              No programme has a published version yet, so there is nothing an individual could be
              enrolled in.
            </Alert>
          ) : (
            <InviteIndividual
              programs={assignable.map((program) => ({
                id: program.id,
                title: program.title,
                versionId: program.latest_published_version_id as string,
              }))}
            />
          )}
        </div>

        <section className="mt-10">
          <h2 className="font-heading text-lg font-semibold text-ui-foreground">Enrolled individuals</h2>
          {individuals.length === 0 ? (
            <Card className="mt-4 p-6">
              <p className="text-sm">Nobody holds a personal grant yet.</p>
            </Card>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <caption className="sr-only">Individual learners and their programmes</caption>
                <thead>
                  <tr className="border-b border-ui-border text-left">
                    <th scope="col" className="py-2 pr-4 text-xs font-medium uppercase tracking-wider text-ui-muted-foreground">
                      Learner
                    </th>
                    <th scope="col" className="py-2 pr-4 text-xs font-medium uppercase tracking-wider text-ui-muted-foreground">
                      Account
                    </th>
                    <th scope="col" className="py-2 pr-4 text-xs font-medium uppercase tracking-wider text-ui-muted-foreground">
                      Program
                    </th>
                    <th scope="col" className="py-2 text-xs font-medium uppercase tracking-wider text-ui-muted-foreground">
                      Progress
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {individuals.map((row) => (
                    <tr key={row.enrollment_id} className="border-b border-ui-border">
                      <td className="py-3 pr-4">
                        <span className="text-ui-foreground">{row.learner_name}</span>
                        <br />
                        <span className="text-ui-muted-foreground">{row.learner_email}</span>
                      </td>
                      <td className="py-3 pr-4">
                        {/* spec/04: "Show identity invitation state". */}
                        <Badge variant={row.invitation_state === "accepted" ? "azure" : "outline"}>
                          {row.invitation_state}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4">
                        {row.program} <span className="text-ui-muted-foreground">v{row.version_number}</span>
                      </td>
                      <td className="tabular py-3">
                        {row.progress_percent}%{" "}
                        <span className="text-ui-muted-foreground">
                          ({row.required_completed}/{row.required_total})
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function NoAccess() {
  return (
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">This page is not available</h1>
      <Alert variant="info" className="mt-6">
        Individual enrolment is for platform administrators.
      </Alert>
      <p className="mt-8 text-sm">
        <Link href="/learn" className="pglearn-link">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
