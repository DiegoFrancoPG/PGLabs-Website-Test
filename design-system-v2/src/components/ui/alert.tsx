import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

/*
 * Save and error summaries. spec/04 requires `aria-live` on these, so the
 * politeness level is part of the component rather than left to each caller:
 * an error interrupts (assertive), a success confirmation does not (polite).
 *
 * Colour never carries the meaning alone — each variant pairs its ground with
 * a left rule and callers supply a text label.
 */
const alertVariants = cva(
  "w-full rounded-sm border-l-2 px-4 py-3 font-body text-body-sm",
  {
    variants: {
      variant: {
        info: "border-l-brand-500 bg-brand-100 text-ink-800",
        success: "border-l-brand-600 bg-azure-100 text-ink-800",
        warning: "border-l-gold-500 bg-gold-100 text-ink-800",
        error: "border-l-coral-500 bg-coral-100 text-ink-800",
      },
    },
    defaultVariants: { variant: "info" },
  }
);

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", ...props }, ref) => (
    <div
      ref={ref}
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={cn(alertVariants({ variant, className }))}
      {...props}
    />
  )
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("font-semibold", className)} {...props} />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("[&_p]:leading-relaxed", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription, alertVariants };
