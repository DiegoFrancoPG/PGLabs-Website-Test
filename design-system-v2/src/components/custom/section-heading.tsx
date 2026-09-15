import * as React from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";

/*
 * The deck's standard slide head: tracked eyebrow, a two-line Playfair headline
 * (often with the second line carrying the emphasis), then an optional lede.
 * Reproducing it as one component keeps every section on the same rhythm.
 */
interface SectionHeadingProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  tone?: "light" | "dark";
  align?: "left" | "center";
  size?: "default" | "lg";
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  tone = "light",
  align = "left",
  size = "default",
  className,
  ...props
}: SectionHeadingProps) {
  const dark = tone === "dark";

  return (
    <div
      className={cn(
        "flex flex-col gap-5",
        align === "center" && "items-center text-center",
        className
      )}
      {...props}
    >
      {eyebrow && (
        <Eyebrow variant={dark ? "white" : "brand"}>{eyebrow}</Eyebrow>
      )}

      <h2
        className={cn(
          "font-display",
          size === "lg" ? "text-h2-sm md:text-h1" : "text-h2-sm md:text-h2",
          dark ? "text-white" : "text-ink-800",
          align === "center" ? "max-w-[22ch]" : "max-w-[26ch]"
        )}
      >
        {title}
      </h2>

      {lede && (
        <p
          className={cn(
            "text-lede max-w-prose",
            dark ? "text-white/70" : "text-steel-500"
          )}
        >
          {lede}
        </p>
      )}
    </div>
  );
}
