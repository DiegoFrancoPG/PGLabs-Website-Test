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
    /*
     * The integration suites talk to a hosted Supabase project, so every query
     * is a network round trip. The default 5s is comfortable for a local
     * database and not for this one — the invitation journey alone makes a
     * dozen calls against real Auth.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    /*
     * There is ONE development database, so test files cannot run against it
     * concurrently: a suite that creates and deletes accounts will interfere
     * with one reading shared state. Vitest parallelises files by default,
     * which produced exactly that — onboarding tests failing because the
     * invitation journey was mutating the same learner at the same moment.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(here),
      "@ds": path.resolve(here, "../design-system-v2/src"),
    },
  },
});
