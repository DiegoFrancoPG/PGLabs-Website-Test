import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Award, CalendarDays, CheckCircle2, Lock } from "lucide-react";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import {
  listMyEnrollments,
  availabilityReason,
  type Enrollment,
} from "@/features/learning/learning";
import { isOverdue } from "@/lib/schedule";
import { AppShell } from "@/components/layout/AppShell";
import { signOut } from "../login/actions";
import { Button } from "@/components/pglearn/ui/button";
import { Badge } from "@/components/pglearn/ui/badge";
import { Card } from "@/components/pglearn/ui/card";
import { Progress } from "@/components/pglearn/ui/progress";
import { Alert } from "@/components/pglearn/ui/alert";
import { pageContainer } from "@/components/pglearn/layout";
import { programCover } from "@/components/pglearn/programCover";

/*
 * spec/04 /learn: "Program cards: title, organization or Personal,
 * counts/percent, due date, availability; Continue/View completion. No
 * enrollments: 'You haven't been assigned a program yet'; locked card gives
 * reason, no player."
 */

export const metadata: Metadata = { title: "Your learning" };

function formatDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeZone: timezone,
  }).format(new Date(iso));
}

function ProgramCard({
  enrollment,
  timezone,
  now,
}: {
  enrollment: Enrollment;
  timezone: string;
  now: string;
}) {
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

  /*
   * One action per card. A locked card offers the record, never the player;
   * a finished one offers its completion; everything else resumes where the
   * learner left off.
   */
  const action = completed
    ? { label: "View completion", href: `/learn/${enrollment.id}`, variant: "outline" as const }
    : locked
      ? { label: "View your record", href: `/learn/${enrollment.id}`, variant: "outline" as const }
      : {
          label: enrollment.started_at ? "Continue" : "Start",
          href: enrollment.continue_class_id
            ? `/learn/${enrollment.id}/classes/${enrollment.continue_class_id}`
            : `/learn/${enrollment.id}`,
          variant: "primary" as const,
        };

  return (
    <Card className="group overflow-hidden transition-shadow hover:shadow-md">
      <div className="relative aspect-[16/9] overflow-hidden bg-ui-muted">
        <Image
          src={programCover(enrollment.program_id)}
          alt=""
          fill
          sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
          className={`object-cover transition-transform duration-500 group-hover:scale-[1.03] ${
            locked ? "grayscale" : ""
          }`}
        />
        {/* The state reads first, on the picture, so a row of cards scans. */}
        <div className="absolute left-3 top-3 flex gap-1.5">
          {completed ? (
            <Badge variant="azure" className="bg-ui-card/95 shadow-sm">
              <CheckCircle2 className="size-3" aria-hidden />
              Completed
            </Badge>
          ) : overdue ? (
            <Badge variant="coral" className="bg-ui-card/95 shadow-sm">
              Overdue
            </Badge>
          ) : null}
          {locked && !completed && (
            <Badge variant="outline" className="border-transparent bg-ui-card/95 shadow-sm">
              <Lock className="size-3" aria-hidden />
              Locked
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <h2 className="line-clamp-2 font-heading text-base font-semibold leading-snug text-ui-foreground">
            {enrollment.program_title}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ui-muted-foreground">
            <span>{enrollment.organization_id ? "Your organization" : "Personal"}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3" aria-hidden />
              Due {formatDate(enrollment.due_at, timezone)}
            </span>
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-4 text-xs">
            <p className="text-ui-muted-foreground">
              {enrollment.required_completed} of {enrollment.required_total} required classes
            </p>
            {/* The percentage is visible text, not only the bar's aria value. */}
            <p className="tabular font-semibold text-ui-foreground">
              {enrollment.progress_percent}%
            </p>
          </div>
          <Progress
            value={enrollment.progress_percent}
            className="mt-2"
            aria-label={`${enrollment.program_title} progress`}
          />
        </div>

        {/* A locked card explains itself; the reason is the whole message. */}
        {locked && <p className="text-xs leading-relaxed text-ui-muted-foreground">{reason}</p>}

        <div className="mt-auto flex items-center gap-2 pt-1">
          <Button variant={action.variant} size="sm" className="flex-1" asChild>
            <Link href={action.href}>
              {action.label}
              {action.variant === "primary" && <ArrowRight aria-hidden />}
            </Link>
          </Button>
          {enrollment.certificate_id && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/certificates/${enrollment.certificate_id}`}>
                <Award aria-hidden />
                Certificate
              </Link>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default async function LearnPage() {
  if (!(await verifiedUser())) redirect("/login?next=/learn");

  /*
   * get_me is one of the onboarding-exempt actions, so it answers even for
   * somebody who has signed in but never accepted their invitation. Everything
   * else is refused for them, which is correct — but it means this page has to
   * check first rather than let the next call fail.
   *
   * spec/04: an unaccepted invitation "resumes invitation flow". There is no
   * operation in the contract for listing your own invitations, so the person
   * is pointed back at the link they were sent rather than guessed at.
   */
  const me = await getMe();
  if (me.profile.onboarded_at === null) return <FinishSetUp email={me.profile.email} />;

  const enrollments = await listMyEnrollments();
  const now = new Date().toISOString();

  return (
    <AppShell active="learn">
    <main className={`${pageContainer} py-10`}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">Your learning</h1>
      <p className="mt-1 text-sm text-ui-muted-foreground">{me.profile.email}</p>

      {enrollments.length === 0 ? (
        <p className="mt-12 text-base leading-relaxed">You haven&rsquo;t been assigned a program yet.</p>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {enrollments.map((enrollment) => (
            <ProgramCard
              key={enrollment.id}
              enrollment={enrollment}
              timezone={me.profile.timezone}
              now={now}
            />
          ))}
        </div>
      )}
    </main>
    </AppShell>
  );
}

/*
 * Signed in, but the invitation was never accepted. Everything beyond the
 * profile is refused until it is, so this explains that rather than letting a
 * refused call surface as a broken page.
 */
function FinishSetUp({ email }: { email: string }) {
  return (
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">Finish setting up your account</h1>
      <Alert variant="info" className="mt-6">
        You are signed in as {email}, but your invitation has not been accepted yet. Open the
        invitation link that was emailed to you to finish.
      </Alert>
      <div className="mt-8 flex gap-3">
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
