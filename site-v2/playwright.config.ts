import { defineConfig, devices } from "@playwright/test";

/*
 * spec/04 requires the interface to be verified at 390px and 1440px, so those
 * are the two projects rather than a single default viewport.
 */
const PORT = 3001;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      APP_ENV: "test",
      NEXT_PUBLIC_APP_URL: baseURL,
      /*
       * The tutor answers from a stub rather than a model, so AC-067 can drive
       * a completed, an unsupported and a failed answer without an account or a
       * bill. assertCoreConfigured() refuses to boot with this set in pilot or
       * production, per spec/05's ban on mock providers there.
       */
      PGLEARN_USE_FIXTURES: "tutor",
    },
  },
});
