import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getEnrollment, getLearningClass } from "@/features/learning/learning";
import { RpcError } from "@/lib/rpc";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";

/*
 * spec/04 /learn/[enrollmentId]/classes/[classId].
 *
 * T12 builds the shell: the class body, its outline position, handouts and
 * previous/next. Playback with progress recording is T13, the exercise panel is
 * T14, and the tutor drawer is T19 — each is marked below so the next task has
 * a place to attach rather than a page to rewrite.
 */

export const metadata: Metadata = { title: "Class" };

export default async function ClassPage({
  params,
}: {
  params: Promise<{ enrollmentId: string; classId: string }>;
}) {
  const { enrollmentId, classId } = await params;
  if (!(await verifiedUser())) {
    redirect(`/login?next=/learn/${enrollmentId}/classes/${classId}`);
  }

  let detail;
  let outline;
  try {
    [detail, outline] = await Promise.all([
      getLearningClass(enrollmentId, classId),
      getEnrollment(enrollmentId),
    ]);
  } catch (err) {
    if (err instanceof RpcError && err.code === "NOT_FOUND") return <Unavailable />;
    if (err instanceof RpcError && err.code === "VALIDATION_ERROR") {
      // Ownership is established but access is blocked, so the outline still
      // reads — the learner is told why rather than shown a dead end.
      return <Blocked enrollmentId={enrollmentId} />;
    }
    throw err;
  }

  const ordered = outline.classes;
  const index = ordered.findIndex((c) => c.id === classId);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  const handouts = detail.assets.filter((a) => a.role === "handout");

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-body-sm">
        <Link
          href={`/learn/${enrollmentId}`}
          className="text-brand-600 underline underline-offset-4"
        >
          {outline.enrollment.program_title}
        </Link>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-h2-sm text-ink-800">{detail.class.title}</h1>
        <Badge variant={detail.class.required ? "default" : "outline"}>
          {detail.class.required ? "Required" : "Optional"}
        </Badge>
        {detail.progress.class_complete && <Badge variant="azure">Complete</Badge>}
      </div>

      {detail.class.kind === "text" ? (
        <article className="mt-8 whitespace-pre-wrap text-body-lg">{detail.class.body_md}</article>
      ) : (
        /*
         * The player itself is T13: it needs the signed playback URL, the
         * caption track and the progress heartbeat, none of which exist yet.
         * A placeholder is shown rather than a control that does nothing.
         */
        <Alert variant="info" className="mt-8">
          The {detail.class.kind} player arrives with playback and progress recording.
        </Alert>
      )}

      {handouts.length > 0 && (
        <section className="mt-10">
          <h2 className="text-label uppercase text-ink-700">Handouts</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {handouts.map((asset) => (
              <li key={asset.id} className="text-body-sm">
                {/* spec/04 shows name, type and size. Downloads are authorized
                    one at a time, so the link is built at T13 alongside playback. */}
                {asset.original_name}{" "}
                <span className="text-steel-500">
                  ({asset.mime_type}, {Math.ceil(Number(asset.bytes) / 1024)} KB)
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detail.exercise && (
        <section className="mt-10 border-t border-steel-200 pt-8">
          <h2 className="font-display text-h4 text-ink-800">Practical exercise</h2>
          <p className="mt-3 whitespace-pre-wrap text-body-sm">
            {detail.exercise.instructions_md}
          </p>
          {/* The response form is T14. */}
          <Alert variant="info" className="mt-4">
            The response form arrives with exercise completion.
          </Alert>
        </section>
      )}

      <nav className="mt-12 flex justify-between gap-4 border-t border-steel-200 pt-6">
        {previous ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/learn/${enrollmentId}/classes/${previous.id}`}>Previous</Link>
          </Button>
        ) : (
          <span />
        )}
        {next ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/learn/${enrollmentId}/classes/${next.id}`}>Next</Link>
          </Button>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}

function Unavailable() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">This class is not available</h1>
      <Alert variant="info" className="mt-6">
        It may have been withdrawn, or it may belong to a different account.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}

function Blocked({ enrollmentId }: { enrollmentId: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">You cannot open this class right now</h1>
      <Alert variant="info" className="mt-6">
        Your access to this program has changed. Your record is still available.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link
          href={`/learn/${enrollmentId}`}
          className="text-brand-600 underline underline-offset-4"
        >
          See your record
        </Link>
      </p>
    </main>
  );
}
