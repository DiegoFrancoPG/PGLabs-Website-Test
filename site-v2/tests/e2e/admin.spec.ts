import { test, expect } from "@playwright/test";
import { signIn } from "./session";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * T23 — the shell, and the screens that make the pilot runnable.
 *
 * AC-053 is a manual accessibility review, and much of it cannot be automated:
 * whether a focus ring is visible, whether an error reads sensibly. What CAN
 * be checked automatically is checked here — every control reachable by
 * keyboard, every field labelled, live regions present, and no keyboard trap —
 * so the manual pass is about judgement rather than about inventory.
 */

const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const { org_a: ORG_A, program_shared: PROGRAM } = fixtures.ids;

test.describe("the application shell", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "covered at desktop width");

  test("gives a learner their own navigation and nothing else", async ({ page }) => {
    await signIn(page, "amber@example.invalid");
    await page.goto("/learn");

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "My learning" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();

    // A learner is not a manager and not an admin.
    await expect(nav.getByRole("link", { name: "Programs" })).toBeHidden();
    await expect(nav.getByRole("link", { name: "Operations" })).toBeHidden();
    await expect(nav.getByRole("link", { name: "Organizations" })).toBeHidden();
  });

  test("takes a single-organization manager straight to their organization", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    await page.goto("/learn");

    const nav = page.getByRole("navigation", { name: "Main" });
    // Named, not "Organizations": spec/04 wants the selected name shown.
    const link = nav.getByRole("link", { name: "Demo Organization A" });
    await expect(link).toHaveAttribute("href", `/manage/${ORG_A}`);
    await expect(nav.getByRole("link", { name: "Operations" })).toBeHidden();
  });

  test("gives a platform admin the admin navigation", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto("/learn");

    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Programs", "Organizations", "Individuals", "Reports", "Operations"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
  });

  test("marks the current page for a screen reader, not only visually", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto("/admin/programs");
    await expect(
      page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Programs" })
    ).toHaveAttribute("aria-current", "page");
  });
});

/*
 * The draft this file creates is removed afterwards. It is shared state: a
 * later run — or tests/integration/versions.test.ts — would otherwise find a
 * draft already there and be testing something different from what it says.
 */
