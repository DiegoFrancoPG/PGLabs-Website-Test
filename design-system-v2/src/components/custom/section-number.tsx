import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * Chapter breaks in the deck are marked with a two-digit Playfair numeral
 * ("01", "02", "03", "04") set very large and low-contrast behind or beside the
 * chapter title. This renders that numeral.
 */
interface SectionNumberProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: number | string;
  variant?: "default" | "ghost" | "white" | "white-ghost";
}

const variantClass = {
  default: "text-brand-600",
  ghost: "text-ink-800/12",
  white: "text-white",
  "white-ghost": "text-white/15",
} as const;

export function SectionNumber({
  value,
  variant = "default",
  className,
  ...props
}: SectionNumberProps) {
  const label = typeof value === "number" ? String(value).padStart(2, "0") : value;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "font-display tabular text-stat leading-none select-none",
        variantClass[variant],
        className
      )}
      {...props}
    >
      {label}
    </span>
  );
}
