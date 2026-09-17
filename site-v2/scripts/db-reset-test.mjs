#!/usr/bin/env node
/*
 * Resets the development database and reapplies migrations.
 *
 * spec/02: "Development migrations can reset only the explicitly designated
 * local/test database. Never reset a remote pilot project as a verification
 * shortcut."
 * spec/05: "Seed scripts require explicit nonproduction target and abort if
 * app environment is pilot/production."
 *
 * A loopback target needs no ceremony. A REMOTE target is permitted only when
 * it is named, by project ref, in PGLEARN_DEV_PROJECT_REF — the "explicitly
 * designated" database in spec/02's wording. Nothing else is accepted, and a
 * mismatch between the designated ref and the configured project is refused
 * rather than resolved in either direction.
 *
 * See HANDOFF.md, "Remote development database", for why a remote target is
 * permitted at all and what was accepted in exchange.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const ALLOWED_APP_ENVS = new Set(["development", "test"]);
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)$/;

function refuse(reason) {
  console.error(`db:reset:test refused — ${reason}`);
  process.exit(1);
}

/** Reads .env.local without printing any value. */
function readEnvLocal() {
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}

const fileEnv = readEnvLocal();
const value = (key) => process.env[key] ?? fileEnv[key] ?? "";

const appEnv = value("APP_ENV") || "development";
if (!ALLOWED_APP_ENVS.has(appEnv)) {
  refuse(`APP_ENV is "${appEnv}". This resets a database and only runs against development or test.`);
}

const projectUrl = value("NEXT_PUBLIC_SUPABASE_URL");
if (!projectUrl) refuse("NEXT_PUBLIC_SUPABASE_URL is not set.");

let host;
try {
  host = new URL(projectUrl).hostname;
} catch {
  refuse("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
}

const isLocal = LOOPBACK.test(host);
const configuredRef = host.endsWith(".supabase.co") ? host.split(".")[0] : null;

if (!isLocal) {
  const designated = value("PGLEARN_DEV_PROJECT_REF");
  if (!designated) {
    refuse(
      `target "${host}" is remote and no PGLEARN_DEV_PROJECT_REF is designated.\n` +
        "  Set it in .env.local to the ref of a project whose contents you are willing to destroy."
    );
  }
  if (designated !== configuredRef) {
    refuse(
      `designated dev project is "${designated}" but NEXT_PUBLIC_SUPABASE_URL points at "${configuredRef}".\n` +
        "  Refusing rather than guessing which one you meant."
    );
  }
}

const dbUrl = buildDbUrl();
function buildDbUrl() {
  const explicit = value("SUPABASE_DB_URL");
  if (explicit) return explicit;
  const password = value("SUPABASE_DB_PASSWORD");
  if (!password) refuse("neither SUPABASE_DB_URL nor SUPABASE_DB_PASSWORD is set.");
  if (isLocal) return "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${configuredRef}.supabase.co:5432/postgres`;
}

if (!existsSync(path.join(root, "supabase", "config.toml"))) {
  refuse("no supabase/config.toml found. Run `supabase init` first.");
}
if (spawnSync("supabase", ["--version"], { encoding: "utf8" }).error) {
  refuse("the Supabase CLI is not on PATH. Install it, then re-run.");
}

const label = isLocal ? "local" : `REMOTE project ${configuredRef}`;
console.log(`Resetting ${label} (APP_ENV=${appEnv}) — this destroys all data in it.`);

/*
 * Three phases, in this order for a reason.
 *
 *   1. Migrations only. --no-seed, because supabase/seed.sql references
 *      auth.users through app.profiles' foreign key, and those rows do not
 *      exist yet.
 *   2. Auth accounts, through the Auth admin API. Auth owns auth.users; writing
 *      those rows by hand meant reproducing GoTrue's internal expectations and
 *      produced accounts that were invisible to it.
 *   3. Application fixtures, which can now satisfy the foreign key.
 *
 * --yes suppresses the CLI's own confirmation prompt, which an npm script
 * cannot answer. The protection is this file's two deliberate opt-ins instead:
 * APP_ENV must be development or test, and a remote target must be named by ref
 * in PGLEARN_DEV_PROJECT_REF.
 */
const reset = spawnSync("supabase", ["db", "reset", "--db-url", dbUrl, "--yes", "--no-seed"], {
  stdio: "inherit",
  cwd: root,
});
if (reset.status !== 0) process.exit(reset.status ?? 1);

const authSeed = spawnSync("node", [path.join(here, "seed-auth-users.mjs")], {
  stdio: "inherit",
  cwd: root,
});
if (authSeed.status !== 0) process.exit(authSeed.status ?? 1);

const { Client } = await import("pg");
const client = new Client({ connectionString: dbUrl, ssl: isLocal ? undefined : { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(readFileSync(path.join(root, "supabase/seed.sql"), "utf8"));
  console.log("Seeded application fixtures from supabase/seed.sql.");
} catch (err) {
  console.error(`seeding failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
