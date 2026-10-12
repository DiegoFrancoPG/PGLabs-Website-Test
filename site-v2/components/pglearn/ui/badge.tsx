import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/components/pglearn/cn";

/*
 * PG Labs status chips: `radius-6`, a 1px hairline, `caption` type in the
 * text colour, and a 6px `bullet` that carries the state's colour. The design
 * system has one hue, so colour is never the only signal — the label always
 * says the state, and the dot only reinforces it.
 *
 * Variant names are design-system-v2's so callers move over unchanged: `azure`
 * is a positive state, `coral` a problem, `gold` a caution.
 */
const badgeVariants = cva(
  "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-ui-sm border px-2 font-ui text-ui-caption font-semibold",
  {
    variants: {
      variant: {
        default: "border-ui-primary bg-ui-primary text-ui-primary-foreground",
        secondary: "border-ui-border bg-ui-muted text-ui-foreground",
        azure: "border-ui-border bg-ui-card text-ui-foreground before:size-1.5 before:rounded-full before:bg-ui-brand",
        gold: "border-ui-border bg-ui-card text-ui-foreground before:size-1.5 before:rounded-full before:bg-ui-warning",
        coral: "border-ui-destructive/40 bg-ui-card text-ui-destructive before:size-1.5 before:rounded-full before:bg-ui-destructive",
        ink: "border-ui-primary bg-ui-primary text-ui-primary-foreground",
        outline: "border-ui-border bg-ui-card text-ui-muted-foreground",
        dark: "border-ui-border bg-ui-muted text-ui-foreground",
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
