import { test, expect } from "@playwright/test";
import { signIn } from "./session";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * AC-067 — the tutor drawer.
 *
 * "Class tutor drawer and injected success/unsupported/failure responses. Send
 * question and observe pending, completed and failed requests. Pending
 * indicator shown; source links validated; example labeled; input retained on
 * failure; navigation/progress unaffected."
 *
 * The injected responses come from lib/tutor/stub.ts, enabled for this server
 * by PGLEARN_USE_FIXTURES in playwright.config.ts. The stub chooses its answer
 * from the question, so one signed-in session exercises all three outcomes.
 */

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
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const { enroll_ben: ENROLL_BEN, class_video: CLASS_VIDEO, ben: BEN } = fixtures.ids;

const ORIGIN = "http://127.0.0.1:3001";

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

/** Ben's conversation and quota back to nothing, so the spec can repeat. */
async function resetTutor() {
  await db(async (client) => {
    await client.query(
      `DELETE FROM app.tutor_requests WHERE session_id IN
         (SELECT s.id FROM app.tutor_sessions s
            JOIN app.enrollments e ON e.id = s.enrollment_id WHERE e.user_id = $1)`,
      [BEN]
    );
    await client.query(
      `DELETE FROM app.tutor_sessions WHERE enrollment_id IN
         (SELECT id FROM app.enrollments WHERE user_id = $1)`,
      [BEN]
    );
    await client.query("DELETE FROM app.tutor_usage WHERE user_id = $1", [BEN]);
    await client.query("DELETE FROM app.rate_windows WHERE key = $1", [BEN]);
  });
}


const CLASS_URL = `/learn/${ENROLL_BEN}/classes/${CLASS_VIDEO}`;

