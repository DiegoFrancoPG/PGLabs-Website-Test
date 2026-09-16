import { describe, it, expect } from "vitest";
import { hasDatabase, inRollback, sqlStateOf, withClient } from "./db";

/*
 * AC-004 — function privilege boundary.
 * AC-005 — cross-context relationship.
 *
 * These run as the real browser roles. `SET LOCAL ROLE authenticated` plus a
 * request.jwt.claims setting is how Supabase presents a logged-in user to
 * Postgres, so auth.uid() here returns what it would for a real session.
 *
 * spec/02 requires exactly this: "Tests must call RPC directly using user JWTs
 * as well as through application routes." A service layer that is wrong must
 * not be able to get past these.
 */

const LEARNER = "f0000006-0000-4000-8000-000000000000";
const OUTSIDER = "f0000009-0000-4000-8000-000000000000";

/** Presents the connection as a signed-in user, the way Supabase does. */
async function asUser(client: import("pg").Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}

async function asAnon(client: import("pg").Client) {
  await client.query("SET LOCAL ROLE anon");
}

const SEED_LEARNER = `
INSERT INTO auth.users(id,email) VALUES('${LEARNER}','probe-amber@example.invalid') ON CONFLICT DO NOTHING;
INSERT INTO app.profiles(id,email,display_name,onboarded_at)
  VALUES('${LEARNER}','probe-amber@example.invalid','Amber',now()) ON CONFLICT DO NOTHING;
`;

