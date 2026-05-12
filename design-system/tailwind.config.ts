import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    "./.storybook/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: "#e87964",
          "orange-hover": "#db715d",
          cream: "#fcfaf7",
          "dark-grey": "#2c3436",
          "dark-blue": "#131a2c",
        },
        accent: {
          blue: "#64a0b4",
          gold: "#d4a76a",
          purple: "#a78bfa",
        },
        neutral: {
          muted: "#b2bec3",
          body: "#636e72",
        },
        // shadcn semantics mapped to PGLabs tokens
        background: "#fcfaf7",
        foreground: "#2c3436",
        primary: {
          DEFAULT: "#e87964",
          foreground: "#ffffff",
        },
        secondary: {
          DEFAULT: "#f0ede8",
          foreground: "#2c3436",
        },
        muted: {
          DEFAULT: "#f5f2ee",
          foreground: "#636e72",
        },
        destructive: {
          DEFAULT: "#ef4444",
          foreground: "#ffffff",
        },
        border: "rgba(0,0,0,0.06)",
        input: "rgba(0,0,0,0.06)",
        ring: "#e87964",
        card: {
          DEFAULT: "#ffffff",
          foreground: "#2c3436",
        },
        popover: {
          DEFAULT: "#ffffff",
          foreground: "#2c3436",
        },
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        body: ["Inter", "sans-serif"],
        sans: ["Inter", "sans-serif"],
      },
      fontSize: {
        "h1": ["40px", { lineHeight: "110%", letterSpacing: "-1.54px", fontWeight: "500" }],
        "h1-lg": ["52px", { lineHeight: "110%", letterSpacing: "-1.5px", fontWeight: "500" }],
        "h2": ["32px", { lineHeight: "39px", letterSpacing: "-0.86px", fontWeight: "500" }],
        "h3": ["18px", { lineHeight: "23px", letterSpacing: "-0.18px", fontWeight: "500" }],
        "body": ["15px", { lineHeight: "130%" }],
        "body-lg": ["18px", { lineHeight: "120%", fontWeight: "300" }],
        "eyebrow": ["13px", { lineHeight: "19.5px" }],
        "label": ["11px", { lineHeight: "18px", letterSpacing: "1.1px", fontWeight: "500" }],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        full: "9999px",
      },
      boxShadow: {
        xs: "0 1px 4px rgba(0,0,0,0.06)",
        sm: "0 2px 12px rgba(0,0,0,0.05)",
        nav: "0 2px 12px rgba(0,0,0,0.2)",
        "glow-orange": "0 0 0 3px rgba(232,121,100,0.25)",
        "glow-blue": "0 0 0 3px rgba(100,160,180,0.25)",
        "glow-gold": "0 0 0 3px rgba(212,167,106,0.25)",
      },
      spacing: {
        "4.5": "18px",
        "13": "52px",
        "15": "60px",
        "18": "72px",
        "22": "88px",
        "26": "104px",
        "30": "120px",
        "32": "128px",
      },
      backdropBlur: {
        nav: "8px",
      },
    },
  },
  plugins: [],
};

export default config;
