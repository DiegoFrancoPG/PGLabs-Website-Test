import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/*
 * v2 navigation is a flat masthead with a hairline rule beneath it — closer to a
 * publication than the floating pill of v1. The wordmark is set in Playfair.
 */
interface NavItem {
  label: string;
  href: string;
  active?: boolean;
}

interface NavbarProps extends React.HTMLAttributes<HTMLElement> {
  items?: NavItem[];
  logo?: React.ReactNode;
  cta?: React.ReactNode;
  tone?: "light" | "dark";
}

const defaultItems: NavItem[] = [
  { label: "Services", href: "/services" },
  { label: "Our Work", href: "/work" },
  { label: "AI Readiness", href: "/ai-readiness" },
  { label: "About", href: "/about" },
];

export function Navbar({
  items = defaultItems,
  logo,
  cta,
  tone = "light",
  className,
  ...props
}: NavbarProps) {
  const dark = tone === "dark";

  return (
    <nav
      className={cn(
        "flex h-18 items-center justify-between gap-8 border-b px-6 backdrop-blur-nav md:px-10",
        dark
          ? "border-white/12 bg-ink-900/80 text-white"
          : "border-steel-200 bg-white/85 text-ink-800",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        {logo ?? (
          <span className="font-display text-[24px] font-bold tracking-[-0.02em]">
            PG&nbsp;Labs
          </span>
        )}
      </div>

      <ul className="hidden items-center gap-8 md:flex">
        {items.map((item) => (
          <li key={item.label}>
            <a
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "font-body text-body-sm font-semibold transition-colors",
                item.active
                  ? dark
                    ? "text-white border-b-2 border-brand-500 pb-0.5"
                    : "text-brand-600 border-b-2 border-brand-500 pb-0.5"
                  : dark
                    ? "text-white/70 hover:text-white"
                    : "text-steel-500 hover:text-ink-800"
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>

      {cta ?? (
        <Button variant={dark ? "ghost" : "primary"} size="sm">
          Contact us
        </Button>
      )}
    </nav>
  );
}
