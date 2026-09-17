import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
/*
 * AC-009, through the real interface: an existing verified account signs in,
 * sees its invitation, and accepts — with no password reset anywhere in the
 * journey.
 *
 * The new-account half is in tests/integration/invitation-journey.test.ts,
 * which drives real Supabase Auth end to end. Following an actually delivered
 * email is T21's gate, when a mail provider is configured.
 */

function env(): Record<string, string> {
  const file = path.join(__dirname, "../../.env.local");
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}

const config = env();
const fixtures = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures.json"), "utf8")
);
const DANA = fixtures.ids.dana;
const ORG_A = fixtures.ids.org_a;
const ADMIN = fixtures.ids.admin;
const INVITATION = "f3000001-0000-4000-8000-000000000000";

/** Puts Dana back to invited-and-not-onboarded, with one pending invitation. */
async function givePendingInvitation() {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(config.SUPABASE_DB_PASSWORD)}@db.${new URL(config.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query("DELETE FROM app.invitations WHERE user_id=$1 OR id=$2", [DANA, INVITATION]);
    await client.query("UPDATE app.profiles SET onboarded_at=NULL WHERE id=$1", [DANA]);
    await client.query(
      "UPDATE app.memberships SET status='invited' WHERE user_id=$1 AND organization_id=$2",
      [DANA, ORG_A]
    );
    await client.query(
      `INSERT INTO app.invitations(id,user_id,organization_id,role,status,expires_at,created_by)
       VALUES ($1,$2,$3,'learner','pending', now() + interval '24 hours', $4)`,
      [INVITATION, DANA, ORG_A, ADMIN]
    );
  } finally {
    await client.end();
  }
}

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(config.PGLEARN_TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/*
 * These mutate one shared learner's invitation and onboarding state, so they
 * cannot run concurrently with each other or across viewport projects — two
 * workers resetting the same row race. Serial, and desktop only: nothing in
 * this journey is viewport-specific beyond what the responsive suites already
 * cover.
 */
test.describe("AC-009 an existing account accepts through the interface", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "shared database state; desktop only");

  test.beforeEach(async () => {
    await givePendingInvitation();
  });

  test("signs in with the password it already has, and is never asked to reset it", async ({ page }) => {
    await signIn(page, "dana@example.invalid");
    await page.waitForURL("**/learn");

    // The point of this test: an existing account goes nowhere near password
    // setup. AC-009's "existing user signs in and accepts without password
    // reset."
    expect(page.url()).not.toContain("set-password");

    /*
     * She has not accepted yet, so she is told to finish rather than shown a
     * dashboard. Every action beyond her own profile is refused until she does,
     * which is the access boundary working — "neither gains access before
     * acceptance".
     */
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Finish setting up your account"
    );
  });

  test("shows the invitation with its organization and role, and accepts it", async ({ page }) => {
    await signIn(page, "dana@example.invalid");
    await page.waitForURL("**/learn");

    await page.goto(`/invitations/${INVITATION}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("You have been invited");
    await expect(page.getByText("Demo Organization A")).toBeVisible();
    await expect(page.getByText("dana@example.invalid")).toBeVisible();

    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.waitForURL("**/learn");
  });

  test("an accepted invitation sends the visitor to their learning", async ({ page }) => {
    await signIn(page, "dana@example.invalid");
    await page.waitForURL("**/learn");

    await page.goto(`/invitations/${INVITATION}`);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.waitForURL("**/learn");

    // Visiting it again redirects rather than offering acceptance twice.
    await page.goto(`/invitations/${INVITATION}`);
    await page.waitForURL("**/learn");
  });

  test("another signed-in account is told it is unavailable, not that it exists", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.waitForURL("**/learn");

    await page.goto(`/invitations/${INVITATION}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("not available");
    // Nothing about whose invitation it is, or that it is pending.
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("dana");
    expect(body).not.toContain("demo organization a");
  });

  test("an anonymous visitor signs in first and comes back to the invitation", async ({ page }) => {
    await page.goto(`/invitations/${INVITATION}`);
    await expect(page).toHaveURL(new RegExp(`next=.*invitations.*${INVITATION}`));
  });
});

test.describe("password recovery", () => {
  test("gives the same answer for a known and an unknown address", async ({ page }) => {
    const responses: string[] = [];
    for (const email of ["amber@example.invalid", "definitely-not-a-user@example.invalid"]) {
      await page.goto("/forgot-password");
      await page.getByLabel("Email address").fill(email);
      await page.getByRole("button", { name: "Send reset link" }).click();
      await expect(page.getByRole("status")).toBeVisible();
      responses.push((await page.getByRole("status").innerText()).trim());
    }
    // Identical wording, so the form cannot be used to discover which
    // addresses have accounts.
    expect(responses[0]).toBe(responses[1]);
    expect(responses[0]).toMatch(/if that address has a PGLearn account/i);
  });

  test("set-password refuses a visitor with no recovery session", async ({ page }) => {
    await page.goto("/set-password");
    await expect(page).toHaveURL(/\/login/);
  });
});
