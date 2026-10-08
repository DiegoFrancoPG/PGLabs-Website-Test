import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getEnrollment } from "@/features/learning/learning";
import { getMe } from "@/features/identity/me";
import { RpcError } from "@/lib/rpc";
import { AppShell } from "@/components/layout/AppShell";
import { ProgramOutline } from "@/components/learning/ProgramOutline";
import { Alert } from "@/components/pglearn/ui/alert";
import { pageContainer } from "@/components/pglearn/layout";

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
  let me;
  try {
    [detail, me] = await Promise.all([getEnrollment(enrollmentId), getMe()]);
  } catch (err) {
    if (err instanceof RpcError && err.code === "NOT_FOUND") return <Unavailable />;
    throw err;
  }

  return (
    <AppShell active="learn">
      <ProgramOutline detail={detail} timezone={me.profile.timezone} now={new Date().toISOString()} />
    </AppShell>
  );
}

/* One response for "no such enrollment" and "not yours". */
function Unavailable() {
  return (
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">This program is not available</h1>
      <Alert variant="info" className="mt-6">
        It may have been withdrawn, or it may belong to a different account.
      </Alert>
      <p className="mt-8 text-sm">
        <Link href="/learn" className="pglearn-link">
          Back to your learning
        </Link>
      </p>
    </main>
  );
}
