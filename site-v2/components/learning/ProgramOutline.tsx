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
 * A header says what the program is, how far along the learner is and the one
 * thing to do next; the outline below lists every class with its state. Data
 * comes from the page, so this renders the same with or without a session.
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
      <nav aria-label="Breadcrumb" className="text-sm text-ui-muted-foreground">
        <Link href="/learn" className="inline-flex items-center gap-1 hover:text-ui-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          Back to your learning
        </Link>
      </nav>

      {/* Header: what this is, how far along, and the one thing to do next. */}
      <Card className="mt-4 overflow-hidden md:flex-row">
        <div className="relative aspect-[16/9] bg-ui-muted md:aspect-auto md:w-80 md:shrink-0 lg:w-96">
          <Image
            src={programCover(enrollment.program_id)}
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 384px, (min-width: 768px) 320px, 100vw"
            className={`object-cover ${locked ? "grayscale" : ""}`}
          />
        </div>

        <div className="flex flex-1 flex-col gap-5 p-6 sm:p-8">
          <div>
            <div className="flex flex-wrap gap-1.5">
              {completed ? (
                <Badge variant="azure">
                  <CheckCircle2 className="size-3" aria-hidden />
                  Completed
                </Badge>
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
            <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-ui-foreground sm:text-3xl">
              {enrollment.program_title}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ui-muted-foreground">
              <span>{enrollment.organization_id ? "Your organization" : "Personal"}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden />
                Due {formatDate(enrollment.due_at, timezone)}
              </span>
              <span aria-hidden>·</span>
              <span>
                {modules.length} {modules.length === 1 ? "module" : "modules"}, {classes.length}{" "}
                {classes.length === 1 ? "class" : "classes"}
              </span>
            </p>
          </div>

          <div className="max-w-xl">
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <p className="text-ui-muted-foreground">
                {enrollment.required_completed} of {enrollment.required_total} required classes complete
              </p>
              <p className="tabular font-semibold text-ui-foreground">{enrollment.progress_percent}%</p>
            </div>
            <Progress value={enrollment.progress_percent} className="mt-2" aria-label="Program progress" />
          </div>

          {locked && (
            <Alert variant="info">
              {/* Some reasons already say the record stays; don't say it twice. */}
              {reason}
              {reason?.includes("record") ? null : " You can still see your record below."}
            </Alert>
          )}

          {completed && (
            <Alert variant="success">
              {/* spec/04: explicit course completion wording, no claim of mastery. */}
              You have completed every required class in this course.
            </Alert>
          )}

          {(nextClassId || enrollment.certificate_id) && (
            <div className="mt-auto flex flex-wrap gap-2">
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

      {/* Outline, grouped by module. */}
      <div className="mt-10 flex flex-col gap-6">
        {modules.map((module, moduleIndex) => {
          const moduleClasses = classes.filter((c) => c.module_id === module.id);
          const done = moduleClasses.filter((c) => c.completed).length;
          return (
            <section key={module.id} aria-labelledby={`module-${module.id}`}>
              <div className="flex items-baseline justify-between gap-4">
                <div className="flex items-baseline gap-3">
                  <span className="tabular text-xs font-medium text-ui-muted-foreground" aria-hidden>
                    {String(moduleIndex + 1).padStart(2, "0")}
                  </span>
                  <h2
                    id={`module-${module.id}`}
                    className="font-heading text-lg font-semibold text-ui-foreground"
                  >
                    {module.title}
                  </h2>
                </div>
                <p className="tabular shrink-0 text-xs text-ui-muted-foreground">
                  {done}/{moduleClasses.length} done
                </p>
              </div>

              <Card className="mt-3 overflow-hidden">
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
              </Card>
            </section>
          );
        })}
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
            ? "bg-ui-success/10 text-ui-success"
            : upNext
              ? "bg-ui-primary text-ui-primary-foreground"
              : "bg-ui-muted text-ui-muted-foreground"
        }`}
        aria-hidden
      >
        {entry.completed ? <CheckCircle2 className="size-4" /> : <KindIcon className="size-4" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ui-foreground sm:truncate">{entry.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ui-muted-foreground">
          <span className="mr-0.5">{kind.label}</span>
          <Badge variant={entry.required ? "secondary" : "outline"}>
            {entry.required ? "Required" : "Optional"}
          </Badge>
          {entry.completed && <Badge variant="azure">Complete</Badge>}
          {upNext && <span className="font-medium text-ui-primary">Up next</span>}
        </span>
      </span>

      {/*
        Locked means no way into the player, per spec/04 — not a link that
        fails once you click it.
      */}
      {locked ? (
        <span className="shrink-0 text-xs text-ui-muted-foreground">Unavailable</span>
      ) : (
        <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-ui-primary">
          {entry.completed ? "Review" : "Open"}
          <ChevronRight className="size-4" aria-hidden />
        </span>
      )}
    </>
  );

  const rowClass = `flex items-center gap-3 px-4 py-3.5 sm:px-5 ${upNext ? "bg-ui-accent/40" : ""}`;

  if (locked) {
    return (
      <div className={rowClass}>{content}</div>
    );
  }

  return (
    <Link
      href={`/learn/${enrollmentId}/classes/${entry.id}`}
      className={`${rowClass} outline-none transition-colors hover:bg-ui-muted focus-visible:bg-ui-muted focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ui-ring/50`}
    >
      {content}
    </Link>
  );
}

