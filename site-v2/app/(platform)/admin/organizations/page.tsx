import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { RpcError } from "@/lib/rpc";
import { listOrganizations } from "@/features/organizations/organizations";
import { listPrograms } from "@/features/content/content";
import { listGrants } from "@/features/organizations/grants";
import { AppShell } from "@/components/layout/AppShell";
import { NewOrganization } from "@/components/admin/NewOrganization";
import { GrantAccess } from "@/components/admin/GrantAccess";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * spec/04 /admin/organizations: "Create name/timezone/initial manager
 * email/name; edit organization status; manager management; catalog grant
 * dates/status. Cannot remove last accepted manager; creation provisioning
 * status/error is explicit; no secret email links."
 *
 * The last clause is why nothing here shows an invitation link. Creating an
 * organization provisions its first manager, and the link that reaches them
 * goes by email and lives only in the private outbox payload.
 */

export const metadata: Metadata = { title: "Organizations" };

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(iso)
  );
}

export default async function OrganizationsPage() {
  if (!(await verifiedUser())) redirect("/login?next=/admin/organizations");

  /*
   * Established, not inferred. list_programs deliberately answers a MANAGER
   * too — they need to know what they may assign — so a refusal is not a
   * reliable signal that somebody is an administrator.
   */
  if (!(await getMe()).platform_admin) return <NoAccess />;

  let organizations;
  let programs;
  try {
    [organizations, programs] = await Promise.all([listOrganizations(100), listPrograms()]);
  } catch (err) {
    if (err instanceof RpcError && err.code === "FORBIDDEN") return <NoAccess />;
    throw err;
  }

  // One grant list per organization, so each card shows what it may actually run.
  const grants = await Promise.all(
    organizations.items.map(async (organization) => ({
      organizationId: organization.id,
      items: (await listGrants(organization.id)).items,
    }))
  );

  return (
    <AppShell active="admin">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="font-display text-h2-sm text-ink-800">Organizations</h1>
        <p className="mt-2 text-body-sm text-steel-500">
          Each client organization, its managers, and which programs it may assign.
        </p>

        <div className="mt-8">
          <NewOrganization />
        </div>

        {organizations.items.length === 0 ? (
          <Card className="mt-8 p-8">
            <p className="text-body-lg">There are no organizations yet.</p>
            <p className="mt-2 text-body-sm text-steel-500">
              Creating one also invites its first manager, who confirms their own account.
            </p>
          </Card>
        ) : (
          <div className="mt-10 flex flex-col gap-5">
            {organizations.items.map((organization) => {
              const held = grants.find((g) => g.organizationId === organization.id)?.items ?? [];
              return (
                <Card key={organization.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-h5 text-ink-800">{organization.name}</h2>
                      <p className="mt-1 text-body-sm text-steel-500">{organization.timezone}</p>
                    </div>
                    <Badge variant={organization.status === "active" ? "azure" : "coral"}>
                      {organization.status}
                    </Badge>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-label uppercase text-steel-500">Catalog access</h3>
                    {held.length === 0 ? (
                      <p className="mt-2 text-body-sm text-steel-500">
                        No programs granted, so nothing can be assigned here yet.
                      </p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1">
                        {held.map((grant) => (
                          <li key={grant.id} className="text-body-sm">
                            {programs.items.find((p) => p.id === grant.program_id)?.title ??
                              "A program"}{" "}
                            <span className="text-steel-500">
                              from {formatDate(grant.starts_at)}
                              {grant.ends_at ? ` until ${formatDate(grant.ends_at)}` : ""}
                            </span>{" "}
                            <Badge variant={grant.status === "active" ? "azure" : "coral"}>
                              {grant.status}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/manage/${organization.id}`}>Open</Link>
                    </Button>
                    <GrantAccess
                      organizationId={organization.id}
                      programs={programs.items
                        .filter((program) => !program.archived)
                        .map((program) => ({ id: program.id, title: program.title }))}
                    />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}

function NoAccess() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">This page is not available</h1>
      <Alert variant="info" className="mt-6">
        Organization administration is for platform administrators.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
