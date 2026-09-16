import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getInvitation } from "@/features/identity/invitations";
import { getMe } from "@/features/identity/me";
import { RpcError } from "@/lib/rpc";
import { Alert } from "@ds/components/ui/alert";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Your invitation" };

/*
 * spec/04 /invitations/[id]: "Organization/name/role summary, Accept
 * invitation. Requires matching signed-in verified user; wrong account or
 * unknown returns unavailable; expired offers resend contact path; existing
 * accepted invitation redirects to learning."
 */
export default async function InvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Acceptance is tied to being signed in as the invited person, so an
  // anonymous visitor signs in first and comes straight back here.
  if (!(await verifiedUser())) redirect(`/login?next=/invitations/${id}`);

  let invitation;
  try {
    invitation = await getInvitation(id);
  } catch (err) {
    if (err instanceof RpcError && err.code === "NOT_FOUND") return <Unavailable />;
    throw err;
  }

  if (invitation.status === "accepted") redirect("/learn");

  if (invitation.status !== "pending") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <h1 className="font-display text-h2-sm text-ink-800">This invitation has expired</h1>
        <p className="mt-4 text-body-lg">
          Invitations are valid for 24 hours. Ask whoever invited you to send a new one.
        </p>
        <p className="mt-8 text-body-sm">
          <Link href="/login" className="text-brand-600 underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </main>
    );
  }

  const me = await getMe();
  const organization = invitation.organization_id
    ? me.contexts.find((c) => c.organization_id === invitation.organization_id)?.organization_name
    : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">You have been invited</h1>

      <dl className="mt-8 flex flex-col gap-4 border-y border-steel-200 py-6">
        <div>
          <dt className="text-label uppercase text-ink-700">Account</dt>
          <dd className="mt-1 text-body-sm">{me.profile.email}</dd>
        </div>
        <div>
          <dt className="text-label uppercase text-ink-700">Organization</dt>
          <dd className="mt-1 text-body-sm">{organization ?? "Personal — no organization"}</dd>
        </div>
        <div>
          <dt className="text-label uppercase text-ink-700">Role</dt>
          <dd className="mt-1 text-body-sm capitalize">{invitation.role}</dd>
        </div>
      </dl>

      <AcceptForm invitationId={invitation.id} />
    </main>
  );
}

/*
 * One response for "no such invitation" and "not yours". Distinguishing them
 * would confirm that an invitation exists for a different account.
 */
function Unavailable() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">This invitation is not available</h1>
      <Alert variant="info" className="mt-6">
        It may have been withdrawn, or it may be for a different account. If you have more than one
        email address, check that you are signed in with the right one.
      </Alert>
      <p className="mt-8 text-body-sm">
        <Link href="/login" className="text-brand-600 underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
