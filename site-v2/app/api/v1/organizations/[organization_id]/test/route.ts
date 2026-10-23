import { organizationTestSchema, setOrganizationTest } from "@/features/organizations/organizations";
import { mutateRoute } from "@/lib/route";

/* operationId set_organization_test (M33, D-13). */
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ organization_id: string }> }
) {
  const { organization_id } = await params;
  return mutateRoute(request, organizationTestSchema, ({ body }) =>
    setOrganizationTest(organization_id, body)
  );
}
