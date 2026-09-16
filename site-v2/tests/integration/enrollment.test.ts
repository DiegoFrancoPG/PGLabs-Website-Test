import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-020 — enrollment uniqueness.
 * AC-021 — personal and multi-org privacy.
 * AC-063 — soft date bulk update.
 * AC-065 — profile removal preserves history.
 * AC-012 — its final clause, explicit reactivation.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  admin: ADMIN, manager_a: MANAGER_A,
  amber: AMBER, ben: BEN, dana: DANA, personal: PERSONAL, multi: MULTI,
  org_a: ORG_A, cohort_a: COHORT_A,
  offering_a: OFFERING_A, offering_b: OFFERING_B,
  enroll_amber: ENROLL_AMBER, enroll_ben: ENROLL_BEN, enroll_cora: ENROLL_CORA,
  enroll_personal: ENROLL_PERSONAL, enroll_multi_b: ENROLL_MULTI_B,
  grant_personal: GRANT_PERSONAL, version_shared: VERSION_SHARED,
} = fixtures.ids;

const NOW = fixtures.now;

async function asUser(client: import("pg").Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}
const rpc = (action: string, payload: object) =>
  `SELECT public.pglearn_rpc('${action}', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) AS out`;

describe.skipIf(!hasDatabase)("AC-020 enrollment uniqueness", () => {
  it("assigning the same people twice creates nothing the second time", async () => {
    await inRollback(async (client) => {
      // Dana is in cohort A but not yet enrolled in its offering.
      await client.query("RESET ROLE");
      await client.query(
        "UPDATE app.cohort_members SET status='active' WHERE cohort_id=$1 AND user_id=$2",
        [COHORT_A, DANA]
      );
      await client.query("DELETE FROM app.enrollments WHERE offering_id=$1 AND user_id=$2", [
        OFFERING_A, DANA,
      ]);

      await asUser(client, MANAGER_A);
      const payload = {
        request_id: crypto.randomUUID(),
        offering_id: OFFERING_A,
        user_ids: [AMBER, BEN, DANA],
      };
      const first = await client.query(rpc("enroll_cohort", payload));
      const second = await client.query(
        rpc("enroll_cohort", { ...payload, request_id: crypto.randomUUID() })
      );

      // Amber and Ben were already enrolled, so only Dana is new.
      expect(first.rows[0].out.created).toBe(1);
      expect(second.rows[0].out.created).toBe(0);
      // Same ids returned both times, per spec/03's "returns existing row".
      expect(second.rows[0].out.enrollment_ids).toEqual(first.rows[0].out.enrollment_ids);

      await client.query("RESET ROLE");
      const n = await client.query(
        "SELECT count(*)::int AS n FROM app.enrollments WHERE offering_id=$1",
        [OFFERING_A]
      );
      expect(n.rows[0].n).toBe(4);
    });
  });

  it("enrols nobody when any one person is not an active cohort member", async () => {
    await inRollback(async (client) => {
      /*
       * Measured as a delta, not an absolute: Dana is already enrolled by the
       * fixture, so asserting zero would be asserting the fixture rather than
       * the rule.
       */
      await client.query("RESET ROLE");
      const before = await client.query(
        "SELECT count(*)::int AS n FROM app.enrollments WHERE offering_id=$1",
        [OFFERING_A]
      );

      await asUser(client, MANAGER_A);
      // multi belongs to organization A but is not a member of cohort A.
      expect(
        await sqlStateOf(client, rpc("enroll_cohort", {
          request_id: crypto.randomUUID(), offering_id: OFFERING_A, user_ids: [DANA, MULTI],
        }))
      ).toBe("23514");

      await client.query("RESET ROLE");
      const after = await client.query(
        "SELECT count(*)::int AS n FROM app.enrollments WHERE offering_id=$1",
        [OFFERING_A]
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
      // And specifically, the person who WAS eligible gained nothing either.
      const multi = await client.query(
        "SELECT count(*)::int AS n FROM app.enrollments WHERE offering_id=$1 AND user_id=$2",
        [OFFERING_A, MULTI]
      );
      expect(multi.rows[0].n).toBe(0);
    });
  });

  it("copies the offering's dates onto each enrollment", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      await client.query(
        "UPDATE app.cohort_members SET status='active' WHERE cohort_id=$1 AND user_id=$2",
        [COHORT_A, DANA]
      );
      await client.query("DELETE FROM app.enrollments WHERE offering_id=$1 AND user_id=$2", [
        OFFERING_A, DANA,
      ]);
      await asUser(client, MANAGER_A);
      await client.query(
        rpc("enroll_cohort", { request_id: crypto.randomUUID(), offering_id: OFFERING_A, user_ids: [DANA] })
      );

      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT e.starts_at = o.starts_at AND e.due_at = o.due_at
                AND e.access_ends_at IS NOT DISTINCT FROM o.access_ends_at AS copied
         FROM app.enrollments e JOIN app.cohort_offerings o ON o.id = e.offering_id
         WHERE e.offering_id=$1 AND e.user_id=$2`,
        [OFFERING_A, DANA]
      );
      expect(r.rows[0].copied).toBe(true);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-012 explicit reactivation", () => {
  it("cannot be reactivated while the learner is still out of the cohort", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      await client.query(rpc("remove_cohort_member", { cohort_id: COHORT_A, user_id: BEN }));

      /*
       * spec/03: reactivation is allowed "if all predicates pass". The M02
       * trigger re-runs on the way back to active, so this is refused without
       * the handler re-implementing the rule.
       */
      expect(
        await sqlStateOf(client, rpc("update_enrollment", { enrollment_id: ENROLL_BEN, status: "active" }))
      ).toBe("23514");
    });
  });

  it("restores access once the learner is back in the cohort, keeping progress", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const progressBefore = await client.query(
        "SELECT count(*)::int AS n FROM app.class_progress WHERE enrollment_id=$1",
        [ENROLL_BEN]
      );

      await asUser(client, MANAGER_A);
      await client.query(rpc("remove_cohort_member", { cohort_id: COHORT_A, user_id: BEN }));
      await client.query(
        rpc("add_cohort_members", { request_id: crypto.randomUUID(), cohort_id: COHORT_A, user_ids: [BEN] })
      );
      const reactivated = await client.query(
        rpc("update_enrollment", { enrollment_id: ENROLL_BEN, status: "active" })
      );

      expect(reactivated.rows[0].out.state).toBe("in_progress");

      await client.query("RESET ROLE");
      const after = await client.query(
        `SELECT (SELECT count(*)::int FROM app.class_progress WHERE enrollment_id=$1) AS progress,
                app.enrollment_availability($2,$1,$3) AS availability`,
        [ENROLL_BEN, BEN, NOW]
      );
      // spec/03: reactivation "preserves progress".
      expect(after.rows[0].progress).toBe(progressBefore.rows[0].n);
      expect(after.rows[0].availability).toBe("available");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-063 soft date bulk update", () => {
  const NEW_DUE = "2026-09-25T17:00:00Z";

  it("changes nothing at all when one selected enrollment is invalid", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const before = await client.query(
        "SELECT id, due_at FROM app.enrollments WHERE offering_id=$1 ORDER BY id",
        [OFFERING_A]
      );

      await asUser(client, MANAGER_A);
      // Cora has completed, so her schedule cannot be edited (spec/02).
      expect(
        await sqlStateOf(client, rpc("update_offering", {
          offering_id: OFFERING_A, due_at: NEW_DUE,
          apply_to_enrollment_ids: [ENROLL_AMBER, ENROLL_CORA],
        }))
      ).toBe("23514");

      await client.query("RESET ROLE");
      const after = await client.query(
        "SELECT id, due_at FROM app.enrollments WHERE offering_id=$1 ORDER BY id",
        [OFFERING_A]
      );
      expect(after.rows).toEqual(before.rows);
    });
  });

  it("applies only to the enrollments that were named", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      await client.query(
        rpc("update_offering", {
          offering_id: OFFERING_A, due_at: NEW_DUE,
          apply_to_enrollment_ids: [ENROLL_AMBER],
        })
      );

      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT id, due_at FROM app.enrollments WHERE id = ANY($1)",
        [[ENROLL_AMBER, ENROLL_BEN]]
      );
      const byId = Object.fromEntries(r.rows.map((x) => [x.id, x.due_at.toISOString()]));
      expect(byId[ENROLL_AMBER]).toBe(new Date(NEW_DUE).toISOString());
      // Ben was not named, so he keeps the date he was enrolled with.
      expect(byId[ENROLL_BEN]).toBe(new Date(fixtures.offering_a.due_at).toISOString());
    });
  });

  it("never edits a completed learner's schedule", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const before = await client.query("SELECT due_at FROM app.enrollments WHERE id=$1", [
        ENROLL_CORA,
      ]);
      await asUser(client, MANAGER_A);
      await client.query(
        rpc("update_offering", {
          offering_id: OFFERING_A, due_at: NEW_DUE, apply_to_enrollment_ids: [ENROLL_AMBER],
        })
      );
      await client.query("RESET ROLE");
      const after = await client.query("SELECT due_at FROM app.enrollments WHERE id=$1", [
        ENROLL_CORA,
      ]);
      expect(after.rows[0].due_at).toEqual(before.rows[0].due_at);
    });
  });

  it("refuses to move the start past a learner who already began", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      // Ben started on 8 September, so a 10 September start is impossible.
      expect(
        await sqlStateOf(client, rpc("update_offering", {
          offering_id: OFFERING_A, starts_at: "2026-09-10T09:00:00Z",
          apply_to_enrollment_ids: [ENROLL_BEN],
        }))
      ).toBe("23514");
    });
  });

  it("still applies the current grant's hard gate after a date change", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      await client.query(
        rpc("update_offering", {
          offering_id: OFFERING_A, due_at: NEW_DUE, apply_to_enrollment_ids: [ENROLL_AMBER],
        })
      );
      await client.query("RESET ROLE");
      // Revoking the grant overrides whatever the enrollment dates now say.
      await client.query("UPDATE app.program_grants SET status='revoked' WHERE id=$1", [
        fixtures.ids.grant_a,
      ]);
      const r = await client.query("SELECT app.enrollment_availability($1,$2,$3) AS a", [
        AMBER, ENROLL_AMBER, NOW,
      ]);
      expect(r.rows[0].a).toBe("revoked");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-021 personal and multi-organisation privacy", () => {
  it("gives a personal learner an enrollment with no organisation at all", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT organization_id, offering_id FROM app.enrollments WHERE id=$1",
        [ENROLL_PERSONAL]
      );
      expect(r.rows[0]).toEqual({ organization_id: null, offering_id: null });
    });
  });

  it("never shows a personal enrollment to an organisation manager", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const r = await client.query("SELECT app.can_report($1,$2) AS can", [
        MANAGER_A, ENROLL_PERSONAL,
      ]);
      // can_report cannot match a null organisation, structurally.
      expect(r.rows[0].can).toBe(false);
    });
  });

  it("shows manager A their own records and none of organisation B's", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT app.can_report($1,$2) AS own, app.can_report($1,$3) AS other`,
        [MANAGER_A, ENROLL_AMBER, ENROLL_MULTI_B]
      );
      expect(r.rows[0]).toEqual({ own: true, other: false });
    });
  });

  it("leaves the multi-organisation learner's work in B untouched by a change in A", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const before = await client.query(
        "SELECT status, due_at, starts_at FROM app.enrollments WHERE id=$1",
        [ENROLL_MULTI_B]
      );

      // Everything organisation A's manager can do to their own offering.
      await asUser(client, MANAGER_A);
      await client.query(
        rpc("update_offering", {
          offering_id: OFFERING_A, due_at: "2026-09-30T17:00:00Z",
          apply_to_enrollment_ids: [ENROLL_AMBER],
        })
      );
      await client.query(rpc("remove_cohort_member", { cohort_id: COHORT_A, user_id: BEN }));

      await client.query("RESET ROLE");
      const after = await client.query(
        "SELECT status, due_at, starts_at FROM app.enrollments WHERE id=$1",
        [ENROLL_MULTI_B]
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
    });
  });

  it("refuses manager A any hold over organisation B's offering", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      expect(
        await sqlStateOf(client, rpc("update_offering", {
          offering_id: OFFERING_B, due_at: "2026-09-30T17:00:00Z", apply_to_enrollment_ids: [],
        }))
      ).toBe("42501");
      expect(
        await sqlStateOf(client, rpc("update_enrollment", { enrollment_id: ENROLL_MULTI_B, status: "cancelled" }))
      ).toBe("P0002");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-065 removal preserves history", () => {
  /** Removes the multi-organisation learner from organisation A entirely. */
  async function removeFromA(client: import("pg").Client) {
    await client.query("RESET ROLE");
    await client.query(
      "UPDATE app.memberships SET status='removed' WHERE organization_id=$1 AND user_id=$2",
      [ORG_A, MULTI]
    );
  }

  it("blocks learning in A once the membership is removed", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      // Give the multi learner something in A to lose.
      await client.query(
        "INSERT INTO app.cohort_members(cohort_id,organization_id,user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [COHORT_A, ORG_A, MULTI]
      );
      const e = await client.query(
        `INSERT INTO app.enrollments(user_id, program_id, version_id, grant_id, organization_id,
                                     offering_id, starts_at, due_at, access_ends_at)
         SELECT $1, o.program_id, o.version_id, o.grant_id, o.organization_id, o.id,
                o.starts_at, o.due_at, o.access_ends_at
         FROM app.cohort_offerings o WHERE o.id=$2 RETURNING id`,
        [MULTI, OFFERING_A]
      );
      const enrollmentA = e.rows[0].id;

      await removeFromA(client);

      const r = await client.query("SELECT app.enrollment_availability($1,$2,$3) AS a", [
        MULTI, enrollmentA, NOW,
      ]);
      expect(r.rows[0].a).toBe("membership_inactive");
    });
  });

  it("keeps the learner's own history in A visible to them", async () => {
    await inRollback(async (client) => {
      await removeFromA(client);
      const r = await client.query("SELECT app.owns_enrollment($1,$2) AS owns", [
        MULTI, ENROLL_MULTI_B,
      ]);
      /*
       * spec/02: "Owners retain summary/progress/certificate access even after
       * cancellation, expired access, or organization removal."
       */
      expect(r.rows[0].owns).toBe(true);
    });
  });

  it("leaves organisation B and personal entitlement untouched", async () => {
    await inRollback(async (client) => {
      await removeFromA(client);
      const r = await client.query(
        `SELECT app.enrollment_availability($1,$2,$3) AS multi_in_b,
                app.enrollment_availability($4,$5,$3) AS personal`,
        [MULTI, ENROLL_MULTI_B, NOW, PERSONAL, ENROLL_PERSONAL]
      );
      expect(r.rows[0].multi_in_b).toBe("available");
      expect(r.rows[0].personal).toBe("available");
    });
  });

  it("keeps reporting on the historical rows for the manager who owned them", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      await client.query(
        "UPDATE app.memberships SET status='removed' WHERE organization_id=$1 AND user_id=$2",
        [ORG_A, AMBER]
      );
      const r = await client.query("SELECT app.can_report($1,$2) AS can", [MANAGER_A, ENROLL_AMBER]);
      // spec/02: "Reporting remains available for historical rows even if
      // target learner membership has been removed."
      expect(r.rows[0].can).toBe(true);
    });
  });
});

