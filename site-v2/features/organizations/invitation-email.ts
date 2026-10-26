import { z } from "zod";
import { serverEnv } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/server";
import { renderEmail } from "@/lib/email/templates";
import { emailProvider, maySendTo, EmailRejected, EmailUncertain } from "@/lib/email/provider";
import { newInvitationToken, invitationUrl } from "@/features/organizations/invitation-link";

/*
 * Sending an invitation (D-27, M42; the link D-28, M43).
 *
 * The email carries a link of ours, /invite/{token}, valid as long as the
 * invitation (7 days); invitation-link.ts explains it. Only the token's hash is
 * stored; the token itself goes to the invited person only, in this email, and
 * is never logged. Each send issues a new token, replacing the last.
 */

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

  const { token, hash } = newInvitationToken();
  await job("invitation.link", { invitation_id: invitationId, token_hash: hash });

  const appUrl = serverEnv().NEXT_PUBLIC_APP_URL;
  const content = renderEmail("invitation", {
    appUrl,
    displayName: context.display_name,
    organizationName: context.organization_name,
    actionUrl: invitationUrl(appUrl, token),
  });

  try {
    const { providerId } = await provider.send({
      // Per link, not per invitation: a retry carries a new link that replaces
      // the last, so a provider must not deduplicate it into the earlier email.
      idempotencyKey: `${invitationId}:${hash.slice(0, 16)}`,
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
