import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * `cn` for PGLearn's primitives. tailwind-merge cannot tell the PG Labs type
 * styles (`text-ui-title`, `text-ui-body` …) from text colours, and would drop
 * a size as soon as a colour followed it. Registering them as font sizes keeps
 * the two in separate conflict groups — the same fix design-system-v2 applies
 * to its own scale.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "ui-display",
            "ui-section",
            "ui-title",
            "ui-heading",
            "ui-lead",
            "ui-body",
            "ui-button",
            "ui-eyebrow",
            "ui-caption",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
