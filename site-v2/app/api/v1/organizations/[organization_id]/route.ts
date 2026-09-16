import { updateOrganization, organizationPatchSchema } from "@/features/organizations/organizations";
import { mutateRoute } from "@/lib/route";

/* operationId update_organization. */
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organization_id: string }> }
) {
  const { organization_id } = await params;
  return mutateRoute(request, organizationPatchSchema, ({ body }) =>
    updateOrganization(organization_id, body)
  );
}
