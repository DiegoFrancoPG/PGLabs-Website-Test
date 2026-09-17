import { dispatchNotifications } from "@/features/notifications/dispatch";
import { secretMatches } from "@/lib/email/provider";
import { serverEnv } from "@/lib/env";
import { jsonError, jsonOk, resolveRequestId } from "@/lib/http";

/*
 * operationId run_reminders. The hourly scheduler.
 *
 * spec/05: "Vercel sends GET; require `Authorization: Bearer ${CRON_SECRET}`
 * with constant-time comparison, user sessions do not substitute. Normal GET
 * routes do not mutate."
 *
 * This is the one GET in the API that writes, which is why it is the one GET
 * that refuses a session: being signed in — even as a platform admin — is not
 * authorisation to run the scheduler.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  const header = request.headers.get("authorization");
  const offered = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!secretMatches(offered, serverEnv().CRON_SECRET)) {
    // The same answer for a missing secret, a wrong secret and a user session:
    // none of them tell the caller which it was.
    return jsonError("UNAUTHENTICATED", "This endpoint requires the scheduler secret.", requestId);
  }

  try {
    const result = await dispatchNotifications();
    // Counts only. This runs unattended and its output lands in logs, so it
    // carries no address, subject or link.
    return jsonOk(result, requestId);
  } catch (err) {
    console.error("[jobs] reminders failed", (err as Error).message);
    return jsonError("CONFLICT", "The scheduler could not complete.", requestId);
  }
}
