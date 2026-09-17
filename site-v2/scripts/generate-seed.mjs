#!/usr/bin/env node
/*
 * Generates supabase/seed.sql from tests/fixtures.json.
 *
 * spec/02 M05: "Test/demo fixtures via explicit seed command; no real
 * staff/passwords in source." Evidence required: "Deterministic totals and
 * repeatable fixture seed."
 *
 * The seed is GENERATED rather than hand-written so it cannot drift from the
 * fixture contract, the same way M01 is generated from contracts/schema.sql.
 * tests/unit/seed-fidelity.test.ts fails if the checked-in file is stale.
 *
 * Passwords are deliberately absent. fixtures.json says "Do not commit
 * passwords. Seed runner creates local test passwords via env and prints only
 * account aliases". Auth users here carry an id and an email only; real
 * credentials arrive with the Auth admin API at T05.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const fx = JSON.parse(readFileSync(path.join(root, "tests/fixtures.json"), "utf8"));
const id = (alias) => {
  const value = fx.ids[alias];
  if (!value) throw new Error(`fixtures.json has no id for "${alias}"`);
  return value;
};
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/*
 * Grant window. fixtures.json fixes the offering dates but not the grant's, and
 * M02 rejects an offering whose access outlives its grant — so the window is
 * chosen here to contain the offering, and stated rather than left implicit.
 */
const GRANT_STARTS = "2026-08-01T00:00:00Z";
const GRANT_ENDS = "2026-12-31T00:00:00Z";

const out = [];
const w = (...lines) => out.push(...lines);

w(
  "-- GENERATED FILE — do not edit.",
  "-- Produced by scripts/generate-seed.mjs from tests/fixtures.json.",
  "-- Regenerate with: npm run db:seed:generate",
  "--",
  `-- Fixture version ${fx.version}; frozen clock ${fx.now}.`,
  "-- Loaded automatically by `supabase db reset`, which npm run db:reset:test",
  "-- guards so it can only ever target a designated development database.",
  "--",
  "-- Contains no passwords and no real people: every address is @example.invalid,",
  "-- a reserved TLD that cannot receive mail. Auth accounts are created",
  "-- separately by scripts/seed-auth-users.mjs before this runs.",
  "",
  "BEGIN;",
  ""
);

w(
  "-- Auth identities are NOT created here.",
  "--",
  "-- They are created through the Auth admin API by scripts/seed-auth-users.mjs,",
  "-- which npm run db:reset:test runs before this file. Hand-writing auth.users",
  "-- rows meant reproducing GoTrue's internal expectations — instance_id, aud,",
  "-- role, and several token columns it scans into non-nullable strings — and",
  "-- getting any of them wrong produced rows that existed in the table but were",
  "-- invisible or unusable to Auth. spec/02 keeps the Auth schema untouched;",
  "-- Auth owns those rows, this file owns app.*."
);
w("");

w("-- Profiles. Dana is the only learner left un-onboarded, so the report can");
w("-- show an invited person counted as assigned while still at 0%.");
for (const p of fx.profiles) {
  const onboarded = p.onboarded ? q(fx.now) : "NULL";
  w(
    `INSERT INTO app.profiles(id, email, display_name, timezone, onboarded_at)`,
    `  VALUES (${q(p.id)}, ${q(p.email)}, ${q(p.display_name)}, ${q(p.timezone)}, ${onboarded});`
  );
}
w("");

w(`INSERT INTO app.platform_admins(user_id) VALUES (${q(id("admin"))});`, "");

for (const o of fx.organizations) {
  w(
    `INSERT INTO app.organizations(id, name, timezone)`,
    `  VALUES (${q(id(o.alias))}, ${q(o.name)}, ${q(o.timezone)});`
  );
}
w("");

for (const m of fx.memberships) {
  w(
    `INSERT INTO app.memberships(organization_id, user_id, role, status)`,
    `  VALUES (${q(id(m.organization))}, ${q(id(m.user))}, ${q(m.role)}, ${q(m.status)});`
  );
}
w("");

w(
  `INSERT INTO app.cohorts(id, organization_id, name) VALUES`,
  `  (${q(id("cohort_a"))}, ${q(id("org_a"))}, 'Cohort A'),`,
  `  (${q(id("cohort_b"))}, ${q(id("org_b"))}, 'Cohort B');`,
  ""
);

const cohortA = ["amber", "ben", "cora", "dana"];
for (const alias of cohortA) {
  w(
    `INSERT INTO app.cohort_members(cohort_id, organization_id, user_id)`,
    `  VALUES (${q(id("cohort_a"))}, ${q(id("org_a"))}, ${q(id(alias))});`
  );
}
w(
  `INSERT INTO app.cohort_members(cohort_id, organization_id, user_id)`,
  `  VALUES (${q(id("cohort_b"))}, ${q(id("org_b"))}, ${q(id("multi"))});`,
  ""
);

