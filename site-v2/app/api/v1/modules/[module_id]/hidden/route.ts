import { moduleHiddenSchema, setModuleHidden } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationId set_module_hidden (M32, D-11). */
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ module_id: string }> }) {
  const { module_id } = await params;
  return mutateRoute(request, moduleHiddenSchema, ({ body }) => setModuleHidden(module_id, body));
}
