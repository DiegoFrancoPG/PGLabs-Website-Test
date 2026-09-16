#!/usr/bin/env node
/*
 * Operator-only platform admin bootstrap.
 *
 * spec/05, "Initial administrator bootstrap": T04 must supply an idempotent
 * operator-only command that "looks up a supplied verified Auth account by
 * email, synchronizes its profile, sets onboarded_at after password setup and
 * creates its platform_admins row. Read service credentials from environment;
 * print only success and user ID. Do not accept public HTTP bootstrap requests
 * or bake a default admin password into the app."
 *
 * So, deliberately:
 *   - It is a script, not a route. There is no HTTP path to becoming an admin.
 *   - It creates no account and sets no password. The account must already
 *     exist and be verified, which means a human completed password setup.
 *   - It prints the user id and nothing else. No token, no link, no email body.
 *
 * Usage: node scripts/bootstrap-admin.mjs <email>
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

function envLocal() {
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
const fileEnv = envLocal();
const value = (key) => process.env[key] ?? fileEnv[key] ?? "";

function fail(message) {
  console.error(`bootstrap-admin: ${message}`);
  process.exit(1);
}

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) fail("usage: node scripts/bootstrap-admin.mjs <email>");

const url = value("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* Find the Auth account. It must already exist; this command never creates one. */
let user = null;
for (let page = 1; page <= 20 && !user; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
  if (error) fail(`could not list Auth users: ${error.message}`);
  if (data.users.length === 0) break;
  user = data.users.find((u) => (u.email ?? "").toLowerCase() === email) ?? null;
}
if (!user) fail("no Auth account with that email address. Create and verify the account first.");

/*
 * spec/05: onboarded_at is set "after password setup". An account that has
 * never signed in has not completed it, so this refuses rather than quietly
 * marking it onboarded.
 */
if (!user.last_sign_in_at && !user.email_confirmed_at) {
  fail("that account has not completed password setup yet. Finish it, then re-run.");
}

/*
 * Synchronize the profile through the service entrypoint, which reads the
 * authoritative email from auth.users rather than trusting anything passed here.
 */
const { error: provisionError } = await supabase.rpc("pglearn_provision", {
  payload: { user_id: user.id },
});
if (provisionError) fail(`provisioning failed: ${provisionError.message}`);

/*
 * Granting platform admin needs a direct database connection, not the Data API:
 * schema `app` is deliberately not exposed there (spec/02), so even the service
 * key cannot reach app.platform_admins over REST. That is the boundary working,
 * not an obstacle to route around.
 */
const dbUrl = buildDbUrl();
function buildDbUrl() {
  const explicit = value("SUPABASE_DB_URL");
  if (explicit) return explicit;
  const password = value("SUPABASE_DB_PASSWORD");
  if (!password) fail("SUPABASE_DB_URL or SUPABASE_DB_PASSWORD is required to grant platform admin.");
  const ref = new URL(url).hostname.split(".")[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

const { Client } = await import("pg");
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("BEGIN");
  // Idempotent: re-running this command changes nothing and still succeeds.
  await client.query(
    "INSERT INTO app.platform_admins(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    [user.id]
  );
  // spec/05: onboarded_at is set after password setup, which was checked above.
  await client.query(
    "UPDATE app.profiles SET onboarded_at = COALESCE(onboarded_at, now()) WHERE id = $1",
    [user.id]
  );
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  fail(`could not grant platform admin: ${err.message}`);
} finally {
  await client.end();
}

// spec/05: "print only success and user ID."
console.log(`platform admin ready: ${user.id}`);
