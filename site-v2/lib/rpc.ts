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
 *   22023  invalid or unknown field     -> VALIDATION_ERROR
 *   23514  a business rule rejected it  -> CONFLICT
 *   0A000  handler not implemented yet  -> NOT_CONFIGURED
 */
const SQLSTATE_TO_CODE: Record<string, ErrorCode> = {
  "28000": "UNAUTHENTICATED",
  "42501": "FORBIDDEN",
  "22023": "VALIDATION_ERROR",
  "23514": "CONFLICT",
  "23505": "CONFLICT",
  "23503": "CONFLICT",
  "0A000": "NOT_CONFIGURED",
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
    throw new RpcError(code, messageFor(code));
  }
  return data as T;
}

function messageFor(code: ErrorCode): string {
  switch (code) {
    case "UNAUTHENTICATED":
      return "Sign in to continue.";
    case "FORBIDDEN":
      return "Not permitted.";
    case "VALIDATION_ERROR":
      return "The request was not valid.";
    case "NOT_CONFIGURED":
      return "This is not available yet.";
    default:
      return "The request could not be completed.";
  }
}
