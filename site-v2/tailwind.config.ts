import type { Config } from "tailwindcss";
import dsConfig from "../design-system-v2/tailwind.config";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../design-system-v2/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      ...(dsConfig.theme?.extend ?? {}),
    },
  },
  plugins: [],
};

export default config;
