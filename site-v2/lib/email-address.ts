/*
 * How an email address is normalised, everywhere.
 *
 * spec/03: "Normalize email by trim + lowercase, without provider-specific
 * dot/plus rewriting." Rewriting dots or plus-addressing would silently merge
 * addresses their owners consider distinct.
 *
 * This lives in lib/ rather than beside the invitation service because the
 * roster importer needs it in the BROWSER, and importing it from a feature
 * service pulled the service-role Supabase client into the client bundle —
 * which the build refused, correctly.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
