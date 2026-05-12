import * as React from "react";
import { cn } from "@/lib/utils";

interface EyebrowProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "coral" | "white";
  children: React.ReactNode;
}

export function Eyebrow({ variant = "default", className, children, ...props }: EyebrowProps) {
  const colorMap = {
    default: "bg-neutral-body text-neutral-body",
    coral: "bg-brand-orange text-brand-orange",
    white: "bg-white text-white",
  };

  return (
    <div className={cn("flex items-center gap-3", className)} {...props}>
      <div className={cn("h-px w-6", colorMap[variant].split(" ")[0])} />
      <span className={cn("text-eyebrow font-body", colorMap[variant].split(" ")[1])}>
        {children}
      </span>
    </div>
  );
}
