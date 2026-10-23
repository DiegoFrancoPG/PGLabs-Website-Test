import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getEnrollment, getLearningClass } from "@/features/learning/learning";
import { RpcError } from "@/lib/rpc";
import { ClassPlayer } from "@/components/learning/ClassPlayer";
import { MarkTextComplete } from "@/components/learning/MarkTextComplete";
import { HandoutLink } from "@/components/learning/HandoutLink";
import { AppShell } from "@/components/layout/AppShell";
import { Alert } from "@/components/pglearn/ui/alert";
import { Badge } from "@/components/pglearn/ui/badge";
import { Button } from "@/components/pglearn/ui/button";
import { Card } from "@/components/pglearn/ui/card";
import { CheckCircle2, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { lessonSummary } from "@/lib/summary";
import { formatRelease, isHeldBack } from "@/lib/release";
import { getMe } from "@/features/identity/me";
import { pageContainer } from "@/components/pglearn/layout";

/*
 * spec/04 /learn/[enrollmentId]/classes/[classId].
 *
 * Two columns from lg up: on the left the video, sticky so it stays in view,
 * with previous/next under it; on the right everything about this lesson —
 * where it sits in the program, its learning goal (D-24) or, when the author
 * wrote none, a three-line summary (lib/summary), links to its source files
 * and the other lessons in its module. A reading lesson puts
 * its text where the video would be.
 *
 * The PG Learn launch has no practical exercises and no tutor, so neither is
 * rendered here. Their routes and components remain for a later release.
 */

/* "PDF", "DOCX", "VTT" — from the file name, falling back to the media type. */
function fileType(name: string, mime: string): string {
  const extension = name.includes(".") ? name.split(".").pop() : null;
  return (extension || mime.split("/").pop() || "file").toUpperCase();
}

function formatDuration(ms: number | string | null): string | null {
  if (ms === null) return null;
  const minutes = Math.max(1, Math.round(Number(ms) / 60000));
  return `${minutes} min`;
}

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
    if (err instanceof RpcError && err.code === "ACCESS_UNAVAILABLE") {
      // Ownership is established but access is blocked, so the outline still
      // reads — the learner is told why rather than shown a dead end. A
      // module held back until a date (D-08) says when it opens.
      const [blockedOutline, me] = await Promise.all([getEnrollment(enrollmentId), getMe()]);
      const lesson = blockedOutline.classes.find((c) => c.id === classId);
      const lessonModule = blockedOutline.modules.find((m) => m.id === lesson?.module_id);
      if (lessonModule && isHeldBack(lessonModule.release_at, new Date())) {
        return (
          <AppShell active="learn">
            <HeldBack
              enrollmentId={enrollmentId}
              moduleTitle={lessonModule.title}
              opens={formatRelease(lessonModule.release_at as string, me.profile.timezone)}
            />
          </AppShell>
        );
      }
      return <Blocked enrollmentId={enrollmentId} />;
    }
    throw err;
  }

  const ordered = outline.classes;
  const index = ordered.findIndex((c) => c.id === classId);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  // The next lesson may be in a module that is not released yet (D-08).
  const nextModule = next ? outline.modules.find((m) => m.id === next.module_id) : undefined;
  const nextOpensAt =
    nextModule && isHeldBack(nextModule.release_at, new Date()) ? nextModule.release_at : null;
  const timezone = nextOpensAt ? (await getMe()).profile.timezone : "UTC";

  // The files behind the lesson: its transcript first, then its handouts.
  const sources = [
    ...detail.assets.filter((a) => a.role === "transcript" && a.state === "ready"),
    ...detail.assets.filter((a) => a.role === "handout" && a.state === "ready"),
  ];
  const captionAsset = detail.assets.find((a) => a.role === "caption" && a.state === "ready");

  const lessonModule = outline.modules.find((m) => m.id === detail.class.module_id) ?? null;
  const moduleLessons = ordered.filter((c) => c.module_id === detail.class.module_id);
  const goal = detail.class.learning_goal.trim();
  const summary =
    goal || detail.class.kind === "text" ? "" : lessonSummary(detail.class.body_md, detail.class.source_text);
  const kindLabel = { video: "Video", audio: "Audio", text: "Reading" }[detail.class.kind];
  const duration = detail.class.kind === "text" ? null : formatDuration(detail.class.duration_ms);
  const hasMedia = Boolean(
    (detail.class.primary_asset_id || detail.class.youtube_video_id) && detail.class.duration_ms
  );

  return (
    <AppShell active="learn">
      <main className={`${pageContainer} py-8 sm:py-10`}>
        <nav aria-label="Breadcrumb" className="text-ui-body text-ui-muted-foreground">
          <Link
            href={`/learn/${enrollmentId}`}
            className="inline-flex items-center gap-1 hover:text-ui-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {outline.enrollment.program_title}
          </Link>
        </nav>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          {/* The lesson itself: the player stays in view while the right column scrolls. */}
          <div className={detail.class.kind === "text" ? "" : "lg:sticky lg:top-24"}>
            {detail.class.kind === "text" ? (
              <Card className="p-6 sm:p-9">
                <article className="whitespace-pre-wrap text-ui-lead">{detail.class.body_md}</article>
              </Card>
            ) : hasMedia ? (
              <ClassPlayer
                className=""
                enrollmentId={enrollmentId}
                classId={classId}
                kind={detail.class.kind}
                durationMs={Number(detail.class.duration_ms)}
                title={detail.class.title}
                primaryAssetId={detail.class.primary_asset_id}
                youtubeVideoId={detail.class.youtube_video_id}
                captionAssetId={captionAsset?.id ?? null}
              />
            ) : (
              // Published content always has both, so this is a draft preview.
              <Alert variant="info">This lesson has no media yet.</Alert>
            )}

            <nav aria-label="Lesson navigation" className="mt-4 flex justify-between gap-3">
              {previous ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/learn/${enrollmentId}/classes/${previous.id}`}>
                    <ChevronLeft aria-hidden />
                    Previous
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              {next && nextOpensAt ? (
                <span className="inline-flex h-9 items-center rounded-full border border-ui-border px-4 text-ui-button text-ui-muted-foreground">
                  Next module opens {formatRelease(nextOpensAt, timezone)}
                </span>
              ) : next ? (
                <Button variant="primary" size="sm" asChild>
                  <Link href={`/learn/${enrollmentId}/classes/${next.id}`}>
                    Next
                    <ChevronRight aria-hidden />
                  </Link>
                </Button>
              ) : (
                <span />
              )}
            </nav>
          </div>

          <aside aria-labelledby="lesson-title" className="flex flex-col gap-4">
            <Card className="gap-5 p-6">
              <div>
                <p className="flex items-center gap-3 text-ui-eyebrow uppercase text-ui-muted-foreground">
                  <span aria-hidden className="h-px w-8 bg-ui-brand" />
                  {/* Its place in the whole program, by format: "Video 1 of 9". */}
                  {index >= 0 ? `${kindLabel} ${index + 1} of ${ordered.length}` : kindLabel}
                </p>
                <h1 id="lesson-title" className="mt-3 font-heading text-ui-title text-ui-foreground">
                  {detail.class.title}
                </h1>
                {lessonModule && (
                  <p className="mt-1 text-ui-body text-ui-muted-foreground">{lessonModule.title}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-ui-caption text-ui-muted-foreground">
                <span className="mr-1">
                  {kindLabel}
                  {duration && ` · ${duration}`}
                </span>
                <Badge variant={detail.class.required ? "secondary" : "outline"}>
                  {detail.class.required ? "Required" : "Optional"}
                </Badge>
                {detail.progress.class_complete && <Badge variant="azure">Complete</Badge>}
              </div>

              {goal && (
                <section aria-labelledby="learning-goal-title" className="rounded-ui-sm bg-ui-wash p-4">
                  <h2
                    id="learning-goal-title"
                    className="flex items-center gap-3 text-ui-eyebrow uppercase text-ui-muted-foreground"
                  >
                    <span aria-hidden className="h-px w-8 bg-ui-brand" />
                    Learning goal
                  </h2>
                  <p className="mt-2 whitespace-pre-line text-ui-body text-ui-foreground">{goal}</p>
                </section>
              )}

              {summary && (
                <p className="line-clamp-3 text-ui-body text-ui-foreground" title={summary}>
                  {summary}
                </p>
              )}

              {detail.class.kind === "text" && (
                /* AC-030: reading is not completing. */
                <MarkTextComplete
                  enrollmentId={enrollmentId}
                  classId={classId}
                  complete={detail.progress.content_complete}
                />
              )}

              {sources.length > 0 && (
                <section aria-labelledby="sources-title" className="border-t border-ui-border pt-5">
                  <h2 id="sources-title" className="text-ui-eyebrow uppercase text-ui-muted-foreground">
                    Sources
                  </h2>
                  <ul className="mt-3 flex flex-col gap-2.5">
                    {sources.map((asset) => (
                      <li key={asset.id} className="flex items-start gap-2 text-ui-body">
                        <FileText aria-hidden className="mt-1 size-4 shrink-0 text-ui-muted-foreground" />
                        <span className="min-w-0">
                          {/* spec/04 shows name, type and size. The URL is minted on the
                              click, because authorization is re-evaluated every time. */}
                          <HandoutLink assetId={asset.id} enrollmentId={enrollmentId} name={asset.original_name} />
                          <span className="block text-ui-caption text-ui-muted-foreground">
                            {asset.role === "transcript" ? "Transcript" : "Handout"} ·{" "}
                            {fileType(asset.original_name, asset.mime_type)} ·{" "}
                            {Math.ceil(Number(asset.bytes) / 1024)} KB
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

            </Card>

            {moduleLessons.length > 1 && (
              <Card className="overflow-hidden">
                <h2 className="border-b border-ui-border px-5 py-4 text-ui-eyebrow uppercase text-ui-muted-foreground">
                  In this module
                </h2>
                <ol className="divide-y divide-ui-border">
                  {moduleLessons.map((lesson) => {
                    const current = lesson.id === classId;
                    return (
                      <li key={lesson.id}>
                        <Link
                          href={`/learn/${enrollmentId}/classes/${lesson.id}`}
                          aria-current={current ? "page" : undefined}
                          className={`flex items-center gap-3 px-5 py-3 text-ui-body transition-colors hover:bg-ui-wash focus-visible:outline-offset-[-2px] ${
                            current ? "bg-ui-wash font-semibold text-ui-foreground" : "text-ui-foreground"
                          }`}
                        >
                          {lesson.completed ? (
                            <CheckCircle2 aria-hidden className="size-4 shrink-0" />
                          ) : (
                            <span
                              aria-hidden
                              className={`size-1.5 shrink-0 rounded-full mx-[5px] ${current ? "bg-ui-brand" : "bg-ui-divider"}`}
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                          {lesson.completed && <span className="sr-only">(complete)</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            )}
          </aside>
        </div>
      </main>
    </AppShell>
  );
}

function Unavailable() {
  return (
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-ui-title text-ui-foreground">This class is not available</h1>
      <Alert variant="info" className="mt-6">
        It may have been withdrawn, or it may belong to a different account.
      </Alert>
      <p className="mt-8 text-ui-body">
        <Link href="/learn" className="pglearn-link">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}

function HeldBack({
  enrollmentId,
  moduleTitle,
  opens,
}: {
  enrollmentId: string;
  moduleTitle: string;
  opens: string;
}) {
  return (
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-ui-title text-ui-foreground">This lesson opens on {opens}</h1>
      <Alert variant="info" className="mt-6">
        {moduleTitle} is released on {opens}. Until then you can keep going with the lessons that
        are already open.
      </Alert>
      <p className="mt-8 text-ui-body">
        <Link href={`/learn/${enrollmentId}`} className="pglearn-link">
          Back to the program
        </Link>
      </p>
    </main>
  );
}

function Blocked({ enrollmentId }: { enrollmentId: string }) {
  return (
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-ui-title text-ui-foreground">You cannot open this class right now</h1>
      <Alert variant="info" className="mt-6">
        Your access to this program has changed. Your record is still available.
      </Alert>
      <p className="mt-8 text-ui-body">
        <Link
          href={`/learn/${enrollmentId}`}
          className="pglearn-link"
        >
          See your record
        </Link>
      </p>
    </main>
  );
}