describe.skipIf(!hasDatabase)("AC-004 function privilege boundary", () => {
  it("lets an authenticated learner run an allowlisted action", async () => {
    await inRollback(async (client) => {
      await client.query(SEED_LEARNER);
      await asUser(client, LEARNER);
      const r = await client.query("SELECT public.pglearn_rpc('get_me') AS out");
      expect(r.rows[0].out.id).toBe(LEARNER);
      expect(r.rows[0].out.is_platform_admin).toBe(false);
    });
  });

  it("derives the actor from auth.uid(), ignoring any user id in the payload", async () => {
    await inRollback(async (client) => {
      await client.query(SEED_LEARNER);
      await client.query(
        `INSERT INTO auth.users(id,email) VALUES('${OUTSIDER}','probe-other@example.invalid') ON CONFLICT DO NOTHING`
      );
      await client.query(
        `INSERT INTO app.profiles(id,email,display_name,onboarded_at) VALUES('${OUTSIDER}','probe-other@example.invalid','Other',now()) ON CONFLICT DO NOTHING`
      );
      await asUser(client, LEARNER);
      // Every shape a caller might use to claim to be somebody else.
      for (const payload of [
        { user_id: OUTSIDER },
        { actor_id: OUTSIDER },
        { sub: OUTSIDER },
        { role: "service_role" },
        { is_admin: true },
      ]) {
        const r = await client.query("SELECT public.pglearn_rpc('get_me', $1::jsonb) AS out", [
          JSON.stringify(payload),
        ]);
        expect(r.rows[0].out.id).toBe(LEARNER);
        expect(r.rows[0].out.is_platform_admin).toBe(false);
      }
    });
  });

  it("denies an unknown action with the same error as an unauthorized one", async () => {
    await inRollback(async (client) => {
      await client.query(SEED_LEARNER);
      await asUser(client, LEARNER);
      for (const action of ["nope", "drop_everything", "get_me; DROP TABLE app.profiles", "GET_ME", ""]) {
        const state = await sqlStateOf(client, `SELECT public.pglearn_rpc('${action.replace(/'/g, "''")}')`);
        expect(state).toBe("42501");
      }
    });
  });

  it("makes no change when an unknown action is rejected", async () => {
    await inRollback(async (client) => {
      await client.query(SEED_LEARNER);
      const before = await client.query("SELECT count(*)::int AS n FROM app.profiles");
      await asUser(client, LEARNER);
      await sqlStateOf(client, "SELECT public.pglearn_rpc('definitely_not_an_action')");
      await client.query("RESET ROLE");
      const after = await client.query("SELECT count(*)::int AS n FROM app.profiles");
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });

  it("refuses an unauthenticated caller", async () => {
    await inRollback(async (client) => {
      await asAnon(client);
      // anon has no EXECUTE at all, so this is a privilege error, not a 28000.
      expect(await sqlStateOf(client, "SELECT public.pglearn_rpc('get_me')")).toBe("42501");
    });
  });

  it("refuses an authenticated role with no JWT subject", async () => {
    await inRollback(async (client) => {
      await client.query("SET LOCAL ROLE authenticated");
      expect(await sqlStateOf(client, "SELECT public.pglearn_rpc('get_me')")).toBe("28000");
    });
  });

  it.each(["anon", "authenticated"])("denies %s EXECUTE on pglearn_job", async (role) => {
    await inRollback(async (client) => {
      await client.query(`SET LOCAL ROLE ${role}`);
      expect(await sqlStateOf(client, "SELECT public.pglearn_job('reminders.claim')")).toBe("42501");
    });
  });

  it.each(["anon", "authenticated"])("denies %s EXECUTE on pglearn_provision", async (role) => {
    await inRollback(async (client) => {
      await client.query(`SET LOCAL ROLE ${role}`);
      const state = await sqlStateOf(
        client,
        `SELECT public.pglearn_provision('{"user_id":"${LEARNER}"}'::jsonb)`
      );
      expect(state).toBe("42501");
    });
  });

  it("denies a learner EXECUTE on the internal handlers", async () => {
    await inRollback(async (client) => {
      await client.query(SEED_LEARNER);
      await asUser(client, LEARNER);
      expect(await sqlStateOf(client, `SELECT app.handle_get_me('${LEARNER}','{}'::jsonb)`)).toBe("42501");
      expect(await sqlStateOf(client, `SELECT app.actor_active('${LEARNER}')`)).toBe("42501");
      expect(await sqlStateOf(client, `SELECT app.can_learn('${LEARNER}',gen_random_uuid(),now())`)).toBe("42501");
    });
  });

  it("keeps every public entrypoint on a fixed empty search_path", async () => {
    await withClient(async (client) => {
      const r = await client.query(`
        SELECT p.proname, p.proconfig, p.prosecdef
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname LIKE 'pglearn%' ORDER BY 1`);
      expect(r.rows).toHaveLength(3);
      for (const row of r.rows) {
        expect(row.prosecdef).toBe(true);
        // spec/02 requires SET search_path = '' exactly — an empty path, not
        // merely a path that excludes public. Postgres stores that literally.
        expect(row.proconfig).toEqual(['search_path=""']);
      }
    });
  });

  it("exposes no other function in public that a browser role could call", async () => {
    await withClient(async (client) => {
      const r = await client.query(`
        SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND (has_function_privilege('anon', p.oid, 'EXECUTE')
            OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
        ORDER BY 1`);
      expect(r.rows.map((x) => x.proname)).toEqual(["pglearn_rpc"]);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-005 cross-context relationship", () => {
  const A = "f0000010-0000-4000-8000-000000000000";
  const B = "f0000003-0000-4000-8000-000000000000";
  const PROGRAM = "f0000007-0000-4000-8000-000000000000";
  const VERSION = "f0000011-0000-4000-8000-000000000000";
  const COHORT_B = "f0000008-0000-4000-8000-000000000000";
  const GRANT_A = "f0000001-0000-4000-8000-000000000000";

  /* Org A holds the grant; org B holds the cohort. */
  const SEED = `
    INSERT INTO auth.users(id,email) VALUES('${LEARNER}','probe-amber@example.invalid');
    INSERT INTO app.profiles(id,email,display_name,onboarded_at) VALUES('${LEARNER}','probe-amber@example.invalid','Amber',now());
    INSERT INTO app.organizations(id,name) VALUES('${A}','Org A'),('${B}','Org B');
    INSERT INTO app.memberships(organization_id,user_id,role,status) VALUES('${B}','${LEARNER}','learner','active');
    INSERT INTO app.cohorts(id,organization_id,name) VALUES('${COHORT_B}','${B}','B cohort');
    INSERT INTO app.cohort_members(cohort_id,organization_id,user_id) VALUES('${COHORT_B}','${B}','${LEARNER}');
    INSERT INTO app.programs(id,title) VALUES('${PROGRAM}','Shared');
    INSERT INTO app.program_versions(id,program_id,version_number,title) VALUES('${VERSION}','${PROGRAM}',1,'v1');
    INSERT INTO app.modules(id,version_id,title,position) VALUES(gen_random_uuid(),'${VERSION}','M',0);
    UPDATE app.program_versions SET state='published', published_at=now() WHERE id='${VERSION}';
    INSERT INTO app.program_grants(id,program_id,organization_id,starts_at,ends_at)
      VALUES('${GRANT_A}','${PROGRAM}','${A}','2026-09-01Z','2026-12-01Z');
  `;

  it("rejects an offering whose grant belongs to another organization", async () => {
    await inRollback(async (client) => {
      await client.query(SEED);
      const state = await sqlStateOf(
        client,
        `INSERT INTO app.cohort_offerings(cohort_id,organization_id,program_id,version_id,grant_id,starts_at,due_at)
         VALUES('${COHORT_B}','${B}','${PROGRAM}','${VERSION}','${GRANT_A}','2026-09-05Z','2026-09-20Z')`
      );
      expect(state).toBe("23514");
      // Scoped to this test's cohort: the seed commits its own offerings.
      const r = await client.query(
        `SELECT count(*)::int AS n FROM app.cohort_offerings WHERE cohort_id='${COHORT_B}'`
      );
      expect(r.rows[0].n).toBe(0);
    });
  });

  it("creates neither offering nor enrollment when the relationship is wrong", async () => {
    await inRollback(async (client) => {
      await client.query(SEED);
      await sqlStateOf(
        client,
        `INSERT INTO app.cohort_offerings(cohort_id,organization_id,program_id,version_id,grant_id,starts_at,due_at)
         VALUES('${COHORT_B}','${B}','${PROGRAM}','${VERSION}','${GRANT_A}','2026-09-05Z','2026-09-20Z')`
      );
      const r = await client.query(`
        SELECT (SELECT count(*) FROM app.cohort_offerings WHERE cohort_id='${COHORT_B}')::int AS o,
               (SELECT count(*) FROM app.enrollments WHERE user_id='${LEARNER}')::int AS e`);
      expect(r.rows[0]).toEqual({ o: 0, e: 0 });
    });
  });

  it("rejects an offering on a draft version", async () => {
    await inRollback(async (client) => {
      await client.query(SEED);
      await client.query(
        `INSERT INTO app.program_versions(id,program_id,version_number,title) VALUES('f0000002-0000-4000-8000-000000000000','${PROGRAM}',2,'draft v2')`
      );
      await client.query(
        `INSERT INTO app.program_grants(id,program_id,organization_id,starts_at) VALUES('f0000004-0000-4000-8000-000000000000','${PROGRAM}','${B}','2026-09-01Z')`
      );
      const state = await sqlStateOf(
        client,
        `INSERT INTO app.cohort_offerings(cohort_id,organization_id,program_id,version_id,grant_id,starts_at,due_at)
         VALUES('${COHORT_B}','${B}','${PROGRAM}','f0000002-0000-4000-8000-000000000000','f0000004-0000-4000-8000-000000000000','2026-09-05Z','2026-09-20Z')`
      );
      expect(state).toBe("23514");
    });
  });

  it("rejects an offering whose access outlives its grant", async () => {
    await inRollback(async (client) => {
      await client.query(SEED);
      await client.query(
        `INSERT INTO app.program_grants(id,program_id,organization_id,starts_at,ends_at) VALUES('f0000005-0000-4000-8000-000000000000','${PROGRAM}','${B}','2026-09-01Z','2026-10-01Z')`
      );
      const state = await sqlStateOf(
        client,
        `INSERT INTO app.cohort_offerings(cohort_id,organization_id,program_id,version_id,grant_id,starts_at,due_at,access_ends_at)
         VALUES('${COHORT_B}','${B}','${PROGRAM}','${VERSION}','f0000005-0000-4000-8000-000000000000','2026-09-05Z','2026-09-20Z','2026-11-01Z')`
      );
      expect(state).toBe("23514");
    });
  });

  it("refuses to change a grant's subject after creation", async () => {
    await inRollback(async (client) => {
      await client.query(SEED);
      expect(
        await sqlStateOf(client, `UPDATE app.program_grants SET organization_id='${B}' WHERE id='${GRANT_A}'`)
      ).toBe("23514");
      // Dates and status remain editable, which is what spec/02 permits.
      await client.query(`UPDATE app.program_grants SET status='revoked' WHERE id='${GRANT_A}'`);
    });
  });

  it("freezes the content of a published version", async () => {
    await inRollback(async (client) => {
      await client.query(SEED);
      expect(await sqlStateOf(client, `UPDATE app.program_versions SET title='edited' WHERE id='${VERSION}'`)).toBe("23514");
      expect(await sqlStateOf(client, `UPDATE app.modules SET title='edited' WHERE version_id='${VERSION}'`)).toBe("23514");
      expect(await sqlStateOf(client, `DELETE FROM app.modules WHERE version_id='${VERSION}'`)).toBe("23514");
      expect(
        await sqlStateOf(client, `INSERT INTO app.modules(version_id,title,position) VALUES('${VERSION}','added',9)`)
      ).toBe("23514");
      expect(await sqlStateOf(client, `UPDATE app.program_versions SET state='draft' WHERE id='${VERSION}'`)).toBe("23514");
      expect(await sqlStateOf(client, `DELETE FROM app.program_versions WHERE id='${VERSION}'`)).toBe("23514");
    });
  });

  it("rejects an unknown timezone on a profile or an organization", async () => {
    await inRollback(async (client) => {
      await client.query(SEED);
      expect(await sqlStateOf(client, `UPDATE app.profiles SET timezone='Mars/Olympus' WHERE id='${LEARNER}'`)).toBe("22023");
      expect(await sqlStateOf(client, `UPDATE app.organizations SET timezone='Nowhere/Here' WHERE id='${A}'`)).toBe("22023");
      await client.query(`UPDATE app.profiles SET timezone='America/Vancouver' WHERE id='${LEARNER}'`);
    });
  });
});
