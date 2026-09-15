import type { Metadata } from "next";

/*
 * PGLearn application shell.
 *
 * Routes are added from T01 onward (/login, /learn, /manage, /admin, …). The
 * group exists now so the marketing and platform boundaries are established
 * before any authenticated code is written.
 *
 * Group names in parentheses do not appear in URLs, so every path in
 * spec/04-ui.md resolves exactly as specified.
 */

export const metadata: Metadata = {
  title: {
    default: "PGLearn",
    template: "%s | PGLearn",
  },
  // Authenticated surfaces are never indexed.
  robots: { index: false, follow: false, nocache: true },
};

/*
 * Authenticated pages read per-user state from a verified session, so they can
 * never be prerendered or shared between users. spec/05: "Authenticated pages,
 * responses and Set-Cookie responses use private/no-store caching."
 */
export const dynamic = "force-dynamic";

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-surface">{children}</div>;
}
