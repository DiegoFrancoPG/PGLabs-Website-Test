import { listOrganizations } from "@/features/organizations/organizations";
import { createOrganization, organizationCreateSchema } from "@/features/organizations/create";
import { readRoute, mutateRoute } from "@/lib/route";

/* operationIds list_organizations and create_organization. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  return readRoute(request, () => listOrganizations(Number.isFinite(limit) ? limit : 20));
}

export async function POST(request: Request) {
  return mutateRoute(request, organizationCreateSchema, ({ body, requestId }) =>
    createOrganization(body, requestId)
  );
}
