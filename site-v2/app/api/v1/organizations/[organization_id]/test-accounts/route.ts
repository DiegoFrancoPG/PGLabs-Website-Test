import { createTestAccounts, testAccountsSchema } from "@/features/organizations/test-accounts";
import { mutateRoute } from "@/lib/route";

/* operationId create_test_accounts (M38, D-21). */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organization_id: string }> }
) {
  const { organization_id } = await params;
  return mutateRoute(request, testAccountsSchema, ({ body }) => createTestAccounts(organization_id, body));
}
