import { z } from "zod";

/*
 * Environment contract for .env.example, validated with Zod (ADR-16).
 *
 * Two rules from spec/05 shape this file:
 *
 *   "Missing optional email/model keys disables that integration with
 *    NOT_CONFIGURED, visible in operations; does not block unrelated learning."
 *   "Production fixtures/mock providers are forbidden. Local tests explicitly
 *    inject fake adapters, never infer mock mode from missing credentials."
 *
 * So a missing secret is never a signal to substitute a mock. It either fails
 * loudly (core configuration) or reports NOT_CONFIGURED for that one
 * integration (optional configuration). There is no third path.
 */

if (typeof window !== "undefined") {
  throw new Error("lib/env is server-only and must never reach the browser bundle");
}

const APP_ENVS = ["development", "test", "pilot", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/*
 * Core: the application cannot serve a correct request without these.
 *
 * Supabase joined this set at T04, when Auth started being used. CRON_SECRET
 * joins at T21 with the scheduler. Nothing is required before something
 * actually needs it, so a missing variable always means a real problem.
 */
/*
 * spec/05 checks a mutation's Origin header against the configured app origin,
 * so this has to be a real http(s) origin. Zod's `.url()` is not enough on its
 * own: it accepts "localhost:3001", reading "localhost" as the scheme.
 */
const httpUrl = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be an absolute http(s) URL" }
);

const coreSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("development"),
  NEXT_PUBLIC_APP_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  /*
   * Bypasses RLS entirely. spec/02 confines it to "server-only modules for Auth
   * admin, signed storage URLs, jobs and provider-result persistence", which is
   * why it carries no NEXT_PUBLIC_ prefix and is read only from this module.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/*
 * Optional: each entry gates exactly one integration. Absent means that
 * integration reports NOT_CONFIGURED; it never means "use a fake".
 */
const optionalSchema = z.object({
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email().optional(),
  /*
   * Who may actually be written to. spec/05 requires a controlled first send,
   * and an allowlist is how a development database full of example.invalid
   * addresses cannot become real mail to a real person.
   */
  EMAIL_TEST_ALLOWLIST: z.string().optional(),
  /* The scheduler's shared secret. A user session never substitutes for it. */
  CRON_SECRET: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-5-mini"),
  TUTOR_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(10),
  TUTOR_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0.25),
  TUTOR_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(2.0),
  CERTIFICATE_ISSUER: z.string().min(1).default("PGLearn"),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("pglearn-private"),
});

const envSchema = coreSchema.merge(optionalSchema);

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

/**
 * Parses and caches the environment. Throws with every problem listed at once,
 * naming variables only — never their values, which are secrets.
 */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: drops the cache so a test can parse a different environment. */
export function resetServerEnvCache(): void {
  cached = undefined;
}

export type IntegrationName = "email" | "tutor";

/**
 * What `/admin/operations` renders (spec/04: "missing model/email configuration
 * clearly shown"). Reports whether an integration can run — never the keys.
 */
export function integrationStatus(): Record<IntegrationName, "configured" | "not_configured"> {
  const env = serverEnv();
  return {
    email: env.RESEND_API_KEY && env.EMAIL_FROM ? "configured" : "not_configured",
    tutor: env.OPENAI_API_KEY ? "configured" : "not_configured",
  };
}

/**
 * Startup check (spec/05: "Startup validates core app/Auth configuration").
 * Invoked from instrumentation.ts so a misconfigured deployment fails at boot
 * rather than on a learner's first request.
 */
export function assertCoreConfigured(): void {
  const env = serverEnv();
  if (env.APP_ENV === "pilot" || env.APP_ENV === "production") {
    // spec/05: "Production fixtures/mock providers are forbidden."
    if (process.env.PGLEARN_USE_FIXTURES) {
      throw new Error("PGLEARN_USE_FIXTURES must never be set outside development or test");
    }
    /*
     * The scheduler's secret is optional in development, where nothing calls
     * the job routes. On a deployed environment it is not optional in any
     * useful sense: without it both /api/v1/jobs routes reject every caller,
     * so reminders stop being sent and retention stops deleting — silently,
     * because a 401 to a platform cron looks exactly like an unauthorized
     * probe. Fail at boot instead, where an operator sees it.
     */
    if (!env.CRON_SECRET) {
      throw new Error(
        `CRON_SECRET is required when APP_ENV is ${env.APP_ENV}: without it the reminder and retention jobs reject the scheduler and never run`
      );
    }
  }
}
