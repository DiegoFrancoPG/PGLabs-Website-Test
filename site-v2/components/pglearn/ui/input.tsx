import * as React from "react";
import { cn } from "@/components/pglearn/cn";

/*
 * Shared by Input, the Select trigger and (through `.pglearn-field` in
 * globals.css) the raw <textarea>/<select> controls the platform renders, so
 * every field has one geometry: `control-height` (44px), `radius-m`, and an
 * `ink-45` border — the design system's 3:1 step for control boundaries.
 */
export const fieldClassName =
  "w-full min-w-0 rounded-ui border border-ui-input bg-ui-card px-3 font-ui text-ui-body text-ui-foreground transition-colors placeholder:text-ui-muted-foreground hover:border-ui-foreground disabled:cursor-not-allowed disabled:bg-ui-muted disabled:opacity-60 aria-[invalid=true]:border-ui-destructive";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    data-slot="input"
    className={cn(fieldClassName, "h-11", className)}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