describe.skipIf(!hasDatabase)("personal enrollment and retakes", () => {
  it("creates a personal enrollment with no organisation", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const r = await client.query(
        rpc("enroll_personal", {
          request_id: crypto.randomUUID(), grant_id: GRANT_PERSONAL, version_id: VERSION_SHARED,
          starts_at: "2026-09-01T09:00:00Z", due_at: "2026-09-20T17:00:00Z", access_ends_at: null,
        })
      );
      expect(r.rows[0].out.organization_id).toBeNull();
      expect(r.rows[0].out.offering_id).toBeNull();
    });
  });

  it("uses the next attempt number for a retake", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const payload = {
        grant_id: GRANT_PERSONAL, version_id: VERSION_SHARED,
        starts_at: "2026-09-01T09:00:00Z", due_at: "2026-09-20T17:00:00Z", access_ends_at: null,
      };
      await client.query(rpc("enroll_personal", { ...payload, request_id: crypto.randomUUID() }));
      await client.query(rpc("enroll_personal", { ...payload, request_id: crypto.randomUUID() }));

      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT array_agg(attempt ORDER BY attempt) AS attempts FROM app.enrollments
         WHERE user_id=$1 AND grant_id=$2 AND offering_id IS NULL`,
        [PERSONAL, GRANT_PERSONAL]
      );
      // spec/03: "personal retake uses next attempt number."
      expect(r.rows[0].attempts).toEqual([1, 2, 3]);
    });
  });

  it("refuses a manager the right to create a personal enrollment", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      expect(
        await sqlStateOf(client, rpc("enroll_personal", {
          request_id: crypto.randomUUID(), grant_id: GRANT_PERSONAL, version_id: VERSION_SHARED,
          starts_at: "2026-09-01T09:00:00Z", due_at: "2026-09-20T17:00:00Z", access_ends_at: null,
        }))
      ).toBe("42501");
    });
  });
});
