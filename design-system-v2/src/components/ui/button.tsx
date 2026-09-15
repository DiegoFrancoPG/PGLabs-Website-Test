import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

/*
 * v2 buttons are softly squared — 6px (`rounded-lg`), enough to read as a
 * control without becoming a pill; the deck sets everything on a grid.
 * Labels are Open Sans semibold with slight positive tracking so they read as
 * deliberate editorial furniture rather than app chrome.
 *
 * Azure (#59c4ed) is the interactive fill and ink-800 the label across the set,
 * so every variant is dark type on a light or tinted ground. It is the same hue
 * as the `brand` ramp, which the deck's teal was retired in favour of.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-body font-semibold tracking-[0.01em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azure-600 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        /*
         * Azure fill, ink label. The fill is too light to carry white type
         * (1.9:1), so the whole set is dark-on-light and reads as one family.
         */
        primary:
          "bg-azure-500 text-ink-800 hover:bg-azure-600 hover:shadow-sm",
        secondary:
          "bg-ink-800 text-white hover:bg-ink-900 hover:shadow-sm",
        outline:
          "bg-transparent text-ink-800 border border-steel-200 hover:border-azure-500 hover:bg-azure-100",
        accent:
          "bg-gold-500 text-ink-800 hover:brightness-[0.96] hover:shadow-sm",
        ghost:
          "bg-transparent text-white border border-white/25 hover:bg-white/10 hover:border-white/45",
        subtle:
          "bg-surface text-ink-800 hover:bg-surface-sunken",
        destructive:
          "bg-coral-500 text-white hover:brightness-95",
        /* Editorial text link with a rule that draws in on hover */
        link:
          "px-0 text-ink-800 border-b-2 border-azure-500/50 rounded-none hover:border-azure-500",
      },
      size: {
        sm: "h-9 px-4 text-body-sm",
        default: "h-11 px-6 text-body-sm",
        lg: "h-13 px-8 text-body",
        icon: "h-11 w-11 px-0",
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
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
