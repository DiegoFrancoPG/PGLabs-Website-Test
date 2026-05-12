import * as React from "react";
import { cn } from "@/lib/utils";

interface IconCircleProps extends React.HTMLAttributes<HTMLDivElement> {
  color?: "orange" | "blue" | "gold" | "purple";
  size?: "sm" | "md";
  children: React.ReactNode;
}

export function IconCircle({ color = "orange", size = "md", className, children, ...props }: IconCircleProps) {
  const colorMap = {
    orange: "bg-brand-orange/8 text-brand-orange",
    blue: "bg-accent-blue/8 text-accent-blue",
    gold: "bg-accent-gold/8 text-accent-gold",
    purple: "bg-accent-purple/10 text-accent-purple",
  };

  const sizeMap = {
    sm: "h-8 w-8 p-1.5",
    md: "h-10 w-10 p-2",
  };

  return (
    <div
      className={cn("inline-flex items-center justify-center rounded-full", colorMap[color], sizeMap[size], className)}
      {...props}
    >
      {children}
    </div>
  );
}
