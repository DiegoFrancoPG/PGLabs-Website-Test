import { getInvitation } from "@/features/identity/invitations";
import { readRoute } from "@/lib/route";

/*
 * operationId get_invitation.
 *
 * The invitation page reads this through the feature service directly, because
 * it renders on the server. The route exists because the contract declares it
 * — and a contract operation with no route is an operation nobody can use.
 *
 * It is onboarding-exempt: somebody who has signed in but not yet accepted
 * must be able to read the invitation they are being asked to accept.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ invitation_id: string }> }
) {
  const { invitation_id } = await params;
  return readRoute(request, () => getInvitation(invitation_id));
}
