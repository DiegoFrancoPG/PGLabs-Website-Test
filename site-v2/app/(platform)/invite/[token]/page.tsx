import type { Metadata } from "next";
import { AuthCard } from "@/components/pglearn/AuthCard";
import { Button } from "@/components/pglearn/ui/button";
import { findInvitationByLink } from "@/features/organizations/invitation-link";

export const metadata: Metadata = { title: "Your PGLearn invitation" };
export const dynamic = "force-dynamic";

/*
 * Where the invitation email's link lands (D-28). Mail scanners open links to
 * check them, so this page only checks the token; Continue posts it to
 * /auth/invite, which a scanner does not press.
 */
export default async function InviteLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = Boolean(await findInvitationByLink(token));

  return (
    <AuthCard>
      <h1 className="text-center font-heading text-ui-title text-ui-foreground">
        {valid ? "Continue to PGLearn" : "This link is not valid"}
      </h1>
      {valid ? (
        <form method="post" action="/auth/invite" className="mt-8 flex flex-col gap-5">
          <input type="hidden" name="token" value={token} />
          <p className="text-center text-ui-body text-ui-muted-foreground">Press Continue to open your invitation.</p>
          <Button type="submit" variant="primary" className="w-full">
            Continue
          </Button>
        </form>
      ) : (
        <p className="mt-4 text-center text-ui-body text-ui-muted-foreground">
          It may have expired, or been replaced by a newer invitation. Ask whoever invited you to send it again.
        </p>
      )}
    </AuthCard>
  );
}
