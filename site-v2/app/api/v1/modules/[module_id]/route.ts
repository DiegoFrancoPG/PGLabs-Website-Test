import { updateModule, modulePatchSchema } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationId update_module. */
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ module_id: string }> }) {
  const { module_id } = await params;
  return mutateRoute(request, modulePatchSchema, ({ body }) => updateModule(module_id, body));
}
