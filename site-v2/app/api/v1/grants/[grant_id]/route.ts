import { updateGrant, grantPatchSchema } from "@/features/organizations/grants";
import { mutateRoute } from "@/lib/route";

/* operationId update_grant. */
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ grant_id: string }> }) {
  const { grant_id } = await params;
  return mutateRoute(request, grantPatchSchema, ({ body }) => updateGrant(grant_id, body));
}
