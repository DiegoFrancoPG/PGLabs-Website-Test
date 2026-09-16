import { describe, it, expect, beforeEach, afterEach } from "vitest";

/*
 * lib/env caches its parse, so each case resets the cache and restores the
 * process environment it borrowed.
 */
const ORIGINAL = { ...process.env };

async function loadEnv() {
  const mod = await import("@/lib/env");
  mod.resetServerEnvCache();
  return mod;
}

/*
 * Supabase joined the core schema at T04, so a valid baseline now includes it.
 * Individual cases still remove one variable at a time to prove it is required.
 */
const VALID_CORE = {
  NEXT_PUBLIC_APP_URL: "http://localhost:3001",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
};

beforeEach(() => {
  process.env = { ...ORIGINAL, ...VALID_CORE };
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("core configuration", () => {
  it("rejects a missing app URL instead of inventing one", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("rejects a non-URL app URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "localhost:3001";
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("never puts a value in the error message", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "not-a-url";
    process.env.EMAIL_FROM = "super-secret-sender@example.test";
    const { serverEnv } = await loadEnv();
    try {
      serverEnv();
      throw new Error("expected a validation failure");
    } catch (err) {
      expect(String(err)).not.toContain("not-a-url");
      expect(String(err)).not.toContain("super-secret-sender");
    }
  });

  it.each([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ])("rejects a missing %s, rather than starting without a database", async (key) => {
    delete process.env[key];
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).toThrow(new RegExp(key));
  });

  it("applies the documented defaults from .env.example", async () => {
    const { serverEnv } = await loadEnv();
    const env = serverEnv();
    expect(env.APP_ENV).toBe("development");
    expect(env.OPENAI_MODEL).toBe("gpt-5-mini");
    expect(env.CERTIFICATE_ISSUER).toBe("PGLearn");
    expect(env.SUPABASE_STORAGE_BUCKET).toBe("pglearn-private");
    expect(env.TUTOR_MONTHLY_BUDGET_USD).toBe(10);
    expect(env.TUTOR_INPUT_USD_PER_MILLION).toBe(0.25);
    expect(env.TUTOR_OUTPUT_USD_PER_MILLION).toBe(2);
  });
});

describe("optional integrations", () => {
  it("reports not_configured when keys are absent, rather than falling back to a mock", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.OPENAI_API_KEY;
    const { integrationStatus } = await loadEnv();
    expect(integrationStatus()).toEqual({ email: "not_configured", tutor: "not_configured" });
  });

  it("needs both a key and a sender before email counts as configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    delete process.env.EMAIL_FROM;
    const { integrationStatus } = await loadEnv();
    expect(integrationStatus().email).toBe("not_configured");
  });

  it("reports configured once both are present", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "learn@example.test";
    process.env.OPENAI_API_KEY = "sk-test";
    const { integrationStatus } = await loadEnv();
    expect(integrationStatus()).toEqual({ email: "configured", tutor: "configured" });
  });

  it("a missing optional key never blocks core configuration", async () => {
    delete process.env.OPENAI_API_KEY;
    const { serverEnv } = await loadEnv();
    expect(() => serverEnv()).not.toThrow();
  });
});

describe("fixture guard", () => {
  it("refuses fixtures in pilot and production", async () => {
    for (const appEnv of ["pilot", "production"]) {
      process.env.APP_ENV = appEnv;
      process.env.PGLEARN_USE_FIXTURES = "1";
      const { assertCoreConfigured } = await loadEnv();
      expect(() => assertCoreConfigured()).toThrow(/PGLEARN_USE_FIXTURES/);
    }
  });

  it("allows them in development and test", async () => {
    for (const appEnv of ["development", "test"]) {
      process.env.APP_ENV = appEnv;
      process.env.PGLEARN_USE_FIXTURES = "1";
      const { assertCoreConfigured } = await loadEnv();
      expect(() => assertCoreConfigured()).not.toThrow();
    }
  });
});
