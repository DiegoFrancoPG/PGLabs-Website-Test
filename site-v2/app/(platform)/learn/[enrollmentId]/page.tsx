import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getEnrollment, availabilityReason } from "@/features/learning/learning";
import { RpcError } from "@/lib/rpc";
import { Button } from "@ds/components/ui/button";
import { Badge } from "@ds/components/ui/badge";
import { Alert } from "@ds/components/ui/alert";
import { Progress } from "@ds/components/ui/progress";

/*
 * spec/04 /learn/[enrollmentId]: "Program outline grouped by modules,
 * required/optional labels, completion and Continue. Outline visible to owner
 * after expiry, with learning actions disabled; unknown/other user gets
 * unavailable."
 *
 * So expiry hides the actions, not the record. What the learner did stays
 * visible to them.
 */

export const metadata: Metadata = { title: "Program outline" };

export default async function OutlinePage({
  params,
}: {
  params: Promise<{ enrollmentId: string }>;
}) {
  const { enrollmentId } = await params;
  if (!(await verifiedUser())) redirect(`/login?next=/learn/${enrollmentId}`);

  let detail;
  try {
    detail = await getEnrollment(enrollmentId);
  } catch (err) {
    if (err instanceof RpcError && err.code === "NOT_FOUND") return <Unavailable />;
    throw err;
  }

  const { enrollment, modules, classes } = detail;
  const reason = availabilityReason(enrollment.availability);
  const locked = reason !== null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-body-sm">
        <Link href="/learn" className="text-brand-600 underline underline-offset-4">
          Back to your learning
        </Link>
      </p>

      <h1 className="mt-6 font-display text-h2-sm text-ink-800">{enrollment.program_title}</h1>

      <div className="mt-5 flex items-baseline justify-between gap-4">
        <p className="text-body-sm text-steel-500">
          {enrollment.required_completed} of {enrollment.required_total} required classes complete
        </p>
        <p className="tabular text-body-sm font-semibold text-ink-800">
          {enrollment.progress_percent}%
        </p>
      </div>
      <Progress value={enrollment.progress_percent} className="mt-2" aria-label="Program progress" />

      {locked && (
        <Alert variant="info" className="mt-6">
          {reason} You can still see your record below.
        </Alert>
      )}

      {enrollment.state === "completed" && (
        <Alert variant="success" className="mt-6">
          {/* spec/04: explicit course completion wording, no claim of mastery. */}
          You have completed every required class in this course.
        </Alert>
      )}

      <div className="mt-10 flex flex-col gap-8">
        {modules.map((module) => {
          const moduleClasses = classes.filter((c) => c.module_id === module.id);
          return (
            <section key={module.id}>
              <h2 className="font-display text-h4 text-ink-800">{module.title}</h2>
              <ul className="mt-4 divide-y divide-steel-100 border-y border-steel-100">
                {moduleClasses.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-3 py-3.5">
                    <span className="flex-1 text-body-sm text-ink-800">{entry.title}</span>

                    <Badge variant={entry.required ? "default" : "outline"}>
                      {entry.required ? "Required" : "Optional"}
                    </Badge>

                    {entry.completed && <Badge variant="azure">Complete</Badge>}

                    {/*
                      Locked means no way into the player, per spec/04 — not a
                      link that fails once you click it.
                    */}
                    {locked ? (
                      <span className="text-body-sm text-steel-400">Unavailable</span>
                    ) : (
                      <Button variant="subtle" size="sm" asChild>
                        <Link href={`/learn/${enrollment.id}/classes/${entry.id}`}>
                          {entry.completed ? "Review" : "Open"}
                        </Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {!locked && enrollment.continue_class_id && (
        <div className="mt-10">
          <Button variant="primary" asChild>
            <Link href={`/learn/${enrollment.id}/classes/${enrollment.continue_class_id}`}>
              Continue
            </Link>
          </Button>
        </div>
      )}
    </main>
  );
}

/* One response for "no such enrollment" and "not yours". */
function Unavailable() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">This program is not available</h1>
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
