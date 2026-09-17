import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@ds/components/ui/button";

/*
 * Global 404. It lives at the app root rather than inside (marketing) because
 * Next resolves an unmatched URL against the root layout, which is now bare —
 * so the masthead and footer are rendered explicitly here to keep an unknown
 * URL looking like the site rather than an unstyled framework default.
 */

// Next injects `noindex` for not-found itself, so only the title is set here.
export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main className="pt-18">
        <section className="px-6 pt-22 pb-26">
          <div className="max-w-content mx-auto">
            <p className="text-body-sm font-semibold text-brand-600">404</p>
            <h1 className="mt-3 text-h1-sm md:text-h1">This page could not be found</h1>
            <p className="mt-4 max-w-prose text-body-lg">
              The page you were looking for has moved or never existed.
            </p>
            <div className="mt-8">
              <Button variant="primary" size="sm" asChild>
                <Link href="/">Back to home</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
