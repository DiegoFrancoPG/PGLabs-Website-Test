import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { organizationSchema } from "@/lib/schema";

export const metadata: Metadata = {
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

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      {/*
       * Figma html-to-design capture. Development only: it is a third-party
       * script and must never load on an authenticated PGLearn route, where
       * spec/05 permits only app, storage and provider origins in the CSP.
       */}
      {process.env.NODE_ENV === "development" && (
        <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async />
      )}
      <Navbar />
      {/* pt-18 clears the fixed masthead (72px) */}
      <main className="pt-18">{children}</main>
      <Footer />
    </>
  );
}
