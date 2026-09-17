import type { Metadata } from "next";
import "./globals.css";

/*
 * Root layout. Deliberately minimal: it owns the document, the stylesheet and
 * the metadata base, and nothing else.
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
