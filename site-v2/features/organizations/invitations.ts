import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { normalizeEmail } from "@/lib/email-address";
import { serviceClient } from "@/lib/supabase/server";
import { invitationSchema, type Invitation } from "@/features/identity/invitations";
import { sendInvitationEmail, type InvitationDelivery } from "@/features/organizations/invitation-email";

/*
 * Creating an invitation spans two systems that cannot share a transaction.
 *
 * spec/03: "Auth and Postgres cannot be one distributed transaction: reconcile
 * by normalized email and request ID after failure; never create duplicate
 * membership or expose the Auth link to the manager."
 *
 * The order is deliberate. The Auth identity is established first and is
 * idempotent by email, so a retry after a crash finds the same account rather
 * than making a second one. Only then does the database work run, itself
 * idempotent by request id. A failure between the two leaves an Auth identity
 * with no invitation — harmless, and reconciled by the next attempt, because a
 * pending Auth identity alone grants no access.
 */

export const inviteCreateSchema = z
  .object({
    email: z.string().email().max(254),
    display_name: z.string().trim().min(1).max(120),
    organization_id: z.string().uuid().nullable(),
    role: z.enum(["manager", "learner"]),
  })
  .strict();

export type InviteCreate = z.infer<typeof inviteCreateSchema>;

/* Defined in lib/email-address so browser code can use it without pulling this
 * server module — and its service-role client — along with it. Re-exported
 * here so existing callers are unchanged. */
export { normalizeEmail };

/** The Auth account id for an address, or null when there is none. */
export async function findAuthUser(email: string): Promise<string | null> {
  const service = serviceClient();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth lookup failed: ${error.message}`);
    if (data.users.length === 0) break;
    const found = data.users.find((u) => normalizeEmail(u.email ?? "") === email);
    if (found) return found.id;
  }
  return null;
}

/** Finds the Auth account for an address, or creates one. Idempotent by email. */
async function ensureAuthIdentity(email: string): Promise<string> {
  const service = serviceClient();
  const existing = await findAuthUser(email);
  if (existing) return existing;

  /*
   * generateLink creates the identity and returns the action link. The link is
   * deliberately NOT returned from this function: spec/03 forbids exposing it
   * to the manager. The email carries a fresh one (invitation-email.ts, D-27).
   */
  const { data, error } = await service.auth.admin.generateLink({ type: "invite", email });
  if (error || !data.user) throw new Error(`auth invite failed: ${error?.message ?? "no user"}`);
  return data.user.id;
}

export async function createInvitation(
  input: InviteCreate,
  requestId: string
): Promise<Invitation> {
  const email = normalizeEmail(input.email);
  const userId = await ensureAuthIdentity(email);

  // Sync the profile from Auth's authoritative record, never from this input.
  const service = serviceClient();
  const { error: provisionError } = await service.rpc("pglearn_provision", {
    payload: { user_id: userId, display_name: input.display_name },
  });
  if (provisionError) throw new Error(`provisioning failed: ${provisionError.message}`);

  const invitation = invitationSchema.parse(
    await callRpc("create_invitation", {
      request_id: requestId,
      user_id: userId,
      organization_id: input.organization_id,
      role: input.role,
    })
  );
  return withDelivery(invitation);
}

/*
 * D-27: the email goes out as soon as the invitation exists. A delivery
 * problem is reported in delivery_status, never as a failed invitation, so the
 * inviter sees it and can resend.
 */
async function withDelivery(invitation: Invitation): Promise<Invitation> {
  if (invitation.status !== "pending") return invitation;
  let delivery: InvitationDelivery;
  try {
    delivery = await sendInvitationEmail(invitation.id);
  } catch (err) {
    console.error("[invitation] the email could not be sent", (err as Error).name);
    return invitation;
  }
  return delivery === "not_sent" ? invitation : { ...invitation, delivery_status: delivery };
}

export async function resendInvitation(invitationId: string, requestId: string): Promise<Invitation> {
  const invitation = invitationSchema.parse(
    await callRpc("resend_invitation", { request_id: requestId, invitation_id: invitationId })
  );
  // A resend makes a new invitation, and with it a new link.
  return withDelivery(invitation);
}
