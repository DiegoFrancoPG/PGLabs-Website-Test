import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * Shared by Input and by the raw <textarea>/<select> controls the platform
 * renders, so every field in PGLearn has one geometry and one focus ring.
 */
export const fieldClassName =
  "w-full min-w-0 rounded-lg border border-ui-input bg-ui-background px-3 py-2 font-ui text-sm text-ui-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-ui-muted-foreground focus-visible:border-ui-ring focus-visible:ring-[3px] focus-visible:ring-ui-ring/50 disabled:cursor-not-allowed disabled:bg-ui-muted disabled:opacity-60 aria-[invalid=true]:border-ui-destructive aria-[invalid=true]:ring-ui-destructive/20";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    data-slot="input"
    className={cn(fieldClassName, "h-9 py-1", className)}
    ref={ref}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
