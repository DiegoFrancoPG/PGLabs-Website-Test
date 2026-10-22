import { z } from "zod";
import { updateModule, deleteModule, modulePatchSchema } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationIds update_module and delete_module (M32, D-11). */
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ module_id: string }> }) {
  const { module_id } = await params;
  return mutateRoute(request, modulePatchSchema, ({ body }) => updateModule(module_id, body));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ module_id: string }> }) {
  const { module_id } = await params;
  return mutateRoute(request, z.object({}).strict().optional(), () => deleteModule(module_id));
}
