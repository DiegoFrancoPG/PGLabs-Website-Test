import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { RpcError } from "@/lib/rpc";
import { listCohorts, listCohortMembers } from "@/features/organizations/cohorts";
import { listOrganizations } from "@/features/organizations/organizations";
import { listGrants } from "@/features/organizations/grants";
import { listOfferings } from "@/features/content/enrollment";
import { listPrograms } from "@/features/content/content";
import { AppShell } from "@/components/layout/AppShell";
import { InviteLearner } from "@/components/manage/InviteLearner";
import { AssignProgram } from "@/components/manage/AssignProgram";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Card } from "@ds/components/ui/card";

/*
 * spec/04 /manage/[orgId]/cohorts/[cohortId]: "Name, roster, invite
 * email/name, add invitation result to cohort, assign granted program/version,
 * dates, select members, cancel/reactivate enrollment. New member is not
 * auto-enrolled; assignment confirmation states count and dates; all-or-nothing
 * validation errors identify invalid selections without exposing other org
 * records."
 *
 * "New member is not auto-enrolled" is the rule that shapes this screen: the
 * roster and the assignment are two separate actions, because adding somebody
 * to a cohort is about who they are and assigning is about what they must do
 * and by when.
 */

export const metadata: Metadata = { title: "Cohort" };

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(iso)
  );
}

export default async function CohortPage({
  params,
}: {
  params: Promise<{ orgId: string; cohortId: string }>;
}) {
  const { orgId, cohortId } = await params;
  if (!(await verifiedUser())) redirect(`/login?next=/manage/${orgId}/cohorts/${cohortId}`);

  let cohorts;
  let members;
  let organizations;
  let grants;
  let offerings;
  let programs;
  try {
    [cohorts, members, organizations, grants, offerings, programs] = await Promise.all([
      listCohorts(orgId),
      listCohortMembers(cohortId),
      listOrganizations(100),
      listGrants(orgId),
      listOfferings(orgId),
      listPrograms(),
    ]);
  } catch (err) {
    if (err instanceof RpcError && (err.code === "FORBIDDEN" || err.code === "NOT_FOUND")) {
      return <NoAccess />;
    }
    throw err;
  }

  const cohort = cohorts.items.find((candidate) => candidate.id === cohortId);
  if (!cohort) return <NoAccess />;
  const organization = organizations.items.find((candidate) => candidate.id === orgId);

  const active = grants.items.filter((grant) => grant.status === "active");
  const cohortOfferings = offerings.items.filter((offering) => offering.cohort_id === cohortId);

  return (
    <AppShell active="manage">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-body-sm">
          <Link href={`/manage/${orgId}`} className="text-brand-600 underline underline-offset-4">
            {organization?.name ?? "Organization"}
          </Link>
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-h2-sm text-ink-800">{cohort.name}</h1>
          {cohort.archived_at && <Badge variant="outline">Archived</Badge>}
        </div>

        <section className="mt-10">
          <h2 className="font-display text-h4 text-ink-800">Roster</h2>
          <p className="mt-2 text-body-sm text-steel-500">
            Adding somebody here does not assign them anything. Assignment is the separate step
            below, because it carries dates.
          </p>

          <div className="mt-4">
            <InviteLearner organizationId={orgId} cohortId={cohortId} />
          </div>

          {members.items.length === 0 ? (
            <Card className="mt-5 p-6">
              <p className="text-body-sm">Nobody is in this cohort yet.</p>
            </Card>
          ) : (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-body-sm">
                <caption className="sr-only">Members of {cohort.name}</caption>
                <thead>
                  <tr className="border-b border-steel-300 text-left">
                    <th scope="col" className="py-2 pr-4 text-label uppercase text-steel-500">
                      Learner
                    </th>
                    <th scope="col" className="py-2 pr-4 text-label uppercase text-steel-500">
                      Account
                    </th>
                    <th scope="col" className="py-2 text-label uppercase text-steel-500">
                      In cohort
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.items.map((member) => (
                    <tr key={member.user_id} className="border-b border-steel-200">
                      <td className="py-3 pr-4">
                        <span className="text-ink-800">{member.display_name}</span>
                        <br />
                        <span className="text-steel-500">{member.email}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant={member.membership_status === "active" ? "azure" : "outline"}
                        >
                          {member.membership_status}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <Badge variant={member.status === "active" ? "default" : "outline"}>
                          {member.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-12 border-t border-steel-200 pt-8">
          <h2 className="font-display text-h4 text-ink-800">Assigned learning</h2>

          {cohortOfferings.length === 0 ? (
            <p className="mt-2 text-body-sm text-steel-500">
              Nothing has been assigned to this cohort yet.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {cohortOfferings.map((offering) => (
                <li key={offering.id} className="text-body-sm">
                  Starts {formatDate(offering.starts_at)}, due {formatDate(offering.due_at)}
                  {offering.access_ends_at
                    ? `, access ends ${formatDate(offering.access_ends_at)}`
                    : ""}{" "}
                  <Badge variant={offering.status === "active" ? "azure" : "coral"}>
                    {offering.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}

          {active.length === 0 ? (
            <Alert variant="info" className="mt-5">
              This organization has no active program grants, so there is nothing to assign yet.
            </Alert>
          ) : (
            <div className="mt-5">
              <AssignProgram
                organizationId={orgId}
                cohortId={cohortId}
                grants={active.map((grant) => {
                  const program = programs.items.find((p) => p.id === grant.program_id);
                  return {
                    id: grant.id,
                    programId: grant.program_id,
                    programTitle: program?.title ?? "A program",
                    // Only a PUBLISHED version can be assigned; a grant whose
                    // program has none is shown as not yet assignable.
                    versionId: program?.latest_published_version_id ?? null,
                  };
                })}
                members={members.items
                  .filter((member) => member.status === "active")
                  .map((member) => ({
                    userId: member.user_id,
                    name: member.display_name,
                    email: member.email,
                  }))}
              />
            </div>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function NoAccess() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">This cohort is not available</h1>
      <Alert variant="info" className="mt-6">
        It may not exist, or it may belong to an organization you do not manage.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
