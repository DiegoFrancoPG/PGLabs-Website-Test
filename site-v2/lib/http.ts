/*
 * The HTTP envelope from spec/05, shared by every /api/v1 route.
 *
 *   success  {data, request_id}
 *   error    {error: {code, message, fields}, request_id}
 *
 * `contracts/api.json` is authoritative for both shapes; `fields` is required
 * on every error, not optional, so it is always emitted even when empty.
 */

/** Stable error codes from spec/05. The HTTP status for each is fixed below. */
export const ERROR_STATUS = {
  MALFORMED_JSON: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  VERSION_PUBLISHED: 409,
  SESSION_SUPERSEDED: 409,
  EXERCISE_ALREADY_COMPLETED: 409,
  CERTIFICATE_REVOKED: 409,
  REQUEST_IN_PROGRESS: 409,
  DELIVERY_UNCERTAIN: 409,
  VALIDATION_ERROR: 422,
  ACCESS_UNAVAILABLE: 422,
  INVALID_PROGRESS: 422,
  PUBLISH_INCOMPLETE: 422,
  EXPORT_LIMIT: 422,
  RATE_LIMITED: 429,
  TUTOR_BUDGET_EXCEEDED: 429,
  PROVIDER_UNAVAILABLE: 503,
  NOT_CONFIGURED: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface FieldError {
  path: string;
  message: string;
}

/**
 * spec/05: "`request_id` is the mutation key or a generated UUID for reads."
 * Mutations carry a UUID Idempotency-Key; a malformed one is rejected by the
 * route's validation rather than silently replaced, so this only falls back
 * for reads and for requests that supplied no key at all.
 */
export function resolveRequestId(request: Request): string {
  const supplied = request.headers.get("Idempotency-Key");
  return supplied && isUuid(supplied) ? supplied : crypto.randomUUID();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function jsonOk<T>(data: T, requestId: string, init?: ResponseInit): Response {
  return Response.json({ data, request_id: requestId }, { status: 200, ...init });
}

/*
 * spec/05: "Never leak a secret or provider stack trace in message." Callers
 * pass a human message they wrote; provider errors are logged, never returned.
 */
export function jsonError(
  code: ErrorCode,
  message: string,
  requestId: string,
  fields: FieldError[] = [],
  init?: ResponseInit
): Response {
  const headers = new Headers(init?.headers);
  return Response.json(
    { error: { code, message, fields }, request_id: requestId },
    { status: ERROR_STATUS[code], ...init, headers }
  );
}

/** 429 responses carry Retry-After for temporary limits (spec/05). */
export function jsonRateLimited(
  code: Extract<ErrorCode, "RATE_LIMITED" | "TUTOR_BUDGET_EXCEEDED">,
  message: string,
  requestId: string,
  retryAfterSeconds: number
): Response {
  return jsonError(code, message, requestId, [], {
    headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}
