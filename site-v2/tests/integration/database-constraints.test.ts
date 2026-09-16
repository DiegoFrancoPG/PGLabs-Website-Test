import { describe, it, expect } from "vitest";
import { hasDatabase, inRollback, sqlStateOf, withClient } from "./db";

/*
 * AC-002 — schema constraints. Every case runs inside a transaction that is
 * rolled back, and each probe uses a savepoint, so a rejected statement leaves
 * no partial row behind. That is the second half of AC-002's "then": not only
 * does each statement fail, the transaction stays clean.
 *
 * SQLSTATEs: 23514 CHECK, 23505 UNIQUE, 23503 FOREIGN KEY.
 */

const U = {
  amber: "6dbad48c-f06b-5321-84d6-0b42d923296d",
  personal: "d132f5f4-a23c-51c2-81e3-3d81ea102b2b",
  orgA: "e803e98e-7e2b-5663-be8d-b90a533b408a",
  orgB: "16f88a87-6764-53cf-abde-3778f2ea1355",
  cohort: "8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3",
  shared: "6f0169d8-f0c3-5c98-a1d1-2567de5cc1df",
  bOnly: "ca077cbc-8c50-51ed-ba8b-f26d4f2f7528",
  vShared: "fabecfce-b09c-541e-acf3-575147e78603",
  vB: "1e4985f2-8eec-5418-998a-484f5561c049",
  module: "1690cd9c-eca0-5455-944c-94bf4537dd5d",
  videoClass: "d95caac8-b580-5147-bc93-bd483f308611",
  exercise: "083cddbe-279d-5ea2-8289-7fb9ece21de6",
  grantOrg: "0459023a-6a55-56cf-b516-1476b9054b8b",
  offering: "65999d80-6d61-5239-8300-529875cbc1e6",
  enrollment: "f1961d6a-d742-5300-bd9a-a9fa80d6ae07",
};

/** The fixture graph from tests/schema-smoke.sql, which never leaves the transaction. */
const SEED = `
INSERT INTO auth.users(id) VALUES('${U.amber}'),('${U.personal}');
INSERT INTO app.profiles(id,email,display_name) VALUES
  ('${U.amber}','amber@example.invalid','Amber'),('${U.personal}','personal@example.invalid','Personal');
INSERT INTO app.organizations(id,name) VALUES('${U.orgA}','A'),('${U.orgB}','B');
INSERT INTO app.memberships(organization_id,user_id,role,status) VALUES('${U.orgA}','${U.amber}','learner','active');
INSERT INTO app.cohorts(id,organization_id,name) VALUES('${U.cohort}','${U.orgA}','Alpha');
INSERT INTO app.cohort_members(cohort_id,organization_id,user_id) VALUES('${U.cohort}','${U.orgA}','${U.amber}');
INSERT INTO app.programs(id,title) VALUES('${U.shared}','Shared'),('${U.bOnly}','B-only');
INSERT INTO app.program_versions(id,program_id,version_number,title) VALUES
  ('${U.vShared}','${U.shared}',1,'Shared v1'),('${U.vB}','${U.bOnly}',1,'B v1');
INSERT INTO app.modules(id,version_id,title,position) VALUES('${U.module}','${U.vShared}','Module',0);
INSERT INTO app.classes(id,module_id,version_id,title,position,kind,duration_ms) VALUES
  ('${U.videoClass}','${U.module}','${U.vShared}','Video',0,'video',600000);
INSERT INTO app.exercises(id,class_id,instructions_md) VALUES('${U.exercise}','${U.videoClass}','Practice');
INSERT INTO app.program_grants(id,program_id,organization_id,starts_at,ends_at) VALUES
  ('${U.grantOrg}','${U.shared}','${U.orgA}','2026-09-01Z','2026-11-01Z');
INSERT INTO app.cohort_offerings(id,cohort_id,organization_id,program_id,version_id,grant_id,starts_at,due_at) VALUES
  ('${U.offering}','${U.cohort}','${U.orgA}','${U.shared}','${U.vShared}','${U.grantOrg}','2026-09-01Z','2026-09-20Z');
INSERT INTO app.enrollments(id,user_id,program_id,version_id,grant_id,organization_id,offering_id,starts_at,due_at) VALUES
  ('${U.enrollment}','${U.amber}','${U.shared}','${U.vShared}','${U.grantOrg}','${U.orgA}','${U.offering}','2026-09-01Z','2026-09-20Z');
`;

