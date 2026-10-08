import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { RpcError } from "@/lib/rpc";
import { listPrograms } from "@/features/content/content";
import { AppShell } from "@/components/layout/AppShell";
import { NewProgram } from "@/components/admin/NewProgram";
import { ArchiveProgram } from "@/components/admin/ArchiveProgram";
import { Alert } from "@/components/pglearn/ui/alert";
import { Badge } from "@/components/pglearn/ui/badge";
import { Button } from "@/components/pglearn/ui/button";
import { Card } from "@/components/pglearn/ui/card";

/*
 * spec/04 /admin/programs: "Program title/summary, New program, Edit draft,
 * Preview published, Archive. Empty catalog prompts New program; archived
 * content hidden from new assignments, existing learning preserved."
 */

export const metadata: Metadata = { title: "Programs" };

export default async function ProgramsPage() {
  if (!(await verifiedUser())) redirect("/login?next=/admin/programs");

  /*
   * Established, not inferred. list_programs deliberately answers a MANAGER
   * too — they need to know what they may assign — so a refusal is not a
   * reliable signal that somebody is an administrator.
   */
  if (!(await getMe()).platform_admin) return <NoAccess />;

  let programs;
  try {
    programs = await listPrograms();
  } catch (err) {
    if (err instanceof RpcError && err.code === "FORBIDDEN") return <NoAccess />;
    throw err;
  }

  const active = programs.items.filter((program) => !program.archived);
  const archived = programs.items.filter((program) => program.archived);

  return (
    <AppShell active="admin">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">Programs</h1>
        <p className="mt-2 text-sm text-ui-muted-foreground">
          The course catalog. A program has versions; learners are always enrolled in one
          particular version, which is frozen once it is published.
        </p>

        <div className="mt-8">
          <NewProgram />
        </div>

        {programs.items.length === 0 ? (
          <Card className="mt-8 p-8">
            <p className="text-base leading-relaxed">There are no programs yet.</p>
            <p className="mt-2 text-sm text-ui-muted-foreground">
              Create one above to start authoring its first version.
            </p>
          </Card>
        ) : (
          <section className="mt-10">
            <h2 className="text-xs font-medium uppercase tracking-wider text-ui-foreground">Active</h2>
            <div className="mt-3 flex flex-col gap-4">
              {active.map((program) => (
                <Card key={program.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-heading text-base font-semibold text-ui-foreground">{program.title}</h3>
                      {program.summary && (
                        <p className="mt-1 text-sm text-ui-muted-foreground">{program.summary}</p>
                      )}
                    </div>
                    {program.latest_published_version_id ? (
                      <Badge variant="azure">Published</Badge>
                    ) : (
                      <Badge variant="outline">Draft only</Badge>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button variant="primary" size="sm" asChild>
                      <Link href={`/admin/programs/${program.id}`}>Open</Link>
                    </Button>
                    <ArchiveProgram programId={program.id} archived={false} />
                  </div>
                </Card>
              ))}
              {active.length === 0 && (
                <p className="text-sm text-ui-muted-foreground">Every program is archived.</p>
              )}
            </div>

            {archived.length > 0 && (
              <>
                <h2 className="mt-10 text-xs font-medium uppercase tracking-wider text-ui-foreground">Archived</h2>
                {/* spec/04: archived content is hidden from NEW assignments; the
                    learning people have already done is untouched. */}
                <p className="mt-2 text-sm text-ui-muted-foreground">
                  Archived programs cannot be assigned to anyone new. Learners already enrolled
                  keep their access and their progress.
                </p>
                <div className="mt-3 flex flex-col gap-3">
                  {archived.map((program) => (
                    <Card key={program.id} className="p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-base leading-relaxed text-ui-foreground">{program.title}</h3>
                        <div className="flex gap-3">
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/admin/programs/${program.id}`}>Open</Link>
                          </Button>
                          <ArchiveProgram programId={program.id} archived />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </AppShell>
  );
}

function NoAccess() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">This page is not available</h1>
      <Alert variant="info" className="mt-6">
        Program authoring is for platform administrators.
      </Alert>
      <p className="mt-8 text-sm">
        <Link href="/learn" className="pglearn-link">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
