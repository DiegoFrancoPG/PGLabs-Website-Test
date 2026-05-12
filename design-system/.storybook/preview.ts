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
      default: "cream",
      values: [
        { name: "cream", value: "#fcfaf7" },
        { name: "white", value: "#ffffff" },
        { name: "dark-grey", value: "#2c3436" },
        { name: "dark-blue", value: "#131a2c" },
      ],
    },
  },
};

export default preview;
