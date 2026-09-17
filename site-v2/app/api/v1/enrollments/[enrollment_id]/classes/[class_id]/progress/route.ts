import { heartbeatSchema, recordProgress } from "@/features/learning/playback";
import { mutateRoute } from "@/lib/route";

/*
 * operationId record_progress.
 *
 * The event_id in the body is the idempotency key the database uses, so the
 * Idempotency-Key header the contract also requires is carried but not used
 * for replay here — see features/learning/playback.ts.
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ enrollment_id: string; class_id: string }> }
) {
  const { enrollment_id, class_id } = await params;
  return mutateRoute(request, heartbeatSchema, ({ body }) =>
    recordProgress(enrollment_id, class_id, body)
  );
}
