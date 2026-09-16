import { test, expect } from "@playwright/test";
import { signIn } from "./session";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * AC-051 — the operations screen, with the secret actually present.
 *
 * "Failed invitation with action link in private outbox payload. Admin opens
 * operations, inspect logs/browser bundle. Status available; signed
 * link/cookie/key/prompt/response body absent."
 *
 * The rendered page and the JavaScript the browser downloads are both searched
 * for the token, because "absent from the API" and "absent from the bundle"
 * are different claims and only the second one is about this screen.
 */

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}
const config = env();
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const AMBER = fixtures.ids.amber;

const TOKEN = "pkce_e2eSECRETTOKENvalue";
const ACTION_LINK = `https://example.supabase.co/auth/v1/verify?token=${TOKEN}&type=invite`;
const EVENT_KEY = "invitation:e2e-operations-test";
const ORIGIN = "http://127.0.0.1:3001";

async function db<T>(fn: (client: import("pg").Client) => Promise<T>): Promise<T> {
  const { Client } = await import("pg");
  const ref = new URL(config.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const client = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(config.SUPABASE_DB_PASSWORD)}@db.${ref}.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function plantFailedInvitation() {
  await db(async (client) => {
    await client.query("DELETE FROM app.notification_outbox WHERE event_key=$1", [EVENT_KEY]);
    await client.query(
      `INSERT INTO app.notification_outbox(user_id, kind, event_key, recipient_email, payload,
                                           status, scheduled_at, first_attempt_at, attempts, last_error)
       VALUES ($1, 'invitation', $2, 'amber@example.invalid',
               jsonb_build_object('action_url', $3::text),
               'failed', now(), now(), 3, 'the provider rejected the message (422)')`,
      [AMBER, EVENT_KEY, ACTION_LINK]
    );
  });
}

async function removeFailedInvitation() {
  await db(async (client) => {
    await client.query("DELETE FROM app.notification_outbox WHERE event_key=$1", [EVENT_KEY]);
  });
}


test.describe("AC-051 redacted operations", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "shared database state; desktop only");

  test.beforeAll(async ({}, info) => {
    if (info.project.name === "desktop-1440") await plantFailedInvitation();
  });
  test.afterAll(async ({}, info) => {
    if (info.project.name === "desktop-1440") await removeFailedInvitation();
  });

  test("shows the failure's status without any of its contents", async ({ page }) => {
    // Every script the page downloads, collected as it loads.
    const scripts: string[] = [];
    page.on("response", async (response) => {
      if (response.url().includes("/_next/static/") && response.url().endsWith(".js")) {
        scripts.push(await response.text().catch(() => ""));
      }
    });

    await signIn(page, "admin@example.invalid");
    await page.goto("/admin/operations");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Operations");

    // The status is there, and useful.
    const table = page.getByRole("table").first();
    await expect(table).toContainText("invitation");
    await expect(table).toContainText("failed");
    await expect(table).toContainText("amber@example.invalid");
    await expect(table).toContainText("rejected");

    // The token is not — not in the HTML…
    const html = await page.content();
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("pkce_");
    expect(html).not.toContain("action_url");
    expect(html).not.toContain("supabase.co/auth/v1/verify");

    // …and not in any script the browser was given.
    for (const script of scripts) {
      expect(script).not.toContain(TOKEN);
      expect(script).not.toContain(config.SUPABASE_SERVICE_ROLE_KEY ?? "service-role-unset");
    }
  });

  test("never sends the payload over the API, whatever the page asks for", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    const response = await page.request.get("/api/v1/operations/notifications?limit=100", {
      headers: { Origin: ORIGIN },
    });
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("invitation");
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain("payload");
  });

  test("offers Send again for a failure and refuses it for an uncertain send", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto("/admin/operations");

    const row = page.getByRole("row").filter({ hasText: "invitation" }).first();
    await expect(row.getByRole("button", { name: "Send again" })).toBeVisible();

    // The same message, with no confirmed outcome.
    await db(async (client) =>
      client.query("UPDATE app.notification_outbox SET status='uncertain' WHERE event_key=$1", [
        EVENT_KEY,
      ])
    );
    await page.reload();

    const uncertainRow = page.getByRole("row").filter({ hasText: "invitation" }).first();
    // spec/03: no blind resend. The button is not offered at all.
    await expect(uncertainRow.getByRole("button", { name: "Send again" })).toBeHidden();
    await expect(uncertainRow).toContainText("Reconcile first");
    await expect(page.getByText(/no confirmed outcome/)).toBeVisible();

    await db(async (client) =>
      client.query("UPDATE app.notification_outbox SET status='failed' WHERE event_key=$1", [
        EVENT_KEY,
      ])
    );
  });

  test("shows which integrations are configured, and never their keys", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto("/admin/operations");

    await expect(page.getByText("Email", { exact: true })).toBeVisible();
    await expect(page.getByText("Tutor model")).toBeVisible();
    await expect(page.getByText("Scheduler", { exact: true })).toBeVisible();
    // With no key set in this environment, it says so plainly.
    await expect(page.getByText("Not configured").first()).toBeVisible();

    const html = await page.content();
    for (const secret of ["sk-", "re_", "whsec_", "eyJ"]) {
      expect(html).not.toContain(secret);
    }
  });

  test("is refused to a manager and to a learner", async ({ browser }) => {
    // A context each: signing in again on a page that already has a session
    // lands on /learn, and the login form is never there to fill in.
    for (const email of ["manager_a@example.invalid", "amber@example.invalid"]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
      await signIn(page, email);
      await page.goto("/admin/operations");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("not available");

      const api = await page.request.get("/api/v1/operations/notifications", {
        headers: { Origin: ORIGIN },
      });
      expect(api.status()).toBe(403);
      expect(await api.text()).not.toContain(TOKEN);
      } finally {
        await context.close();
      }
    }
  });
});