async function removeDrafts() {
  const { Client } = await import("pg");
  const config = Object.fromEntries(
    readFileSync(path.join(__dirname, "../../.env.local"), "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key.trim(), rest.join("=").trim()];
      })
  ) as Record<string, string>;
  const ref = new URL(config.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const client = new Client({
    connectionString: `postgresql://postgres:${encodeURIComponent(config.SUPABASE_DB_PASSWORD)}@db.${ref}.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    /*
     * A draft is no longer empty: T27 clones the published version's content
     * into it, so everything that hangs off a class has to go before the
     * modules can. Deleting in the other order fails on a foreign key, which
     * would leave the draft behind and make the next run test something else.
     */
    const drafts = `SELECT id FROM app.program_versions WHERE program_id=$1 AND state='draft'`;
    await client.query(
      `DELETE FROM app.assets WHERE class_id IN
         (SELECT id FROM app.classes WHERE version_id IN (${drafts}))`,
      [PROGRAM]
    );
    await client.query(`DELETE FROM app.content_chunks WHERE version_id IN (${drafts})`, [PROGRAM]);
    await client.query(
      `DELETE FROM app.exercises WHERE class_id IN
         (SELECT id FROM app.classes WHERE version_id IN (${drafts}))`,
      [PROGRAM]
    );
    await client.query(`UPDATE app.classes SET primary_asset_id=NULL WHERE version_id IN (${drafts})`, [
      PROGRAM,
    ]);
    await client.query(`DELETE FROM app.classes WHERE version_id IN (${drafts})`, [PROGRAM]);
    await client.query(`DELETE FROM app.modules WHERE version_id IN (${drafts})`, [PROGRAM]);
    await client.query("DELETE FROM app.program_versions WHERE program_id=$1 AND state='draft'", [
      PROGRAM,
    ]);
  } finally {
    await client.end();
  }
}

test.describe("AC-053 the admin screens are operable", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "shared database state; desktop only");

  test.afterAll(async ({}, info) => {
    if (info.project.name === "desktop-1440") await removeDrafts();
  });

  test("lists the catalog and reaches a program", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto("/admin/programs");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Programs");
    await expect(page.getByRole("heading", { name: "AI Foundations" })).toBeVisible();

    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/programs/${PROGRAM}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("AI Foundations");
  });

  test("opens the draft and shows the published version read-only", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto(`/admin/programs/${PROGRAM}`);

    // The published version is previewable and cannot be edited.
    await page.getByRole("link", { name: "Preview" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Version");
    await expect(page.getByText(/published and cannot be changed/)).toBeVisible();
    // spec/04: "published editor read-only".
    await expect(page.getByRole("button", { name: "Publish this version" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Add module" })).toBeHidden();
    await expect(page.getByLabel("Title").first()).toBeDisabled();
  });

  test("creates a draft, adds a module, and refuses to publish an incomplete one", async ({
    page,
  }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto(`/admin/programs/${PROGRAM}`);

    await page.getByRole("button", { name: "Open draft" }).click();
    await expect(page).toHaveURL(/\/versions\//);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Version");

    /*
     * AC-056: the draft is a COPY of the published version, so the author
     * starts from the course rather than from nothing. The classes are new
     * rows — the learners on the published version are unaffected — but they
     * carry the same titles, which is what makes this recognisable as "the
     * next version of this course" on the screen.
     */
    await expect(page.getByText("Class: video")).toBeVisible();
    await expect(page.getByText("Class: text")).toBeVisible();

    await page.getByRole("button", { name: "Add module" }).click();
    await expect(page.getByRole("heading", { name: /Module/ }).first()).toBeVisible();

    // An empty module cannot be published, and the reasons are listed per class.
    await page.getByRole("button", { name: "Publish this version" }).click();
    await expect(page.getByText(/cannot be published yet/)).toBeVisible({ timeout: 15_000 });
  });

  test("shows an organization, its grants and its cohorts", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto("/admin/organizations");

    await expect(page.getByRole("heading", { name: "Demo Organization A" })).toBeVisible();
    await expect(page.getByText("Catalog access").first()).toBeVisible();
    // The grant the fixture holds is named by its programme, not its uuid.
    await expect(page.getByText("AI Foundations").first()).toBeVisible();
  });

  test("shows individuals without inventing an organization for them", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto("/admin/individuals");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Individuals");
    // The fixture's personal learner, with no organization anywhere on the row.
    await expect(page.getByText("personal@example.invalid")).toBeVisible();
  });

  test("reports across every organization and labels personal rows", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto("/admin/reports");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Reports");
    await expect(page.getByRole("option", { name: "All organizations" })).toBeAttached();

    const table = page.getByRole("table");
    await expect(table).toContainText("Demo Organization A");
    // spec/04: "personal rows labeled Personal."
    await expect(table.getByText("Personal").first()).toBeVisible();
  });
});

test.describe("AC-053 the manager screens are operable", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "covered at desktop width");

  test("shows cohorts and reaches a roster", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    await page.goto(`/manage/${ORG_A}`);

    await expect(page.getByRole("heading", { name: "Cohorts" })).toBeVisible();
    await page.getByRole("link", { name: /Cohort/ }).first().click();

    await expect(page).toHaveURL(new RegExp(`/manage/${ORG_A}/cohorts/`));
    await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
    // The rule that shapes the screen, stated on it.
    await expect(page.getByText(/does not assign them anything/)).toBeVisible();
    await expect(page.getByRole("table")).toContainText("amber@example.invalid");
  });

  test("keeps a manager out of the admin screens", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    for (const route of ["/admin/programs", "/admin/organizations", "/admin/individuals"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("not available");
    }
  });
});

test.describe("AC-053 what can be checked without a person", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "covered at desktop width");

  test("labels every form control on the admin screens", async ({ page }) => {
    await signIn(page, "admin@example.invalid");

    for (const route of ["/admin/programs", "/admin/organizations", "/admin/reports"]) {
      await page.goto(route);
      // Open the forms that are behind a disclosure.
      for (const name of ["New program", "New organization", "Invite an individual"]) {
        const button = page.getByRole("button", { name, exact: true });
        if (await button.count()) await button.first().click();
      }

      const controls = page.locator("input:visible, select:visible, textarea:visible");
      const count = await controls.count();
      for (let index = 0; index < count; index += 1) {
        const control = controls.nth(index);
        const id = await control.getAttribute("id");
        const aria = await control.getAttribute("aria-label");
        const labelled = await control.getAttribute("aria-labelledby");
        // Every control is reachable by name: a label's htmlFor, an aria-label
        // or an aria-labelledby. A placeholder is not a label.
        const hasLabel = id ? (await page.locator(`label[for="${id}"]`).count()) > 0 : false;
        expect(hasLabel || Boolean(aria) || Boolean(labelled)).toBe(true);
      }
    }
  });

  test("can be operated from the keyboard, with no trap", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto("/admin/programs");

    const reached: string[] = [];
    for (let step = 0; step < 25; step += 1) {
      await page.keyboard.press("Tab");
      reached.push(
        await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          return element ? `${element.tagName}:${element.textContent?.trim().slice(0, 20) ?? ""}` : "";
        })
      );
    }

    // Focus moved through several different controls rather than sticking.
    expect(new Set(reached).size).toBeGreaterThan(3);
    // And it left the header rather than cycling inside it.
    expect(reached.some((entry) => entry.includes("New program"))).toBe(true);
  });

  test("announces saves and failures in a live region", async ({ page }) => {
    await signIn(page, "admin@example.invalid");
    await page.goto(`/admin/programs/${PROGRAM}`);
    await page.getByRole("button", { name: "Open draft" }).click();
    await expect(page).toHaveURL(/\/versions\//);

    // spec/04: "aria-live save/error summaries".
    await expect(page.locator("[aria-live='polite']").first()).toBeAttached();
  });
});
