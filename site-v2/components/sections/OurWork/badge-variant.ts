import type { BadgeTint } from "./types";

/**
 * Maps the project data's tint names onto v2 Badge variants. Lives in its own
 * module so both the selector cards and the detail panel can import it without
 * creating a cycle between index.tsx and ProjectPanel.tsx.
 */
export const BADGE_VARIANT: Record<
  BadgeTint,
  "default" | "coral" | "gold" | "azure"
> = {
  green: "default",
  rose: "coral",
  gold: "gold",
  azure: "azure",
};
