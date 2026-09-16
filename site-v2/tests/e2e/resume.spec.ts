import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * AC-024 — cross-session resume.
 *
 * "Given acknowledged position 125000ms, when reload and log in on another
 * browser then Continue, then same enrollment/class/position restored; no
 * automatic completion from opening."
 *
 * Driven through the real API in a real signed-in session, then repeated in a
 * second, independent browser context — a different cookie jar, which is what
 * "another browser" means here. What is not covered is a real video element
 * seeking to 125 seconds: that needs the client's media, and is recorded as
 * blocked rather than passed.
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
/*
 * The personal learner, not Amber. This spec writes progress, and Amber is
 * the fixture that tests/e2e/learning-navigation.spec.ts asserts has none —
 * the two specs run in parallel against one shared database, so a mutating
 * spec has to own its learner. "personal" holds an individual grant nothing
 * else reads.
 */
const {
  enroll_personal: ENROLLMENT, class_video: CLASS_VIDEO, personal: LEARNER,
} = fixtures.ids;
const EMAIL = "personal@example.invalid";

const ORIGIN = "http://127.0.0.1:3001";
const POSITION = 125_000;

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
 * The learner back to untouched, so the spec can run twice in a row.
 *
 * session_replication_role='replica' is what makes the UPDATE possible: the
 * M02 trigger forbids started_at from ever being unset, deliberately, and
 * this is maintenance rather than something the application may do. It is
 * scoped to this one connection and reset when it closes.
 */
async function resetLearner() {
  await db(async (client) => {
    await client.query("SET session_replication_role = 'replica'");
    await client.query("DELETE FROM app.learning_events WHERE enrollment_id=$1", [ENROLLMENT]);
    await client.query("DELETE FROM app.playback_sessions WHERE enrollment_id=$1", [ENROLLMENT]);
    await client.query("DELETE FROM app.class_progress WHERE enrollment_id=$1", [ENROLLMENT]);
    await client.query("DELETE FROM app.idempotency_records WHERE actor_id=$1", [LEARNER]);
    await client.query(
      `UPDATE app.enrollments
          SET started_at=NULL, last_activity_at=NULL, completed_at=NULL,
              last_class_id=NULL, resume_generation=0
        WHERE id=$1`,
      [ENROLLMENT]
    );
  });
}

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(config.PGLEARN_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/learn");
}

/* page.request sends no Origin of its own, and proxy.ts requires one. */
const headers = { "Content-Type": "application/json", Origin: ORIGIN };
const mutate = (body: unknown) => ({
  headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
  data: body ?? {},
});

