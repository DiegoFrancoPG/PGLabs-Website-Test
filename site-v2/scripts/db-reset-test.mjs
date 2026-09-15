#!/usr/bin/env node
/*
 * Resets the local/test database and reseeds fixtures.
 *
 * spec/02: "Development migrations can reset only the explicitly designated
 * local/test database. Never reset a remote pilot project as a verification
 * shortcut."
 * spec/05: "Seed scripts require explicit nonproduction target and abort if
 * app environment is pilot/production."
 *
 * Both guards run before anything is executed, and they are deliberately
 * redundant: APP_ENV must be development or test, and the Supabase target must
 * be a loopback address. A remote host is refused even if APP_ENV lies.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

const appEnv = process.env.APP_ENV ?? "development";
if (!ALLOWED_APP_ENVS.has(appEnv)) {
  refuse(`APP_ENV is "${appEnv}". This resets a database and only runs against development or test.`);
}

const target = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (target) {
  let host;
  try {
    host = new URL(target).hostname;
  } catch {
    refuse("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
  if (!LOOPBACK.test(host)) {
    refuse(`NEXT_PUBLIC_SUPABASE_URL points at "${host}", which is not a local target.`);
  }
}

if (!existsSync(path.join(root, "supabase", "config.toml"))) {
  console.error(
    "No supabase/config.toml found. The local stack and the first migration land at T02;\n" +
      "until then there is no schema to reset. Run `supabase init` and `supabase start` first."
  );
  process.exit(1);
}

const probe = spawnSync("supabase", ["--version"], { encoding: "utf8" });
if (probe.error) {
  refuse("the Supabase CLI is not on PATH. Install it, then re-run.");
}

console.log(`Resetting local database (APP_ENV=${appEnv})…`);
const reset = spawnSync("supabase", ["db", "reset", "--local"], { stdio: "inherit", cwd: root });
process.exit(reset.status ?? 1);
