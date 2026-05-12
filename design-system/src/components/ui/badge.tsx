import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-eyebrow font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-brand-orange/10 border-brand-orange/20 text-brand-orange",
        blue: "bg-accent-blue/10 border-accent-blue/20 text-accent-blue",
        gold: "bg-accent-gold/10 border-accent-gold/20 text-accent-gold",
        purple: "bg-accent-purple/10 border-accent-purple/20 text-accent-purple",
        dark: "bg-white/10 border-white/15 text-white",
        outline: "border-black/10 text-neutral-body",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
