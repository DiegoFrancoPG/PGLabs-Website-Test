import { z } from "zod";
import { updateTestAccount, deleteTestAccount, testAccountPatchSchema } from "@/features/organizations/test-accounts";
import { mutateRoute } from "@/lib/route";

/* operationIds update_test_account (M40, D-25) and delete_test_account (M41, D-26). */
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ organization_id: string; user_id: string }> }
) {
  const { organization_id, user_id } = await params;
  return mutateRoute(request, z.object({}).strict().optional(), () => deleteTestAccount(organization_id, user_id));
}
