import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * Compact numbered row — the deck uses these as supporting detail beside a
 * headline (slide 2's "Your family migrated / Someone you love is a newcomer").
 */
interface MiniCardProps extends React.HTMLAttributes<HTMLDivElement> {
  number?: string | number;
  title: string;
  description?: string;
  color?: "brand" | "gold" | "coral" | "azure";
  tone?: "light" | "dark";
}

const numberColor = {
  brand: "text-brand-600",
  gold: "text-gold-500",
  coral: "text-coral-500",
  azure: "text-azure-500",
} as const;

export function MiniCard({
  number,
  title,
  description,
  color = "brand",
  tone = "light",
  className,
  ...props
}: MiniCardProps) {
  const dark = tone === "dark";

  return (
    <div
      className={cn(
        "flex flex-row items-baseline gap-4 rounded-sm border p-4",
        dark ? "border-white/12 bg-white/[0.04]" : "border-steel-200 bg-white",
        className
      )}
      {...props}
    >
      {number !== undefined && (
        <span
          className={cn(
            "font-display tabular text-h4 w-7 shrink-0",
            numberColor[color]
          )}
        >
          {number}
        </span>
      )}
      <div className="flex flex-col gap-1">
        <span
          className={cn(
            "font-display text-[17px] font-semibold leading-snug",
            dark ? "text-white" : "text-ink-800"
          )}
        >
          {title}
        </span>
        {description && (
          <span
            className={cn(
              "text-body-sm",
              dark ? "text-white/70" : "text-steel-500"
            )}
          >
            {description}
          </span>
        )}
      </div>
    </div>
  );
}
