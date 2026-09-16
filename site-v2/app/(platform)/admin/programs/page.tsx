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
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

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
        <h1 className="font-display text-h2-sm text-ink-800">Programs</h1>
        <p className="mt-2 text-body-sm text-steel-500">
          The course catalog. A program has versions; learners are always enrolled in one
          particular version, which is frozen once it is published.
        </p>

        <div className="mt-8">
          <NewProgram />
        </div>

        {programs.items.length === 0 ? (
          <Card className="mt-8 p-8">
            <p className="text-body-lg">There are no programs yet.</p>
            <p className="mt-2 text-body-sm text-steel-500">
              Create one above to start authoring its first version.
            </p>
          </Card>
        ) : (
          <section className="mt-10">
            <h2 className="text-label uppercase text-ink-700">Active</h2>
            <div className="mt-3 flex flex-col gap-4">
              {active.map((program) => (
                <Card key={program.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-h5 text-ink-800">{program.title}</h3>
                      {program.summary && (
                        <p className="mt-1 text-body-sm text-steel-500">{program.summary}</p>
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
                <p className="text-body-sm text-steel-500">Every program is archived.</p>
              )}
            </div>

            {archived.length > 0 && (
              <>
                <h2 className="mt-10 text-label uppercase text-ink-700">Archived</h2>
                {/* spec/04: archived content is hidden from NEW assignments; the
                    learning people have already done is untouched. */}
                <p className="mt-2 text-body-sm text-steel-500">
                  Archived programs cannot be assigned to anyone new. Learners already enrolled
                  keep their access and their progress.
                </p>
                <div className="mt-3 flex flex-col gap-3">
                  {archived.map((program) => (
                    <Card key={program.id} className="p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-body-lg text-ink-800">{program.title}</h3>
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
      <h1 className="font-display text-h2-sm text-ink-800">This page is not available</h1>
      <Alert variant="info" className="mt-6">
        Program authoring is for platform administrators.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
