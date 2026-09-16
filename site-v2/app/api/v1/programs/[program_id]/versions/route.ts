import { z } from "zod";
import { draftVersion } from "@/features/content/content";
import { mutateRoute } from "@/lib/route";

/*
 * operationId clone_version.
 *
 * "Give me this program's draft": an existing draft is returned rather than a
 * second one created, which is what makes this the way back to work in
 * progress. See supabase/migrations/…_m23_versions.sql for why that is
 * necessary rather than merely convenient.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ program_id: string }> }
) {
  const { program_id } = await params;
  /*
   * The contract's 201 carries a Version and nothing else
   * (additionalProperties: false), so the clone's own summary is not returned
   * here. It does not need to be: every copied file is an asset row, and
   * get_version already reports each one's state — a file that did not copy is
   * `failed` on the screen the author lands on, next to the class it belongs
   * to, which is where they would have to go to replace it anyway.
   */
  return mutateRoute(request, z.object({}).strict().optional(), async ({ requestId }) => {
    const result = await draftVersion(program_id, requestId);
    return result.version;
  });
}
