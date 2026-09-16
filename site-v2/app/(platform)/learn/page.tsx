import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import {
  listMyEnrollments,
  availabilityReason,
  type Enrollment,
} from "@/features/learning/learning";
import { isOverdue } from "@/lib/schedule";
import { signOut } from "../login/actions";
import { Button } from "@ds/components/ui/button";
import { Badge } from "@ds/components/ui/badge";
import { Card } from "@ds/components/ui/card";
import { Progress } from "@ds/components/ui/progress";
import { Alert } from "@ds/components/ui/alert";

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

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-h4 text-ink-800">{enrollment.program_title}</h2>
          <p className="mt-1 text-body-sm text-steel-500">
            {enrollment.organization_id ? "Your organization" : "Personal"}
          </p>
        </div>
        {enrollment.state === "completed" ? (
          <Badge variant="azure">Completed</Badge>
        ) : overdue ? (
          <Badge variant="coral">Overdue</Badge>
        ) : null}
      </div>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-body-sm text-steel-500">
            {enrollment.required_completed} of {enrollment.required_total} required classes
          </p>
          {/* The percentage is visible text, not only the bar's aria value. */}
          <p className="tabular text-body-sm font-semibold text-ink-800">
            {enrollment.progress_percent}%
          </p>
        </div>
        <Progress
          value={enrollment.progress_percent}
          className="mt-2"
          aria-label={`${enrollment.program_title} progress`}
        />
      </div>

      <p className="mt-4 text-body-sm text-steel-500">
        Due {formatDate(enrollment.due_at, timezone)}
      </p>

      {/* A locked card explains itself and offers no player. */}
      {locked && (
        <Alert variant="info" className="mt-4">
          {reason}
        </Alert>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {enrollment.state === "completed" ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/learn/${enrollment.id}`}>View completion</Link>
          </Button>
        ) : locked ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/learn/${enrollment.id}`}>View your record</Link>
          </Button>
        ) : (
          <Button variant="primary" size="sm" asChild>
            <Link
              href={
                enrollment.continue_class_id
                  ? `/learn/${enrollment.id}/classes/${enrollment.continue_class_id}`
                  : `/learn/${enrollment.id}`
              }
            >
              {enrollment.started_at ? "Continue" : "Start"}
            </Link>
          </Button>
        )}
        {enrollment.certificate_id && (
          <Button variant="subtle" size="sm" asChild>
            <Link href={`/certificates/${enrollment.certificate_id}`}>Certificate</Link>
          </Button>
        )}
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
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-h2-sm text-ink-800">Your learning</h1>
          <p className="mt-2 text-body-sm text-steel-500">{me.profile.email}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings">Settings</Link>
          </Button>
          <form action={signOut}>
            <Button type="submit" variant="subtle" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>

      {enrollments.length === 0 ? (
        <p className="mt-12 text-body-lg">You haven&rsquo;t been assigned a program yet.</p>
      ) : (
        <div className="mt-10 flex flex-col gap-5">
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
  );
}

/*
 * Signed in, but the invitation was never accepted. Everything beyond the
 * profile is refused until it is, so this explains that rather than letting a
 * refused call surface as a broken page.
 */
function FinishSetUp({ email }: { email: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">Finish setting up your account</h1>
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
