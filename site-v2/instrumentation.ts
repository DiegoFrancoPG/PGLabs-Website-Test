/*
 * spec/05: "Startup validates core app/Auth configuration." Running it here
 * means a deployment with a broken environment fails at boot, in the platform
 * logs, rather than part-way through a learner's first request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertCoreConfigured } = await import("./lib/env");
    assertCoreConfigured();
  }
}
