import { updateTestAccount, testAccountPatchSchema } from "@/features/organizations/test-accounts";
import { mutateRoute } from "@/lib/route";

/* operationId update_test_account (M40, D-25). */
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organization_id: string; user_id: string }> }
) {
  const { organization_id, user_id } = await params;
  return mutateRoute(request, testAccountPatchSchema, ({ body }) =>
    updateTestAccount(organization_id, user_id, body)
  );
}
