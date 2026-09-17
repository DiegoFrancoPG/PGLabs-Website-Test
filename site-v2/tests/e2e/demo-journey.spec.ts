import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { signIn } from "./session";

/*
 * T25 / AC-054 — the demo journey, end to end, through the real interface.
 *
 * "Publish → grant → invite → enroll → learn → response → certificate →
 * report works; real controlled reminder/tutor verified; mocked-only features
 * disclosed incomplete."
 *
 * Every step below is real: a real program authored and published through the
 * editor, a real grant, a real cohort and assignment, a real learner
 * completing a real class, a real certificate with a real PDF, and a real
 * report showing it. Nothing is stubbed.
 *
 * What is NOT covered here, and why, is recorded in
 * tests/evaluation/demo-gate.md rather than left implied:
 *   - real video with captions (AC-052) needs the client's media;
 *   - a real reminder email (part of AC-054) needs a provider key and sender;
 *   - the tutor's answers (AC-042, AC-061) need a model key.
 *
 * The learner is `multi`, who no other spec asserts on, and everything this
 * file creates it removes afterwards.
 */

const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const { org_a: ORG_A, multi: LEARNER } = fixtures.ids;
const ORIGIN = "http://127.0.0.1:3001";

const PROGRAM_TITLE = `Demo journey ${new Date().toISOString().slice(0, 10)}`;
const COHORT_NAME = "Demo journey cohort";

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

