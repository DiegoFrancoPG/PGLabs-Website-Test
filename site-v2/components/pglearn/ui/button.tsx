import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/components/pglearn/cn";

/*
 * PG Labs buttons are pills: `radius-pill`, `control-height` (44px), the
 * `button-label` style and a 1px border. The design system's button is the
 * outline pill (`ink-warm` on light, `text-light` on dark); `primary` is the
 * same pill filled with ink, kept for the one main action on a screen. Hover
 * washes with `ink-4`. Focus is the global 2px `focus-ring` (globals.css).
 *
 * The variant names are the design system's (primary, subtle, …) so every
 * caller written against `@ds/components/ui/button` moves over unchanged.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full border font-ui text-ui-button transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border-ui-primary bg-ui-primary text-ui-primary-foreground hover:bg-ui-primary/85",
        outline: "border-ui-foreground bg-transparent text-ui-foreground hover:bg-ui-wash",
        secondary: "border-ui-foreground bg-transparent text-ui-foreground hover:bg-ui-wash",
        subtle: "border-ui-input bg-transparent text-ui-foreground hover:bg-ui-wash",
        accent: "border-ui-primary bg-ui-primary text-ui-primary-foreground hover:bg-ui-primary/85",
        ghost: "border-transparent bg-transparent text-ui-foreground hover:bg-ui-wash",
        destructive:
          "border-ui-destructive bg-transparent text-ui-destructive hover:bg-ui-destructive/10",
        link: "h-auto border-transparent px-0 text-ui-foreground underline decoration-ui-brand decoration-2 underline-offset-4 hover:decoration-ui-foreground",
      },
      size: {
        sm: "h-9 px-4",
        default: "h-11 px-4",
        lg: "h-11 px-6",
        icon: "size-11 px-0",
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
