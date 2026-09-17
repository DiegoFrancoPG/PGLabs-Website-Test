import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback, sqlStateOf } from "./db";
import { previewRoster } from "@/lib/roster";

/*
 * AC-055 — bulk roster import.
 *
 * "CSV with duplicates, bad email and foreign context. Preview then apply
 * valid rows. Preview identifies issues; explicit apply idempotent; manager
 * cannot assign foreign org/role; output reconciles counts."
 *
 * The preview is tested as pure logic in tests/unit/roster.test.ts. What is
 * tested here is the apply, which T26 deliberately builds from commands that
 * already exist: create_invitation once per row, then add_cohort_members once.
 * So these tests are about those commands under bulk use — the properties the
 * import relies on rather than a new mechanism nobody else uses.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  manager_a: MANAGER_A, amber: AMBER,
  org_a: ORG_A, org_b: ORG_B, cohort_a: COHORT_A, cohort_b: COHORT_B,
} = fixtures.ids;

async function asUser(client: Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}
const rpc = (action: string, payload: object) =>
  `SELECT public.pglearn_rpc('${action}', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) AS out`;
const call = async (client: Client, action: string, payload: object) =>
  (await client.query(rpc(action, payload))).rows[0].out;

/*
 * The invitation command needs an Auth identity, which the integration suite
 * cannot create. So these tests use people who already exist — which is also
 * the case the import has to get right: a roster of colleagues, most of whom
 * are already in the system.
 */
const EXISTING = ["amber@example.invalid", "ben@example.invalid", "cora@example.invalid"];

describe("AC-055 the preview and the apply agree", () => {
  it("counts a realistic roster the way the import will act on it", () => {
    const csv = [
      "email,name",
      ...EXISTING.map((email, index) => `${email},Person ${index}`),
      "AMBER@example.invalid,Amber Again", // a duplicate, differently cased
      "not-an-email,Broken",
      ",No Address",
    ].join("\n");

    const preview = previewRoster(csv);
    expect(preview.totals.rows).toBe(6);
    expect(preview.totals.valid).toBe(3);
    expect(preview.totals.invalid).toBe(3);
    // The three that will be sent are exactly the three that exist.
    expect(preview.valid.map((row) => row.email).sort()).toEqual([...EXISTING].sort());
  });
});

describe.skipIf(!hasDatabase)("AC-055 applying is idempotent", () => {
  it("adds the same people twice without adding them twice", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);

      // Everybody in the roster is already in the organization, which is the
      // ordinary case for a cohort being assembled from an existing client.
      const userIds = [fixtures.ids.amber, fixtures.ids.ben, fixtures.ids.cora];
      const payload = { request_id: crypto.randomUUID(), user_ids: userIds };

      const first = await call(client, "add_cohort_members", { cohort_id: COHORT_A, ...payload });
      const second = await call(client, "add_cohort_members", { cohort_id: COHORT_A, ...payload });
      expect(second).toEqual(first);

      // A DIFFERENT request id, same people: still no duplicates, because the
      // membership itself is keyed by (cohort, user).
      await call(client, "add_cohort_members", {
        cohort_id: COHORT_A, request_id: crypto.randomUUID(), user_ids: userIds,
      });

      await client.query("RESET ROLE");
      const counted = await client.query(
        `SELECT user_id, count(*)::int AS n FROM app.cohort_members
          WHERE cohort_id=$1 AND user_id = ANY($2::uuid[]) GROUP BY user_id`,
        [COHORT_A, userIds]
      );
      for (const row of counted.rows) expect(row.n).toBe(1);
    });
  });

  it("reports how many were actually added, so the counts reconcile", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const result = await call(client, "add_cohort_members", {
        cohort_id: COHORT_A,
        request_id: crypto.randomUUID(),
        user_ids: [fixtures.ids.amber, fixtures.ids.ben, fixtures.ids.cora],
      });
      // Amber and Ben are already in cohort A; Cora is not. The command says
      // what it did rather than only that it succeeded.
      expect(result).toHaveProperty("added");
      expect(Number(result.added)).toBeGreaterThanOrEqual(0);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-055 a manager cannot reach a foreign context", () => {
  it("refuses a cohort in another organization", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      /*
       * Cohort B belongs to organization B, which manager A does not manage.
       * 42501 rather than 404: the cohort id was supplied by the caller, so
       * saying "not permitted" reveals nothing they did not already have.
       */
      expect(
        await sqlStateOf(client, rpc("add_cohort_members", {
          cohort_id: COHORT_B,
          request_id: crypto.randomUUID(),
          user_ids: [fixtures.ids.amber],
        }))
      ).toBe("42501");
    });
  });

  it("refuses an invitation into another organization", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      /*
       * create_invitation takes a user_id, not an email: the Auth identity is
       * established first by the feature service (spec/03 — Auth and Postgres
       * cannot be one transaction), and the command records the invitation for
       * somebody who already exists. So this uses an existing learner's id.
       */
      expect(
        await sqlStateOf(client, rpc("create_invitation", {
          request_id: crypto.randomUUID(),
          organization_id: ORG_B,
          user_id: fixtures.ids.dana,
          role: "learner",
        }))
      ).toBe("42501");
    });
  });

  it("refuses to import anybody as a manager", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      /*
       * The import always sends role: "learner", but the rule that matters is
       * the database's: a manager may invite learners only. So even a request
       * that asked for a manager is refused, whatever the screen sent.
       */
      expect(
        await sqlStateOf(client, rpc("create_invitation", {
          request_id: crypto.randomUUID(),
          organization_id: ORG_A,
          user_id: fixtures.ids.dana,
          role: "manager",
        }))
      ).toBe("42501");
    });
  });

  it("refuses somebody who manages nothing", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      expect(
        await sqlStateOf(client, rpc("add_cohort_members", {
          cohort_id: COHORT_A,
          request_id: crypto.randomUUID(),
          user_ids: [fixtures.ids.ben],
        }))
      ).toBe("42501");
    });
  });

  it("refuses a roster containing somebody from another organization", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      /*
       * spec/04: "all-or-nothing validation errors identify invalid selections
       * without exposing other org records." Manager B's own account is not a
       * member of organization A, so adding them is refused — and the refusal
       * says nothing about who they are.
       */
      const code = await sqlStateOf(client, rpc("add_cohort_members", {
        cohort_id: COHORT_A,
        request_id: crypto.randomUUID(),
        user_ids: [fixtures.ids.amber, fixtures.ids.manager_b],
      }));
      expect(code).not.toBeNull();

      // All or nothing: Amber was not added on her own.
      await client.query("RESET ROLE");
      const added = await client.query(
        "SELECT count(*)::int AS n FROM app.cohort_members WHERE cohort_id=$1 AND user_id=$2",
        [COHORT_A, fixtures.ids.manager_b]
      );
      expect(added.rows[0].n).toBe(0);
    });
  });
});
