import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * PGLearn button — SkillSphere / shadcn geometry: 8px radius, medium weight,
 * a 3px focus ring in the primary hue and a one-pixel press.
 *
 * The variant names are the design system's (primary, subtle, …) so every
 * caller written against `@ds/components/ui/button` moves over unchanged.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-transparent font-ui text-sm font-medium transition-all outline-none select-none focus-visible:border-ui-ring focus-visible:ring-[3px] focus-visible:ring-ui-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ui-primary text-ui-primary-foreground shadow-xs hover:bg-ui-primary/85",
        secondary: "bg-ui-secondary text-ui-secondary-foreground hover:bg-ui-secondary/70",
        outline:
          "border-ui-border bg-ui-background text-ui-foreground shadow-xs hover:bg-ui-muted",
        subtle: "bg-ui-secondary text-ui-foreground hover:bg-ui-accent hover:text-ui-accent-foreground",
        ghost: "text-ui-foreground hover:bg-ui-muted",
        accent: "bg-ui-accent text-ui-accent-foreground hover:bg-ui-accent/80",
        destructive:
          "bg-ui-destructive/10 text-ui-destructive hover:bg-ui-destructive/20 focus-visible:ring-ui-destructive/20",
        link: "h-auto px-0 text-ui-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[0.8125rem]",
        default: "h-9 px-4",
        lg: "h-10 px-5",
        icon: "size-9 px-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    // Radix's types resolve against the workspace's React 18 typings, so the
    // union is widened rather than letting the two ReactNode shapes collide.
    const Comp = (asChild ? Slot : "button") as React.ElementType;
    return (
      <Comp
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
