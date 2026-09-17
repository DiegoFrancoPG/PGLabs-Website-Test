import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-008 — invitation acceptance.
 *
 * "Amber becomes onboarded/active once; retry returns same state; ben gets 404."
 *
 * Run as the real `authenticated` role with a JWT subject, so these exercise
 * the same path a browser session takes.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const AMBER = fixtures.ids.amber;
const BEN = fixtures.ids.ben;
const DANA = fixtures.ids.dana;
const ORG_A = fixtures.ids.org_a;
const ADMIN = fixtures.ids.admin;

const INVITE = "f1000001-0000-4000-8000-000000000000";
const INVITE_PERSONAL = "f1000002-0000-4000-8000-000000000000";

async function asUser(client: import("pg").Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}

/*
 * Dana is the fixture's un-onboarded learner with an `invited` membership, so
 * she is the realistic subject for an acceptance test. Amber is already
 * onboarded, which lets the "already accepted" path be exercised separately.
 */
/*
 * Establishes the state it needs rather than assuming the seeded state. Other
 * suites commit changes to this learner — the invitation journey and the e2e
 * flow both onboard her — so a test that assumed "Dana starts un-onboarded"
 * passed or failed depending on what had run before it. Everything here is
 * inside a transaction that rolls back.
 */
const PENDING_FOR_DANA = `
  DELETE FROM app.invitations WHERE user_id = '${DANA}';
  UPDATE app.profiles SET onboarded_at = NULL WHERE id = '${DANA}';
  UPDATE app.memberships SET status = 'invited'
    WHERE user_id = '${DANA}' AND organization_id = '${ORG_A}';
  INSERT INTO app.invitations(id,user_id,organization_id,role,status,expires_at,created_by)
  VALUES ('${INVITE}','${DANA}','${ORG_A}','learner','pending', now() + interval '24 hours','${ADMIN}');
`;

