import { z } from "zod";
import { retryNotification } from "@/features/operations/operations";
import { mutateRoute } from "@/lib/route";

/*
 * operationId retry_notification.
 *
 * A failed or suppressed message may be sent again; an UNCERTAIN one may not,
 * because nobody yet knows whether the first copy arrived. That refusal is
 * 409 DELIVERY_UNCERTAIN and carries the instruction to reconcile with the
 * provider first (spec/03).
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ notification_id: string }> }
) {
  const { notification_id } = await params;
  return mutateRoute(request, z.object({}).strict(), ({ requestId }) =>
    retryNotification(notification_id, requestId)
  );
}
