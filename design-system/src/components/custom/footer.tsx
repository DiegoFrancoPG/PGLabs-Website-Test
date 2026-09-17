import * as React from "react";
import { cn } from "@/lib/utils";

interface FooterLink {
  label: string;
  href: string;
}

interface FooterProps {
  links?: FooterLink[];
  className?: string;
}

const defaultLinks: FooterLink[] = [
  { label: "Services", href: "/services" },
  { label: "AI Readiness", href: "/ai-readiness" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export function Footer({ links = defaultLinks, className }: FooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer
      className={cn(
        "w-full bg-brand-dark-grey text-white",
        className
      )}
    >
      <div className="max-w-5xl mx-auto px-6 py-12 flex flex-col gap-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <span className="font-display text-[22px] font-bold text-white">
            PG Labs
          </span>
          <nav>
            <ul className="flex flex-wrap gap-6">
              {links.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="font-body text-body text-white/60 hover:text-white transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <p className="text-body text-white/40">
            &copy; {year} PG Labs. All rights reserved.
          </p>
          <p className="text-body text-white/40">
            Responsible AI for social impact.
          </p>
        </div>
      </div>
    </footer>
  );
}
