import * as React from "react";
import { cn } from "../../lib/utils";

/*
 * spec/04 requires skeletons while fetching. Hidden from assistive tech: the
 * loading state is announced by the surrounding live region, and a screen
 * reader should not read a row of placeholder blocks.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-sm bg-steel-100", className)}
      {...props}
    />
  );
}

export { Skeleton };
