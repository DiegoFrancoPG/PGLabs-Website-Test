import { moveToLatestSchema, moveToLatestVersion } from "@/features/organizations/organizations";
import { mutateRoute } from "@/lib/route";

/* operationId move_to_latest_version (M33, D-13). */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organization_id: string }> }
) {
  const { organization_id } = await params;
  return mutateRoute(request, moveToLatestSchema, ({ body }) =>
    moveToLatestVersion(organization_id, body)
  );
}
