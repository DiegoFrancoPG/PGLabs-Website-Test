import { jsonOk, resolveRequestId } from "@/lib/http";

/*
 * operationId `health`, x-access `public`, security [] — contracts/api.json.
 *
 * spec/05: "Health endpoint returns status/version only, no secrets or
 * connection details." It deliberately does not probe the database or any
 * provider: a health check that fans out to dependencies turns one slow
 * provider into a failing deployment, and the admin operations screen (T22)
 * is where integration state belongs.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return jsonOk(
    { status: "ok" as const, version: process.env.APP_VERSION ?? "0.0.0" },
    resolveRequestId(request)
  );
}
