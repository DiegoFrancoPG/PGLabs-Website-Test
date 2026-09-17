import { z } from "zod";
import { resendInvitation } from "@/features/organizations/invitations";
import { mutateRoute } from "@/lib/route";

/* operationId resend_invitation. The body carries nothing; the id is the path. */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ invitation_id: string }> }
) {
  const { invitation_id } = await params;
  return mutateRoute(request, z.object({}).strict(), ({ requestId }) =>
    resendInvitation(invitation_id, requestId)
  );
}
