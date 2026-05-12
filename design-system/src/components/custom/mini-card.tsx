import * as React from "react";
import { cn } from "@/lib/utils";

interface MiniCardProps {
  number?: string | number;
  title: string;
  description?: string;
  color?: "orange" | "blue" | "gold";
  className?: string;
}

const colorMap = {
  orange: "text-brand-orange",
  blue: "text-accent-blue",
  gold: "text-accent-gold",
};

export function MiniCard({ number, title, description, color = "orange", className }: MiniCardProps) {
  return (
    <div
      className={cn(
        "flex flex-row items-center gap-3.5 p-3 px-4 rounded-[10px] bg-white/85 shadow-xs",
        className
      )}
    >
      {number !== undefined && (
        <span className={cn("font-display text-h3 font-medium w-6 shrink-0", colorMap[color])}>
          {number}
        </span>
      )}
      <div className="flex flex-col gap-0.5">
        <span className="text-eyebrow font-semibold text-brand-dark-grey">{title}</span>
        {description && (
          <span className="text-[11px] text-neutral-body leading-tight">{description}</span>
        )}
      </div>
    </div>
  );
}
