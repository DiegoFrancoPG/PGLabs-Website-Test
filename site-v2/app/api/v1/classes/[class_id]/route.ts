import { z } from "zod";
import { updateClass, deleteClass, classPatchSchema } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationIds update_class and delete_class. */
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ class_id: string }> }) {
  const { class_id } = await params;
  return mutateRoute(request, classPatchSchema, ({ body }) => updateClass(class_id, body));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ class_id: string }> }) {
  const { class_id } = await params;
  return mutateRoute(request, z.object({}).strict().optional(), () => deleteClass(class_id));
}
