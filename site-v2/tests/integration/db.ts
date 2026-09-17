import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

/*
 * Connection helper for the database suites.
 *
 * Reads .env.local directly rather than through lib/env, because the database
 * URL is a development-only concern that the application itself never uses —
 * the app talks to Supabase through the RPC dispatcher, never raw SQL.
 *
 * When no development database is configured the suites SKIP rather than pass.
 * AGENTS.md: "Record unavailable-provider checks as blocked, not passed."
 */

const root = path.join(__dirname, "../..");

function envLocal(): Record<string, string> {
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}

const fileEnv = envLocal();
const value = (key: string) => process.env[key] ?? fileEnv[key] ?? "";

export function databaseUrl(): string | null {
  const explicit = value("SUPABASE_DB_URL");
  if (explicit) return explicit;
  const password = value("SUPABASE_DB_PASSWORD");
  const projectUrl = value("NEXT_PUBLIC_SUPABASE_URL");
  if (!password || !projectUrl) return null;
  try {
    const host = new URL(projectUrl).hostname;
    const ref = host.split(".")[0];
    return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
  } catch {
    return null;
  }
}

export const hasDatabase = databaseUrl() !== null;

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: databaseUrl()!, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Runs fn inside a transaction that is always rolled back. */
export async function inRollback<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      return await fn(client);
    } finally {
      await client.query("ROLLBACK");
    }
  });
}

/** Returns the SQLSTATE a statement raises, or null if it unexpectedly succeeds. */
export async function sqlStateOf(client: Client, statement: string): Promise<string | null> {
  await client.query("SAVEPOINT probe");
  try {
    await client.query(statement);
    await client.query("RELEASE SAVEPOINT probe");
    return null;
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT probe");
    return (err as { code?: string }).code ?? "unknown";
  }
}

export const publicEnv = {
  projectUrl: value("NEXT_PUBLIC_SUPABASE_URL"),
  publishableKey: value("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  serviceRoleKey: value("SUPABASE_SERVICE_ROLE_KEY"),
};
