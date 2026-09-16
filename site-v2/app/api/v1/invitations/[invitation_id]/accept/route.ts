import { z } from "zod";
import { acceptInvitation } from "@/features/identity/invitations";
import { mutateRoute } from "@/lib/route";

/*
 * operationId accept_invitation.
 *
 * Accepting is what turns a pending membership into an active one, so it is a
 * mutation with an Idempotency-Key like every other — accepting twice is one
 * acceptance, not two.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invitation_id: string }> }
) {
  const { invitation_id } = await params;
  return mutateRoute(request, z.object({}).strict().optional(), () =>
    acceptInvitation(invitation_id)
  );
}
