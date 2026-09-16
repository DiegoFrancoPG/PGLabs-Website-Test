import { z } from "zod";
import { verifiedUser } from "@/lib/auth";
import { RpcError } from "@/lib/rpc";
import { jsonError, jsonOk, resolveRequestId, isUuid } from "@/lib/http";

/*
 * The shape every /api/v1 route shares, so the rules in spec/05 are applied
 * once rather than re-implemented per route:
 *
 *   - the session is verified with getUser() before anything else
 *   - mutations require a UUID Idempotency-Key
 *   - unknown request fields are rejected, not stripped
 *   - RpcError maps to its stable code; anything else is logged, not returned
 *
 * The Origin rule is enforced earlier still, in proxy.ts, so a cross-site
 * mutation never reaches any of this.
 */

type Handler<T> = (input: { body: T; requestId: string }) => Promise<unknown>;

export async function readRoute(request: Request, handler: (requestId: string) => Promise<unknown>) {
  const requestId = resolveRequestId(request);
  if (!(await verifiedUser())) {
    return jsonError("UNAUTHENTICATED", "Sign in to continue.", requestId);
  }
  try {
    return jsonOk(await handler(requestId), requestId);
  } catch (err) {
    return toResponse(err, requestId);
  }
}

export async function mutateRoute<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  handler: Handler<z.infer<S>>
) {
  const requestId = resolveRequestId(request);

  const key = request.headers.get("Idempotency-Key");
  if (!key || !isUuid(key)) {
    return jsonError("VALIDATION_ERROR", "A UUID Idempotency-Key header is required.", requestId, [
      { path: "Idempotency-Key", message: "must be a UUID" },
    ]);
  }
  if (!(await verifiedUser())) {
    return jsonError("UNAUTHENTICATED", "Sign in to continue.", requestId);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError("MALFORMED_JSON", "The request body was not valid JSON.", requestId);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "The request was not valid.",
      requestId,
      parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(body)", message: i.message }))
    );
  }

  try {
    return jsonOk(await handler({ body: parsed.data, requestId: key }), requestId);
  } catch (err) {
    return toResponse(err, requestId);
  }
}

function toResponse(err: unknown, requestId: string) {
  if (err instanceof RpcError) return jsonError(err.code, err.message, requestId, err.fields);
  // Never surfaced: an unexpected failure must not leak a stack or a provider
  // message into the response (spec/05).
  console.error("[api] unexpected", err);
  return jsonError("CONFLICT", "The request could not be completed.", requestId);
}
