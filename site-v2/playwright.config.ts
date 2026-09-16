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
      // The scheduler has its own project below, because it is the one spec
      // whose subject is global.
      testIgnore: /jobs\.spec\.ts/,
    },
    {
      name: "mobile-390",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
      testIgnore: /jobs\.spec\.ts/,
    },
    /*
     * The scheduler, alone and last.
     *
     * Every other spec owns a learner or an organization and can run beside
     * its neighbours. The scheduler owns nobody and touches everybody: one run
     * plans a reminder for every eligible learner in the database. Running it
     * beside the others made three unrelated specs fail — not because either
     * was wrong, but because they disagreed about whose state it was.
     *
     * `dependencies` makes this wait until the rest have finished, and a
     * single worker keeps it from racing itself.
     */
    {
      name: "scheduler",
      testMatch: /jobs\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      dependencies: ["desktop-1440", "mobile-390"],
      fullyParallel: false,
      workers: 1,
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
      /*
       * The scheduler's secret and the webhook's signing key, so AC-050 and
       * AC-049 can exercise a correct secret, a wrong one and a forged
       * signature against the real routes. Both are test values and neither
       * unlocks anything outside this server.
       */
      CRON_SECRET: "test-cron-secret-do-not-reuse",
      RESEND_WEBHOOK_SECRET: "whsec_dGVzdHNlY3JldGZvcnBnbGVhcm50ZXN0cw==",
    },
  },
});
