#!/usr/bin/env node
/*
 * AC-059 — forty learners at once.
 *
 * "Given realistic 40 synthetic learners with seeded program, exercise
 * concurrent dashboard/progress and report reads. No lost acknowledged
 * updates/isolation failures; measure p95 data operation<1s and dashboard
 * usable<3s on stated network; report failures instead of assuming pass."
 *
 * Three commitments this script makes, because a load test that flatters the
 * system is worse than none:
 *
 *   - It reports what it measured, including failures, and exits non-zero when
 *     a target is missed. It never decides that a slow run was "warm-up".
 *   - Every learner is a REAL identity with a REAL enrollment, and every call
 *     goes through public.pglearn_rpc as that learner, so row-level security is
 *     doing its work on every one of them. A load test that bypassed RLS would
 *     be measuring a system nobody uses.
 *   - "No lost acknowledged updates" is checked, not assumed: every accepted
 *     heartbeat is counted, and the coverage the database ends up holding must
 *     account for all of them.
 *
 * Usage:
 *   node scripts/load-40.mjs                 # provision, measure, clean up
 *   node scripts/load-40.mjs --keep          # leave the synthetic learners
 *   node scripts/load-40.mjs --learners 40 --rounds 12
 *
 * The network is stated in the report: this machine to the hosted Supabase
 * project over the public internet. That is a harsher network than the
 * deployed application's (same-region), so the numbers are conservative.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

/* ---------------------------------------------------------------- settings */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : Number(args[at + 1]);
};
const LEARNERS = flag("learners", 40);
const ROUNDS = flag("rounds", 10);
const KEEP = args.includes("--keep");
/*
 * --clean removes the synthetic learners and nothing else. It exists because
 * --keep leaves forty enrollments in a database whose fixture totals other
 * tests assert on (tests/integration/fixture-report.test.ts among them), and
 * "I will remember to tidy up" is not a mechanism.
 */
const CLEAN_ONLY = args.includes("--clean");
/*
 * How the calls travel.
 *
 * "pg" gives every learner a database backend of their own. That was the first
 * measurement, and its numbers said more about the measurement than the system:
 * forty direct backends on a free-tier instance is not how the application
 * connects. The deployed app speaks to PostgREST over HTTPS, which multiplexes
 * onto a small pool — so "http" is the default, and it is the one AC-059's
 * numbers come from.
 */
const TRANSPORT = args.includes("--pg") ? "pg" : "http";
const PREFIX = "load";

/** spec/05 and AC-059. Missing either of these fails the run. */
const TARGET_DATA_P95_MS = 1000;
const TARGET_DASHBOARD_MS = 3000;

/* -------------------------------------------------------------------- env */

function env() {
  const out = {};
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}
const config = { ...env(), ...process.env };
const value = (key) => config[key] ?? "";

