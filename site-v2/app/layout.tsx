import type { Metadata } from "next";
/*
 * Lora (titles) and Nunito Sans (UI and body), self-hosted from @fontsource.
 * These were once an `@import` of Google Fonts at the top of globals.css,
 * which the production build silently dropped — so no font loaded, titles fell
 * back to Georgia, and Georgia has no semibold: every 600 rendered as bold.
 * The weights are exactly the ones the design system uses.
 */
import "@fontsource/lora/500.css";
import "@fontsource/lora/600.css";
import "@fontsource/lora/700.css";
import "@fontsource/lora/500-italic.css";
import "@fontsource/lora/600-italic.css";
import "@fontsource/nunito-sans/300.css";
import "@fontsource/nunito-sans/400.css";
import "@fontsource/nunito-sans/500.css";
import "@fontsource/nunito-sans/600.css";
import "@fontsource/nunito-sans/700.css";
import "@fontsource/nunito-sans/400-italic.css";
import "./globals.css";

/*
 * Root layout. Deliberately minimal: it owns the document, the fonts, the
 * stylesheet and the metadata base, and nothing else.
 *
 * The marketing chrome (masthead, footer, JSON-LD) lives in (marketing)/layout
 * and the authenticated PGLearn shell lives in (platform)/layout, because the
 * two have opposite requirements — one is indexed, statically generated and
 * carries third-party tags; the other is noindex, dynamic and must not.
 */

export const metadata: Metadata = {
  metadataBase: new URL("https://pg-labs.org"),
  title: "PG Labs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
