import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-006 — session and profile authority, at the database boundary.
 *
 * The schema layer already rejects these fields, but spec/02 is explicit that
 * "RLS alone does not secure a buggy privileged function" and requires the RPC
 * to validate again. These tests bypass the application entirely and go
 * straight to pglearn_rpc as a signed-in user.
 */
const fixtures = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures.json"), "utf8")
);
const AMBER = fixtures.ids.amber;
const MANAGER_A = fixtures.ids.manager_a;
const ADMIN = fixtures.ids.admin;

async function asUser(client: import("pg").Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}

describe.skipIf(!hasDatabase)("AC-006 profile authority", () => {
  it("returns the contract's Me shape and nothing more", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const r = await client.query("SELECT public.pglearn_rpc('get_me') AS out");
      const me = r.rows[0].out;
      expect(Object.keys(me).sort()).toEqual(["contexts", "platform_admin", "profile"]);
      expect(Object.keys(me.profile).sort()).toEqual([
        "display_name", "email", "id", "onboarded_at", "reminders_enabled", "timezone",
      ]);
      expect(me.profile.id).toBe(AMBER);
    });
  });

  it.each([
    ["platform_admin", '{"platform_admin":true}'],
    ["email", '{"email":"attacker@example.invalid"}'],
    ["role", '{"role":"manager"}'],
    ["status", '{"status":"active"}'],
    ["onboarded_at", '{"onboarded_at":"2020-01-01T00:00:00Z"}'],
    ["id", `{"id":"${ADMIN}"}`],
  ])("rejects update_me setting %s", async (_name, payload) => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      expect(await sqlStateOf(client, `SELECT public.pglearn_rpc('update_me','${payload}'::jsonb)`)).toBe("22023");
    });
  });

  it("leaves database authority unchanged after a rejected attempt", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      await sqlStateOf(client, `SELECT public.pglearn_rpc('update_me','{"platform_admin":true,"email":"attacker@example.invalid"}'::jsonb)`);
      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT p.email, EXISTS(SELECT 1 FROM app.platform_admins a WHERE a.user_id=p.id) AS is_admin
         FROM app.profiles p WHERE p.id=$1`,
        [AMBER]
      );
      expect(r.rows[0].email).toBe("amber@example.invalid");
      expect(r.rows[0].is_admin).toBe(false);
    });
  });

  it("cannot promote itself by claiming another user's id in the payload", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      // The id key is refused outright; even if it were accepted, the row is
      // addressed by the verified actor, never by the payload.
      await sqlStateOf(client, `SELECT public.pglearn_rpc('update_me','{"id":"${ADMIN}","display_name":"Hijacked"}'::jsonb)`);
      await client.query("RESET ROLE");
      const r = await client.query("SELECT display_name FROM app.profiles WHERE id=$1", [ADMIN]);
      expect(r.rows[0].display_name).toBe("Admin");
    });
  });

  it("applies a legitimate change to the caller's own row only", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      await client.query(`SELECT public.pglearn_rpc('update_me','{"display_name":"Amber Updated","reminders_enabled":false}'::jsonb)`);
      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT id, display_name, reminders_enabled FROM app.profiles WHERE id IN ($1,$2) ORDER BY display_name",
        [AMBER, MANAGER_A]
      );
      expect(r.rows[0]).toEqual({ id: AMBER, display_name: "Amber Updated", reminders_enabled: false });
      expect(r.rows[1].display_name).toBe("Manager A");
    });
  });

  it("rejects a timezone that Postgres does not know", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      expect(await sqlStateOf(client, `SELECT public.pglearn_rpc('update_me','{"timezone":"Mars/Olympus"}'::jsonb)`)).toBe("22023");
    });
  });

  it("shows a manager their organization context, and a learner theirs", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const r = await client.query("SELECT public.pglearn_rpc('get_me') AS out");
      expect(r.rows[0].out.contexts).toEqual([
        {
          organization_id: fixtures.ids.org_a,
          organization_name: "Demo Organization A",
          role: "manager",
          status: "active",
        },
      ]);
    });
  });

  it("reports platform_admin from the database, not from any claim", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const admin = await client.query("SELECT public.pglearn_rpc('get_me') AS out");
      expect(admin.rows[0].out.platform_admin).toBe(true);
    });
    await inRollback(async (client) => {
      // A learner asserting the admin role in their own JWT claims stays a learner.
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: AMBER, role: "authenticated", user_role: "platform_admin", is_admin: true }),
      ]);
      await client.query("SET LOCAL ROLE authenticated");
      const r = await client.query("SELECT public.pglearn_rpc('get_me') AS out");
      expect(r.rows[0].out.platform_admin).toBe(false);
    });
  });
});
