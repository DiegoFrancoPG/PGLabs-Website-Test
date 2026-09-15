import type { Config } from "tailwindcss";

/*
 * PGLabs Design System v2 — "Editorial"
 *
 * Every value below traces back to the PeaceGeeks NY Donor Deck. Colour names
 * are deliberately non-colliding with Tailwind's built-in scales (steel, gold,
 * coral, azure) so the built-ins stay available alongside the brand ramps.
 */

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}", "./.storybook/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Ink navy — headings and dark sections. Deck: #1A2230 */
        ink: {
          900: "#10161f",
          800: "#1a2230",
          700: "#2a3f5c",
          600: "#474f5e",
          DEFAULT: "#1a2230",
        },
        /* Cool slate — body copy and hairlines. Deck: #667083 (most-used) */
        steel: {
          500: "#667083",
          400: "#8595ab",
          300: "#9daac0",
          200: "#c9d4e2",
          100: "#e4eaf2",
          DEFAULT: "#667083",
        },
        /*
         * Brand blue — the deck's teal retired in favour of azure #59C4ED, now
         * the single brand hue (same family as the `azure` ramp below, which
         * stays as the interactive alias). 500 is the accent for fills, rules
         * and type on dark; 600/700 are the text-safe steps for light grounds
         * (#59C4ED itself is only 2:1 on white, so it never carries small type).
         */
        brand: {
          700: "#0e5f81",
          600: "#11739c",
          500: "#59c4ed",
          400: "#7ecff1",
          100: "#ddeffb",
          DEFAULT: "#11739c",
        },
        /* Data accents used on the deck's stat and chart slides */
        gold: {
          500: "#e8a33d",
          100: "#fbeed6",
          DEFAULT: "#e8a33d",
        },
        coral: {
          500: "#e2624a",
          100: "#fbe3de",
          DEFAULT: "#e2624a",
        },
        /*
         * Azure is now the interactive ramp — 500 is the button fill, 600 its
         * hover/active step (same hue and saturation, 10% darker), 100 the
         * tinted wash for quiet states.
         */
        azure: {
          600: "#2cb0e7",
          500: "#59c4ed",
          100: "#dff2fb",
          DEFAULT: "#59c4ed",
        },

        /* Surfaces */
        surface: {
          DEFAULT: "#f4f6f8",
          raised: "#ffffff",
          sunken: "#e9edf2",
        },

        /* shadcn semantics mapped onto v2 tokens */
        background: "#ffffff",
        foreground: "#1a2230",
        primary: {
          /* Matches the button fill: azure ground, ink label */
          DEFAULT: "#59c4ed",
          foreground: "#1a2230",
        },
        secondary: {
          DEFAULT: "#f4f6f8",
          foreground: "#1a2230",
        },
        muted: {
          DEFAULT: "#f4f6f8",
          foreground: "#667083",
        },
        accent: {
          DEFAULT: "#e8a33d",
          foreground: "#1a2230",
        },
        destructive: {
          DEFAULT: "#e2624a",
          foreground: "#ffffff",
        },
        border: "#c9d4e2",
        input: "#c9d4e2",
        ring: "#59c4ed",
        card: {
          DEFAULT: "#ffffff",
          foreground: "#1a2230",
        },
        popover: {
          DEFAULT: "#ffffff",
          foreground: "#1a2230",
        },
      },

      fontFamily: {
        display: ["Lora", "Georgia", "serif"],
        body: ["Nunito Sans", "system-ui", "sans-serif"],
        sans: ["Nunito Sans", "system-ui", "sans-serif"],
        serif: ["Lora", "Georgia", "serif"],
      },

      /*
       * Editorial type scale. Display sizes are Playfair at 600 with tight
       * negative tracking, matching the deck's headline treatment. Body sizes
       * are Open Sans at a generous 1.6 line-height for long-form reading.
       */
      fontSize: {
        display: ["64px", { lineHeight: "1.05", letterSpacing: "-0.025em", fontWeight: "600" }],
        "display-sm": ["48px", { lineHeight: "1.08", letterSpacing: "-0.022em", fontWeight: "600" }],
        h1: ["52px", { lineHeight: "1.08", letterSpacing: "-0.022em", fontWeight: "600" }],
        "h1-sm": ["38px", { lineHeight: "1.12", letterSpacing: "-0.02em", fontWeight: "600" }],
        h2: ["40px", { lineHeight: "1.14", letterSpacing: "-0.02em", fontWeight: "600" }],
        "h2-sm": ["30px", { lineHeight: "1.2", letterSpacing: "-0.018em", fontWeight: "600" }],
        h3: ["28px", { lineHeight: "1.22", letterSpacing: "-0.015em", fontWeight: "600" }],
        h4: ["20px", { lineHeight: "1.32", letterSpacing: "-0.01em", fontWeight: "600" }],

        /* Big-number stat treatment from the deck's data slides */
        stat: ["64px", { lineHeight: "1", letterSpacing: "-0.03em", fontWeight: "600" }],
        "stat-lg": ["88px", { lineHeight: "0.95", letterSpacing: "-0.035em", fontWeight: "600" }],
        "stat-sm": ["44px", { lineHeight: "1", letterSpacing: "-0.025em", fontWeight: "600" }],

        /* Body */
        "body-lg": ["19px", { lineHeight: "1.62" }],
        body: ["17px", { lineHeight: "1.6" }],
        "body-sm": ["15px", { lineHeight: "1.55" }],

        /* Editorial furniture */
        lede: ["22px", { lineHeight: "1.5", fontWeight: "300" }],
        eyebrow: ["12px", { lineHeight: "1", letterSpacing: "0.14em", fontWeight: "600" }],
        label: ["11px", { lineHeight: "1.4", letterSpacing: "0.1em", fontWeight: "600" }],
        source: ["12px", { lineHeight: "1.45" }],
      },

      letterSpacing: {
        eyebrow: "0.14em",
        label: "0.1em",
      },

      /*
       * Near-square for type-bearing surfaces — the deck sets type on a grid,
       * not in pills. `2xl`/`3xl` are the deck's soft card geometry, for panels
       * that hold an image and read as objects rather than as ruled columns.
       */
      borderRadius: {
        none: "0",
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
        lg: "6px",
        xl: "10px",
        "2xl": "16px",
        "3xl": "24px",
        full: "9999px",
      },

      /* Cool, navy-tinted elevation rather than neutral black */
      boxShadow: {
        xs: "0 1px 2px rgba(26,34,48,0.06)",
        sm: "0 2px 8px rgba(26,34,48,0.07)",
        md: "0 6px 20px rgba(26,34,48,0.09)",
        lg: "0 16px 44px rgba(26,34,48,0.12)",
        nav: "0 1px 0 rgba(201,212,226,1)",
        "ring-brand": "0 0 0 3px rgba(89,196,237,0.35)",
        "ring-gold": "0 0 0 3px rgba(232,163,61,0.28)",
        "ring-coral": "0 0 0 3px rgba(226,98,74,0.28)",
      },

      spacing: {
        "4.5": "18px",
        "13": "52px",
        "15": "60px",
        "18": "72px",
        "22": "88px",
        "26": "104px",
        "30": "120px",
        "34": "136px",
        "40": "160px",
      },

      maxWidth: {
        prose: "68ch",
        measure: "56ch",
        content: "1200px",
        wide: "1360px",
      },

      backdropBlur: {
        nav: "10px",
      },
    },
  },
  plugins: [],
};

export default config;
