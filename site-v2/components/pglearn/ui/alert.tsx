import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/components/pglearn/cn";

/*
 * Save and error summaries. spec/04 requires `aria-live` on these, so the
 * politeness level is part of the component rather than left to each caller:
 * an error interrupts (assertive), a success confirmation does not (polite).
 *
 * PG Labs styling: a `surface-subtle` panel, `radius-m`, a hairline, `body-m`
 * in the heading colour, and a leading 6px `bullet` in the state's colour.
 * Colour never carries the meaning alone; callers supply the words.
 */
const alertVariants = cva(
  "relative w-full rounded-ui border py-3 pl-8 pr-4 font-ui text-ui-body before:absolute before:left-4 before:top-[1.15rem] before:size-1.5 before:rounded-full",
  {
    variants: {
      variant: {
        info: "border-ui-border bg-ui-muted text-ui-foreground before:bg-ui-brand",
        success: "border-ui-border bg-ui-muted text-ui-foreground before:bg-ui-brand",
        warning: "border-ui-warning/50 bg-ui-muted text-ui-foreground before:bg-ui-warning",
        error: "border-ui-destructive/40 bg-ui-card text-ui-destructive before:bg-ui-destructive",
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
  ({ className, ...props }, ref) => <p ref={ref} className={cn("font-semibold", className)} {...props} />
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
