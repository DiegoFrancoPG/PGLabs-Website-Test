import { createInvitation, inviteCreateSchema } from "@/features/organizations/invitations";
import { mutateRoute } from "@/lib/route";

/* operationId create_invitation. */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return mutateRoute(request, inviteCreateSchema, ({ body, requestId }) =>
    createInvitation(body, requestId)
  );
}
