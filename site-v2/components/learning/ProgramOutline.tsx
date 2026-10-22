import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Award,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Headphones,
  Lock,
  PlayCircle,
} from "lucide-react";
import { availabilityReason, type EnrollmentDetail } from "@/features/learning/learning";
import { isOverdue } from "@/lib/schedule";
import { Alert } from "@/components/pglearn/ui/alert";
import { Badge } from "@/components/pglearn/ui/badge";
import { Button } from "@/components/pglearn/ui/button";
import { Card } from "@/components/pglearn/ui/card";
import { Progress } from "@/components/pglearn/ui/progress";
import { pageContainer } from "@/components/pglearn/layout";
import { programCover } from "@/components/pglearn/programCover";

/*
 * spec/04 /learn/[enrollmentId]: "Program outline grouped by modules,
 * required/optional labels, completion and Continue. Outline visible to owner
 * after expiry, with learning actions disabled."
 *
 * A sticky card on the left says what the program is, how far along the
 * learner is and the one thing to do next; on the right, one card per module
 * lists its lessons with their state. Data comes from the page, so this
 * renders the same with or without a session.
 */

type OutlineClass = EnrollmentDetail["classes"][number];

const KIND = {
  video: { icon: PlayCircle, label: "Video" },
  audio: { icon: Headphones, label: "Audio" },
  text: { icon: FileText, label: "Reading" },
} as const;

function formatDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: timezone }).format(
    new Date(iso)
  );
}