w(
  `INSERT INTO app.programs(id, title) VALUES`,
  `  (${q(id("program_shared"))}, 'AI Foundations'),`,
  `  (${q(id("program_b_only"))}, 'Organization B Only');`,
  "",
  `INSERT INTO app.program_versions(id, program_id, version_number, title) VALUES`,
  `  (${q(id("version_shared"))}, ${q(id("program_shared"))}, 1, 'AI Foundations v1'),`,
  `  (${q(id("version_b_only"))}, ${q(id("program_b_only"))}, 1, 'Organization B Only v1');`,
  "",
  `INSERT INTO app.modules(id, version_id, title, position)`,
  `  VALUES (${q(id("module_shared"))}, ${q(id("version_shared"))}, 'Module 1', 0);`,
  ""
);

w("-- Three classes, all required, so a learner's percentage is thirds.");
fx.content.classes.forEach((c, i) => {
  const duration = c.duration_ms ?? "NULL";
  w(
    `INSERT INTO app.classes(id, module_id, version_id, title, position, kind, required, body_md, source_text, duration_ms)`,
    `  VALUES (${q(id(c.alias))}, ${q(id("module_shared"))}, ${q(id("version_shared"))},`,
    `          ${q(c.alias.replace("class_", "Class: "))}, ${i}, ${q(c.kind)}, ${c.required ? "true" : "false"},`,
    `          ${q(c.body_md ?? "")}, ${q(c.source)}, ${duration});`
  );
  if (c.exercise) {
    w(
      `INSERT INTO app.exercises(id, class_id, instructions_md)`,
      `  VALUES (${q(id(c.exercise))}, ${q(id(c.alias))}, ${q(c.exercise_instructions)});`
    );
  }
});
w("");

w("-- Retrieval chunks. spec/05 creates these during publication, which is why");
w("-- M02 leaves content_chunks insertable on a published version.");
fx.content.classes.forEach((c) => {
  const chunk = `source_${c.alias.replace("class_", "")}`;
  w(
    `INSERT INTO app.content_chunks(id, class_id, version_id, ordinal, text_content)`,
    `  VALUES (${q(id(chunk))}, ${q(id(c.alias))}, ${q(id("version_shared"))}, 0, ${q(c.source)});`
  );
});
w("");

w("-- Publication. Written directly, so it does NOT exercise T10's content");
w("-- validation: these classes carry no media assets. See HANDOFF.");
w(
  `UPDATE app.program_versions SET state = 'published', published_at = ${q(fx.now)}`,
  `  WHERE id IN (${q(id("version_shared"))}, ${q(id("version_b_only"))});`,
  ""
);

w(
  `-- Grant window ${GRANT_STARTS} .. ${GRANT_ENDS}, chosen to contain the offering.`,
  `INSERT INTO app.program_grants(id, program_id, organization_id, starts_at, ends_at) VALUES`,
  `  (${q(id("grant_a"))}, ${q(id("program_shared"))}, ${q(id("org_a"))}, ${q(GRANT_STARTS)}, ${q(GRANT_ENDS)}),`,
  `  (${q(id("grant_b"))}, ${q(id("program_b_only"))}, ${q(id("org_b"))}, ${q(GRANT_STARTS)}, ${q(GRANT_ENDS)});`,
  "",
  `-- Personal grant: subject is the learner, never an organization.`,
  `INSERT INTO app.program_grants(id, program_id, user_id, starts_at, ends_at)`,
  `  VALUES (${q(id("grant_personal"))}, ${q(id("program_shared"))}, ${q(id("personal"))}, ${q(GRANT_STARTS)}, ${q(GRANT_ENDS)});`,
  ""
);

const off = fx.offering_a;
w(
  `INSERT INTO app.cohort_offerings(id, cohort_id, organization_id, program_id, version_id, grant_id, starts_at, due_at, access_ends_at)`,
  `  VALUES (${q(id("offering_a"))}, ${q(id("cohort_a"))}, ${q(id("org_a"))}, ${q(id("program_shared"))},`,
  `          ${q(id("version_shared"))}, ${q(id("grant_a"))}, ${q(off.starts_at)}, ${q(off.due_at)}, ${q(off.access_ends_at)});`,
  `INSERT INTO app.cohort_offerings(id, cohort_id, organization_id, program_id, version_id, grant_id, starts_at, due_at, access_ends_at)`,
  `  VALUES (${q(id("offering_b"))}, ${q(id("cohort_b"))}, ${q(id("org_b"))}, ${q(id("program_b_only"))},`,
  `          ${q(id("version_b_only"))}, ${q(id("grant_b"))}, ${q(off.starts_at)}, ${q(off.due_at)}, ${q(off.access_ends_at)});`,
  ""
);

