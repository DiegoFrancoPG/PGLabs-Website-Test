import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-012 — cohort membership removal.
 * AC-013 — catalog subject and expiry.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  admin: ADMIN, manager_a: MANAGER_A, manager_b: MANAGER_B,
  amber: AMBER, ben: BEN, personal: PERSONAL, multi: MULTI,
  org_a: ORG_A, org_b: ORG_B, cohort_a: COHORT_A, cohort_b: COHORT_B,
  program_shared: PROGRAM_SHARED, program_b_only: PROGRAM_B,
  grant_a: GRANT_A, grant_b: GRANT_B, grant_personal: GRANT_PERSONAL,
  enroll_ben: ENROLL_BEN,
} = fixtures.ids;

const KEY = "f5000001-0000-4000-8000-000000000000";

async function asUser(client: import("pg").Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}
const rpc = (action: string, payload: object) =>
  `SELECT public.pglearn_rpc('${action}', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) AS out`;

describe.skipIf(!hasDatabase)("AC-012 cohort membership removal", () => {
  it("cancels the enrollment but keeps every scrap of progress", async () => {
    await inRollback(async (client) => {
      // Ben is enrolled through cohort A's offering and has completed classes.
      const before = await client.query(
        `SELECT (SELECT count(*)::int FROM app.class_progress WHERE enrollment_id=$1) AS progress,
                (SELECT status FROM app.enrollments WHERE id=$1) AS status`,
        [ENROLL_BEN]
      );
      expect(before.rows[0].progress).toBeGreaterThan(0);
      expect(before.rows[0].status).toBe("active");

      await asUser(client, MANAGER_A);
      const r = await client.query(rpc("remove_cohort_member", { cohort_id: COHORT_A, user_id: BEN }));
      expect(r.rows[0].out.status).toBe("removed");
      expect(r.rows[0].out.cancelled_enrollments).toBe(1);

      await client.query("RESET ROLE");
      const after = await client.query(
        `SELECT (SELECT count(*)::int FROM app.class_progress WHERE enrollment_id=$1) AS progress,
                (SELECT status FROM app.enrollments WHERE id=$1) AS enrollment,
                (SELECT status FROM app.cohort_members WHERE cohort_id=$2 AND user_id=$3) AS member`,
        [ENROLL_BEN, COHORT_A, BEN]
      );
      // spec/02: "Cancellation never deletes progress."
      expect(after.rows[0].progress).toBe(before.rows[0].progress);
      expect(after.rows[0].enrollment).toBe("cancelled");
      expect(after.rows[0].member).toBe("removed");
    });
  });

  it("re-adding does not silently restore the cancelled enrollment", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      await client.query(rpc("remove_cohort_member", { cohort_id: COHORT_A, user_id: BEN }));
      await client.query(rpc("add_cohort_members", { request_id: KEY, cohort_id: COHORT_A, user_ids: [BEN] }));

      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT (SELECT status FROM app.cohort_members WHERE cohort_id=$1 AND user_id=$2) AS member,
                (SELECT status FROM app.enrollments WHERE id=$3) AS enrollment`,
        [COHORT_A, BEN, ENROLL_BEN]
      );
      // spec/03: re-adding restores membership, never the enrollment.
      expect(r.rows[0].member).toBe("active");
      expect(r.rows[0].enrollment).toBe("cancelled");
    });
  });

  it("leaves a cancelled learner with no access, so reactivation is a real decision", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      await client.query(rpc("remove_cohort_member", { cohort_id: COHORT_A, user_id: BEN }));
      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT app.enrollment_availability($1,$2,now()) AS availability",
        [BEN, ENROLL_BEN]
      );
      expect(r.rows[0].availability).toBe("cancelled");
    });
  });

  it("cancels only the enrollments reached through that cohort", async () => {
    await inRollback(async (client) => {
      // The personal enrollment belongs to nobody's cohort.
      await asUser(client, MANAGER_A);
      await client.query(rpc("remove_cohort_member", { cohort_id: COHORT_A, user_id: BEN }));
      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT status FROM app.enrollments WHERE id=$1",
        [fixtures.ids.enroll_personal]
      );
      expect(r.rows[0].status).toBe("active");
    });
  });

  it("adds nothing at all when any one of the listed people is invalid", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      // multi belongs to both organizations; personal belongs to neither.
      expect(
        await sqlStateOf(client, rpc("add_cohort_members", { request_id: KEY, cohort_id: COHORT_A, user_ids: [MULTI, PERSONAL] }))
      ).toBe("23514");

      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT count(*)::int AS n FROM app.cohort_members WHERE cohort_id=$1 AND user_id = ANY($2)",
        [COHORT_A, [MULTI, PERSONAL]]
      );
      expect(r.rows[0].n).toBe(0);
    });
  });

  it("does not auto-enrol someone added to a cohort", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      await client.query(rpc("add_cohort_members", { request_id: KEY, cohort_id: COHORT_A, user_ids: [MULTI] }));
      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT count(*)::int AS n FROM app.enrollments e
         JOIN app.cohort_offerings o ON o.id = e.offering_id
         WHERE e.user_id=$1 AND o.cohort_id=$2`,
        [MULTI, COHORT_A]
      );
      // spec/03: "Adding a new cohort member does not auto-enroll them."
      expect(r.rows[0].n).toBe(0);
    });
  });

  it("refuses a manager acting on another organization's cohort", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      for (const call of [
        rpc("remove_cohort_member", { cohort_id: COHORT_B, user_id: MULTI }),
        rpc("add_cohort_members", { request_id: KEY, cohort_id: COHORT_B, user_ids: [MULTI] }),
        rpc("list_cohort_members", { cohort_id: COHORT_B }),
      ]) {
        expect(await sqlStateOf(client, call)).toBe("42501");
      }
    });
  });
});

