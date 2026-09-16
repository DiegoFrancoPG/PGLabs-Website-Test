import { userClient } from "@/lib/supabase/server";
import { type ErrorCode } from "@/lib/http";

/*
 * The only way application code reaches the database.
 *
 * ADR-04 keeps one business implementation: pages and route handlers both call
 * this, never a second query path. spec/02: user-scoped requests go through
 * public.pglearn_rpc, which derives the actor from auth.uid().
 */

export class RpcError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields: { path: string; message: string }[] = []
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/*
 * SQLSTATE to stable error code. The database raises these deliberately:
 *   28000  no verified session          -> UNAUTHENTICATED
 *   42501  denied, or unknown action    -> FORBIDDEN
 *   P0002  absent, or not the caller's  -> NOT_FOUND
 *   22023  invalid or unknown field     -> VALIDATION_ERROR
 *   23514  a business rule rejected it  -> CONFLICT
 *   0A000  handler not implemented yet  -> NOT_CONFIGURED
 *   PGL22  owned but blocked learning   -> ACCESS_UNAVAILABLE (custom class)
 *   PGL28  playback session superseded  -> SESSION_SUPERSEDED (custom class)
 *   PGL29  implausible progress claim   -> INVALID_PROGRESS   (custom class)
 *   PGL40  a second, different response  -> EXERCISE_ALREADY_COMPLETED
 *   PGL41  the certificate was withdrawn -> CERTIFICATE_REVOKED
 *   PGL42  an export too large to serve   -> EXPORT_LIMIT
 *   PGL43  a question already in flight    -> REQUEST_IN_PROGRESS
 *   PGL44  too many questions              -> RATE_LIMITED
 *   PGL45  the month's tutor budget is out -> TUTOR_BUDGET_EXCEEDED
 *
 * The PGL classes are ours: SQLSTATE lets an implementation define its own
 * five-character codes, and these three are conditions spec/05 names that no
 * standard class describes. ACCESS_UNAVAILABLE carries the availability
 * reason (not_started, ended, revoked, …) in the error's DETAIL, which is
 * the one database message returned to the caller, as `fields`.
 *
 * spec/05 uses 404 for "nonexistent or other-user/other-organization target
 * IDs", so P0002 deliberately covers both — the two are indistinguishable from
 * outside, which is the point.
 */
const SQLSTATE_TO_CODE: Record<string, ErrorCode> = {
  "28000": "UNAUTHENTICATED",
  "42501": "FORBIDDEN",
  P0002: "NOT_FOUND",
  "22023": "VALIDATION_ERROR",
  "23514": "CONFLICT",
  "23505": "CONFLICT",
  "23503": "CONFLICT",
  "0A000": "NOT_CONFIGURED",
  PGL22: "ACCESS_UNAVAILABLE",
  PGL28: "SESSION_SUPERSEDED",
  PGL29: "INVALID_PROGRESS",
  PGL40: "EXERCISE_ALREADY_COMPLETED",
  PGL41: "CERTIFICATE_REVOKED",
  PGL42: "EXPORT_LIMIT",
  PGL43: "REQUEST_IN_PROGRESS",
  PGL44: "RATE_LIMITED",
  PGL45: "TUTOR_BUDGET_EXCEEDED",
};

export async function callRpc<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const supabase = await userClient();
  const { data, error } = await supabase.rpc("pglearn_rpc", { action, payload });

  if (error) {
    const code = SQLSTATE_TO_CODE[error.code ?? ""] ?? "CONFLICT";
    /*
     * spec/05: "Never leak a secret or provider stack trace in message." The
     * database's own message is logged, never returned — a denial in
     * particular must say nothing about why, or it would distinguish an
     * unknown action from an unauthorized one.
     */
    console.error(`[rpc] ${action} failed`, { sqlstate: error.code, message: error.message });
    const fields =
      code === "ACCESS_UNAVAILABLE" && error.details
        ? [{ path: "availability", message: error.details }]
        : [];
    throw new RpcError(code, messageFor(code), fields);
  }
  return data as T;
}

function messageFor(code: ErrorCode): string {
  switch (code) {
    case "UNAUTHENTICATED":
      return "Sign in to continue.";
    case "FORBIDDEN":
      return "Not permitted.";
    case "NOT_FOUND":
      return "Not found.";
    case "VALIDATION_ERROR":
      return "The request was not valid.";
    case "NOT_CONFIGURED":
      return "This is not available yet.";
    case "ACCESS_UNAVAILABLE":
      return "This program is not available to you right now.";
    case "EXERCISE_ALREADY_COMPLETED":
      return "This exercise has already been completed.";
    case "CERTIFICATE_REVOKED":
      return "This certificate has been revoked.";
    case "EXPORT_LIMIT":
      return "This export is too large. Narrow the filters and try again.";
    case "REQUEST_IN_PROGRESS":
      return "A question is already being answered. Wait for it to finish.";
    case "RATE_LIMITED":
      return "Too many questions just now. Try again shortly.";
    case "TUTOR_BUDGET_EXCEEDED":
      return "The tutor is unavailable for the rest of this month.";
    case "SESSION_SUPERSEDED":
      return "This program is playing in another tab.";
    case "INVALID_PROGRESS":
      return "The progress reported could not have been played.";
    default:
      return "The request could not be completed.";
  }
}
