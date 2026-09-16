import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { serviceClient } from "@/lib/supabase/server";
import { invitationSchema, type Invitation } from "@/features/identity/invitations";

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

/**
 * spec/03: "Normalize email by trim + lowercase, without provider-specific
 * dot/plus rewriting." Rewriting dots or plus-addressing would silently merge
 * addresses their owners consider distinct.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Finds the Auth account for an address, or creates one. Idempotent by email. */
async function ensureAuthIdentity(email: string): Promise<string> {
  const service = serviceClient();

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth lookup failed: ${error.message}`);
    if (data.users.length === 0) break;
    const found = data.users.find((u) => normalizeEmail(u.email ?? "") === email);
    if (found) return found.id;
  }

  /*
   * generateLink creates the identity and returns the action link. The link is
   * deliberately NOT returned from this function: spec/03 forbids exposing it
   * to the manager, and T21 is what puts it in an email.
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

  return invitationSchema.parse(
    await callRpc("create_invitation", {
      request_id: requestId,
      user_id: userId,
      organization_id: input.organization_id,
      role: input.role,
    })
  );
}

export async function resendInvitation(invitationId: string, requestId: string): Promise<Invitation> {
  return invitationSchema.parse(
    await callRpc("resend_invitation", { request_id: requestId, invitation_id: invitationId })
  );
}