describe.skipIf(!hasDatabase)("AC-013 catalog subject and expiry", () => {
  it("shows manager A only their own organization's grants", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const r = await client.query(rpc("list_grants", {}));
      const ids = r.rows[0].out.items.map((g: { id: string }) => g.id);
      expect(ids).toEqual([GRANT_A]);
    });
  });

  it("never shows a personal grant to an organization manager", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const r = await client.query(rpc("list_grants", {}));
      const items = r.rows[0].out.items;
      // A personal grant's subject is a user, so it can never belong to an org.
      expect(items.every((g: { user_id: string | null }) => g.user_id === null)).toBe(true);
      expect(items.map((g: { id: string }) => g.id)).not.toContain(GRANT_PERSONAL);
    });
  });

  it("does not show manager A organization B's catalog", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const r = await client.query(rpc("list_grants", {}));
      const programs = r.rows[0].out.items.map((g: { program_id: string }) => g.program_id);
      expect(programs).not.toContain(PROGRAM_B);
      // And asking for B explicitly is refused rather than quietly empty.
      expect(await sqlStateOf(client, rpc("list_grants", { organization_id: ORG_B }))).toBe("42501");
    });
  });

  it("shows manager B their own catalog and nothing of A's", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_B);
      const r = await client.query(rpc("list_grants", {}));
      expect(r.rows[0].out.items.map((g: { id: string }) => g.id)).toEqual([GRANT_B]);
    });
  });

  it("shows a platform admin every grant, including personal ones", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const ids = (await client.query(rpc("list_grants", {}))).rows[0].out.items.map(
        (g: { id: string }) => g.id
      );
      expect(ids.sort()).toEqual([GRANT_A, GRANT_B, GRANT_PERSONAL].sort());
    });
  });

  it("does not let a manager create or change a grant", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      expect(
        await sqlStateOf(client, rpc("create_grant", { request_id: KEY, program_id: PROGRAM_B, organization_id: ORG_A, user_id: null, starts_at: "2026-09-01T00:00:00Z", ends_at: null }))
      ).toBe("42501");
      expect(
        await sqlStateOf(client, rpc("update_grant", { grant_id: GRANT_A, status: "revoked" }))
      ).toBe("42501");
    });
  });

  it("refuses a grant naming both subjects, or neither", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      expect(
        await sqlStateOf(client, rpc("create_grant", { request_id: KEY, program_id: PROGRAM_SHARED, organization_id: ORG_B, user_id: PERSONAL, starts_at: "2026-09-01T00:00:00Z", ends_at: null }))
      ).toBe("22023");
      expect(
        await sqlStateOf(client, rpc("create_grant", { request_id: KEY, program_id: PROGRAM_SHARED, organization_id: null, user_id: null, starts_at: "2026-09-01T00:00:00Z", ends_at: null }))
      ).toBe("22023");
    });
  });

  it("keeps a grant's subject immutable while dates and status stay editable", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const r = await client.query(rpc("update_grant", { grant_id: GRANT_A, status: "revoked" }));
      expect(r.rows[0].out.status).toBe("revoked");
      expect(r.rows[0].out.organization_id).toBe(ORG_A);

      await client.query("RESET ROLE");
      // The subject cannot be moved even by direct SQL — the M02 trigger holds.
      expect(
        await sqlStateOf(client, `UPDATE app.program_grants SET organization_id='${ORG_B}' WHERE id='${GRANT_A}'`)
      ).toBe("23514");
    });
  });

  it("takes effect immediately when a grant is revoked", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const before = await client.query(
        "SELECT app.enrollment_availability($1,$2,$3) AS a",
        [AMBER, fixtures.ids.enroll_amber, fixtures.now]
      );
      expect(before.rows[0].a).toBe("available");

      await asUser(client, ADMIN);
      await client.query(rpc("update_grant", { grant_id: GRANT_A, status: "revoked" }));

      await client.query("RESET ROLE");
      const after = await client.query(
        "SELECT app.enrollment_availability($1,$2,$3) AS a",
        [AMBER, fixtures.ids.enroll_amber, fixtures.now]
      );
      // spec/03: revoking takes effect without rewriting enrollment history.
      expect(after.rows[0].a).toBe("revoked");
    });
  });

  it("expires access when the grant window closes, without touching the enrollment", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      await client.query(rpc("update_grant", { grant_id: GRANT_A, ends_at: "2026-09-10T00:00:00Z" }));
      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT app.enrollment_availability($1,$2,$3) AS a,
                (SELECT status FROM app.enrollments WHERE id=$2) AS enrollment`,
        [AMBER, fixtures.ids.enroll_amber, fixtures.now]
      );
      expect(r.rows[0].a).toBe("expired");
      expect(r.rows[0].enrollment).toBe("active");
    });
  });

  it("does not let a cohort learner be added while the cohort is archived", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      await client.query(rpc("update_cohort", { cohort_id: COHORT_A, archived: true }));
      expect(
        await sqlStateOf(client, rpc("add_cohort_members", { request_id: KEY, cohort_id: COHORT_A, user_ids: [MULTI] }))
      ).toBe("23514");
    });
  });

  it("makes an archived cohort's learners unavailable without deleting anything", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      await client.query(rpc("update_cohort", { cohort_id: COHORT_A, archived: true }));
      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT app.enrollment_availability($1,$2,$3) AS a,
                (SELECT count(*)::int FROM app.class_progress WHERE enrollment_id=$2) AS progress`,
        [BEN, ENROLL_BEN, fixtures.now]
      );
      expect(r.rows[0].a).toBe("membership_inactive");
      expect(r.rows[0].progress).toBeGreaterThan(0);
    });
  });
});
