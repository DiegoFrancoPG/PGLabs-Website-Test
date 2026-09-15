import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * Our type scale uses named keys (text-h2, text-stat-sm, text-lede …) rather
 * than Tailwind's built-in t-shirt sizes. tailwind-merge can't tell those from
 * text-colour utilities, so out of the box it treats `text-stat-sm` as a colour
 * and silently drops it the moment a real colour follows:
 *
 *   twMerge("text-stat-sm text-white")  ->  "text-white"   // size lost
 *
 * Registering the scale in the font-size group keeps size and colour in
 * separate conflict groups, so both survive.
 */
const FONT_SIZES = [
  "display",
  "display-sm",
  "h1",
  "h1-sm",
  "h2",
  "h2-sm",
  "h3",
  "h4",
  "stat",
  "stat-lg",
  "stat-sm",
  "lede",
  "body-lg",
  "body",
  "body-sm",
  "eyebrow",
  "label",
  "source",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: FONT_SIZES }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
