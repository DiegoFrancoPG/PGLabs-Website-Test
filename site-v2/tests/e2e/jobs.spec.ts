import { test, expect } from "@playwright/test";
import { signIn } from "./session";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * AC-050 — the scheduler endpoint.
 *   "GET scheduler with user session, bad secret and correct CRON_SECRET.
 *    Only correct Bearer secret runs; job persisted; normal read routes do not
 *    mutate."
 *
 * AC-049's route half — a forged signature is refused with 401 and writes
 * nothing. The database half is in tests/integration/email-events.test.ts.
 *
 * Both secrets are set for this server in playwright.config.ts.
 */

const CRON_SECRET = "test-cron-secret-do-not-reuse";
const WEBHOOK_SECRET = "whsec_dGVzdHNlY3JldGZvcnBnbGVhcm50ZXN0cw==";
const ORIGIN = "http://127.0.0.1:3001";

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}
const config = env();

async function db<T>(fn: (client: import("pg").Client) => Promise<T>): Promise<T> {
  const { Client } = await import("pg");
  const ref = new URL(config.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const client = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(config.SUPABASE_DB_PASSWORD)}@db.${ref}.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/*
 * Everything the SCHEDULER may have written, removed — and nothing else.
 *
 * It deliberately leaves app.email_webhook_events alone: the callback tests
 * below run alongside these, and a cleanup that emptied that table would
 * delete the record one of them had just made and was about to count.
 */
async function clearOutbox() {
  await db(async (client) => {
    await client.query("DELETE FROM app.reminder_days");
    await client.query(
      "DELETE FROM app.notification_outbox WHERE kind IN ('inactivity','due_soon','due_today','overdue')"
    );
  });
}

/** A correctly signed Svix payload, as Resend would send. */
function signed(body: string, id: string, timestamp: number) {
  const secret = Buffer.from(WEBHOOK_SECRET.split("_")[1], "base64");
  const signature = createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
    "Content-Type": "application/json",
  };
}


