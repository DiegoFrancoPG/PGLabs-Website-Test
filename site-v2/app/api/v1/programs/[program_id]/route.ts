import { deleteProgram, programDeleteSchema, updateProgram, programPatchSchema } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationIds update_program and delete_program (M36, D-18). */
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ program_id: string }> }) {
  const { program_id } = await params;
  return mutateRoute(request, programPatchSchema, ({ body }) => updateProgram(program_id, body));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ program_id: string }> }) {
  const { program_id } = await params;
  return mutateRoute(request, programDeleteSchema, ({ body }) => deleteProgram(program_id, body));
}
