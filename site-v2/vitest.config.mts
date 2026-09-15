import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // Unit and integration suites are selected by path on the command line.
    include: ["tests/**/*.test.ts"],
    // Playwright owns tests/e2e and uses its own runner.
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(here),
      "@ds": path.resolve(here, "../design-system-v2/src"),
    },
  },
});
