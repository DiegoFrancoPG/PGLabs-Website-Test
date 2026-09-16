import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-010 — invitation retry and expiry.
 * AC-011 — last manager and scope.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const ADMIN = fixtures.ids.admin;
const MANAGER_A = fixtures.ids.manager_a;
const MANAGER_B = fixtures.ids.manager_b;
const AMBER = fixtures.ids.amber;
const BEN = fixtures.ids.ben;
const DANA = fixtures.ids.dana;
const PERSONAL = fixtures.ids.personal;
const ORG_A = fixtures.ids.org_a;
const ORG_B = fixtures.ids.org_b;

const KEY = "f4000001-0000-4000-8000-000000000000";
const KEY2 = "f4000002-0000-4000-8000-000000000000";

async function asUser(client: import("pg").Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}

const rpc = (action: string, payload: object) =>
  `SELECT public.pglearn_rpc('${action}', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) AS out`;

describe.skipIf(!hasDatabase)("AC-010 invitation retry and expiry", () => {
  it("creates one invitation and one membership, however many times it is retried", async () => {
    await inRollback(async (client) => {
      await client.query("DELETE FROM app.invitations WHERE user_id=$1", [PERSONAL]);
      await asUser(client, MANAGER_A);

      const payload = { request_id: KEY, user_id: PERSONAL, organization_id: ORG_A, role: "learner" };
      const first = await client.query(rpc("create_invitation", payload));
      const second = await client.query(rpc("create_invitation", payload));
      const third = await client.query(rpc("create_invitation", payload));

      // Identical response every time, from the stored idempotency record.
      expect(second.rows[0].out).toEqual(first.rows[0].out);
      expect(third.rows[0].out).toEqual(first.rows[0].out);

      await client.query("RESET ROLE");
      const counts = await client.query(
        `SELECT (SELECT count(*)::int FROM app.invitations WHERE user_id=$1 AND organization_id=$2) AS invitations,
                (SELECT count(*)::int FROM app.memberships WHERE user_id=$1 AND organization_id=$2) AS memberships`,
        [PERSONAL, ORG_A]
      );
      expect(counts.rows[0]).toEqual({ invitations: 1, memberships: 1 });
    });
  });

  it("refuses the same idempotency key with a different request", async () => {
    await inRollback(async (client) => {
      await client.query("DELETE FROM app.invitations WHERE user_id=$1", [PERSONAL]);
      await asUser(client, MANAGER_A);
      await client.query(rpc("create_invitation", { request_id: KEY, user_id: PERSONAL, organization_id: ORG_A, role: "learner" }));
      // spec/05: same key, different body is a conflict, never a silent replay.
      expect(
        await sqlStateOf(client, rpc("create_invitation", { request_id: KEY, user_id: DANA, organization_id: ORG_A, role: "learner" }))
      ).toBe("23505");
    });
  });

  it("replaces an expired invitation with a fresh 24-hour one", async () => {
    await inRollback(async (client) => {
      await client.query("DELETE FROM app.invitations WHERE user_id=$1", [DANA]);
      const old = await client.query(
        `INSERT INTO app.invitations(user_id,organization_id,role,status,expires_at,created_at,created_by)
         VALUES ($1,$2,'learner','pending', now() - interval '1 hour', now() - interval '25 hours', $3)
         RETURNING id`,
        [DANA, ORG_A, ADMIN]
      );
      const oldId = old.rows[0].id;

      await asUser(client, MANAGER_A);
      const resent = await client.query(rpc("resend_invitation", { request_id: KEY, invitation_id: oldId }));
      const fresh = resent.rows[0].out;

      expect(fresh.id).not.toBe(oldId);
      expect(fresh.status).toBe("pending");
      const hours = (new Date(fresh.expires_at).getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23);
      expect(hours).toBeLessThanOrEqual(24);

      await client.query("RESET ROLE");
      // The old row is expired rather than deleted, so the trail survives.
      const before = await client.query("SELECT status FROM app.invitations WHERE id=$1", [oldId]);
      expect(before.rows[0].status).toBe("expired");
    });
  });

  it("reuses the result when a resend is retried with the same request id", async () => {
    await inRollback(async (client) => {
      await client.query("DELETE FROM app.invitations WHERE user_id=$1", [DANA]);
      const old = await client.query(
        `INSERT INTO app.invitations(user_id,organization_id,role,status,expires_at,created_by)
         VALUES ($1,$2,'learner','pending', now() + interval '2 hours', $3) RETURNING id`,
        [DANA, ORG_A, ADMIN]
      );
      await asUser(client, MANAGER_A);
      const payload = { request_id: KEY, invitation_id: old.rows[0].id };
      const first = await client.query(rpc("resend_invitation", payload));
      const second = await client.query(rpc("resend_invitation", payload));
      expect(second.rows[0].out).toEqual(first.rows[0].out);

      await client.query("RESET ROLE");
      const n = await client.query(
        "SELECT count(*)::int AS n FROM app.invitations WHERE user_id=$1 AND status='pending'",
        [DANA]
      );
      // One retry must not leave two live invitations behind.
      expect(n.rows[0].n).toBe(1);
    });
  });

  it("never returns an Auth link or token to the caller", async () => {
    await inRollback(async (client) => {
      await client.query("DELETE FROM app.invitations WHERE user_id=$1", [PERSONAL]);
      await asUser(client, MANAGER_A);
      const r = await client.query(
        rpc("create_invitation", { request_id: KEY2, user_id: PERSONAL, organization_id: ORG_A, role: "learner" })
      );
      const body = JSON.stringify(r.rows[0].out);
      // spec/03: "never ... expose the Auth link to the manager."
      expect(Object.keys(r.rows[0].out).sort()).toEqual([
        "delivery_status", "expires_at", "id", "organization_id", "role", "status", "user_id",
      ]);
      expect(body).not.toMatch(/token|action_link|otp|verify|http/i);
    });
  });

  it("returns the existing state instead of re-inviting an active member", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      // Amber is already an active learner in organization A.
      const r = await client.query(
        rpc("create_invitation", { request_id: KEY, user_id: AMBER, organization_id: ORG_A, role: "learner" })
      );
      expect(r.rows[0].out.status).toBe("accepted");

      await client.query("RESET ROLE");
      const n = await client.query(
        "SELECT count(*)::int AS n FROM app.invitations WHERE user_id=$1 AND organization_id=$2",
        [AMBER, ORG_A]
      );
      expect(n.rows[0].n).toBe(0);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-011 last manager and scope", () => {
  it("refuses to remove the only active manager", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      expect(
        await sqlStateOf(client, rpc("update_membership", { organization_id: ORG_A, user_id: MANAGER_A, status: "removed" }))
      ).toBe("23514");

      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT status FROM app.memberships WHERE organization_id=$1 AND user_id=$2",
        [ORG_A, MANAGER_A]
      );
      expect(r.rows[0].status).toBe("active");
    });
  });

  it("refuses to demote the only active manager", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      expect(
        await sqlStateOf(client, rpc("update_membership", { organization_id: ORG_A, user_id: MANAGER_A, role: "learner" }))
      ).toBe("23514");
    });
  });

  it("allows the swap once a second manager is active", async () => {
    await inRollback(async (client) => {
      /*
       * An upsert, not insert-then-catch: in Postgres a failed statement
       * aborts the whole transaction, so a JavaScript catch cannot recover it.
       * Ben already has a learner membership here.
       */
      await client.query(
        `INSERT INTO app.memberships(organization_id,user_id,role,status) VALUES ($1,$2,'manager','active')
         ON CONFLICT (organization_id,user_id) DO UPDATE SET role='manager', status='active'`,
        [ORG_A, BEN]
      );
      await asUser(client, ADMIN);
      await client.query(rpc("update_membership", { organization_id: ORG_A, user_id: MANAGER_A, status: "removed" }));
      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT count(*)::int AS n FROM app.memberships WHERE organization_id=$1 AND role='manager' AND status='active'",
        [ORG_A]
      );
      expect(r.rows[0].n).toBe(1);
    });
  });

  it("does not let a manager invite another manager", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      expect(
        await sqlStateOf(client, rpc("create_invitation", { request_id: KEY, user_id: PERSONAL, organization_id: ORG_A, role: "manager" }))
      ).toBe("42501");
    });
  });

  it("does not let a manager change any membership, including their own", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      for (const payload of [
        { organization_id: ORG_A, user_id: AMBER, role: "manager" },
        { organization_id: ORG_A, user_id: MANAGER_A, role: "manager" },
        { organization_id: ORG_A, user_id: BEN, status: "removed" },
      ]) {
        expect(await sqlStateOf(client, rpc("update_membership", payload))).toBe("42501");
      }
    });
  });

  it("does not let a manager act on an organization they do not manage", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      // Manager A has no standing in organization B.
      expect(
        await sqlStateOf(client, rpc("create_invitation", { request_id: KEY, user_id: PERSONAL, organization_id: ORG_B, role: "learner" }))
      ).toBe("42501");

      const list = await client.query(rpc("list_organizations", {}));
      expect(list.rows[0].out.items.map((o: { id: string }) => o.id)).toEqual([ORG_A]);
    });
  });

  it("does not let a manager issue a personal invitation", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      expect(
        await sqlStateOf(client, rpc("create_invitation", { request_id: KEY, user_id: PERSONAL, organization_id: null, role: "learner" }))
      ).toBe("42501");
    });
  });

  it("does not let a manager create or edit an organization", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      expect(
        await sqlStateOf(client, rpc("create_organization", { request_id: KEY, name: "Sneaky", timezone: "UTC", manager_user_id: MANAGER_A }))
      ).toBe("42501");
      expect(
        await sqlStateOf(client, rpc("update_organization", { organization_id: ORG_A, name: "Renamed" }))
      ).toBe("42501");
    });
  });

  it("shows a platform admin every organization", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const list = await client.query(rpc("list_organizations", {}));
      const ids = list.rows[0].out.items.map((o: { id: string }) => o.id).sort();
      expect(ids).toEqual([ORG_A, ORG_B].sort());
    });
  });

  it("shows manager B only their own organization", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_B);
      const list = await client.query(rpc("list_organizations", {}));
      expect(list.rows[0].out.items.map((o: { id: string }) => o.id)).toEqual([ORG_B]);
    });
  });
});
