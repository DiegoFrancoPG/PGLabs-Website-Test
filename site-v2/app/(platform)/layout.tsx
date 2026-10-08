import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { THEME_COOKIE, parseTheme } from "@/components/pglearn/theme";

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

/*
 * `.pglearn` scopes the SkillSphere theme (app/globals.css): its colour
 * variables, Geist type and the optional dark mode exist only beneath this
 * element, so nothing here can restyle the marketing site.
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div
      className={`pglearn ${GeistSans.variable} ${GeistMono.variable} min-h-screen bg-ui-background text-ui-foreground antialiased ${
        theme === "dark" ? "dark" : ""
      }`}
    >
      {children}
    </div>
  );
}
