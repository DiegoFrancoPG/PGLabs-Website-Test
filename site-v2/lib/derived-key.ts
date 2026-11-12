/*
 * An Idempotency-Key derived from content rather than drawn at random, so the
 * same request pressed twice is the same request (spec/05: a retry replays
 * the stored result instead of acting again). Used where a browser repeats a
 * batch of existing operations: the roster import, the bulk resend.
 */

/** The SHA-256 of a text, hex, first 32 characters. */
export async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** A uuid-shaped key derived from the parts. */
export async function derivedKey(...parts: string[]): Promise<string> {
  const hex = await digest(parts.join(":"));
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
