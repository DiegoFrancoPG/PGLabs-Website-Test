import { z } from "zod";
import { startPlayback } from "@/features/learning/playback";
import { mutateRoute } from "@/lib/route";

/*
 * operationId start_playback.
 *
 * A mutation, because it supersedes whatever session was open — which is the
 * point of AC-028. The Idempotency-Key is what makes a retried start return
 * the same session rather than superseding the one the first attempt opened.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ enrollment_id: string; class_id: string }> }
) {
  const { enrollment_id, class_id } = await params;
  return mutateRoute(request, z.object({}).strict(), ({ requestId }) =>
    startPlayback(enrollment_id, class_id, requestId)
  );
}
