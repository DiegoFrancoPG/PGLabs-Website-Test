import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/server";
import { renderEmail } from "@/lib/email/templates";
import { emailProvider, maySendTo, EmailRejected, EmailUncertain } from "@/lib/email/provider";

/*
 * Sending an invitation (D-27, M42).
 *
 * spec/03 keeps the Auth link from the manager; it goes to the invited person
 * only, in this email, and is never stored or logged. It is a fresh one-time
 * link generated here, so the email is sent at once rather than queued for the
 * daily scheduler, by which time the link would have expired.
 *
 * The link opens /auth/confirm, a page with a Continue button, not the Auth
 * verification itself: mail scanners open links to check them, and a GET that
 * spent the token would leave the person with a used link. The token is only
 * exchanged when the person presses Continue (/auth/verify).
 *
 * Someone who has never set a password is taken to /set-password first, then
 * to the invitation; someone who has goes straight to the invitation.
 */

export type ConfirmType = "invite" | "magiclink";

/** Where the person lands after confirming: always one of our own paths. */
export function nextAfterConfirm(invitationId: string, onboarded: boolean): string {
  const invitation = `/invitations/${invitationId}`;
  return onboarded ? invitation : `/set-password?next=${encodeURIComponent(invitation)}`;
}

export function confirmUrl(appUrl: string, tokenHash: string, type: ConfirmType, next: string): string {
  const query = new URLSearchParams({ token_hash: tokenHash, type, next });
  return `${appUrl.replace(/\/$/, "")}/auth/confirm?${query.toString()}`;
}

const contextSchema = z.object({
  invitation_id: z.string().uuid(),
  status: z.string(),
  user_id: z.string().uuid(),
  email: z.string(),
  display_name: z.string(),
  onboarded: z.boolean(),
  organization_name: z.string().nullable(),
  sent: z.boolean(),
});

export type InvitationDelivery = "accepted" | "failed" | "uncertain" | "suppressed" | "not_sent";

async function job<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await serviceClient().rpc("pglearn_job", { job: name, payload });
  if (error) throw new Error(`${name} failed: ${error.code ?? ""}`);
  return data as T;
}

/**
 * Sends the invitation email for a pending invitation and records the outcome.
 * Never throws for a delivery problem: the invitation stands, and its
 * delivery status says what happened, so the inviter can resend.
 */
export async function sendInvitationEmail(invitationId: string): Promise<InvitationDelivery> {
  const context = contextSchema.parse(await job("invitation.context", { invitation_id: invitationId }));
  if (context.status !== "pending" || context.sent) return "not_sent";

  const provider = emailProvider();
  if (!provider) {
    console.error("[invitation] email is not configured; the invitation was not sent");
    return "not_sent";
  }

  const record = (outcome: string, extra: Record<string, unknown> = {}) =>
    job("invitation.sent", { invitation_id: invitationId, outcome, ...extra });

  if (!maySendTo(context.email)) {
    await record("suppressed", { error: "recipient is not in EMAIL_TEST_ALLOWLIST" });
    return "suppressed";
  }

  // A fresh one-time link. An account that has confirmed its email gets a
  // sign-in link; one that never has (a new invitee) gets an invite link.
  const service = serviceClient();
  const { data: found } = await service.auth.admin.getUserById(context.user_id);
  const type: ConfirmType = found.user?.email_confirmed_at ? "magiclink" : "invite";
  let { data, error } = await service.auth.admin.generateLink({ type, email: context.email });
  let usedType: ConfirmType = type;
  if ((error || !data.properties?.hashed_token) && type === "invite") {
    // Auth refuses an invite link for an account it considers registered.
    ({ data, error } = await service.auth.admin.generateLink({ type: "magiclink", email: context.email }));
    usedType = "magiclink";
  }
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error("[invitation] the sign-in link could not be generated", { code: error?.code });
    await record("rejected", { error: "the sign-in link could not be generated" });
    return "failed";
  }

  const appUrl = serverEnv().NEXT_PUBLIC_APP_URL;
  const content = renderEmail("invitation", {
    appUrl,
    displayName: context.display_name,
    organizationName: context.organization_name,
    actionUrl: confirmUrl(appUrl, tokenHash, usedType, nextAfterConfirm(invitationId, context.onboarded)),
  });

  try {
    const { providerId } = await provider.send({
      idempotencyKey: invitationId,
      to: context.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
    });
    await record("accepted", { provider_id: providerId });
    return "accepted";
  } catch (err) {
    const definitive = err instanceof EmailRejected;
    if (!definitive && !(err instanceof EmailUncertain)) {
      console.error("[invitation] unexpected send failure", (err as Error).name);
    }
    await record(definitive ? "rejected" : "unknown", { error: (err as Error).message });
    return definitive ? "failed" : "uncertain";
  }
}
