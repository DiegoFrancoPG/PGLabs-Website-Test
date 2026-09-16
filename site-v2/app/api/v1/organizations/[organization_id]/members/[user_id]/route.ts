import { updateMembership, membershipPatchSchema } from "@/features/organizations/organizations";
import { mutateRoute } from "@/lib/route";

/* operationId update_membership. */
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organization_id: string; user_id: string }> }
) {
  const { organization_id, user_id } = await params;
  return mutateRoute(request, membershipPatchSchema, ({ body }) =>
    updateMembership(organization_id, user_id, body)
  );
}
