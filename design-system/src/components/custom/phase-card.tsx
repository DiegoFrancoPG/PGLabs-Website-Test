import * as React from "react";
import { cn } from "@/lib/utils";
import { IconCircle } from "./icon-circle";

interface PhaseCardProps {
  phase: string;
  title: string;
  description: string;
  color?: "orange" | "blue" | "gold" | "purple";
  icon?: React.ReactNode;
  className?: string;
}

export function PhaseCard({ phase, title, description, color = "blue", icon, className }: PhaseCardProps) {
  const dotColorMap = {
    orange: "bg-brand-orange",
    blue: "bg-accent-blue",
    gold: "bg-accent-gold",
    purple: "bg-accent-purple",
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center text-center gap-4 p-7 px-6 rounded-lg border border-black/5 bg-brand-cream",
        className
      )}
    >
      <div className="flex flex-col items-center gap-3">
        {icon ? (
          <IconCircle color={color}>{icon}</IconCircle>
        ) : (
          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-brand-cream border border-black/6">
            <div className={cn("h-2 w-2 rounded-full", dotColorMap[color])} />
          </div>
        )}
        <span className="text-label uppercase tracking-widest text-neutral-muted">{phase}</span>
      </div>
      <h3 className="font-display text-[19px] font-medium text-brand-dark-grey leading-tight tracking-tight">
        {title}
      </h3>
      <p className="text-body text-neutral-body">{description}</p>
    </div>
  );
}
