import { test, expect } from "@playwright/test";
import { signIn } from "./session";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/*
 * The invitation API, exercised with a real session against real Auth.
 *
 * This is the path spec/03 warns about: "Auth and Postgres cannot be one
 * distributed transaction." Everything below goes through HTTP, so the Origin
 * rule, the Idempotency-Key requirement, the service layer and both systems
 * are all in play.
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

/*
 * page.request does NOT send an Origin header, and proxy.ts rejects a
 * cookie-authenticated mutation without one. Sending it explicitly is what
 * makes these tests exercise authorization rather than the Origin rule —
 * without it every POST returns 403 and the tests that expect 403 pass for
 * entirely the wrong reason.
 */
const ORIGIN = "http://127.0.0.1:3001";
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const ORG_A = fixtures.ids.org_a;
const ORG_B = fixtures.ids.org_b;


async function removeInvitee(email: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const service = createClient(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { Client } = await import("pg");
  const ref = new URL(config.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const db = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(config.SUPABASE_DB_PASSWORD)}@db.${ref}.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    for (let page = 1; page <= 10; page += 1) {
      const { data } = await service.auth.admin.listUsers({ page, perPage: 200 });
      if (!data || data.users.length === 0) break;
      const found = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (!found) continue;
      await db.query("DELETE FROM app.idempotency_records WHERE actor_id IS NOT NULL AND action LIKE '%invitation%'");
      await db.query("DELETE FROM app.invitations WHERE user_id=$1", [found.id]);
      await db.query("DELETE FROM app.memberships WHERE user_id=$1", [found.id]);
      await db.query("DELETE FROM app.profiles WHERE id=$1", [found.id]);
      await service.auth.admin.deleteUser(found.id);
      break;
    }
  } finally {
    await db.end();
  }
}

test.describe("AC-010 invitation creation over HTTP", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "shared database state; desktop only");

  const INVITEE = "http-invitee@example.invalid";

  test.afterAll(async () => {
    await removeInvitee(INVITEE);
  });

  test("a manager invites a learner, and a retry creates nothing more", async ({ page }) => {
    await removeInvitee(INVITEE);
    await signIn(page, "manager_a@example.invalid");

    const key = randomUUID();
    const body = {
      email: INVITEE,
      display_name: "HTTP Invitee",
      organization_id: ORG_A,
      role: "learner",
    };

    const first = await page.request.post("/api/v1/invitations", {
      headers: { Origin: ORIGIN, "Idempotency-Key": key, "Content-Type": "application/json" },
      data: body,
    });
    expect(first.status()).toBe(200);
    const created = (await first.json()).data;
    expect(created.status).toBe("pending");
    expect(created.organization_id).toBe(ORG_A);

    // The same key and body again returns the identical invitation.
    const retry = await page.request.post("/api/v1/invitations", {
      headers: { Origin: ORIGIN, "Idempotency-Key": key, "Content-Type": "application/json" },
      data: body,
    });
    expect(retry.status()).toBe(200);
    expect((await retry.json()).data).toEqual(created);
  });

  test("never returns the Auth link to the manager", async ({ page }) => {
    await removeInvitee(INVITEE);
    await signIn(page, "manager_a@example.invalid");

    const res = await page.request.post("/api/v1/invitations", {
      headers: { Origin: ORIGIN, "Idempotency-Key": randomUUID(), "Content-Type": "application/json" },
      data: { email: INVITEE, display_name: "HTTP Invitee", organization_id: ORG_A, role: "learner" },
    });
    const text = await res.text();
    // spec/03: the private Auth link must never reach the manager.
    expect(text).not.toMatch(/action_link|hashed_token|email_otp|\/auth\/v1\/verify/i);
  });

  test("refuses a manager inviting into an organization they do not manage", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    const res = await page.request.post("/api/v1/invitations", {
      headers: { Origin: ORIGIN, "Idempotency-Key": randomUUID(), "Content-Type": "application/json" },
      data: { email: INVITEE, display_name: "X", organization_id: ORG_B, role: "learner" },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  test("refuses a manager inviting another manager", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    const res = await page.request.post("/api/v1/invitations", {
      headers: { Origin: ORIGIN, "Idempotency-Key": randomUUID(), "Content-Type": "application/json" },
      data: { email: INVITEE, display_name: "X", organization_id: ORG_A, role: "manager" },
    });
    expect(res.status()).toBe(403);
  });

  test("rejects an unknown field rather than ignoring it", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    const res = await page.request.post("/api/v1/invitations", {
      headers: { Origin: ORIGIN, "Idempotency-Key": randomUUID(), "Content-Type": "application/json" },
      data: {
        email: INVITEE,
        display_name: "X",
        organization_id: ORG_A,
        role: "learner",
        platform_admin: true,
      },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  test("requires an Idempotency-Key", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    const res = await page.request.post("/api/v1/invitations", {
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      data: { email: INVITEE, display_name: "X", organization_id: ORG_A, role: "learner" },
    });
    expect(res.status()).toBe(422);
  });
});

test.describe("organization scope over HTTP", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "desktop only");

  test("a manager sees only their own organization", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    const res = await page.request.get("/api/v1/organizations");
    expect(res.status()).toBe(200);
    const items = (await res.json()).data.items;
    expect(items.map((o: { id: string }) => o.id)).toEqual([ORG_A]);
  });

  test("a platform admin sees every organization", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    const res = await page.request.get("/api/v1/organizations");
    const items = (await res.json()).data.items;
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  test("a manager cannot create an organization", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    const res = await page.request.post("/api/v1/organizations", {
      headers: { Origin: ORIGIN, "Idempotency-Key": randomUUID(), "Content-Type": "application/json" },
      data: { name: "Sneaky", timezone: "UTC", manager_email: "x@example.invalid", manager_name: "X" },
    });
    expect(res.status()).toBe(403);
  });
});
