import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page, BrowserContext } from "@playwright/test";

/*
 * One sign-in per learner, reused by every spec that needs one.
 *
 * The suite used to sign in inside each test. That worked until there were
 * enough specs: Supabase Auth throttles sign-ins, and past a certain number
 * per run the form simply stops answering — which surfaced as three unrelated
 * tests timing out on `waitForURL("**\/learn")` while their actual subjects
 * were fine.
 *
 * So a session is established once per email, its cookies are written to
 * tests/.auth/<email>.json, and every later use loads them into a context.
 * Specs whose SUBJECT is authentication — auth.spec.ts, invitations.spec.ts —
 * deliberately do not use this: they must exercise the real form.
 */

const AUTH_DIR = path.join(__dirname, "../.auth");

interface StoredState {
  cookies: Parameters<BrowserContext["addCookies"]>[0];
  savedAt: number;
}

/* A session older than this is re-established rather than trusted. */
const MAX_AGE_MS = 20 * 60 * 1000;

function fileFor(email: string): string {
  return path.join(AUTH_DIR, `${email.replace(/[^a-z0-9]/gi, "_")}.json`);
}

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  const file = path.join(__dirname, "../../.env.local");
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}

/** Signs in through the real form. Used to establish a session, and by the specs that test it. */
export async function signInThroughForm(page: Page, email: string): Promise<void> {
  const password = env().PGLEARN_TEST_PASSWORD;
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/learn", { timeout: 20_000 });
}

/**
 * Puts this page's context into `email`'s session, signing in only if there is
 * no usable cached one. Leaves the page on /learn either way, so callers can
 * navigate from a known place.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  const file = fileFor(email);

  if (existsSync(file)) {
    const stored = JSON.parse(readFileSync(file, "utf8")) as StoredState;
    if (Date.now() - stored.savedAt < MAX_AGE_MS) {
      await page.context().addCookies(stored.cookies);
      await page.goto("/learn");
      // A stale or rejected cookie lands on /login; fall through and sign in.
      if (!page.url().includes("/login")) return;
      await page.context().clearCookies();
    }
  }

  await signInThroughForm(page, email);

  mkdirSync(AUTH_DIR, { recursive: true });
  const cookies = await page.context().cookies();
  writeFileSync(file, JSON.stringify({ cookies, savedAt: Date.now() } satisfies StoredState));
}
