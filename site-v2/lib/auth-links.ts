/*
 * Shared by /auth/confirm and /auth/verify (D-27): which emailed link types
 * are exchanged, and where a person may be sent afterwards.
 */

export const CONFIRM_TYPES = ["invite", "magiclink"] as const;

/** Only same-site paths, so a link cannot be turned into an open redirect. */
export function safeNext(next: string | undefined | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/learn";
}
