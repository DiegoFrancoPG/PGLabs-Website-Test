import { z } from "zod";
import { putExercise, deleteExercise, exercisePutSchema } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationIds put_exercise and delete_exercise. */
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: Promise<{ class_id: string }> }) {
  const { class_id } = await params;
  return mutateRoute(request, exercisePutSchema, ({ body }) => putExercise(class_id, body));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ class_id: string }> }) {
  const { class_id } = await params;
  return mutateRoute(request, z.object({}).strict().optional(), () => deleteExercise(class_id));
}
