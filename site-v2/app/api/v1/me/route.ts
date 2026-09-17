import { getMe, updateMe, profilePatchSchema } from "@/features/identity/me";
import { RpcError } from "@/lib/rpc";
import { verifiedUser } from "@/lib/auth";
import { jsonError, jsonOk, resolveRequestId, isUuid } from "@/lib/http";

/*
 * operationIds get_me and update_me — contracts/api.json, x-access authenticated.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  if (!(await verifiedUser())) {
    return jsonError("UNAUTHENTICATED", "Sign in to continue.", requestId);
  }
  try {
    return jsonOk(await getMe(), requestId);
  } catch (err) {
    return toResponse(err, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = resolveRequestId(request);

  // spec/05: "All user mutations require UUID Idempotency-Key."
  const key = request.headers.get("Idempotency-Key");
  if (!key || !isUuid(key)) {
    return jsonError("VALIDATION_ERROR", "A UUID Idempotency-Key header is required.", requestId, [
      { path: "Idempotency-Key", message: "must be a UUID" },
    ]);
  }
  if (!(await verifiedUser())) {
    return jsonError("UNAUTHENTICATED", "Sign in to continue.", requestId);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("MALFORMED_JSON", "The request body was not valid JSON.", requestId);
  }

  /*
   * .strict() rejects rather than strips, so an attempt to set platform_admin,
   * email or an organization role fails loudly here — and the RPC checks again
   * independently, because a service layer can be wrong.
   */
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      "VALIDATION_ERROR",
      "The request was not valid.",
      requestId,
      parsed.error.issues.map((i) => ({
        path: i.path.join(".") || "(body)",
        message: i.message,
      }))
    );
  }

  try {
    return jsonOk(await updateMe(parsed.data), requestId);
  } catch (err) {
    return toResponse(err, requestId);
  }
}

function toResponse(err: unknown, requestId: string) {
  if (err instanceof RpcError) return jsonError(err.code, err.message, requestId, err.fields);
  console.error("[/api/v1/me] unexpected", err);
  return jsonError("CONFLICT", "The request could not be completed.", requestId);
}
