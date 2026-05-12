import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const cardVariants = cva(
  "flex flex-col rounded-lg border",
  {
    variants: {
      variant: {
        default: "bg-brand-cream border-black/5 p-8",
        white: "bg-white border-black/5 p-8",
        dark: "bg-white/5 border-white/10 p-8",
        mini: "bg-white/85 border-transparent shadow-xs p-3 px-4 flex-row items-center gap-3.5",
        phase: "bg-brand-cream border-black/5 p-7 px-6 items-center text-center",
        risk: "bg-white/5 border-brand-orange/15 p-6",
        audience: "bg-white/5 border-white/10 p-10",
      },
      accent: {
        none: "",
        orange: "before:absolute before:top-0 before:left-0 before:h-0.5 before:w-full before:bg-gradient-to-r before:from-brand-orange/30 before:to-transparent relative overflow-hidden",
        blue: "before:absolute before:top-0 before:left-0 before:h-0.5 before:w-full before:bg-gradient-to-r before:from-accent-blue/30 before:to-transparent relative overflow-hidden",
        gold: "before:absolute before:top-0 before:left-0 before:h-0.5 before:w-full before:bg-gradient-to-r before:from-accent-gold/30 before:to-transparent relative overflow-hidden",
      },
    },
    defaultVariants: {
      variant: "default",
      accent: "none",
    },
  }
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, accent, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, accent, className }))}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 mb-4", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("font-display text-h3 font-medium text-brand-dark-grey", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-body text-neutral-body", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex-1", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center mt-4", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, cardVariants };
