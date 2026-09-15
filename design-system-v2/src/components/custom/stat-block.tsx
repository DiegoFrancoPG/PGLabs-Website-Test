import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * The deck's defining device: an oversized Playfair figure, a short caption
 * beneath it, and an attributed source line ("— UNHCR, 2025"). Reproduced here
 * with tabular numerals so rows of stats align.
 *
 * Slides 5–7, 14, 20 and 21 are all built from this pattern.
 */
interface StatBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
  caption: string;
  source?: string;
  color?: "ink" | "brand" | "gold" | "coral" | "white";
  size?: "sm" | "default" | "lg";
  /** Adds the deck's hairline above the figure. */
  ruled?: boolean;
}

const valueColor = {
  ink: "text-ink-800",
  brand: "text-brand-600",
  gold: "text-gold-500",
  coral: "text-coral-500",
  white: "text-white",
} as const;

const sizeClass = {
  sm: "text-stat-sm",
  default: "text-stat",
  lg: "text-stat-lg",
} as const;

export function StatBlock({
  value,
  caption,
  source,
  color = "ink",
  size = "default",
  ruled = false,
  className,
  ...props
}: StatBlockProps) {
  const onDark = color === "white";

  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        ruled && (onDark ? "border-t border-white/20 pt-6" : "border-t border-steel-200 pt-6"),
        className
      )}
      {...props}
    >
      <span
        className={cn("font-display tabular", sizeClass[size], valueColor[color])}
      >
        {value}
      </span>
      <p
        className={cn(
          "text-body-sm max-w-measure",
          onDark ? "text-white/75" : "text-steel-500"
        )}
      >
        {caption}
      </p>
      {source && (
        <span
          className={cn(
            "text-source uppercase tracking-label",
            onDark ? "text-white/45" : "text-steel-400"
          )}
        >
          {source}
        </span>
      )}
    </div>
  );
}
