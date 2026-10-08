import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * SkillSphere badges are small rounded pills in sentence case. The design
 * system's variant names are kept so callers move over unchanged: `azure`
 * reads as a positive state, `coral` as a problem, `gold` as a caution.
 */
const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border border-transparent px-2 py-0.5 font-ui text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-ui-primary text-ui-primary-foreground",
        azure: "bg-ui-success/10 text-ui-success",
        gold: "bg-ui-warning/15 text-ui-foreground",
        coral: "bg-ui-destructive/10 text-ui-destructive",
        ink: "bg-ui-foreground text-ui-background",
        outline: "border-ui-border text-ui-foreground",
        dark: "bg-ui-secondary text-ui-secondary-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
