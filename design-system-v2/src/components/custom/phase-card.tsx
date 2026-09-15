import * as React from "react";
import { cn } from "@/lib/utils";
import { IconCircle } from "./icon-circle";

/*
 * Numbered process step. The deck's Welcome Coach 2.0 slide runs four of these
 * as "01 Smart Onboarding … 04 Job Co-Pilot" — left-aligned with a keyline
 * above, not centred in a rounded box.
 */
interface PhaseCardProps extends React.HTMLAttributes<HTMLDivElement> {
  phase: string;
  title: string;
  description: string;
  color?: "brand" | "gold" | "coral" | "azure";
  icon?: React.ReactNode;
  tone?: "light" | "dark";
}

const ruleColor = {
  brand: "border-t-brand-500",
  gold: "border-t-gold-500",
  coral: "border-t-coral-500",
  azure: "border-t-azure-500",
} as const;

const numeralColor = {
  brand: "text-brand-600",
  gold: "text-gold-500",
  coral: "text-coral-500",
  azure: "text-azure-500",
} as const;

export function PhaseCard({
  phase,
  title,
  description,
  color = "brand",
  icon,
  tone = "light",
  className,
  ...props
}: PhaseCardProps) {
  const dark = tone === "dark";

  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-t-2 pt-6",
        ruleColor[color],
        className
      )}
      {...props}
    >
      {icon ? (
        <IconCircle color={color}>{icon}</IconCircle>
      ) : (
        <span className={cn("font-display tabular text-h3", numeralColor[color])}>
          {phase}
        </span>
      )}
      <h3
        className={cn(
          "font-display text-h4",
          dark ? "text-white" : "text-ink-800"
        )}
      >
        {title}
      </h3>
      <p className={cn("text-body-sm", dark ? "text-white/70" : "text-steel-500")}>
        {description}
      </p>
    </div>
  );
}
