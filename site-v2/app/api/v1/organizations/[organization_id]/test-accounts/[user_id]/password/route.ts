import { resetTestAccountPassword, testAccountPasswordSchema } from "@/features/organizations/test-accounts";
import { mutateRoute } from "@/lib/route";

/* operationId reset_test_account_password (M40, D-25). */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organization_id: string; user_id: string }> }
) {
  const { organization_id, user_id } = await params;
  return mutateRoute(request, testAccountPasswordSchema, ({ body }) =>
    resetTestAccountPassword(organization_id, user_id, body)
  );
}
