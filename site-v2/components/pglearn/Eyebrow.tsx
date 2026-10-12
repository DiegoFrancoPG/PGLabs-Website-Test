import { cn } from "@/components/pglearn/cn";

/*
 * The PG Labs eyebrow: a 32px `accent` rule (`eyebrow-rule`) and an uppercase
 * label in the `eyebrow` style, in `text-body`. It sits `space-12` above a
 * title. Write the label in normal case; the style uppercases it.
 */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "flex items-center gap-3 font-ui text-ui-eyebrow uppercase text-ui-muted-foreground",
        className
      )}
    >
      <span aria-hidden className="h-px w-8 bg-ui-brand" />
      {children}
    </p>
  );
}
