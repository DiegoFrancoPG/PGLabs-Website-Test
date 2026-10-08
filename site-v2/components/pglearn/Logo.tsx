import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

/* PGLearn wordmark: the SkillSphere logo treatment — a primary tile and name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 font-heading text-lg font-semibold", className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-ui-primary text-ui-primary-foreground shadow-sm">
        <GraduationCap className="size-[18px]" aria-hidden />
      </span>
      PGLearn
    </span>
  );
}
