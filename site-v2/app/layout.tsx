import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { organizationSchema } from "@/lib/schema";

export const metadata: Metadata = {
  metadataBase: new URL("https://pg-labs.org"),
  title: {
    default: "PG Labs — Responsible AI for Nonprofits",
    template: "%s | PG Labs",
  },
  description:
    "PG Labs helps nonprofits, funders, and social impact organizations navigate AI responsibly. Technology strategy, AI governance, and human-centered design.",
  openGraph: {
    type: "website",
    siteName: "PG Labs",
    locale: "en_CA",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async />
      </head>
      <body>
        <Navbar />
        {/* pt-18 clears the fixed masthead (72px) */}
        <main className="pt-18">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