/*
 * Enrollment state per learner, derived from fixtures.progress so the report
 * numbers follow from the data rather than being asserted alongside it.
 */
const required = fx.content.classes.filter((c) => c.required).map((c) => c.alias);
const STARTED = "2026-09-08T09:00:00Z";

w("-- Enrollments. started_at/completed_at follow directly from progress.");
for (const alias of off.users) {
  const p = fx.progress[alias];
  const done = p.completed_classes ?? [];
  const started = done.length > 0 ? q(STARTED) : "NULL";
  const completed = done.length === required.length ? q(p.completed_at) : "NULL";
  const lastActivity = p.completed_at ? q(p.completed_at) : p.last_activity_at ? q(p.last_activity_at) : "NULL";
  w(
    `INSERT INTO app.enrollments(id, user_id, program_id, version_id, grant_id, organization_id, offering_id,`,
    `                            starts_at, due_at, access_ends_at, started_at, last_activity_at, completed_at)`,
    `  VALUES (${q(id(`enroll_${alias}`))}, ${q(id(alias))}, ${q(id("program_shared"))}, ${q(id("version_shared"))},`,
    `          ${q(id("grant_a"))}, ${q(id("org_a"))}, ${q(id("offering_a"))},`,
    `          ${q(off.starts_at)}, ${q(off.due_at)}, ${q(off.access_ends_at)}, ${started}, ${lastActivity}, ${completed});`
  );
}
w("");

w("-- Personal enrollment: no organization, no offering (additional_contexts).");
w(
  `INSERT INTO app.enrollments(id, user_id, program_id, version_id, grant_id, starts_at, due_at, access_ends_at)`,
  `  VALUES (${q(id("enroll_personal"))}, ${q(id("personal"))}, ${q(id("program_shared"))}, ${q(id("version_shared"))},`,
  `          ${q(id("grant_personal"))}, ${q(off.starts_at)}, ${q(off.due_at)}, ${q(off.access_ends_at)});`,
  "",
  `-- multi sits in organization B's offering, deliberately outside offering_a's report.`,
  `INSERT INTO app.enrollments(id, user_id, program_id, version_id, grant_id, organization_id, offering_id,`,
  `                            starts_at, due_at, access_ends_at)`,
  `  VALUES (${q(id("enroll_multi_b"))}, ${q(id("multi"))}, ${q(id("program_b_only"))}, ${q(id("version_b_only"))},`,
  `          ${q(id("grant_b"))}, ${q(id("org_b"))}, ${q(id("offering_b"))},`,
  `          ${q(off.starts_at)}, ${q(off.due_at)}, ${q(off.access_ends_at)});`,
  ""
);

w("-- Class progress. A completed media class is fully covered, well past the");
w("-- 90% of unique timeline ADR-09 requires.");
for (const alias of off.users) {
  const p = fx.progress[alias];
  for (const classAlias of p.completed_classes ?? []) {
    const cls = fx.content.classes.find((c) => c.alias === classAlias);
    const at = p.completed_at ?? p.last_activity_at ?? fx.now;
    const ranges = cls.duration_ms ? `'{[0,${cls.duration_ms})}'::int8multirange` : `'{}'::int8multirange`;
    const position = cls.duration_ms ?? 0;
    w(
      `INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges, position_ms, content_completed_at, completed_at, updated_at)`,
      `  VALUES (${q(id(`enroll_${alias}`))}, ${q(id(classAlias))}, ${q(id("version_shared"))}, ${ranges}, ${position}, ${q(at)}, ${q(at)}, ${q(at)});`
    );
  }
  if (p.exercise_response) {
    const exerciseClass = fx.content.classes.find((c) => c.exercise);
    w(
      `INSERT INTO app.exercise_completions(enrollment_id, exercise_id, response, confirmed_at)`,
      `  VALUES (${q(id(`enroll_${alias}`))}, ${q(id(exerciseClass.exercise))}, ${q(p.exercise_response)}, ${q(p.completed_at)});`
    );
  }
}
w("");

const cora = fx.progress.cora;
w(
  "-- Certificate for the one learner who finished every required class.",
  `INSERT INTO app.certificates(id, enrollment_id, learner_name, program_title, version_number, issuer, completed_at, issued_at)`,
  `  VALUES (${q(id("certificate_cora"))}, ${q(id("enroll_cora"))}, 'Cora', 'AI Foundations', 1, 'PGLearn', ${q(cora.completed_at)}, ${q(cora.completed_at)});`,
  "",
  "COMMIT;",
  ""
);

writeFileSync(path.join(root, "supabase/seed.sql"), out.join("\n"));
console.log(`Wrote supabase/seed.sql (${out.length} lines) from fixtures.json ${fx.version}`);
