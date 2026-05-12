import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-body text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-orange text-white rounded-full hover:bg-brand-orange-hover hover:shadow-sm",
        outline:
          "bg-transparent text-neutral-body border-2 border-brand-orange rounded-full hover:bg-black/5 font-display",
        ghost:
          "bg-transparent text-white border border-white rounded-full hover:bg-white/10",
        cta:
          "bg-transparent text-brand-dark-grey border border-black/10 rounded-full hover:bg-black/5",
        secondary:
          "bg-secondary text-secondary-foreground rounded-full hover:bg-secondary/80",
        destructive:
          "bg-destructive text-destructive-foreground rounded-full hover:bg-destructive/90",
        link: "text-brand-orange underline-offset-4 hover:underline",
      },
      size: {
        sm: "px-4 py-1.5 text-xs",
        default: "px-6 py-2",
        lg: "px-8 py-3 text-base",
        icon: "h-9 w-9",
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
