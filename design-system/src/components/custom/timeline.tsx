import * as React from "react";
import { cn } from "@/lib/utils";

interface TimelineItem {
  label: string;
  title: string;
  description: string;
  color?: "orange" | "blue" | "gold";
}

interface TimelineProps {
  items: TimelineItem[];
  className?: string;
}

const dotColorMap = {
  orange: "bg-brand-orange shadow-glow-orange",
  blue: "bg-accent-blue shadow-glow-blue",
  gold: "bg-accent-gold shadow-glow-gold",
};

export function Timeline({ items, className }: TimelineProps) {
  return (
    <div className={cn("flex flex-col gap-0", className)}>
      {items.map((item, index) => (
        <div key={index} className="flex gap-5">
          <div className="flex flex-col items-center">
            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-brand-cream border border-black/6 shrink-0">
              <div className={cn("h-2 w-2 rounded-full", dotColorMap[item.color ?? "orange"])} />
            </div>
            {index < items.length - 1 && (
              <div className="w-px flex-1 bg-black/6 my-1" />
            )}
          </div>
          <div className="flex flex-col gap-1 pb-8">
            <span className="text-label uppercase tracking-widest text-neutral-muted">{item.label}</span>
            <h4 className="font-display text-h3 font-medium text-brand-dark-grey">{item.title}</h4>
            <p className="text-body text-neutral-body">{item.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