test.describe("AC-024 cross-session resume", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "shared database state; desktop only");

  /*
   * The hooks carry the same guard as the tests. A test.skip() condition stops
   * the TESTS from running but not beforeAll/afterAll, so without this the
   * mobile project — whose tests are all skipped — would still wipe the
   * playback session out from under the desktop run.
   */
  const desktopOnly = async ({}, info: import("@playwright/test").TestInfo) => {
    if (info.project.name === "desktop-1440") await resetLearner();
  };
  test.beforeAll(desktopOnly);
  test.afterAll(desktopOnly);

  test("restores the same class and position in a second browser, completing nothing", async ({
    page,
    browser,
  }) => {
    await signIn(page, EMAIL);

    // First browser: open the video class and acknowledge 125000ms.
    const started = await page.request.post(
      `/api/v1/enrollments/${ENROLLMENT}/classes/${CLASS_VIDEO}/playback`,
      mutate({})
    );
    expect(started.status()).toBe(200);
    const session = (await started.json()).data;
    expect(session.position_ms).toBe(0);

    const beat = await page.request.post(
      `/api/v1/enrollments/${ENROLLMENT}/classes/${CLASS_VIDEO}/progress`,
      mutate({
        event_id: crypto.randomUUID(),
        session_id: session.session_id,
        sequence: session.next_sequence,
        position_ms: POSITION,
        elapsed_ms: 0,
        rate: 1,
        interval: null,
      })
    );
    expect(beat.status()).toBe(200);
    const acknowledged = (await beat.json()).data;
    expect(acknowledged.accepted).toBe(true);
    expect(acknowledged.progress.position_ms).toBe(POSITION);

    /*
     * A second context: its own cookies, its own sign-in. This is the
     * "another browser" the scenario asks for — the position cannot have come
     * from anything local, because nothing local is shared.
     */
    const second = await browser.newContext();
    const other = await second.newPage();
    try {
      await signIn(other, EMAIL);

      // The dashboard's Continue points back at the class that was open.
      const list = await other.request.get("/api/v1/enrollments", { headers });
      const enrollment = (await list.json()).data.items.find(
        (e: { id: string }) => e.id === ENROLLMENT
      );
      expect(enrollment.continue_class_id).toBe(CLASS_VIDEO);
      /*
       * The card still says "Start", not "Continue": saving a position is not
       * learning activity (spec/03 step 5), so nothing has been started yet.
       * What matters for resume is where the link goes.
       */
      await expect(other.getByRole("link", { name: "Start" })).toHaveAttribute(
        "href",
        `/learn/${ENROLLMENT}/classes/${CLASS_VIDEO}`
      );

      // And starting there resumes at 125000ms.
      const resumed = await other.request.post(
        `/api/v1/enrollments/${ENROLLMENT}/classes/${CLASS_VIDEO}/playback`,
        mutate({})
      );
      expect(resumed.status()).toBe(200);
      const resumedSession = (await resumed.json()).data;
      expect(resumedSession.position_ms).toBe(POSITION);
      expect(resumedSession.generation).toBe(session.generation + 1);

      // Nothing was completed by any of this: a position is not coverage.
      const detail = await other.request.get(
        `/api/v1/enrollments/${ENROLLMENT}/classes/${CLASS_VIDEO}`,
        { headers }
      );
      const progress = (await detail.json()).data.progress;
      expect(progress.position_ms).toBe(POSITION);
      expect(progress.coverage_ms).toBe(0);
      expect(progress.content_complete).toBe(false);
      expect(progress.class_complete).toBe(false);
      expect(progress.required_completed).toBe(0);

      // The first browser is now the old tab, and is told so.
      const stale = await page.request.post(
        `/api/v1/enrollments/${ENROLLMENT}/classes/${CLASS_VIDEO}/progress`,
        mutate({
          event_id: crypto.randomUUID(),
          session_id: session.session_id,
          sequence: session.next_sequence + 1,
          position_ms: 10_000,
          elapsed_ms: 0,
          rate: 1,
          interval: null,
        })
      );
      expect(stale.status()).toBe(409);
      expect((await stale.json()).error.code).toBe("SESSION_SUPERSEDED");
    } finally {
      await second.close();
    }
  });

  test("completes a text class only when the learner says so", async ({ page }) => {
    await signIn(page, EMAIL);
    const CLASS_TEXT = fixtures.ids.class_text;

    // Reading it, twice, changes nothing (AC-030 and AC-066).
    await page.goto(`/learn/${ENROLLMENT}/classes/${CLASS_TEXT}`);
    await page.reload();
    let detail = await page.request.get(
      `/api/v1/enrollments/${ENROLLMENT}/classes/${CLASS_TEXT}`,
      { headers }
    );
    expect((await detail.json()).data.progress.content_complete).toBe(false);

    await page.getByRole("button", { name: "Mark as complete" }).click();
    await expect(page.getByText("You marked this class as complete.")).toBeVisible();

    detail = await page.request.get(`/api/v1/enrollments/${ENROLLMENT}/classes/${CLASS_TEXT}`, {
      headers,
    });
    const progress = (await detail.json()).data.progress;
    expect(progress.content_complete).toBe(true);
    expect(progress.class_complete).toBe(true);
    expect(progress.required_completed).toBe(1);
  });
});
