import { runRetention } from "@/features/operations/retention";
import { secretMatches } from "@/lib/email/provider";
import { serverEnv } from "@/lib/env";
import { jsonError, jsonOk, resolveRequestId } from "@/lib/http";

/*
 * operationId run_retention. The nightly purge.
 *
 * spec/05: "Add `/api/v1/jobs/retention` at `15 3 * * *` only when its handler
 * ships at T28" — which is now — and the same rule as the reminder scheduler:
 * "require `Authorization: Bearer ${CRON_SECRET}` with constant-time
 * comparison, user sessions do not substitute."
 *
 * A signed-in platform administrator cannot run this. Retention deletes
 * things, and the one caller entitled to delete them is the scheduler.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  const header = request.headers.get("authorization");
  const offered = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!secretMatches(offered, serverEnv().CRON_SECRET)) {
    return jsonError("UNAUTHENTICATED", "This endpoint requires the scheduler secret.", requestId);
  }

  try {
    const result = await runRetention();
    /*
     * The contract's JobResult, which is shared with the reminder scheduler and
     * declares additionalProperties: false — so the per-rule breakdown does not
     * travel in the response. It is written to app.job_runs.counts, which is
     * where an operator looks at a run afterwards anyway, and which survives
     * the request that produced it.
     */
    return jsonOk(
      {
        run_id: result.runId,
        claimed: result.removed,
        accepted: result.removed,
        failed: 0,
        suppressed: 0,
      },
      requestId
    );
  } catch (err) {
    console.error("[jobs] retention failed", (err as Error).message);
    return jsonError("CONFLICT", "The retention run could not complete.", requestId);
  }
}
