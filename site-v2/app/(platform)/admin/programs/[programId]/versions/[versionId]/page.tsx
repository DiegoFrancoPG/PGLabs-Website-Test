import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { RpcError } from "@/lib/rpc";
import { getVersion, listPrograms } from "@/features/content/content";
import { AppShell } from "@/components/layout/AppShell";
import { VersionEditor } from "@/components/admin/VersionEditor";
import { Alert } from "@/components/pglearn/ui/alert";
import { Badge } from "@/components/pglearn/ui/badge";
import { pageContainer } from "@/components/pglearn/layout";

/*
 * spec/04 /admin/programs/[programId]/versions/[versionId]:
 * "Version title/description; add module/class; up/down reorder; class
 * format/required/body/duration; file picker; source/captions; exercise
 * instructions; Publish. Upload progress/retry; source parser errors;
 * publication lists missing fields per class; published editor read-only;
 * preview does not create progress."
 *
 * The whole draft arrives in one read, so the outline is never shown half
 * built. A published version renders the same screen with every control
 * disabled — "published editor read-only" is a property of the screen, and the
 * database refuses the writes independently.
 */

export const metadata: Metadata = { title: "Version" };

export default async function VersionPage({
  params,
}: {
  params: Promise<{ programId: string; versionId: string }>;
}) {
  const { programId, versionId } = await params;
  if (!(await verifiedUser())) {
    redirect(`/login?next=/admin/programs/${programId}/versions/${versionId}`);
  }

  /*
   * Established, not inferred: get_version answers a manager who holds a grant
   * for the programme, so a refusal is not a reliable signal of admin rights,
   * and authoring is admin-only.
   */
  if (!(await getMe()).platform_admin) return <NoAccess />;

  let detail;
  let programs;
  try {
    [detail, programs] = await Promise.all([getVersion(versionId), listPrograms()]);
  } catch (err) {
    if (err instanceof RpcError && (err.code === "FORBIDDEN" || err.code === "NOT_FOUND")) {
      return <NoAccess />;
    }
    throw err;
  }

  const program = programs.items.find((candidate) => candidate.id === programId);
  const published = detail.version.state === "published";

  return (
    <AppShell active="admin">
      <main className={`${pageContainer} py-12 [&>*]:max-w-4xl`}>
        <p className="text-sm">
          <Link
            href={`/admin/programs/${programId}`}
            className="pglearn-link"
          >
            {program?.title ?? "Program"}
          </Link>
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">
            Version {detail.version.version_number}
          </h1>
          {published ? (
            <Badge variant="azure">Published</Badge>
          ) : (
            <Badge variant="outline">Draft</Badge>
          )}
        </div>

        {published && (
          /* spec/04: "published editor read-only"; also "Preview has visible
             Preview badge and disables learner completion/tutor-history
             mutations" — nothing on this screen records progress at all. */
          <Alert variant="info" className="mt-6">
            This version is published and cannot be changed. Everybody learning it stays on it.
            Open the program&rsquo;s draft to prepare the next version.
          </Alert>
        )}

        <VersionEditor detail={detail} readOnly={published} />
      </main>
    </AppShell>
  );
}

function NoAccess() {
  return (
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">This version is not available</h1>
      <Alert variant="info" className="mt-6">
        It may not exist, or program authoring may not be yours to do.
      </Alert>
      <p className="mt-8 text-sm">
        <Link href="/learn" className="pglearn-link">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