describe.skipIf(!hasDatabase)("AC-002 schema constraints", () => {
  /*
   * A case may need extra rows before its statement means anything. An UPDATE
   * against a table with no matching row succeeds trivially, which would make
   * the case pass without ever reaching the constraint — so those carry a
   * prelude, and the assertion below proves the statement actually bit.
   */
  const PROGRESS_ROW = `INSERT INTO app.class_progress(enrollment_id,class_id,version_id,played_ranges) VALUES('${U.enrollment}','${U.videoClass}','${U.vShared}','{[0,540000)}'::int8multirange);`;

  const CASES: [name: string, sqlstate: string, statement: string, prelude?: string][] = [
    ["grant naming both an organization and a user", "23514",
      `INSERT INTO app.program_grants(program_id,organization_id,user_id,starts_at) VALUES('${U.shared}','${U.orgB}','${U.personal}',now())`],
    ["grant naming no subject at all", "23514",
      `INSERT INTO app.program_grants(program_id,starts_at) VALUES('${U.shared}',now())`],
    ["grant ending before it starts", "23514",
      `INSERT INTO app.program_grants(program_id,organization_id,starts_at,ends_at) VALUES('${U.shared}','${U.orgB}','2026-10-01Z','2026-09-01Z')`],
    ["second active grant for the same organization and program", "23505",
      `INSERT INTO app.program_grants(program_id,organization_id,starts_at) VALUES('${U.shared}','${U.orgA}',now())`],
    ["cohort member belonging to a different organization", "23503",
      `INSERT INTO app.cohort_members(cohort_id,organization_id,user_id) VALUES('${U.cohort}','${U.orgB}','${U.personal}')`],
    ["class attached to a module from another version", "23503",
      `INSERT INTO app.classes(module_id,version_id,title,position,kind) VALUES('${U.module}','${U.vB}','Bad',2,'text')`],
    ["two classes at the same position", "23505",
      `INSERT INTO app.classes(module_id,version_id,title,position,kind) VALUES('${U.module}','${U.vShared}','Bad',0,'text')`],
    ["text class carrying a media duration", "23514",
      `INSERT INTO app.classes(module_id,version_id,title,position,kind,duration_ms) VALUES('${U.module}','${U.vShared}','Bad',2,'text',1000)`],
    ["duplicate enrollment in one offering", "23505",
      `INSERT INTO app.enrollments(user_id,program_id,version_id,grant_id,organization_id,offering_id,starts_at,due_at) VALUES('${U.amber}','${U.shared}','${U.vShared}','${U.grantOrg}','${U.orgA}','${U.offering}','2026-09-01Z','2026-09-20Z')`],
    ["enrollment due date moved onto its start", "23514",
      `UPDATE app.enrollments SET due_at=starts_at WHERE id='${U.enrollment}'`],
    ["offering enrollment stripped of its organization", "23514",
      `UPDATE app.enrollments SET organization_id=NULL WHERE id='${U.enrollment}'`],
    ["progress recorded against another version", "23503",
      `INSERT INTO app.class_progress(enrollment_id,class_id,version_id) VALUES('${U.enrollment}','${U.videoClass}','${U.vB}')`],
    ["blank exercise response", "23514",
      `INSERT INTO app.exercise_completions(enrollment_id,exercise_id,response) VALUES('${U.enrollment}','${U.exercise}',' ')`],
    ["exercise response over 2,000 code points", "23514",
      `INSERT INTO app.exercise_completions(enrollment_id,exercise_id,response) VALUES('${U.enrollment}','${U.exercise}',repeat('a',2001))`],
    ["class completed before its content was", "23514",
      `UPDATE app.class_progress SET completed_at=now() WHERE enrollment_id='${U.enrollment}'`,
      PROGRESS_ROW],
    ["enrollment completed before it was started", "23514",
      `UPDATE app.enrollments SET completed_at=now() WHERE id='${U.enrollment}'`],
  ];

  it.each(CASES)("rejects %s", async (_name, expected, statement, prelude) => {
    await inRollback(async (client) => {
      await client.query(SEED);
      if (prelude) await client.query(prelude);
      expect(await sqlStateOf(client, statement)).toBe(expected);
    });
  });

  /*
   * Guards the suite against vacuous passes: every UPDATE case must match at
   * least one row, or it would "pass" by touching nothing. This caught the
   * class_progress case, which had no row to update at all.
   */
  it.each(CASES.filter(([, , statement]) => statement.trim().toUpperCase().startsWith("UPDATE")))(
    "case %s actually matches a row",
    async (_name, _expected, statement, prelude) => {
      await inRollback(async (client) => {
        await client.query(SEED);
        if (prelude) await client.query(prelude);
        const table = /UPDATE\s+(app\.\w+)/.exec(statement)![1];
        const where = statement.slice(statement.toUpperCase().lastIndexOf("WHERE"));
        const r = await client.query(`SELECT count(*)::int AS n FROM ${table} ${where}`);
        expect(r.rows[0].n).toBeGreaterThan(0);
      });
    }
  );

  it("leaves no partial row behind when a statement is rejected", async () => {
    await inRollback(async (client) => {
      await client.query(SEED);
      const before = await client.query("SELECT count(*)::int AS n FROM app.program_grants");
      await sqlStateOf(client, `INSERT INTO app.program_grants(program_id,starts_at) VALUES('${U.shared}',now())`);
      const after = await client.query("SELECT count(*)::int AS n FROM app.program_grants");
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });
  });

  it("counts an exercise response in Unicode code points, not bytes", async () => {
    await inRollback(async (client) => {
      await client.query(SEED);
      // 2,000 emoji are 2,000 code points but 8,000 bytes.
      await client.query(
        `INSERT INTO app.exercise_completions(enrollment_id,exercise_id,response) VALUES('${U.enrollment}','${U.exercise}',repeat(chr(128512),2000))`
      );
      const r = await client.query("SELECT char_length(response)::int AS n, octet_length(response)::int AS b FROM app.exercise_completions");
      expect(r.rows[0].n).toBe(2000);
      expect(r.rows[0].b).toBe(8000);
      expect(await sqlStateOf(client, `UPDATE app.exercise_completions SET response=repeat(chr(128512),2001)`)).toBe("23514");
    });
  });

  it("measures played coverage as the union of ranges, not their sum", async () => {
    await inRollback(async (client) => {
      await client.query(SEED);
      // ADR-09 needs 90% of UNIQUE timeline coverage, so overlap must not double-count.
      await client.query(
        `INSERT INTO app.class_progress(enrollment_id,class_id,version_id,played_ranges) VALUES('${U.enrollment}','${U.videoClass}','${U.vShared}','{[0,300000),[200000,540000)}'::int8multirange)`
      );
      const r = await client.query(
        `SELECT sum(upper(x)-lower(x))::bigint AS covered FROM app.class_progress p, unnest(p.played_ranges) x WHERE enrollment_id='${U.enrollment}'`
      );
      // 300s + 340s of wall clock, but only 540s of distinct timeline.
      expect(Number(r.rows[0].covered)).toBe(540000);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-003 no direct table access", () => {
  it.each(["anon", "authenticated"])("denies %s a SELECT on app.enrollments", async (role) => {
    await inRollback(async (client) => {
      await client.query(`SET LOCAL ROLE ${role}`);
      const state = await sqlStateOf(client, "SELECT * FROM app.enrollments LIMIT 1");
      expect(state).toBe("42501");
    });
  });

  it.each(["anon", "authenticated"])("denies %s an INSERT into app.enrollments", async (role) => {
    await inRollback(async (client) => {
      await client.query(`SET LOCAL ROLE ${role}`);
      const state = await sqlStateOf(
        client,
        `INSERT INTO app.enrollments(user_id,program_id,version_id,grant_id,starts_at,due_at) VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),now(),now()+interval '1 day')`
      );
      expect(state).toBe("42501");
    });
  });

  it("gives neither browser role USAGE on the app schema", async () => {
    await withClient(async (client) => {
      const r = await client.query(
        "SELECT has_schema_privilege('anon','app','USAGE') AS anon, has_schema_privilege('authenticated','app','USAGE') AS auth"
      );
      expect(r.rows[0]).toEqual({ anon: false, auth: false });
    });
  });

  it("keeps row level security enabled on every app table", async () => {
    await withClient(async (client) => {
      const r = await client.query(
        "SELECT count(*)::int AS total, count(*) FILTER (WHERE relrowsecurity)::int AS secured FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'"
      );
      expect(r.rows[0].total).toBeGreaterThan(0);
      expect(r.rows[0].secured).toBe(r.rows[0].total);
    });
  });

  it("installs no permissive policy, since access goes through the RPC dispatcher", async () => {
    await withClient(async (client) => {
      const r = await client.query("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='app'");
      expect(r.rows[0].n).toBe(0);
    });
  });
});
