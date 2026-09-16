import { listGrants, createGrant, grantCreateSchema } from "@/features/organizations/grants";
import { readRoute, mutateRoute } from "@/lib/route";

/* operationIds list_grants and create_grant. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const org = new URL(request.url).searchParams.get("organization_id") ?? undefined;
  return readRoute(request, () => listGrants(org));
}

export async function POST(request: Request) {
  return mutateRoute(request, grantCreateSchema, ({ body, requestId }) =>
    createGrant(body, requestId)
  );
}
