"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@ds/components/ui/button";

/*
 * v2 masthead: a flat, full-width bar with a hairline rule — a publication
 * header rather than v1's floating pill.
 */
const NAV_ITEMS = [
  { label: "Services", href: "/services" },
  { label: "AI Readiness", href: "/ai-readiness" },
  { label: "Work", href: "/work" },
  { label: "About", href: "/about" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-steel-200 bg-white/90 backdrop-blur-nav">
      <nav className="max-w-content mx-auto flex items-center justify-between gap-8 px-6 h-18">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image
            src="/images/PGlabs-logo.svg"
            alt="PG Labs"
            width={104}
            height={28}
            priority
          />
        </Link>

        <ul className="hidden md:flex items-center gap-8">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "text-body-sm font-semibold transition-colors",
                    active
                      ? "text-brand-600 border-b-2 border-brand-500 pb-0.5"
                      : "text-steel-500 hover:text-ink-800"
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <Button variant="primary" size="sm" asChild>
          <Link href="/contact">Talk to an AI expert for free</Link>
        </Button>
      </nav>
    </header>
  );
}
