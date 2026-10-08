import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * Save and error summaries. spec/04 requires `aria-live` on these, so the
 * politeness level is part of the component rather than left to each caller:
 * an error interrupts (assertive), a success confirmation does not (polite).
 *
 * Colour never carries the meaning alone — callers supply a text label — but
 * each variant also tints its ground and border, shadcn-style.
 */
const alertVariants = cva("w-full rounded-lg border px-4 py-3 font-ui text-sm", {
  variants: {
    variant: {
      info: "border-ui-primary/25 bg-ui-accent text-ui-accent-foreground",
      success: "border-ui-success/30 bg-ui-success/10 text-ui-foreground",
      warning: "border-ui-warning/40 bg-ui-warning/10 text-ui-foreground",
      error: "border-ui-destructive/30 bg-ui-destructive/10 text-ui-destructive",
    },
  },
  defaultVariants: { variant: "info" },
});

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", ...props }, ref) => (
    <div
      ref={ref}
      data-slot="alert"
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
      className={cn(alertVariants({ variant, className }))}
      {...props}
    />
  )
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn("font-medium", className)} {...props} />
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("[&_p]:leading-relaxed", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription, alertVariants };
