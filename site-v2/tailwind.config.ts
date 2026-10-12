import type { Config } from "tailwindcss";
import dsConfig from "../design-system-v2/tailwind.config";

/*
 * PGLearn's tokens, from the PG Labs design system. Every colour reads a CSS
 * variable that is only defined inside `.pglearn` (app/globals.css), so these
 * utilities have no meaning on the marketing site. They live under their own
 * `ui` key because the design system already claims the bare shadcn names
 * (`primary`, `muted`, …) with fixed values the marketing pages depend on.
 */
const ui = (name: string) => `rgb(var(--ui-${name}) / <alpha-value>)`;
/* Tokens whose value carries its own alpha (ink-4, white-10 …). */
const uiSolid = (name: string) => `rgb(var(--ui-${name}))`;

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
          brand: ui("brand"),
          destructive: ui("destructive"),
          success: ui("success"),
          warning: ui("warning"),
          ring: ui("ring"),
          border: uiSolid("border"),
          divider: uiSolid("divider"),
          input: ui("input"),
          wash: uiSolid("wash"),
        },
      },
      fontFamily: {
        ...(dsExtend.fontFamily ?? {}),
        heading: ["Lora", "Georgia", "serif"],
        ui: ['"Nunito Sans"', "system-ui", "sans-serif"],
      },
      /* The design system's type styles, by name (tokens.json `type`). */
      fontSize: {
        ...(dsExtend.fontSize ?? {}),
        "ui-display": ["44px", { lineHeight: "44px", letterSpacing: "-1.1px", fontWeight: "600" }],
        "ui-section": ["40px", { lineHeight: "45.6px", letterSpacing: "-0.8px", fontWeight: "600" }],
        "ui-title": ["28px", { lineHeight: "34.16px", letterSpacing: "-0.42px", fontWeight: "600" }],
        "ui-heading": ["20px", { lineHeight: "26.4px", letterSpacing: "-0.2px", fontWeight: "600" }],
        "ui-lead": ["17px", { lineHeight: "27.2px" }],
        "ui-body": ["15px", { lineHeight: "23.25px" }],
        "ui-button": ["14px", { lineHeight: "20px", fontWeight: "600" }],
        "ui-eyebrow": ["12px", { lineHeight: "12px", letterSpacing: "1.68px", fontWeight: "600" }],
        "ui-caption": ["12px", { lineHeight: "17.4px" }],
      },
      borderRadius: {
        ...(dsExtend.borderRadius ?? {}),
        "ui-sm": "6px", // radius-6: chips, small thumbnails
        ui: "8px", // radius-m: cards, images, fields
        "ui-lg": "16px", // radius-16: large image tiles
      },
      maxWidth: {
        ...(dsExtend.maxWidth ?? {}),
        "ui-container": "1360px", // container-max
      },
    },
  },
  plugins: [],
};

export default config;
