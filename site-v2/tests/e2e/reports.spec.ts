import { test, expect } from "@playwright/test";
import { signIn } from "./session";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * AC-036 and AC-038 through the manager's own screen: the totals spec/04 asks
 * for, the filters, and the CSV the Export button actually downloads.
 *
 * The database half is in tests/integration/reports.test.ts. This half exists
 * because "CSV uses same filters" is a claim about the page, and because a
 * manager reaching another organization's rows would be a real breach rather
 * than a failing assertion.
 */

const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const { org_a: ORG_A, org_b: ORG_B, offering_a: OFFERING_A } = fixtures.ids;
const EXPECTED = fixtures.expected_report;


test.describe("AC-036 and AC-038 the manager's reports", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "covered at desktop width");

  test("shows the organization's totals", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    await page.goto(`/manage/${ORG_A}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Demo Organization A");
    await expect(page.getByText("Assigned")).toBeVisible();
    await expect(page.getByText("Overdue")).toBeVisible();
    await expect(page.getByRole("link", { name: "Reports" })).toBeVisible();
  });

  test("shows the fixture's numbers and rows for offering A", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    await page.goto(`/manage/${ORG_A}/reports?offering_id=${OFFERING_A}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Reports");
    // The selected organization is named, per spec/04's shared-interface rule.
    await expect(page.getByLabel("Selected organization")).toHaveText("Demo Organization A");

    const table = page.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(EXPECTED.assigned + 1); // + header
    await expect(table).toContainText("amber@example.invalid");
    await expect(table).toContainText("66.7%");
    // The date-filter basis is explained on the page, not left to be guessed.
    await expect(page.getByText(/From is inclusive and before is exclusive/)).toBeVisible();
  });

  test("filters, and the CSV carries the same filters", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    await page.goto(`/manage/${ORG_A}/reports?offering_id=${OFFERING_A}&state=completed`);

    const table = page.getByRole("table");
    await expect(table.getByRole("row")).toHaveCount(EXPECTED.completed + 1);
    await expect(table).toContainText("cora@example.invalid");

    // The export link the page offers, followed exactly as a click would.
    const href = await page.getByRole("link", { name: "Export CSV" }).getAttribute("href");
    expect(href).toContain("state=completed");
    const csv = await page.request.get(href!);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(csv.headers()["content-disposition"]).toContain("attachment");

    const text = await csv.text();
    expect(text.charCodeAt(0)).toBe(0xfeff); // the BOM
    const lines = text.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0].startsWith("enrollment_id,organization,cohort,program")).toBe(true);
    // One header and one completed learner: the file matches the screen.
    expect(lines).toHaveLength(EXPECTED.completed + 1);
    expect(lines[1]).toContain("cora@example.invalid");
    // Nothing anybody wrote is in it.
    expect(text).not.toContain(fixtures.progress.cora.exercise_response);
  });

  test("shows an empty table and dashes rather than zeros when nothing matches", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    await page.goto(`/manage/${ORG_A}/reports?completed_from=2099-01-01`);

    await expect(page.getByText("No enrollments match these filters.")).toBeVisible();
    // spec/04: "Zero denominator displayed '—'".
    await expect(page.getByText("—", { exact: true }).first()).toBeVisible();
  });

  test("denies a manager another organization, on the page and on the export", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");

    await page.goto(`/manage/${ORG_B}/reports`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("not available");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("organization b");

    const csv = await page.request.get(`/api/v1/reports/enrollments.csv?organization_id=${ORG_B}`);
    expect(csv.status()).toBe(403);
    expect(csv.headers()["content-type"]).toContain("application/json");
  });

  test("denies a learner the reports entirely", async ({ page }) => {
    await signIn(page, "amber@example.invalid");
    await page.goto(`/manage/${ORG_A}/reports`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("not available");

    const api = await page.request.get(`/api/v1/reports/enrollments?organization_id=${ORG_A}`);
    expect(api.status()).toBe(403);
  });

  test("rejects an unknown filter rather than ignoring it", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    const api = await page.request.get(
      `/api/v1/reports/enrollments?organization_id=${ORG_A}&sort_by=salary`
    );
    expect(api.status()).toBe(422);
    expect((await api.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
