import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * Deck badges are status stamps — squared, uppercase, tracked out. Used on the
 * industry-coach slide for "IN DEVELOPMENT" / "PLANNED".
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2.5 py-1 text-label uppercase font-body transition-colors",
  {
    variants: {
      variant: {
        default: "bg-brand-100 border-brand-500/25 text-brand-700",
        gold: "bg-gold-100 border-gold-500/30 text-[#8a5c11]",
        coral: "bg-coral-100 border-coral-500/30 text-[#a13d29]",
        azure: "bg-azure-100 border-azure-500/35 text-[#1a6c8c]",
        ink: "bg-ink-800 border-ink-800 text-white",
        outline: "bg-transparent border-steel-200 text-steel-500",
        dark: "bg-white/8 border-white/20 text-white",
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
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
