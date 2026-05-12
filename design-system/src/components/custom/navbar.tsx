import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface NavItem {
  label: string;
  href: string;
  active?: boolean;
}

interface NavbarProps {
  items?: NavItem[];
  logo?: React.ReactNode;
  className?: string;
}

const defaultItems: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "AI Readiness", href: "/ai-readiness" },
  { label: "About", href: "/about" },
];

export function Navbar({ items = defaultItems, logo, className }: NavbarProps) {
  return (
    <nav
      className={cn(
        "flex items-center justify-between px-6 h-15 rounded-full",
        "bg-brand-cream/60 backdrop-blur-nav border border-black/5 shadow-nav",
        className
      )}
    >
      <div className="flex items-center gap-2">
        {logo ?? (
          <span className="font-display text-[22px] font-bold text-brand-dark-grey">
            PG Labs
          </span>
        )}
      </div>
      <ul className="hidden md:flex items-center gap-6">
        {items.map((item) => (
          <li key={item.label}>
            <a
              href={item.href}
              className={cn(
                "font-body text-body font-medium transition-colors",
                item.active
                  ? "text-brand-orange border-b border-brand-orange"
                  : "text-brand-dark-grey hover:text-brand-orange"
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
      <Button variant="primary" size="sm">
        Contact Us
      </Button>
    </nav>
  );
}
