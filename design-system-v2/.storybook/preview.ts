import type { Preview } from "@storybook/react";
import "../src/styles/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "white",
      values: [
        { name: "white", value: "#ffffff" },
        { name: "surface", value: "#f4f6f8" },
        { name: "ink", value: "#1a2230" },
        { name: "ink-deep", value: "#10161f" },
      ],
    },
  },
};

export default preview;
