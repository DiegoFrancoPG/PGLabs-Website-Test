/*
 * `cn` lives in the design system, because the font-size conflict group it
 * configures is derived from the design system's own type scale.
 *
 * This file used to hold a byte-identical copy. Keeping the duplicate meant
 * two tailwind-merge instances in the bundle (~8 kB) and two places to update
 * whenever the scale changes, so the site re-exports the one implementation.
 */
export { cn } from "@ds/lib/utils";
