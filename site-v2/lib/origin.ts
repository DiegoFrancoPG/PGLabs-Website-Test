/*
 * spec/05: "Check Origin equals configured app origin on cookie-authenticated
 * mutations; reject absent/foreign Origin."
 *
 * The configured origin is NEXT_PUBLIC_APP_URL. The origin the request was
 * actually served on — its own host — is accepted as well, so moving the app
 * to another domain (a new Vercel domain, say) does not refuse every sign-in
 * until the variable is changed and the app rebuilt. That adds nothing an
 * attacker can use: a cross-site form or fetch carries the attacker's page as
 * its Origin, which matches neither. An absent Origin is still refused.
 */
export function isAllowedOrigin(
  origin: string | null,
  configured: string | undefined,
  served: { host: string | null; proto: string | null }
): boolean {
  if (!origin) return false;

  const allowed = new Set<string>();
  if (configured) {
    try {
      allowed.add(new URL(configured).origin);
    } catch {
      // A malformed setting allows nothing by itself.
    }
  }
  if (served.host) {
    const proto = (served.proto ?? "https").split(",")[0].trim();
    try {
      allowed.add(new URL(`${proto}://${served.host.split(",")[0].trim()}`).origin);
    } catch {
      // A malformed Host header allows nothing.
    }
  }
  return allowed.has(origin);
}