test.describe("AC-050 the scheduler endpoint", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "shared database state; desktop only");

  // The spec runs in its own "scheduler" project (playwright.config.ts), which
  // is the only one that executes it, so the hooks run unconditionally.
  const desktopOnly = async () => {
    await clearOutbox();
  };
  test.beforeAll(desktopOnly);
  test.afterAll(desktopOnly);

  test("refuses a request with no secret at all", async ({ request }) => {
    const response = await request.get("/api/v1/jobs/reminders");
    expect(response.status()).toBe(401);
    // And nothing was written.
    const planned = await db(async (client) =>
      client.query("SELECT count(*)::int AS n FROM app.reminder_days")
    );
    expect(planned.rows[0].n).toBe(0);
  });

  test("refuses a wrong secret, and one that is merely a prefix", async ({ request }) => {
    for (const wrong of ["nonsense", CRON_SECRET.slice(0, -1), `${CRON_SECRET}x`, ""]) {
      const response = await request.get("/api/v1/jobs/reminders", {
        headers: { Authorization: `Bearer ${wrong}` },
      });
      expect(response.status()).toBe(401);
    }
  });

  test("refuses a signed-in user, however privileged", async ({ page }) => {
    // spec/05: "user sessions do not substitute".
    await signIn(page, "admin@example.invalid");
    const response = await page.request.get("/api/v1/jobs/reminders", {
      headers: { Origin: ORIGIN },
    });
    expect(response.status()).toBe(401);
  });

  test("runs with the correct secret and persists what it planned", async ({ request }) => {
    const response = await request.get("/api/v1/jobs/reminders", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    // Counts only: no address, subject or link may appear in a cron response.
    expect(body.data).toHaveProperty("planned");
    expect(body.data).toHaveProperty("claimed");
    const text = await response.text();
    expect(text).not.toContain("@example.invalid");

    // The plan is in the database, not merely in the response.
    const persisted = await db(async (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM app.notification_outbox
          WHERE kind IN ('inactivity','due_soon','due_today','overdue')`
      )
    );
    expect(persisted.rows[0].n).toBeGreaterThan(0);
  });

  test("is safe to run twice: the second run plans nothing new", async ({ request }) => {
    const before = await db(async (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM app.notification_outbox
          WHERE kind IN ('inactivity','due_soon','due_today','overdue')`
      )
    );
    const response = await request.get("/api/v1/jobs/reminders", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).data.planned).toBe(0);

    const after = await db(async (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM app.notification_outbox
          WHERE kind IN ('inactivity','due_soon','due_today','overdue')`
      )
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  test("leaves ordinary GET routes read-only", async ({ page }) => {
    await signIn(page, "amber@example.invalid");

    const before = await db(async (client) =>
      client.query("SELECT count(*)::int AS n FROM app.notification_outbox")
    );
    // Every learner-facing GET, twice.
    for (const pass of [1, 2]) {
      void pass;
      await page.request.get("/api/v1/enrollments", { headers: { Origin: ORIGIN } });
      await page.request.get("/api/v1/me", { headers: { Origin: ORIGIN } });
      await page.request.get("/api/v1/health");
    }
    const after = await db(async (client) =>
      client.query("SELECT count(*)::int AS n FROM app.notification_outbox")
    );
    // spec/05: "Normal GET routes do not mutate."
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

test.describe("AC-049 a forged callback", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "covered at desktop width");

  const body = JSON.stringify({
    type: "email.delivered",
    data: { email_id: "prov_forged" },
  });

  test("is refused with 401 and writes nothing", async ({ request }) => {
    const response = await request.post("/api/v1/webhooks/email", {
      headers: {
        "svix-id": "msg_forged",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,WRlcnNpZ25hdHVyZXRoYXRpc3dyb25n",
        "Content-Type": "application/json",
      },
      data: body,
    });
    expect(response.status()).toBe(401);

    const written = await db(async (client) =>
      client.query("SELECT count(*)::int AS n FROM app.email_webhook_events WHERE provider_event_id=$1", [
        "msg_forged",
      ])
    );
    // "reject invalid signatures with 401 before persisting".
    expect(written.rows[0].n).toBe(0);
  });

  test("is refused when the signature headers are missing entirely", async ({ request }) => {
    const response = await request.post("/api/v1/webhooks/email", {
      headers: { "Content-Type": "application/json" },
      data: body,
    });
    expect(response.status()).toBe(401);
  });

  test("is refused when the body has been altered after signing", async ({ request }) => {
    const id = `msg_${crypto.randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = signed(body, id, timestamp);

    const tampered = JSON.stringify({
      type: "email.delivered",
      data: { email_id: "somebody_elses_message" },
    });
    const response = await request.post("/api/v1/webhooks/email", { headers, data: tampered });
    expect(response.status()).toBe(401);
  });

  test("accepts a correctly signed event and records it once", async ({ request }) => {
    const id = `msg_${crypto.randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = signed(body, id, timestamp);

    const first = await request.post("/api/v1/webhooks/email", { headers, data: body });
    expect(first.status()).toBe(200);

    // The provider redelivers; the record is still one.
    const second = await request.post("/api/v1/webhooks/email", { headers, data: body });
    expect(second.status()).toBe(200);
    expect((await second.json()).data.duplicate).toBe(true);

    const written = await db(async (client) =>
      client.query(
        "SELECT count(*)::int AS n FROM app.email_webhook_events WHERE provider_event_id=$1",
        [id]
      )
    );
    expect(written.rows[0].n).toBe(1);

    await db(async (client) =>
      client.query("DELETE FROM app.email_webhook_events WHERE provider_event_id=$1", [id])
    );
  });
});

/*
 * AC-057's other half: the endpoint the nightly purge runs behind.
 *
 * The rules themselves are tested in tests/integration/retention.test.ts, where
 * rows can be given an age. What is tested here is the boundary — that the
 * scheduler's secret is the only way in — and that a real run against a real
 * database takes nothing a learner would miss.
 */
test.describe("AC-057 the retention endpoint", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "shared database state; desktop only");

  test("refuses no secret, a wrong secret, and a signed-in administrator", async ({
    request,
    page,
  }) => {
    expect((await request.get("/api/v1/jobs/retention")).status()).toBe(401);

    for (const wrong of ["nonsense", CRON_SECRET.slice(0, -1), `${CRON_SECRET}x`, ""]) {
      const response = await request.get("/api/v1/jobs/retention", {
        headers: { Authorization: `Bearer ${wrong}` },
      });
      expect(response.status()).toBe(401);
    }

    // spec/05: "user sessions do not substitute" — and retention deletes.
    await signIn(page, "admin@example.invalid");
    const asAdmin = await page.request.get("/api/v1/jobs/retention", { headers: { Origin: ORIGIN } });
    expect(asAdmin.status()).toBe(401);
  });

  test("runs with the correct secret and keeps every learner record", async ({ request }) => {
    const counts = async () =>
      (
        await db(async (client) =>
          client.query(
            `SELECT
               (SELECT count(*)::int FROM app.class_progress) AS progress,
               (SELECT count(*)::int FROM app.exercise_completions) AS exercises,
               (SELECT count(*)::int FROM app.certificates) AS certificates,
               (SELECT count(*)::int FROM app.enrollments) AS enrollments`
          )
        )
      ).rows[0];

    const before = await counts();
    const response = await request.get("/api/v1/jobs/retention", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    // The contract's JobResult, and nothing else: no table names, no ids of
    // anything deleted, nothing that identifies a person.
    expect(Object.keys(body.data).sort()).toEqual([
      "accepted",
      "claimed",
      "failed",
      "run_id",
      "suppressed",
    ]);
    expect(await response.text()).not.toContain("@example.invalid");

    // What a learner would miss is exactly what retention may not touch.
    expect(await counts()).toEqual(before);

    const recorded = await db(async (client) =>
      client.query("SELECT kind, status FROM app.job_runs WHERE id=$1", [body.data.run_id])
    );
    expect(recorded.rows[0]).toEqual({ kind: "retention", status: "completed" });
  });
});
