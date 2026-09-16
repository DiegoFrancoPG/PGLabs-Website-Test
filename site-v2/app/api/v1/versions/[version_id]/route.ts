import { getVersion, updateVersion, versionPatchSchema } from "@/features/content/content";
import { readRoute, mutateRoute } from "@/lib/route";

/* operationIds get_version and update_version. */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ version_id: string }> }) {
  const { version_id } = await params;
  return readRoute(request, () => getVersion(version_id));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ version_id: string }> }) {
  const { version_id } = await params;
  return mutateRoute(request, versionPatchSchema, ({ body }) => updateVersion(version_id, body));
}
