import { z } from "zod";
import { callRpc } from "@/lib/rpc";

/* Mirrors contracts/api.json's Invitation. */
export const invitationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  organization_id: z.string().uuid().nullable(),
  role: z.enum(["manager", "learner"]),
  status: z.enum(["pending", "accepted", "expired", "cancelled"]),
  expires_at: z.string(),
  delivery_status: z.enum(["pending", "accepted", "delivered", "failed", "uncertain", "suppressed"]),
});

export type Invitation = z.infer<typeof invitationSchema>;

export async function getInvitation(invitationId: string): Promise<Invitation> {
  return invitationSchema.parse(await callRpc("get_invitation", { invitation_id: invitationId }));
}

export async function acceptInvitation(invitationId: string): Promise<Invitation> {
  return invitationSchema.parse(await callRpc("accept_invitation", { invitation_id: invitationId }));
}