function databaseUrl() {
  if (value("SUPABASE_DB_URL")) return value("SUPABASE_DB_URL");
  const ref = new URL(value("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0];
  return `postgresql://postgres:${encodeURIComponent(
    value("SUPABASE_DB_PASSWORD")
  )}@db.${ref}.supabase.co:5432/postgres`;
}

/*
 * The same guard as scripts/db-reset-test.mjs. This script CREATES AND DELETES
 * accounts, so it may only ever run against the designated development project
 * — spec/02: "Never reset a remote pilot project as a verification shortcut."
 */
function refuseUnlessDevelopment() {
  const appEnv = value("PGLEARN_APP_ENV") || value("APP_ENV") || "development";
  if (!["development", "test"].includes(appEnv)) {
    console.error(`load-40 refused — the app environment is ${appEnv}`);
    process.exit(1);
  }
  const designated = value("PGLEARN_DEV_PROJECT_REF");
  const ref = new URL(value("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0];
  if (!designated || designated !== ref) {
    console.error(
      "load-40 refused — the configured project is not the one named in PGLEARN_DEV_PROJECT_REF"
    );
    process.exit(1);
  }
}

/* ------------------------------------------------------------- statistics */

class Timings {
  constructor() {
    this.samples = new Map();
    this.failures = [];
  }

  async measure(operation, run) {
    const started = process.hrtime.bigint();
    try {
      const result = await run();
      this.record(operation, started);
      return result;
    } catch (error) {
      this.record(operation, started);
      // Recorded, never swallowed: AC-059 says "report failures instead of
      // assuming pass", so a failed call is part of the result.
      this.failures.push(`${operation}: ${error.code ?? ""} ${error.message}`.trim());
      return null;
    }
  }

  record(operation, started) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (!this.samples.has(operation)) this.samples.set(operation, []);
    this.samples.get(operation).push(ms);
  }

  static percentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    // Nearest-rank, which never reports a number no request actually saw.
    const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
    return sorted[rank - 1];
  }

  table() {
    const rows = [];
    for (const [operation, values] of [...this.samples.entries()].sort()) {
      rows.push({
        operation,
        calls: values.length,
        p50: Math.round(Timings.percentile(values, 50)),
        p95: Math.round(Timings.percentile(values, 95)),
        max: Math.round(Math.max(...values)),
      });
    }
    return rows;
  }

  worstP95() {
    let worst = { operation: "none", p95: 0 };
    for (const row of this.table()) if (row.p95 > worst.p95) worst = row;
    return worst;
  }
}

/* ----------------------------------------------------------- provisioning */

const admin = () =>
  createClient(value("NEXT_PUBLIC_SUPABASE_URL"), value("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

const emailFor = (index) => `${PREFIX}-${String(index).padStart(2, "0")}@example.invalid`;

/**
 * Forty identities, forty profiles, forty enrollments on the seeded programme.
 *
 * Auth first and Postgres second, never as one transaction — spec/03 is
 * explicit that they cannot be, and this is the same order the invitation
 * service uses.
 */
async function provision(pool) {
  const service = admin();
  const password = value("PGLEARN_TEST_PASSWORD");
  if (!password) throw new Error("PGLEARN_TEST_PASSWORD is not set");

  const existing = new Map();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth lookup failed: ${error.message}`);
    if (data.users.length === 0) break;
    for (const user of data.users) if (user.email) existing.set(user.email, user.id);
  }

  const learners = [];
  for (let index = 1; index <= LEARNERS; index += 1) {
    const email = emailFor(index);
    let id = existing.get(email);
    if (!id) {
      const { data, error } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw new Error(`could not create ${email}: ${error.message}`);
      id = data.user.id;
    }
    learners.push({ index, email, id });
  }

  const fixtures = JSON.parse(readFileSync(path.join(root, "tests/fixtures.json"), "utf8")).ids;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const learner of learners) {
      await client.query(
        `INSERT INTO app.profiles(id, email, display_name, onboarded_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (id) DO UPDATE SET onboarded_at = COALESCE(app.profiles.onboarded_at, now())`,
        [learner.id, learner.email, `Load Learner ${learner.index}`]
      );
      await client.query(
        `INSERT INTO app.memberships(organization_id, user_id, role, status)
         VALUES ($1, $2, 'learner', 'active') ON CONFLICT DO NOTHING`,
        [fixtures.org_a, learner.id]
      );
      await client.query(
        `INSERT INTO app.cohort_members(cohort_id, organization_id, user_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [fixtures.cohort_a, fixtures.org_a, learner.id]
      );
    }

    /*
     * One enrollment each, on the offering the fixture already publishes, so
     * every learner is reading the SAME programme — which is what forty people
     * in a cohort actually do, and the case where contention would show.
     */
    const offering = (
      await client.query(
        `SELECT id, organization_id, program_id, version_id, grant_id, starts_at, due_at, access_ends_at
           FROM app.cohort_offerings WHERE id = $1`,
        [fixtures.offering_a]
      )
    ).rows[0];

    for (const learner of learners) {
      const enrollment = await client.query(
        `INSERT INTO app.enrollments(user_id, program_id, version_id, grant_id, organization_id,
                                     offering_id, starts_at, due_at, access_ends_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
          WHERE NOT EXISTS (
            SELECT 1 FROM app.enrollments WHERE user_id = $1 AND offering_id = $6 AND status = 'active')
         RETURNING id`,
        [
          learner.id,
          offering.program_id,
          offering.version_id,
          offering.grant_id,
          offering.organization_id,
          offering.id,
          offering.starts_at,
          offering.due_at,
          offering.access_ends_at,
        ]
      );
      learner.enrollment =
        enrollment.rows[0]?.id ??
        (
          await client.query(
            "SELECT id FROM app.enrollments WHERE user_id=$1 AND offering_id=$2 AND status='active'",
            [learner.id, offering.id]
          )
        ).rows[0].id;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { learners, fixtures };
}

async function cleanUp(pool, learners) {
  const client = await pool.connect();
  try {
    const ids = learners.map((learner) => learner.id);
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM app.learning_events WHERE enrollment_id IN
         (SELECT id FROM app.enrollments WHERE user_id = ANY($1::uuid[]))`,
      [ids]
    );
    await client.query(
      `DELETE FROM app.class_progress WHERE enrollment_id IN
         (SELECT id FROM app.enrollments WHERE user_id = ANY($1::uuid[]))`,
      [ids]
    );
    await client.query(
      `DELETE FROM app.playback_sessions WHERE enrollment_id IN
         (SELECT id FROM app.enrollments WHERE user_id = ANY($1::uuid[]))`,
      [ids]
    );
    await client.query("DELETE FROM app.enrollments WHERE user_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM app.cohort_members WHERE user_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM app.memberships WHERE user_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM app.idempotency_records WHERE actor_id = ANY($1::uuid[])", [ids]);
    await client.query("DELETE FROM app.profiles WHERE id = ANY($1::uuid[])", [ids]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // The cached tokens belong to accounts that are about to stop existing.
  if (existsSync(TOKEN_CACHE)) writeTokenCache({});

  const service = admin();
  for (const learner of learners) {
    const { error } = await service.auth.admin.deleteUser(learner.id);
    if (error) console.warn(`could not delete ${learner.email}: ${error.message}`);
  }
}

/* ------------------------------------------------------------ the measure */

/*
 * A learner's access token, from the same password grant the sign-in form uses.
 *
 * Supabase Auth rate-limits sign-ins hard — around thirty in five minutes per
 * address — which is not a problem with the platform but a fact about it, and
 * one the e2e suite already had to learn (tests/e2e/session.ts caches sessions
 * for the same reason). So: paced, retried on 429, and cached on disk for the
 * hour a token lives, under tests/.auth, which is gitignored.
 */
const TOKEN_CACHE = path.join(root, "tests/.auth/load-tokens.json");

function readTokenCache() {
  if (!existsSync(TOKEN_CACHE)) return {};
  try {
    const cache = JSON.parse(readFileSync(TOKEN_CACHE, "utf8"));
    // Fifty minutes: a token lives an hour, and a run takes a few minutes.
    if (Date.now() - cache.savedAt > 50 * 60 * 1000) return {};
    return cache.tokens ?? {};
  } catch {
    return {};
  }
}

function writeTokenCache(tokens) {
  writeFileSync(TOKEN_CACHE, `${JSON.stringify({ savedAt: Date.now(), tokens }, null, 2)}\n`);
}

async function signIn(email) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(
      `${value("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          apikey: value("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password: value("PGLEARN_TEST_PASSWORD") }),
      }
    );
    if (response.ok) return (await response.json()).access_token;
    if (response.status !== 429) {
      throw new Error(`sign-in failed for ${email}: ${response.status}`);
    }
    // Throttled. Waiting is the only correct response to a rate limit.
    process.stdout.write(`  throttled at ${email}, waiting…\n`);
    await new Promise((resolve) => setTimeout(resolve, 65_000));
  }
  throw new Error(`sign-in for ${email} stayed throttled`);
}

/** The call the application makes: PostgREST, over HTTPS, as this learner. */
async function httpRpc(token, action, payload) {
  const response = await fetch(`${value("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/rpc/pglearn_rpc`, {
    method: "POST",
    headers: {
      apikey: value("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, payload: payload ?? {} }),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message ?? `rpc ${action} failed`);
    error.code = body.code;
    throw error;
  }
  return body;
}

/** One learner's connection, in their own session, for the whole run. */
async function session(pool, userId) {
  const client = await pool.connect();
  await client.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET ROLE authenticated");
  return client;
}

const rpc = async (who, action, payload) =>
  typeof who === "string"
    ? httpRpc(who, action, payload)
    : (
        await who.query("SELECT public.pglearn_rpc($1, $2::jsonb) AS out", [
          action,
          JSON.stringify(payload ?? {}),
        ])
      ).rows[0].out;

/**
 * What a learner does in a session: look at the dashboard, open the class they
 * were on, and play some of it. The reads outnumber the writes, because that is
 * what learning looks like.
 */
async function learnerRound(timings, client, learner, state) {
  /*
   * One read per round, not five.
   *
   * The first version of this fired every read back to back with no pause, for
   * all forty learners at once. That is not "realistic 40 synthetic learners"
   * — it is a forty-way burst nobody generates by learning. A person opens a
   * page, reads it, watches for a while. So each round is one thing a learner
   * does, followed by the think time doing it takes.
   */
  const reads = [
    ["get_me", {}],
    ["list_my_enrollments", {}],
    ["get_enrollment", { enrollment_id: learner.enrollment }],
    ["get_learning_class", { enrollment_id: learner.enrollment, class_id: state.classId }],
  ];
  const [action, payload] = reads[Math.floor(Math.random() * reads.length)];
  await timings.measure(action, () => rpc(client, action, payload));

  if (!state.session) {
    const started = await timings.measure("start_playback", () =>
      rpc(client, "start_playback", {
        request_id: crypto.randomUUID(),
        enrollment_id: learner.enrollment,
        class_id: state.classId,
      })
    );
    if (!started) return;
    state.session = started.session_id;
    // The first heartbeat is sequence 1; the handler refuses 0 outright.
    state.sequence = 1;
    state.position = 0;
    state.lastBeatAt = Date.now();
    return;
  }

  /*
   * A heartbeat claiming the wall-clock time since the last one, at rate 1,
   * capped at the thirty seconds a single heartbeat may ever claim — the
   * player sends one every fifteen. Claiming more is refused (PGL29), and
   * rightly: it is how a client would pretend to have watched.
   */
  const elapsed = Math.min(30_000, Math.max(1000, Date.now() - state.lastBeatAt));
  const end = state.position + elapsed;
  const accepted = await timings.measure("record_progress", () =>
    rpc(client, "record_progress", {
      request_id: crypto.randomUUID(),
      enrollment_id: learner.enrollment,
      class_id: state.classId,
      event_id: crypto.randomUUID(),
      session_id: state.session,
      sequence: state.sequence,
      position_ms: end,
      elapsed_ms: elapsed,
      rate: 1,
      interval: { start_ms: state.position, end_ms: end },
    })
  );
  state.lastBeatAt = Date.now();
  if (accepted?.accepted) {
    state.sequence += 1;
    state.position = end;
    // What the learner believes was saved. Checked against the database later.
    state.acknowledgedCoverage = accepted.progress?.coverage_ms ?? state.acknowledgedCoverage;
    state.acknowledged += 1;
  }
}

/** The pause a person takes between doing one thing and the next. */
const think = () =>
  new Promise((resolve) => setTimeout(resolve, 1500 + Math.floor(Math.random() * 2500)));

/** A manager reading reports while forty people are learning. */
async function managerRound(timings, client, fixtures) {
  await timings.measure("report_enrollments", () =>
    rpc(client, "report_enrollments", { offering_id: fixtures.offering_a, limit: 50 })
  );
  await timings.measure("list_cohort_members", () =>
    rpc(client, "list_cohort_members", { cohort_id: fixtures.cohort_a, limit: 50 })
  );
}

/**
 * The dashboard, over HTTP, in a real session.
 *
 * It reuses a session cached by the e2e suite (tests/.auth). If there is none,
 * the dashboard is reported as NOT MEASURED — never as passing. A number that
 * was not taken is not a number.
 */
async function measureDashboard() {
  const file = path.join(root, "tests/.auth/amber_example_invalid.json");
  const base = value("PGLEARN_BASE_URL") || "http://127.0.0.1:3001";
  if (!existsSync(file)) return { measured: false, reason: "no cached session in tests/.auth" };

  const cookies = JSON.parse(readFileSync(file, "utf8")).cookies ?? [];
  const header = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  if (!header) return { measured: false, reason: "cached session has no cookies" };

  const samples = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = Date.now();
    try {
      const response = await fetch(`${base}/learn`, { headers: { cookie: header } });
      const body = await response.text();
      const ms = Date.now() - started;
      if (response.status !== 200 || body.includes("Sign in")) {
        return { measured: false, reason: `dashboard answered ${response.status} or signed out` };
      }
      samples.push(ms);
      // Kept out of the operation table: it is a page, not a data operation,
      // and it has a target of its own.
    } catch (error) {
      return { measured: false, reason: `no server at ${base}: ${error.message}` };
    }
  }
  return { measured: true, p95: Math.round(Timings.percentile(samples, 95)), samples };
}

/* -------------------------------------------------------------------- run */

async function main() {
  refuseUnlessDevelopment();

  if (CLEAN_ONLY) {
    const pool = new pg.Pool({
      connectionString: databaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 4,
    });
    const service = admin();
    const learners = [];
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`auth lookup failed: ${error.message}`);
      if (data.users.length === 0) break;
      for (const user of data.users) {
        if (user.email?.startsWith(`${PREFIX}-`)) learners.push({ id: user.id, email: user.email });
      }
    }
    console.log(`cleaning up ${learners.length} synthetic learners…`);
    if (learners.length > 0) await cleanUp(pool, learners);
    await pool.end();
    return;
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl(),
    ssl: { rejectUnauthorized: false },
    max: TRANSPORT === "pg" ? LEARNERS + 4 : 8,
  });

  console.log(`provisioning ${LEARNERS} synthetic learners…`);
  const { learners, fixtures } = await provision(pool);

  const timings = new Timings();
  const clients = [];
  let dashboard = { measured: false, reason: "not attempted" };

  try {
    let manager;
    if (TRANSPORT === "http") {
      const cached = readTokenCache();
      const tokens = { ...cached };
      for (const learner of learners) {
        if (!tokens[learner.email]) {
          tokens[learner.email] = await signIn(learner.email);
          // Paced: forty password grants in a burst is a throttle, not a test.
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        clients.push(tokens[learner.email]);
      }
      if (!tokens["manager_a@example.invalid"]) {
        tokens["manager_a@example.invalid"] = await signIn("manager_a@example.invalid");
      }
      manager = tokens["manager_a@example.invalid"];
      writeTokenCache(tokens);
    } else {
      for (const learner of learners) clients.push(await session(pool, learner.id));
      manager = await session(pool, fixtures.manager_a);
    }

    const firstClass = (
      await pool.query(
        "SELECT id FROM app.classes WHERE version_id=$1 AND kind<>'text' ORDER BY position LIMIT 1",
        [fixtures.version_shared]
      )
    ).rows[0].id;

    const states = learners.map(() => ({
      classId: firstClass,
      session: null,
      sequence: 1,
      position: 0,
      acknowledged: 0,
      acknowledgedCoverage: 0,
      lastBeatAt: Date.now(),
    }));

    /*
     * A baseline first: the same operations, one learner, nothing else
     * running. Without it a slow p95 cannot be attributed — the link from this
     * machine to a hosted database, the free-tier instance, and genuine
     * contention under forty learners all look identical in a single number.
     */
    console.log("baseline: one learner, no concurrency…");
    const baseline = new Timings();
    for (let round = 0; round < 10; round += 1) {
      await baseline.measure("get_me", () => rpc(clients[0], "get_me", {}));
      await baseline.measure("list_my_enrollments", () =>
        rpc(clients[0], "list_my_enrollments", {})
      );
      await baseline.measure("get_enrollment", () =>
        rpc(clients[0], "get_enrollment", { enrollment_id: learners[0].enrollment })
      );
      await baseline.measure("report_enrollments", () =>
        rpc(manager, "report_enrollments", { offering_id: fixtures.offering_a, limit: 50 })
      );
    }
    console.table(baseline.table());

    console.log(`running ${ROUNDS} rounds, ${LEARNERS} learners concurrently…`);
    const startedAt = Date.now();
    for (let round = 0; round < ROUNDS; round += 1) {
      await Promise.all([
        ...learners.map(async (learner, index) => {
          // Learners are not in lockstep: each starts its round somewhere
          // inside the first second, as forty people would.
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000));
          await learnerRound(timings, clients[index], learner, states[index]);
          await think();
        }),
        managerRound(timings, manager, fixtures),
        // The dashboard is measured DURING the load, not after it.
        round === Math.floor(ROUNDS / 2)
          ? measureDashboard().then((result) => {
              dashboard = result;
            })
          : Promise.resolve(),
      ]);
    }
    const elapsed = (Date.now() - startedAt) / 1000;
    if (TRANSPORT === "pg") manager.release(true);

    /*
     * "No lost acknowledged updates." Every heartbeat the server said it
     * accepted has to be in the coverage it now holds — asked of the database
     * directly, as a third party to both sides of the conversation.
     */
    const lost = [];
    for (const [index, learner] of learners.entries()) {
      const state = states[index];
      if (state.acknowledged === 0) continue;
      /*
       * Coverage is not a column: it is the measure of the played_ranges
       * multirange, summed the same way app.progress_json does. Asking the
       * database to add it up is the point — it is the third party to what the
       * server acknowledged and what the learner was told.
       */
      const stored = await pool.query(
        `SELECT COALESCE(sum(upper(x) - lower(x)), 0)::bigint AS coverage_ms
           FROM app.class_progress cp, unnest(cp.played_ranges) AS x
          WHERE cp.enrollment_id = $1 AND cp.class_id = $2`,
        [learner.enrollment, state.classId]
      );
      const held = Number(stored.rows[0]?.coverage_ms ?? 0);
      if (held < state.acknowledgedCoverage) {
        lost.push(`${learner.email}: acknowledged ${state.acknowledgedCoverage}ms, holds ${held}ms`);
      }
    }

    report(timings, dashboard, { learners: LEARNERS, rounds: ROUNDS, elapsed, lost }, baseline);
  } finally {
    /*
     * Each of these connections is inside a learner's identity — a role and a
     * JWT claim set for the session, not the transaction. Returning one to the
     * pool as it stands would hand somebody else's identity to the next
     * caller, so it is destroyed rather than reused.
     */
    if (TRANSPORT === "pg") for (const client of clients) client.release(true);
    if (!KEEP) {
      console.log("cleaning up…");
      await cleanUp(pool, learners);
    } else {
      console.log("--keep: the synthetic learners were left in place");
    }
    await pool.end();
  }
}

function report(timings, dashboard, run, baseline) {
  const rows = timings.table();
  const worst = timings.worstP95();
  const calls = rows.reduce((total, row) => total + row.calls, 0);

  console.log("");
  console.log(
    `transport ${TRANSPORT}   learners ${run.learners}   rounds ${run.rounds}   calls ${calls}   wall ${run.elapsed.toFixed(1)}s`
  );
  console.table(rows);
  console.log("baseline (one learner, no concurrency):");
  console.table(baseline.table());
  console.log(
    dashboard.measured
      ? `dashboard (HTML, signed in, during load): p95 ${dashboard.p95}ms`
      : `dashboard: NOT MEASURED — ${dashboard.reason}`
  );

  const problems = [];
  if (worst.p95 > TARGET_DATA_P95_MS) {
    problems.push(`p95 ${worst.p95}ms on ${worst.operation} exceeds ${TARGET_DATA_P95_MS}ms`);
  }
  if (dashboard.measured && dashboard.p95 > TARGET_DASHBOARD_MS) {
    problems.push(`dashboard p95 ${dashboard.p95}ms exceeds ${TARGET_DASHBOARD_MS}ms`);
  }
  if (!dashboard.measured) problems.push(`dashboard not measured (${dashboard.reason})`);
  if (timings.failures.length > 0) {
    problems.push(`${timings.failures.length} failed calls`);
    for (const failure of new Set(timings.failures)) console.log(`  failure: ${failure}`);
  }
  for (const loss of run.lost) problems.push(`lost acknowledged update — ${loss}`);

  const summary = {
    measuredAt: new Date().toISOString(),
    transport: TRANSPORT,
    baseline: baseline.table(),
    learners: run.learners,
    rounds: run.rounds,
    calls,
    wallSeconds: Number(run.elapsed.toFixed(1)),
    operations: rows,
    dashboard,
    failures: timings.failures,
    lostUpdates: run.lost,
    problems,
  };
  writeFileSync(
    path.join(root, "tests/evaluation/load-40.json"),
    `${JSON.stringify(summary, null, 2)}\n`
  );

  if (problems.length > 0) {
    console.log("");
    console.log("FAIL");
    for (const problem of problems) console.log(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("");
  console.log("PASS — every data operation inside 1s at p95, no lost acknowledged updates");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
