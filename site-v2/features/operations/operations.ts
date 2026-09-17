import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { serverEnv, integrationStatus } from "@/lib/env";

/*
 * What an operator may see.
 *
 * contracts/api.json's OperationStatus has seven fields and none of them is a
 * payload, a body or a link — which is AC-051's point. The schema is strict,
 * so if a handler ever started returning more, this would refuse it rather
 * than pass it through to a screen.
 */

export const operationStatusSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.string(),
    status: z.string(),
    recipient_email: z.string().nullable(),
    attempts: z.number().int().min(0),
    created_at: z.string(),
    last_error: z.string().nullable(),
  })
  .strict();

export type OperationStatus = z.infer<typeof operationStatusSchema>;

const listSchema = z.object({
  items: z.array(operationStatusSchema),
  next_cursor: z.string().nullable(),
});

export async function listNotifications(limit = 50) {
  return listSchema.parse(await callRpc("list_notifications", { limit }));
}

export async function listJobs(limit = 20) {
  return listSchema.parse(await callRpc("list_jobs", { limit }));
}

export async function retryNotification(notificationId: string, requestId: string) {
  return operationStatusSchema.parse(
    await callRpc("retry_notification", {
      request_id: requestId,
      notification_id: notificationId,
    })
  );
}

/**
 * Which integrations are configured. spec/04: "missing model/email
 * configuration clearly shown."
 *
 * Reports only configured/not_configured — never a key, a prefix or a length.
 */
export function configuration(): { email: string; tutor: string; scheduler: string } {
  const env = serverEnv();
  return {
    ...integrationStatus(),
    scheduler: env.CRON_SECRET ? "configured" : "not_configured",
  };
}
