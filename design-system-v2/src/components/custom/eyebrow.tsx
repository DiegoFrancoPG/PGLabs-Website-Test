import * as React from "react";
import { cn } from "../../lib/utils";

/*
 * The deck opens nearly every slide with a tracked-out uppercase kicker
 * ("THE GLOBAL PICTURE", "THE ECONOMICS", "OUR FLAGSHIP"). v2 makes that a
 * first-class component, optionally preceded by a short rule.
 */
interface EyebrowProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "brand" | "gold" | "white";
  rule?: boolean;
  children: React.ReactNode;
}

const textColor = {
  default: "text-steel-500",
  brand: "text-brand-600",
  gold: "text-gold-500",
  white: "text-white/70",
} as const;

const ruleColor = {
  default: "bg-steel-300",
  brand: "bg-brand-500",
  gold: "bg-gold-500",
  white: "bg-white/45",
} as const;

export function Eyebrow({
  variant = "default",
  rule = true,
  className,
  children,
  ...props
}: EyebrowProps) {
  return (
    <div className={cn("flex items-center gap-3", className)} {...props}>
      {rule && <span className={cn("h-px w-8 shrink-0", ruleColor[variant])} />}
      <span className={cn("font-body text-eyebrow uppercase", textColor[variant])}>
        {children}
      </span>
    </div>
  );
}