describe.skipIf(!hasDatabase)("AC-008 invitation acceptance", () => {
  it("lets the invited person read their own invitation", async () => {
    await inRollback(async (client) => {
      await client.query(PENDING_FOR_DANA);
      await asUser(client, DANA);
      const r = await client.query(
        `SELECT public.pglearn_rpc('get_invitation', '{"invitation_id":"${INVITE}"}'::jsonb) AS out`
      );
      const inv = r.rows[0].out;
      expect(Object.keys(inv).sort()).toEqual([
        "delivery_status", "expires_at", "id", "organization_id", "role", "status", "user_id",
      ]);
      expect(inv.status).toBe("pending");
      expect(inv.user_id).toBe(DANA);
    });
  });

  it("onboards the invited person and activates their membership", async () => {
    await inRollback(async (client) => {
      await client.query(PENDING_FOR_DANA);

      await client.query("RESET ROLE");
      const before = await client.query(
        `SELECT p.onboarded_at, m.status FROM app.profiles p
           JOIN app.memberships m ON m.user_id=p.id AND m.organization_id=$2
         WHERE p.id=$1`,
        [DANA, ORG_A]
      );
      expect(before.rows[0].onboarded_at).toBeNull();
      expect(before.rows[0].status).toBe("invited");

      await asUser(client, DANA);
      await client.query(`SELECT public.pglearn_rpc('accept_invitation','{"invitation_id":"${INVITE}"}'::jsonb)`);

      await client.query("RESET ROLE");
      const after = await client.query(
        `SELECT p.onboarded_at, m.status, i.status AS invitation_status, i.accepted_at
           FROM app.profiles p
           JOIN app.memberships m ON m.user_id=p.id AND m.organization_id=$2
           JOIN app.invitations i ON i.id=$3
         WHERE p.id=$1`,
        [DANA, ORG_A, INVITE]
      );
      expect(after.rows[0].onboarded_at).not.toBeNull();
      expect(after.rows[0].status).toBe("active");
      expect(after.rows[0].invitation_status).toBe("accepted");
      expect(after.rows[0].accepted_at).not.toBeNull();
    });
  });

  it("is idempotent: a retry returns the same state and changes nothing", async () => {
    await inRollback(async (client) => {
      await client.query(PENDING_FOR_DANA);
      await asUser(client, DANA);

      const first = await client.query(
        `SELECT public.pglearn_rpc('accept_invitation','{"invitation_id":"${INVITE}"}'::jsonb) AS out`
      );
      await client.query("RESET ROLE");
      const onboardedAt = (
        await client.query("SELECT onboarded_at FROM app.profiles WHERE id=$1", [DANA])
      ).rows[0].onboarded_at;

      await asUser(client, DANA);
      const second = await client.query(
        `SELECT public.pglearn_rpc('accept_invitation','{"invitation_id":"${INVITE}"}'::jsonb) AS out`
      );
      expect(second.rows[0].out).toEqual(first.rows[0].out);

      await client.query("RESET ROLE");
      const again = (
        await client.query("SELECT onboarded_at FROM app.profiles WHERE id=$1", [DANA])
      ).rows[0].onboarded_at;
      // onboarded_at is set once; a retry must not move it.
      expect(again).toEqual(onboardedAt);
    });
  });

  it("gives another signed-in user 404, not a permission error", async () => {
    await inRollback(async (client) => {
      await client.query(PENDING_FOR_DANA);
      await asUser(client, BEN);
      expect(
        await sqlStateOf(client, `SELECT public.pglearn_rpc('get_invitation','{"invitation_id":"${INVITE}"}'::jsonb)`)
      ).toBe("P0002");
      expect(
        await sqlStateOf(client, `SELECT public.pglearn_rpc('accept_invitation','{"invitation_id":"${INVITE}"}'::jsonb)`)
      ).toBe("P0002");
    });
  });

  it("changes nothing when the wrong person tries to accept", async () => {
    await inRollback(async (client) => {
      await client.query(PENDING_FOR_DANA);
      await asUser(client, BEN);
      await sqlStateOf(client, `SELECT public.pglearn_rpc('accept_invitation','{"invitation_id":"${INVITE}"}'::jsonb)`);
      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT i.status, (SELECT onboarded_at FROM app.profiles WHERE id=$2) AS dana_onboarded
         FROM app.invitations i WHERE i.id=$1`,
        [INVITE, DANA]
      );
      expect(r.rows[0].status).toBe("pending");
      expect(r.rows[0].dana_onboarded).toBeNull();
    });
  });

  it("refuses an expired invitation and reports it as expired", async () => {
    await inRollback(async (client) => {
      // created_at must precede expires_at (schema CHECK), so this is an
      // invitation issued two days ago under the 24-hour expiry of spec/03.
      await client.query(`
        DELETE FROM app.invitations WHERE user_id = '${DANA}';
        INSERT INTO app.invitations(id,user_id,organization_id,role,status,expires_at,created_at,created_by)
        VALUES ('${INVITE}','${DANA}','${ORG_A}','learner','pending',
                now() - interval '24 hours', now() - interval '48 hours','${ADMIN}')`);
      await asUser(client, DANA);
      const read = await client.query(
        `SELECT public.pglearn_rpc('get_invitation','{"invitation_id":"${INVITE}"}'::jsonb) AS out`
      );
      // Reported as expired even though the row still says pending.
      expect(read.rows[0].out.status).toBe("expired");
      expect(
        await sqlStateOf(client, `SELECT public.pglearn_rpc('accept_invitation','{"invitation_id":"${INVITE}"}'::jsonb)`)
      ).toBe("23514");
    });
  });

  it("creates no membership for a personal invitation", async () => {
    await inRollback(async (client) => {
      const personal = fixtures.ids.personal;
      await client.query(`
        DELETE FROM app.invitations WHERE user_id = '${personal}';
        UPDATE app.profiles SET onboarded_at = NULL WHERE id = '${personal}';
        INSERT INTO app.invitations(id,user_id,organization_id,role,status,expires_at,created_by)
        VALUES ('${INVITE_PERSONAL}','${personal}',NULL,'learner','pending', now() + interval '24 hours','${ADMIN}')`);
      await asUser(client, personal);
      await client.query(
        `SELECT public.pglearn_rpc('accept_invitation','{"invitation_id":"${INVITE_PERSONAL}"}'::jsonb)`
      );
      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT (SELECT onboarded_at FROM app.profiles WHERE id=$1) AS onboarded,
                (SELECT count(*)::int FROM app.memberships WHERE user_id=$1) AS memberships`,
        [personal]
      );
      expect(r.rows[0].onboarded).not.toBeNull();
      expect(r.rows[0].memberships).toBe(0);
    });
  });

  it("does not let a manager invitation demote or promote an active learner", async () => {
    await inRollback(async (client) => {
      // spec/03: "An active learner membership cannot be promoted by a manager
      // invitation." Amber is already an active learner in org A.
      await client.query(`
        DELETE FROM app.invitations WHERE user_id = '${AMBER}';
        INSERT INTO app.invitations(id,user_id,organization_id,role,status,expires_at,created_by)
        VALUES ('${INVITE}','${AMBER}','${ORG_A}','manager','pending', now() + interval '24 hours','${ADMIN}')`);
      await asUser(client, AMBER);
      await client.query(`SELECT public.pglearn_rpc('accept_invitation','{"invitation_id":"${INVITE}"}'::jsonb)`);
      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT role, status FROM app.memberships WHERE user_id=$1 AND organization_id=$2",
        [AMBER, ORG_A]
      );
      expect(r.rows[0]).toEqual({ role: "learner", status: "active" });
    });
  });

  it("requires an invitation_id", async () => {
    await inRollback(async (client) => {
      await asUser(client, DANA);
      expect(await sqlStateOf(client, `SELECT public.pglearn_rpc('get_invitation','{}'::jsonb)`)).toBe("22023");
      expect(await sqlStateOf(client, `SELECT public.pglearn_rpc('accept_invitation','{}'::jsonb)`)).toBe("22023");
    });
  });
});
