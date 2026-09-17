import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

/*
 * v2 cards lean on hairlines and a top rule rather than rounded elevation.
 * The `rule` accent reproduces the deck's device of a coloured keyline sitting
 * directly above a block of content.
 */
const cardVariants = cva("flex flex-col rounded-sm", {
  variants: {
    variant: {
      default: "bg-white border border-steel-200 p-8",
      surface: "bg-surface border border-steel-200/70 p-8",
      /* Borderless editorial column — divided by rules, not boxes */
      plain: "bg-transparent p-0",
      ruled: "bg-transparent border-t border-steel-200 pt-6",
      dark: "bg-white/[0.04] border border-white/12 p-8",
      "dark-ruled": "bg-transparent border-t border-white/20 pt-6",
      mini: "bg-white border border-steel-200 p-4 flex-row items-center gap-4",
      phase: "bg-white border border-steel-200 p-8",
      quote: "bg-surface border-l-2 border-l-brand-500 border-y-0 border-r-0 p-8",
    },
    accent: {
      none: "",
      brand: "border-t-2 border-t-brand-500",
      gold: "border-t-2 border-t-gold-500",
      coral: "border-t-2 border-t-coral-500",
      azure: "border-t-2 border-t-azure-500",
    },
  },
  defaultVariants: {
    variant: "default",
    accent: "none",
  },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, accent, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, accent, className }))} {...props} />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-2 mb-4", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("font-display text-h4 text-ink-800", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-body-sm text-steel-500", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex-1", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center mt-6", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  cardVariants,
};
