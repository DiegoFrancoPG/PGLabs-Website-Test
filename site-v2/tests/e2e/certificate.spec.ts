import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * AC-035 through the real interface: Cora's certificate page, the PDF it
 * downloads, the refusal another learner gets, and the revoked state.
 *
 * The database half is in tests/integration/certificates.test.ts. This half
 * exists because spec/04 describes a page — a revoked banner with the metadata
 * still visible and the download disabled — and that is only true if the page
 * says so.
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
const CERT_CORA = fixtures.ids.certificate_cora;

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

/** Un-revokes the fixture certificate. Only maintenance may do this. */
async function clearRevocation() {
  await db(async (client) => {
    await client.query("SET session_replication_role = 'replica'");
    await client.query(
      "UPDATE app.certificates SET revoked_at=NULL, revocation_reason=NULL WHERE id=$1",
      [CERT_CORA]
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

test.describe("AC-035 the certificate page", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "shared database state; desktop only");

  // As in resume.spec.ts: a skip condition does not stop these hooks.
  const desktopOnly = async ({}, info: import("@playwright/test").TestInfo) => {
    if (info.project.name === "desktop-1440") await clearRevocation();
  };
  test.beforeAll(desktopOnly);
  test.afterAll(desktopOnly);

  test("shows the snapshot and offers the PDF to its owner", async ({ page }) => {
    await signIn(page, "cora@example.invalid");
    await page.goto(`/certificates/${CERT_CORA}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Certificate of completion");
    await expect(page.getByText("Cora", { exact: true })).toBeVisible();
    await expect(page.getByText("AI Foundations")).toBeVisible();
    await expect(page.getByText("PGLearn", { exact: true })).toBeVisible();
    // The verification identity is the UUID (spec/03), shown in full.
    await expect(page.getByText(CERT_CORA)).toBeVisible();
    await expect(page.getByText("Valid", { exact: true })).toBeVisible();

    const pdf = await page.request.get(`/api/v1/certificates/${CERT_CORA}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    // No shared cache may hold somebody's personal document.
    expect(pdf.headers()["cache-control"]).toContain("no-store");
    const body = await pdf.body();
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("denies another learner, without confirming the certificate exists", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.goto(`/certificates/${CERT_CORA}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("not available");
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toContain("cora");

    const pdf = await page.request.get(`/api/v1/certificates/${CERT_CORA}/pdf`);
    expect(pdf.status()).toBe(404);
  });

  test("keeps metadata and disables the download once revoked", async ({ page }) => {
    // Revoked as the platform admin, through the API, as it would really happen.
    const admin = await page.context().browser()!.newContext();
    const adminPage = await admin.newPage();
    try {
      await signIn(adminPage, "admin@example.invalid");
      const revoked = await adminPage.request.post(`/api/v1/certificates/${CERT_CORA}/revoke`, {
        headers: {
          "Content-Type": "application/json",
          Origin: "http://127.0.0.1:3001",
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: { reason: "Issued against the wrong enrollment." },
      });
      expect(revoked.status()).toBe(200);
    } finally {
      await admin.close();
    }

    await signIn(page, "cora@example.invalid");
    await page.goto(`/certificates/${CERT_CORA}`);

    // Scoped: "Revoked" also appears in the banner and in the download note.
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(page.getByText("Issued against the wrong enrollment.")).toBeVisible();
    // spec/03: revoked metadata remains visible.
    await expect(page.getByText("AI Foundations")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeDisabled();

    const pdf = await page.request.get(`/api/v1/certificates/${CERT_CORA}/pdf`);
    expect(pdf.status()).toBe(409);
    expect((await pdf.json()).error.code).toBe("CERTIFICATE_REVOKED");
  });

  test("refuses a learner trying to revoke their own certificate", async ({ page }) => {
    await signIn(page, "cora@example.invalid");
    const attempt = await page.request.post(`/api/v1/certificates/${CERT_CORA}/revoke`, {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:3001",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: { reason: "I would rather it were not revoked." },
    });
    expect(attempt.status()).toBe(403);
  });

  test("requires a session: there is no public lookup", async ({ browser }) => {
    const anonymous = await browser.newContext();
    try {
      const page = await anonymous.newPage();
      await page.goto(`/certificates/${CERT_CORA}`);
      await expect(page).toHaveURL(/\/login/);

      const api = await page.request.get(`/api/v1/certificates/${CERT_CORA}`);
      expect(api.status()).toBe(401);
    } finally {
      await anonymous.close();
    }
  });
});
