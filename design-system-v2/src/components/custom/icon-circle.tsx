import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * v2 icon holders are squared to match the rest of the geometry, with a
 * hairline border rather than a soft tinted disc.
 */
interface IconCircleProps extends React.HTMLAttributes<HTMLDivElement> {
  color?: "brand" | "gold" | "coral" | "azure" | "ink";
  size?: "sm" | "md" | "lg";
  shape?: "square" | "circle";
  children: React.ReactNode;
}

const colorMap = {
  brand: "bg-brand-100 text-brand-600 border-brand-500/25",
  gold: "bg-gold-100 text-[#8a5c11] border-gold-500/30",
  coral: "bg-coral-100 text-[#a13d29] border-coral-500/30",
  azure: "bg-azure-100 text-[#1a6c8c] border-azure-500/35",
  ink: "bg-surface text-ink-800 border-steel-200",
} as const;

const sizeMap = {
  sm: "h-8 w-8 p-1.5",
  md: "h-11 w-11 p-2.5",
  lg: "h-14 w-14 p-3.5",
} as const;

export function IconCircle({
  color = "brand",
  size = "md",
  shape = "square",
  className,
  children,
  ...props
}: IconCircleProps) {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center justify-center border",
        shape === "square" ? "rounded-sm" : "rounded-full",
        colorMap[color],
        sizeMap[size],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
