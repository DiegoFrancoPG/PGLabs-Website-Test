#!/usr/bin/env node
/*
 * Creates the fixture Auth accounts, with their fixture ids and a local test
 * password, through the Auth admin API.
 *
 * Auth owns auth.users. Writing those rows by hand meant reproducing GoTrue's
 * internal expectations, and getting any of them wrong produced rows that
 * existed in the table but were invisible or unusable to Auth. Creating them
 * through the API is the boundary spec/02 describes, where the Auth schema
 * stays untouched and app.profiles merely references it.
 *
 * fixtures.json: "Do not commit passwords. Seed runner creates local test
 * passwords via env and prints only account aliases." So the password comes
 * from PGLEARN_TEST_PASSWORD and this prints aliases only.
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

function refuse(reason) {
  console.error(`seed:auth:users refused — ${reason}`);
  process.exit(1);
}

const appEnv = value("APP_ENV") || "development";
if (!["development", "test"].includes(appEnv)) {
  refuse(`APP_ENV is "${appEnv}". This writes credentials and only runs against development or test.`);
}

const url = value("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) refuse("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const host = new URL(url).hostname;
if (!/^(127\.0\.0\.1|localhost|\[::1\])$/.test(host)) {
  const designated = value("PGLEARN_DEV_PROJECT_REF");
  const configured = host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  if (!designated || designated !== configured) {
    refuse("this is a remote project and PGLEARN_DEV_PROJECT_REF does not designate it.");
  }
}

const password = value("PGLEARN_TEST_PASSWORD");
if (!password) {
  refuse(
    "PGLEARN_TEST_PASSWORD is not set. Choose a local test password and put it in .env.local;\n" +
      "  it must never be committed and must never be used for a real account."
  );
}
if ([...password].length < 12) {
  refuse("PGLEARN_TEST_PASSWORD must be at least 12 characters, matching the rule the app enforces.");
}

const fixtures = JSON.parse(readFileSync(path.join(root, "tests/fixtures.json"), "utf8"));
const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const created = [];
const updated = [];
for (const profile of fixtures.profiles) {
  const { error } = await supabase.auth.admin.createUser({
    id: profile.id,
    email: profile.email,
    password,
    // Confirmed outright: these accounts never receive mail, and an
    // unconfirmed account cannot sign in.
    email_confirm: true,
  });

  if (!error) {
    created.push(profile.alias);
    continue;
  }

  // Idempotent: an existing account has its password reset instead.
  const { error: updateError } = await supabase.auth.admin.updateUserById(profile.id, {
    password,
    email_confirm: true,
  });
  if (updateError) {
    console.error(`  ${profile.alias}: ${updateError.message}`);
    continue;
  }
  updated.push(profile.alias);
}

if (created.length === 0 && updated.length === 0) refuse("no fixture account could be created.");

// Aliases only, as fixtures.json requires. No address, no id, no password.
if (created.length) console.log(`auth accounts created: ${created.join(", ")}`);
if (updated.length) console.log(`auth accounts updated: ${updated.join(", ")}`);
