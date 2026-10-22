import { moduleReleaseSchema, setModuleRelease } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationId set_module_release (M31, D-08). */
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ module_id: string }> }
) {
  const { module_id } = await params;
  return mutateRoute(request, moduleReleaseSchema, ({ body }) => setModuleRelease(module_id, body));
}
