import * as React from "react";
import { cn } from "../../lib/utils";

/*
 * "OUR JOURNEY — From a Vancouver volunteer collective building tech for peace"
 * (deck slide 16). Years are set in Playfair as the anchor; each milestone hangs
 * off a vertical rule.
 */
interface TimelineItem {
  label: string;
  title: string;
  description: string;
  color?: "brand" | "gold" | "coral" | "azure";
}

interface TimelineProps extends React.HTMLAttributes<HTMLDivElement> {
  items: TimelineItem[];
  tone?: "light" | "dark";
}

const dotColor = {
  brand: "bg-brand-500",
  gold: "bg-gold-500",
  coral: "bg-coral-500",
  azure: "bg-azure-500",
} as const;

export function Timeline({ items, tone = "light", className, ...props }: TimelineProps) {
  const dark = tone === "dark";

  return (
    <div className={cn("flex flex-col", className)} {...props}>
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="flex gap-6">
          {/* Rail */}
          <div className="flex flex-col items-center pt-2">
            <span
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                dotColor[item.color ?? "brand"]
              )}
            />
            {index < items.length - 1 && (
              <span
                className={cn(
                  "my-1 w-px flex-1",
                  dark ? "bg-white/20" : "bg-steel-200"
                )}
              />
            )}
          </div>

          {/* Milestone */}
          <div className={cn("flex flex-col gap-1.5", index < items.length - 1 && "pb-10")}>
            <span
              className={cn(
                "font-display tabular text-h4",
                dark ? "text-white/60" : "text-steel-400"
              )}
            >
              {item.label}
            </span>
            <h4
              className={cn(
                "font-display text-h4",
                dark ? "text-white" : "text-ink-800"
              )}
            >
              {item.title}
            </h4>
            <p
              className={cn(
                "text-body-sm max-w-prose",
                dark ? "text-white/70" : "text-steel-500"
              )}
            >
              {item.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
