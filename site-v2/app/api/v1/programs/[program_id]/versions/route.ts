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
  return mutateRoute(request, z.object({}).strict().optional(), ({ requestId }) =>
    draftVersion(program_id, requestId)
  );
}