test.describe("AC-067 the tutor drawer", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "shared database state; desktop only");

  const desktopOnly = async ({}, info: import("@playwright/test").TestInfo) => {
    if (info.project.name === "desktop-1440") await resetTutor();
  };
  test.beforeAll(desktopOnly);
  test.afterAll(desktopOnly);

  /*
   * Each test asks at least one question, and the limit is three a minute —
   * so without this the fourth test in the file fails on a rate limit that has
   * nothing to do with what it is checking. The limit itself is exercised in
   * tests/integration/tutor.test.ts, where it is the subject rather than an
   * obstacle.
   */
  test.beforeEach(async ({}, info) => {
    if (info.project.name !== "desktop-1440") return;
    await db(async (client) => {
      await client.query("DELETE FROM app.rate_windows WHERE key = $1", [BEN]);
      await client.query(
        `UPDATE app.tutor_requests SET status='failed', error_code='TUTOR_ABANDONED'
          WHERE status='pending' AND session_id IN
            (SELECT s.id FROM app.tutor_sessions s
               JOIN app.enrollments e ON e.id = s.enrollment_id WHERE e.user_id = $1)`,
        [BEN]
      );
    });
  });

  test("answers a question, labels an example and links its sources", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.goto(CLASS_URL);

    // The drawer is closed until it is asked for, and does not fetch anything.
    await expect(page.getByRole("heading", { name: "Course tutor" })).toBeVisible();
    await page.getByRole("button", { name: "Ask the tutor" }).click();

    await page.getByLabel("Your question").fill("Give me a practical example of specificity.");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    const answer = page.getByText(/Imagine a colleague drafting/);
    await expect(answer).toBeVisible({ timeout: 15_000 });

    // spec/04: "Mark examples 'Illustrative example.'"
    await expect(page.getByText("Illustrative example.")).toBeVisible();

    // The source link is one the server built, pointing into this enrollment.
    const source = page.getByRole("link", { name: "Class: video" });
    await expect(source).toHaveAttribute("href", `/learn/${ENROLL_BEN}/classes/${CLASS_VIDEO}`);
  });

  test("shows an unsupported answer without pretending to know", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.goto(CLASS_URL);
    await page.getByRole("button", { name: "Ask the tutor" }).click();

    await page.getByLabel("Your question").fill("stub:unsupported what is the weather today?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    await expect(page.getByText(/outside the material for this course/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Outside this course")).toBeVisible();
  });

  test("reports a failure with a retry, and keeps the class usable", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.goto(CLASS_URL);
    await page.getByRole("button", { name: "Ask the tutor" }).click();

    const question = "stub:fail please break";
    await page.getByLabel("Your question").fill(question);
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    await expect(page.getByText("The tutor could not answer that one.")).toBeVisible({
      timeout: 15_000,
    });
    // spec/04: "provider failure with a manual retry choice".
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    // AC-067: "input retained on failure" — the question is still shown.
    await expect(page.getByText(question)).toBeVisible();

    // AC-067: "navigation/progress unaffected". The class is still navigable.
    await expect(page.getByRole("link", { name: "Next" })).toBeEnabled();
    const enrollments = await page.request.get("/api/v1/enrollments", {
      headers: { Origin: ORIGIN },
    });
    const ben = (await enrollments.json()).data.items.find(
      (e: { id: string }) => e.id === ENROLL_BEN
    );
    // Ben's two completed classes, unchanged by anything the tutor did.
    expect(ben.required_completed).toBe(2);
  });

  test("records a fabricated citation as a failure rather than showing it", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.goto(CLASS_URL);
    await page.getByRole("button", { name: "Ask the tutor" }).click();

    await page.getByLabel("Your question").fill("stub:invalid cite something imaginary");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    // AC-041: the invented citation is refused, and nothing of the answer is shown.
    await expect(page.getByText("The tutor could not answer that one.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/An answer citing something that does not exist/)).toBeHidden();
  });

  test("never sends the same question twice on a refresh", async ({ page }) => {
    await signIn(page, "ben@example.invalid");

    const body = {
      enrollment_id: ENROLL_BEN,
      class_id: CLASS_VIDEO,
      session_id: null,
      question: "What makes a prompt specific?",
      intent: "explanation",
    };
    const key = crypto.randomUUID();
    const headers = { "Content-Type": "application/json", Origin: ORIGIN, "Idempotency-Key": key };

    const first = await page.request.post("/api/v1/tutor/requests", { headers, data: body });
    expect(first.status()).toBe(200);
    const answer = (await first.json()).data;
    expect(answer.status).toBe("completed");

    // The same key again: the stored answer, not a second call.
    const second = await page.request.post("/api/v1/tutor/requests", { headers, data: body });
    expect(second.status()).toBe(200);
    expect((await second.json()).data.request_id).toBe(answer.request_id);

    // One question asked means one usage row — for THIS request. The earlier
    // tests in this file have asked their own, so a count over the learner
    // would be counting theirs too.
    const usage = await db(async (client) =>
      client.query("SELECT count(*)::int AS n FROM app.tutor_usage WHERE request_id=$1", [
        answer.request_id,
      ])
    );
    expect(usage.rows[0].n).toBe(1);

    // And the same key with a different question is refused.
    const changed = await page.request.post("/api/v1/tutor/requests", {
      headers,
      data: { ...body, question: "A different question entirely?" },
    });
    expect(changed.status()).toBe(409);
  });

  test("polling a request consumes no quota and needs no session id", async ({ page }) => {
    await signIn(page, "ben@example.invalid");

    const created = await page.request.post("/api/v1/tutor/requests", {
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        enrollment_id: ENROLL_BEN,
        class_id: CLASS_VIDEO,
        session_id: null,
        question: "How do I name an audience?",
        intent: "explanation",
      },
    });
    const answer = (await created.json()).data;

    for (let i = 0; i < 5; i += 1) {
      const polled = await page.request.get(`/api/v1/tutor/requests/${answer.request_id}`, {
        headers: { Origin: ORIGIN },
      });
      expect(polled.status()).toBe(200);
    }

    const window = await db(async (client) =>
      client.query("SELECT count FROM app.rate_windows WHERE scope='tutor.minute' AND key=$1", [BEN])
    );
    expect(window.rows[0].count).toBe(1);
  });

  test("refuses another learner's request", async ({ page, browser }) => {
    await signIn(page, "ben@example.invalid");
    const created = await page.request.post("/api/v1/tutor/requests", {
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        enrollment_id: ENROLL_BEN,
        class_id: CLASS_VIDEO,
        session_id: null,
        question: "Something only Ben asked.",
        intent: "explanation",
      },
    });
    const answer = (await created.json()).data;

    const other = await browser.newContext();
    try {
      const amber = await other.newPage();
      await signIn(amber, "amber@example.invalid");
      const stolen = await amber.request.get(`/api/v1/tutor/requests/${answer.request_id}`, {
        headers: { Origin: ORIGIN },
      });
      expect(stolen.status()).toBe(404);
      expect(await stolen.text()).not.toContain("only Ben asked");
    } finally {
      await other.close();
    }
  });
});