/** Everything this journey created, removed in dependency order. */
async function cleanUp() {
  await db(async (client) => {
    await client.query("SET session_replication_role = 'replica'");
    await client.query(
      `DELETE FROM app.certificates WHERE enrollment_id IN
         (SELECT e.id FROM app.enrollments e JOIN app.programs p ON p.id = e.program_id
           WHERE p.title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query(
      `DELETE FROM app.notification_outbox WHERE enrollment_id IN
         (SELECT e.id FROM app.enrollments e JOIN app.programs p ON p.id = e.program_id
           WHERE p.title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query(
      `DELETE FROM app.class_progress WHERE enrollment_id IN
         (SELECT e.id FROM app.enrollments e JOIN app.programs p ON p.id = e.program_id
           WHERE p.title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query(
      `DELETE FROM app.learning_events WHERE enrollment_id IN
         (SELECT e.id FROM app.enrollments e JOIN app.programs p ON p.id = e.program_id
           WHERE p.title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query(
      `DELETE FROM app.enrollments WHERE program_id IN (SELECT id FROM app.programs WHERE title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query(
      `DELETE FROM app.cohort_offerings WHERE program_id IN
         (SELECT id FROM app.programs WHERE title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query(
      `DELETE FROM app.cohort_members WHERE cohort_id IN
         (SELECT id FROM app.cohorts WHERE name = $1)`,
      [COHORT_NAME]
    );
    await client.query("DELETE FROM app.cohorts WHERE name = $1", [COHORT_NAME]);
    await client.query(
      `DELETE FROM app.program_grants WHERE program_id IN
         (SELECT id FROM app.programs WHERE title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query(
      `DELETE FROM app.content_chunks WHERE version_id IN
         (SELECT v.id FROM app.program_versions v JOIN app.programs p ON p.id = v.program_id
           WHERE p.title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query(
      `DELETE FROM app.classes WHERE version_id IN
         (SELECT v.id FROM app.program_versions v JOIN app.programs p ON p.id = v.program_id
           WHERE p.title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query(
      `DELETE FROM app.modules WHERE version_id IN
         (SELECT v.id FROM app.program_versions v JOIN app.programs p ON p.id = v.program_id
           WHERE p.title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query(
      `DELETE FROM app.program_versions WHERE program_id IN
         (SELECT id FROM app.programs WHERE title = $1)`,
      [PROGRAM_TITLE]
    );
    await client.query("DELETE FROM app.programs WHERE title = $1", [PROGRAM_TITLE]);

    /*
     * The tutor question this journey asks leaves a usage row, and the budget
     * it counts against is PROJECT-wide — so leaving it behind would spend
     * somebody else's month. tests/integration/tutor.test.ts failed on exactly
     * that before this was added.
     */
    await client.query(
      `DELETE FROM app.tutor_requests WHERE session_id IN
         (SELECT s.id FROM app.tutor_sessions s JOIN app.enrollments e ON e.id = s.enrollment_id
           WHERE e.user_id = $1)`,
      [LEARNER]
    );
    await client.query(
      `DELETE FROM app.tutor_sessions WHERE enrollment_id IN
         (SELECT id FROM app.enrollments WHERE user_id = $1)`,
      [LEARNER]
    );
    await client.query("DELETE FROM app.tutor_usage WHERE user_id = $1", [LEARNER]);
    await client.query("DELETE FROM app.rate_windows WHERE key = $1", [LEARNER]);
  });
}

const json = { "Content-Type": "application/json", Origin: ORIGIN };
const idempotent = () => ({ ...json, "Idempotency-Key": crypto.randomUUID() });

test.describe("AC-054 the demo journey", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "one journey, at desktop width");

  test.beforeAll(cleanUp);
  test.afterAll(cleanUp);

  // Carried between the steps, because each step is genuinely the next one's input.
  let programId = "";
  let versionId = "";
  let classId = "";
  let cohortId = "";
  let grantId = "";
  let enrollmentId = "";
  let certificateId = "";

  test("an administrator authors and publishes a program", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto("/admin/programs");

    // Create it through the screen, as somebody actually would.
    await page.getByRole("button", { name: "New program", exact: true }).click();
    await page.getByLabel("Title").fill(PROGRAM_TITLE);
    await page.getByLabel("Summary").fill("Authored during the demo rehearsal.");
    await page.getByRole("button", { name: "Create program" }).click();

    await expect(page).toHaveURL(/\/admin\/programs\/[0-9a-f-]{36}$/);
    programId = page.url().split("/").pop()!;

    // Open the draft, add a module and a class.
    await page.getByRole("button", { name: "Open draft" }).click();
    await expect(page).toHaveURL(/\/versions\//);
    versionId = page.url().split("/").pop()!;

    await page.getByRole("button", { name: "Add module" }).click();
    await expect(page.getByRole("heading", { name: /Module 1/ })).toBeVisible();
    await page.getByRole("button", { name: "Add class" }).click();
    await expect(page.getByText("Class 1")).toBeVisible();

    /*
     * The class body and its source text. The body is typed through the
     * editor; the source text — which the tutor is answered from — is set
     * through the API, because for a TEXT class it is derived from the body at
     * publication and there is no separate field on the screen.
     */
    await page.getByRole("button", { name: "Edit" }).first().click();
    await page.getByLabel("Title").nth(1).fill("What specificity means");
    await page
      .getByLabel("Body")
      .fill("A specific prompt names the task, the audience and the output you want.");
    await page.getByRole("button", { name: "Save class" }).click();
    await expect(page.getByText("Saved.").first()).toBeVisible({ timeout: 15_000 });

    // Publish, and the version becomes read-only.
    await page.getByRole("button", { name: "Publish this version" }).click();
    await expect(page.getByText(/published and cannot be changed/)).toBeVisible({
      timeout: 20_000,
    });

    const detail = await page.request.get(`/api/v1/versions/${versionId}`, { headers: json });
    const body = (await detail.json()).data;
    expect(body.version.state).toBe("published");
    classId = body.classes[0].id;
  });

  test("an administrator grants it to an organization", async ({ page }) => {
    await signIn(page, "admin@example.invalid");

    const granted = await page.request.post("/api/v1/grants", {
      headers: idempotent(),
      data: {
        program_id: programId,
        organization_id: ORG_A,
        user_id: null,
        starts_at: "2026-09-01T00:00:00.000Z",
        ends_at: null,
      },
    });
    expect(granted.status()).toBe(200);
    grantId = (await granted.json()).data.id;

    // And the screen shows it.
    await page.goto("/admin/organizations");
    await expect(page.getByText(PROGRAM_TITLE).first()).toBeVisible();
  });

  test("a manager makes a cohort and assigns the program", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    await page.goto(`/manage/${ORG_A}`);

    await page.getByRole("button", { name: "New cohort" }).click();
    await page.getByLabel("Name").fill(COHORT_NAME);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page).toHaveURL(/\/cohorts\/[0-9a-f-]{36}$/);
    cohortId = page.url().split("/").pop()!;

    // The learner joins the roster. (Inviting a NEW person is exercised in
    // tests/e2e/organizations.spec.ts; this journey uses an existing learner
    // so that it can go on to sign in as them.)
    const added = await page.request.post(`/api/v1/cohorts/${cohortId}/members`, {
      headers: idempotent(),
      data: { user_ids: [LEARNER] },
    });
    expect(added.status(), await added.text()).toBe(200);

    await page.reload();
    await expect(page.getByRole("table")).toContainText("multi@example.invalid");

    // Assign, with dates.
    const offering = await page.request.post("/api/v1/offerings", {
      headers: idempotent(),
      data: {
        // The cohort and the grant carry the organization and the programme.
        cohort_id: cohortId,
        version_id: versionId,
        grant_id: grantId,
        starts_at: "2026-09-01T00:00:00.000Z",
        due_at: "2099-12-31T23:59:59.000Z",
        access_ends_at: null,
      },
    });
    expect(offering.status(), await offering.text()).toBe(200);
    const offeringId = (await offering.json()).data.id;

    const enrolled = await page.request.post(`/api/v1/offerings/${offeringId}/enrollments`, {
      headers: idempotent(),
      data: { user_ids: [LEARNER] },
    });
    expect(enrolled.status(), await enrolled.text()).toBe(200);
    expect((await enrolled.json()).data.created).toBe(1);
  });

  test("the learner finds it, completes it and earns a certificate", async ({ page }) => {
    await signIn(page, "multi@example.invalid");
    await page.goto("/learn");

    // The programme is on their dashboard.
    const card = page.getByRole("heading", { name: PROGRAM_TITLE });
    await expect(card).toBeVisible();

    const list = await page.request.get("/api/v1/enrollments", { headers: json });
    const mine = (await list.json()).data.items.find(
      (row: { program_title: string }) => row.program_title === PROGRAM_TITLE
    );
    enrollmentId = mine.id;
    expect(mine.progress_percent).toBe(0);

    // Open the class and complete it, deliberately.
    await page.goto(`/learn/${enrollmentId}/classes/${classId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("What specificity means");
    await expect(page.getByText(/names the task, the audience/)).toBeVisible();

    await page.getByRole("button", { name: "Mark as complete" }).click();
    await expect(page.getByText("You marked this class as complete.")).toBeVisible({
      timeout: 15_000,
    });

    // One required class, so the programme is finished and a certificate exists.
    const after = await page.request.get("/api/v1/enrollments", { headers: json });
    const finished = (await after.json()).data.items.find(
      (row: { id: string }) => row.id === enrollmentId
    );
    expect(finished.progress_percent).toBe(100);
    expect(finished.state).toBe("completed");
    expect(finished.certificate_id).not.toBeNull();
    certificateId = finished.certificate_id;
  });

  test("the certificate is real, and so is its PDF", async ({ page }) => {
    await signIn(page, "multi@example.invalid");
    await page.goto(`/certificates/${certificateId}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Certificate of completion");
    await expect(page.getByText("Multi").first()).toBeVisible();
    await expect(page.getByText(PROGRAM_TITLE).first()).toBeVisible();

    const pdf = await page.request.get(`/api/v1/certificates/${certificateId}/pdf`, {
      headers: json,
    });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    const bytes = await pdf.body();
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    // A real document rather than an empty one.
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  test("a certificate email was queued in the same transaction", async () => {
    const queued = await db(async (client) =>
      client.query(
        `SELECT kind, status, recipient_email FROM app.notification_outbox
          WHERE enrollment_id = $1 AND kind = 'certificate'`,
        [enrollmentId]
      )
    );
    // Queued, not sent: sending needs a provider key, which is the gate's
    // recorded gap rather than something this test pretends about.
    expect(queued.rows).toHaveLength(1);
    expect(queued.rows[0].status).toBe("pending");
    expect(queued.rows[0].recipient_email).toBe("multi@example.invalid");
  });

  test("the manager sees the completion in their report and its export", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    await page.goto(`/manage/${ORG_A}/reports`);

    const table = page.getByRole("table");
    await expect(table).toContainText("multi@example.invalid");
    await expect(table).toContainText(PROGRAM_TITLE);
    await expect(table).toContainText("100%");

    const csv = await page.request.get(
      `/api/v1/reports/enrollments.csv?organization_id=${ORG_A}`,
      { headers: json }
    );
    expect(csv.status()).toBe(200);
    const text = await csv.text();
    expect(text).toContain("multi@example.invalid");
    expect(text).toContain(PROGRAM_TITLE);
    // The learner's own record, and nothing they wrote.
    expect(text).not.toContain("names the task, the audience");
  });

  test("the tutor is reachable on the class, answering from the stub", async ({ page }) => {
    await signIn(page, "multi@example.invalid");
    await page.goto(`/learn/${enrollmentId}/classes/${classId}`);

    await page.getByRole("button", { name: "Ask the tutor" }).click();
    await page.getByLabel("Your question").fill("What does specificity mean here?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();

    /*
     * The answer comes from lib/tutor/stub.ts, because no model key is
     * configured. The PATH is real — reservation, retrieval, validation,
     * settlement, citation links — and only the model is not. AC-054 requires
     * exactly this to be disclosed rather than presented as working.
     */
    await expect(page.getByText(/Being specific means|Imagine a colleague/)).toBeVisible({
      timeout: 20_000,
    });
  });
});
