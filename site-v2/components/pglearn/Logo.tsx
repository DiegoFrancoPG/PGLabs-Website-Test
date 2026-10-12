import Image from "next/image";
import { cn } from "@/components/pglearn/cn";

/*
 * PGLearn wordmark: the real PG Labs lockup (the same file the marketing
 * masthead uses), a hairline, and "Learn" in Lora as the product name. On dark
 * grounds the lockup is inverted so its type stays readable.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <Image
        src="/images/PGlabs-logo.svg"
        alt="PG Labs"
        width={93}
        height={28}
        priority
        className="h-7 w-auto dark:invert"
      />
      <span aria-hidden className="h-5 w-px bg-ui-divider" />
      <span className="font-heading text-ui-heading text-ui-foreground">Learn</span>
    </span>
  );
}
