import { createHash, randomBytes } from "node:crypto";
import { serviceClient, userClient } from "@/lib/supabase/server";

/*
 * The link in an invitation email (D-28, M43).
 *
 * Auth's own email links last at most 24 hours (mailer_otp_exp), and an
 * invitation lasts 7 days. So the email carries a token of ours instead: 32
 * random bytes, of which only the SHA-256 is stored (app.invitations
 * .link_token_hash). It is not the invitation id, which managers can see.
 *
 * /invite/{token} only checks the token and shows a Continue button: mail
 * scanners open links, and nothing is spent or signed in on a GET. Continue
 * posts to /auth/invite, which calls signInWithInvitationLink:
 *
 *   - a person who has never accepted an invitation (not onboarded) is signed
 *     in to the invited account, a one-time Auth token being generated and
 *     exchanged on the spot, and sent to choose a password, then the
 *     invitation;
 *   - someone already onboarded is only sent to the invitation, where they sign
 *     in themselves (spec/03: accepting requires login as the matching user).
 *
 * The link stops working when the invitation is accepted, expires or is
 * replaced by a resend. The token is never logged.
 */

export const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function invitationUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/invite/${token}`;
}

/** Where the person goes after the link: always one of our own paths. */
export function nextAfterLink(invitationId: string, onboarded: boolean): string {
  const invitation = `/invitations/${invitationId}`;
  return onboarded ? invitation : `/set-password?next=${encodeURIComponent(invitation)}`;
}

interface Redeemed {
  invitation_id: string;
  user_id: string;
  email: string;
  onboarded: boolean;
}

/** The pending, unexpired invitation a token opens, or null. Spends nothing. */
export async function findInvitationByLink(token: string): Promise<Redeemed | null> {
  if (!INVITATION_TOKEN.test(token)) return null;
  const { data, error } = await serviceClient().rpc("pglearn_job", {
    job: "invitation.redeem",
    payload: { token_hash: hashInvitationToken(token) },
  });
  if (error) {
    if (error.code !== "P0002") console.error("[invite] the link could not be checked", { code: error.code });
    return null;
  }
  return data as Redeemed;
}

export const INVALID_LINK = "/login?link=invalid";

/** Signs a new invitee in from the link; returns where to send them. */
export async function signInWithInvitationLink(token: string): Promise<string> {
  const found = await findInvitationByLink(token);
  if (!found) return INVALID_LINK;
  const next = nextAfterLink(found.invitation_id, found.onboarded);
  if (found.onboarded) return next;

  // A fresh one-time Auth token for the invited account, exchanged at once.
  const service = serviceClient();
  const { data: user } = await service.auth.admin.getUserById(found.user_id);
  const type = user.user?.email_confirmed_at ? "magiclink" : "invite";
  let { data, error } = await service.auth.admin.generateLink({ type, email: found.email });
  let usedType: "invite" | "magiclink" = type;
  if ((error || !data.properties?.hashed_token) && type === "invite") {
    // Auth refuses an invite link for an account it considers registered.
    ({ data, error } = await service.auth.admin.generateLink({ type: "magiclink", email: found.email }));
    usedType = "magiclink";
  }
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("[invite] the sign-in token could not be generated", { code: error?.code });
    return INVALID_LINK;
  }

  const supabase = await userClient();
  const verified = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: usedType });
  if (verified.error) {
    console.error("[invite] sign-in failed", { code: verified.error.code });
    return INVALID_LINK;
  }
  return next;
}
