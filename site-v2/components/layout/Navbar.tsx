"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@ds/components/ui/button";

/*
 * v2 masthead: a flat, full-width bar with a hairline rule — a publication
 * header rather than v1's floating pill.
 *
 * Below `md` the links collapse behind a disclosure button. Until this existed,
 * the nav was simply `hidden md:flex`, so on a phone every section was
 * unreachable from the header — only the footer carried them. spec/04 requires
 * the interface to work at 390px, and that includes the way in.
 *
 * A disclosure rather than a modal dialog: the panel is short, it does not trap
 * the page behind it, and it needs no focus trap or scroll lock to be correct.
 */
const NAV_ITEMS = [
  { label: "Services", href: "/services" },
  { label: "AI Readiness", href: "/ai-readiness" },
  { label: "Learning", href: "/learning" },
  { label: "Work", href: "/work" },
  { label: "About", href: "/about" },
];

export function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Escape closes and returns focus to the control that opened it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const linkClass = (href: string, extra?: string) =>
    cn(
      "text-body-sm font-semibold transition-colors",
      pathname === href ? "text-brand-600" : "text-steel-500 hover:text-ink-800",
      extra
    );

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-steel-200 bg-white/90 backdrop-blur-nav">
      <nav aria-label="Main">
        <div className="max-w-content mx-auto flex items-center justify-between gap-4 px-6 h-18 md:gap-8">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image src="/images/PGlabs-logo.svg" alt="PG Labs" width={104} height={28} priority />
          </Link>

          <ul className="hidden md:flex items-center gap-8">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? "page" : undefined}
                  className={linkClass(
                    item.href,
                    pathname === item.href ? "border-b-2 border-brand-500 pb-0.5" : undefined
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          {/* The call to action is too wide to sit beside a phone-width logo, so
              below md it moves into the panel. */}
          <Button variant="primary" size="sm" asChild className="hidden md:inline-flex">
            <Link href="/contact">Talk to an AI expert for free</Link>
          </Button>

          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={menuId}
            className={cn(
              "-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-800 md:hidden",
              "transition-colors hover:bg-surface",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azure-600 focus-visible:ring-offset-2"
            )}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            </button>
        </div>

        {open && (
          <div id={menuId} className="border-t border-steel-200 bg-white md:hidden">
            <ul className="max-w-content mx-auto flex flex-col px-6 py-2">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                {/* Closed from the click rather than from a pathname effect:
                    setting state inside an effect cascades renders. */}
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={pathname === item.href ? "page" : undefined}
                  className={linkClass(item.href, "block py-3.5")}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="py-4">
              <Button variant="primary" size="sm" asChild className="w-full">
                <Link href="/contact" onClick={() => setOpen(false)}>
                  Talk to an AI expert for free
                </Link>
              </Button>
              </li>
            </ul>
          </div>
        )}
      </nav>
    </header>
  );
}