export function ProgramOutline({
  detail,
  timezone,
  now,
}: {
  detail: EnrollmentDetail;
  timezone: string;
  now: string;
}) {
  const { enrollment, modules, classes } = detail;
  const reason = availabilityReason(enrollment.availability);
  const locked = reason !== null;
  const completed = enrollment.state === "completed";
  const overdue = isOverdue(
    {
      status: enrollment.state === "cancelled" ? "cancelled" : "active",
      startsAt: enrollment.starts_at,
      dueAt: enrollment.due_at,
      accessEndsAt: enrollment.access_ends_at,
      startedAt: enrollment.started_at,
      completedAt: enrollment.completed_at,
    },
    now
  );

  // The class the learner should open next. Locked programs have none.
  const nextClassId = locked ? null : enrollment.continue_class_id;

  return (
    <main className={`${pageContainer} py-8 sm:py-10`}>
      <nav aria-label="Breadcrumb" className="text-ui-body text-ui-muted-foreground">
        <Link href="/learn" className="inline-flex items-center gap-1 hover:text-ui-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          Back to your learning
        </Link>
      </nav>

      {/*
        Two columns from lg up. The program card on the left is sticky, so it
        stays in view while the module cards on the right scroll past it; it
        scrolls on its own only if it is taller than the window. On a phone
        the card comes first and the modules follow.
      */}
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <aside
          aria-labelledby="program-title"
          className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7.5rem)] lg:overflow-y-auto"
        >
          <Card className="overflow-hidden">
            <div className="relative aspect-[16/9] bg-ui-muted">
              <Image
                src={programCover(enrollment.program_id)}
                alt=""
                fill
                priority
                sizes="(min-width: 1280px) 420px, (min-width: 1024px) 380px, 100vw"
                className={`object-cover ${locked ? "grayscale" : ""}`}
              />
            </div>

            <div className="flex flex-col gap-5 p-6">
              <div>
                <div className="flex flex-wrap gap-1.5">
                  {completed ? (
                    <Badge variant="azure">Completed</Badge>
                  ) : overdue ? (
                    <Badge variant="coral">Overdue</Badge>
                  ) : null}
                  {locked && !completed && (
                    <Badge variant="outline">
                      <Lock className="size-3" aria-hidden />
                      Locked
                    </Badge>
                  )}
                </div>
                <h1 id="program-title" className="mt-2 font-heading text-ui-title text-ui-foreground">
                  {enrollment.program_title}
                </h1>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-ui-body">
                <div>
                  <dt className="text-ui-eyebrow uppercase text-ui-muted-foreground">Provided by</dt>
                  <dd className="mt-1 text-ui-foreground">
                    {enrollment.organization_id ? "Your organization" : "Personal"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ui-eyebrow uppercase text-ui-muted-foreground">Due</dt>
                  <dd className="mt-1 inline-flex items-center gap-1 text-ui-foreground">
                    <CalendarDays className="size-3.5" aria-hidden />
                    {formatDate(enrollment.due_at, timezone)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ui-eyebrow uppercase text-ui-muted-foreground">Modules</dt>
                  <dd className="tabular mt-1 text-ui-foreground">{modules.length}</dd>
                </div>
                <div>
                  <dt className="text-ui-eyebrow uppercase text-ui-muted-foreground">Lessons</dt>
                  <dd className="tabular mt-1 text-ui-foreground">{classes.length}</dd>
                </div>
              </dl>

              <div>
                <div className="flex items-baseline justify-between gap-4 text-ui-body">
                  <p className="text-ui-muted-foreground">
                    {enrollment.required_completed} of {enrollment.required_total} required lessons complete
                  </p>
                  <p className="tabular font-semibold text-ui-foreground">{enrollment.progress_percent}%</p>
                </div>
                <Progress value={enrollment.progress_percent} className="mt-2" aria-label="Program progress" />
              </div>

              {locked && (
                <Alert variant="info">
                  {/* Some reasons already say the record stays; don't say it twice. */}
                  {reason}
                  {reason?.includes("record") ? null : " You can still see your record."}
                </Alert>
              )}

              {completed && (
                <Alert variant="success">
                  {/* spec/04: explicit course completion wording, no claim of mastery. */}
                  You have completed every required lesson in this course.
                </Alert>
              )}

              {(nextClassId || enrollment.certificate_id) && (
                <div className="flex flex-wrap gap-2">
                  {nextClassId && (
                    <Button variant="primary" asChild>
                      <Link href={`/learn/${enrollment.id}/classes/${nextClassId}`}>
                        {enrollment.started_at ? "Continue" : "Start"}
                        <ArrowRight aria-hidden />
                      </Link>
                    </Button>
                  )}
                  {enrollment.certificate_id && (
                    <Button variant="outline" asChild>
                      <Link href={`/certificates/${enrollment.certificate_id}`}>
                        <Award aria-hidden />
                        Certificate
                      </Link>
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        </aside>

        {/* One card per module, as many as the program has. */}
        <div className="flex flex-col gap-4">
          {modules.map((module, moduleIndex) => {
            const moduleClasses = classes.filter((c) => c.module_id === module.id);
            const done = moduleClasses.filter((c) => c.completed).length;
            const percent = moduleClasses.length === 0 ? 0 : Math.round((done / moduleClasses.length) * 100);
            return (
              <Card key={module.id} className="overflow-hidden">
                <section aria-labelledby={`module-${module.id}`}>
                  <div className="flex flex-col gap-3 border-b border-ui-border p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="flex items-center gap-3 text-ui-eyebrow uppercase text-ui-muted-foreground">
                          <span aria-hidden className="h-px w-8 bg-ui-brand" />
                          Module {String(moduleIndex + 1).padStart(2, "0")}
                        </p>
                        <h2
                          id={`module-${module.id}`}
                          className="mt-2 font-heading text-ui-heading text-ui-foreground"
                        >
                          {module.title}
                        </h2>
                      </div>
                      <p className="tabular shrink-0 text-ui-caption text-ui-muted-foreground">
                        {done}/{moduleClasses.length} done
                      </p>
                    </div>
                    <p className="text-ui-caption text-ui-muted-foreground">
                      {moduleClasses.length} {moduleClasses.length === 1 ? "lesson" : "lessons"}
                      {" · "}
                      {moduleClasses.filter((c) => c.required).length} required
                    </p>
                    <Progress value={percent} aria-label={`${module.title} progress`} />
                  </div>

                  <ul className="divide-y divide-ui-border">
                    {moduleClasses.map((entry) => (
                      <li key={entry.id}>
                        <ClassRow
                          enrollmentId={enrollment.id}
                          entry={entry}
                          locked={locked}
                          upNext={entry.id === nextClassId}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              </Card>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function ClassRow({
  enrollmentId,
  entry,
  locked,
  upNext,
}: {
  enrollmentId: string;
  entry: OutlineClass;
  locked: boolean;
  upNext: boolean;
}) {
  const kind = KIND[entry.kind];
  const KindIcon = kind.icon;

  const content = (
    <>
      {/* Leading mark: a tick once done, otherwise what kind of class it is. */}
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${
          entry.completed
            ? "border border-ui-brand bg-ui-card text-ui-foreground"
            : upNext
              ? "bg-ui-primary text-ui-primary-foreground"
              : "bg-ui-muted text-ui-muted-foreground"
        }`}
        aria-hidden
      >
        {entry.completed ? <CheckCircle2 className="size-4" /> : <KindIcon className="size-4" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-ui-body font-medium text-ui-foreground sm:truncate">{entry.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-ui-caption text-ui-muted-foreground">
          <span className="mr-0.5">{kind.label}</span>
          <Badge variant={entry.required ? "secondary" : "outline"}>
            {entry.required ? "Required" : "Optional"}
          </Badge>
          {entry.completed && <Badge variant="azure">Complete</Badge>}
          {upNext && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-ui-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-ui-brand" />
              Up next
            </span>
          )}
        </span>
      </span>

      {/*
        Locked means no way into the player, per spec/04 — not a link that
        fails once you click it.
      */}
      {locked ? (
        <span className="shrink-0 text-ui-caption text-ui-muted-foreground">Unavailable</span>
      ) : (
        <span className="flex shrink-0 items-center gap-0.5 text-ui-body font-medium text-ui-foreground">
          {entry.completed ? "Review" : "Open"}
          <ChevronRight className="size-4" aria-hidden />
        </span>
      )}
    </>
  );

  const rowClass = `flex items-center gap-3 px-4 py-3.5 sm:px-5 ${upNext ? "bg-ui-wash" : ""}`;

  if (locked) {
    return (
      <div className={rowClass}>{content}</div>
    );
  }

  return (
    <Link
      href={`/learn/${enrollmentId}/classes/${entry.id}`}
      className={`${rowClass} transition-colors hover:bg-ui-wash focus-visible:outline-offset-[-2px]`}
    >
      {content}
    </Link>
  );
}

