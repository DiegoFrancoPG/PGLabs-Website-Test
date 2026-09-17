import { updateProgram, programPatchSchema } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/* operationId update_program. */
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ program_id: string }> }) {
  const { program_id } = await params;
  return mutateRoute(request, programPatchSchema, ({ body }) => updateProgram(program_id, body));
}
