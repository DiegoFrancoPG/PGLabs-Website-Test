import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { RpcError } from "@/lib/rpc";
import { listPrograms, getVersion } from "@/features/content/content";
import { AppShell } from "@/components/layout/AppShell";
import { OpenDraft } from "@/components/admin/OpenDraft";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * A program and its versions.
 *
 * The published version is reachable from `latest_published_version_id`. The
 * draft is reached through clone_version, which returns an existing draft
 * rather than making a second one — see the migration for why the contract
 * leaves no other way to find it.
 */

export const metadata: Metadata = { title: "Program" };

export default async function ProgramPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  if (!(await verifiedUser())) redirect(`/login?next=/admin/programs/${programId}`);

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

  const program = programs.items.find((candidate) => candidate.id === programId);
  if (!program) return <NoAccess />;

  const published = program.latest_published_version_id
    ? await getVersion(program.latest_published_version_id)
    : null;

  return (
    <AppShell active="admin">
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-body-sm">
          <Link href="/admin/programs" className="text-brand-600 underline underline-offset-4">
            Programs
          </Link>
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-h2-sm text-ink-800">{program.title}</h1>
          {program.archived && <Badge variant="outline">Archived</Badge>}
        </div>
        {program.summary && <p className="mt-2 text-body-sm text-steel-500">{program.summary}</p>}

        <section className="mt-10">
          <h2 className="text-label uppercase text-ink-700">Draft</h2>
          <Card className="mt-3 p-5">
            <p className="text-body-sm">
              Authoring happens in a draft. Publishing freezes it, and everybody already learning
              stays on the version they started.
            </p>
            <div className="mt-4">
              <OpenDraft programId={program.id} />
            </div>
          </Card>
        </section>

        <section className="mt-10">
          <h2 className="text-label uppercase text-ink-700">Published</h2>
          {published ? (
            <Card className="mt-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-h5 text-ink-800">
                    Version {published.version.version_number}
                  </h3>
                  <p className="mt-1 text-body-sm text-steel-500">
                    {published.modules.length} module
                    {published.modules.length === 1 ? "" : "s"}, {published.classes.length} class
                    {published.classes.length === 1 ? "" : "es"}
                  </p>
                </div>
                <Badge variant="azure">Published</Badge>
              </div>
              <div className="mt-4">
                {/* spec/04: "Preview published" — read-only, and creating no progress. */}
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/admin/programs/${program.id}/versions/${published.version.id}`}>
                    Preview
                  </Link>
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="mt-3 p-5">
              <p className="text-body-sm">
                Nothing has been published yet. Learners cannot be assigned this program until a
                version is.
              </p>
            </Card>
          )}
        </section>
      </main>
    </AppShell>
  );
}

function NoAccess() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">This program is not available</h1>
      <Alert variant="info" className="mt-6">
        It may not exist, or program authoring may not be yours to do.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
