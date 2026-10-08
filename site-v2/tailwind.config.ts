import type { Config } from "tailwindcss";
import dsConfig from "../design-system-v2/tailwind.config";

/*
 * PGLearn's SkillSphere theme. Every colour reads a CSS variable that is only
 * defined inside `.pglearn` (app/globals.css), so these utilities have no
 * meaning on the marketing site. They live under their own `ui` key because the
 * design system already claims the bare shadcn names (`primary`, `muted`, …)
 * with fixed brand values the marketing pages depend on.
 */
const ui = (name: string) => `oklch(var(--ui-${name}) / <alpha-value>)`;

const dsExtend = dsConfig.theme?.extend ?? {};

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../design-system-v2/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      ...dsExtend,
      colors: {
        ...(dsExtend.colors ?? {}),
        ui: {
          background: ui("background"),
          foreground: ui("foreground"),
          card: ui("card"),
          "card-foreground": ui("card-foreground"),
          popover: ui("popover"),
          "popover-foreground": ui("popover-foreground"),
          primary: ui("primary"),
          "primary-foreground": ui("primary-foreground"),
          secondary: ui("secondary"),
          "secondary-foreground": ui("secondary-foreground"),
          muted: ui("muted"),
          "muted-foreground": ui("muted-foreground"),
          accent: ui("accent"),
          "accent-foreground": ui("accent-foreground"),
          destructive: ui("destructive"),
          success: ui("success"),
          warning: ui("warning"),
          border: ui("border"),
          input: ui("input"),
          ring: ui("ring"),
        },
      },
      fontFamily: {
        ...(dsExtend.fontFamily ?? {}),
        heading: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        ui: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
