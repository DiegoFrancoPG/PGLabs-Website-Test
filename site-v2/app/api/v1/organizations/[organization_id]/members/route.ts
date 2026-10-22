import { listOrganizationMembers } from "@/features/organizations/organizations";
import { readRoute } from "@/lib/route";

/* operationId list_organization_members (M30, D-07). */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organization_id: string }> }
) {
  const { organization_id } = await params;
  return readRoute(request, () => listOrganizationMembers(organization_id));
}
