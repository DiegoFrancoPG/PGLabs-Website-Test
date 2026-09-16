import { test, expect } from "@playwright/test";
import { signIn } from "./session";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * AC-066 — learner navigation states.
 *
 * "Owned enrollment renders correct outline; empty/blocked states are clear;
 * unauthorized IDs denied; no completion is caused by GET."
 *
 * Driven through the real interface with real sessions, using the fixture
 * learners whose states were built for exactly this: Amber has started
 * nothing, Ben is part-way, Cora has finished.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const { enroll_amber: ENROLL_AMBER, enroll_cora: ENROLL_CORA, class_video: CLASS_VIDEO } =
  fixtures.ids;


test.describe("AC-066 learner navigation", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "covered at desktop width");

  test("the dashboard shows a card with counts, percentage and due date", async ({ page }) => {
    await signIn(page, "ben@example.invalid");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your learning");
    await expect(page.getByRole("heading", { name: "AI Foundations" })).toBeVisible();
    // Ben has finished two of three required classes.
    await expect(page.getByText("2 of 3 required classes")).toBeVisible();
    await expect(page.getByText("66.7%")).toBeVisible();
    await expect(page.getByText(/Due /)).toBeVisible();
  });

  test("tells a learner with nothing assigned exactly that", async ({ page }) => {
    // manager_b has no enrollments of their own.
    await signIn(page, "manager_b@example.invalid");
    // Matched without the apostrophe: the page uses a typographic one, and an
    // ASCII apostrophe in the test would silently never match.
    await expect(page.getByText(/been assigned a program yet/)).toBeVisible();
  });

  test("marks an unfinished, past-due program as overdue", async ({ page }) => {
    await signIn(page, "amber@example.invalid");
    // The fixture's due date is behind the real clock, and Amber has not finished.
    await expect(page.getByText("Overdue")).toBeVisible();
  });

  test("shows a finished program as completed rather than overdue", async ({ page }) => {
    await signIn(page, "cora@example.invalid");
    await expect(page.getByText("Completed")).toBeVisible();
    await expect(page.getByText("100%")).toBeVisible();
    await expect(page.getByRole("link", { name: "View completion" })).toBeVisible();
    // Cora finished before the due date, so she is not late.
    await expect(page.getByText("Overdue")).toBeHidden();
  });

  test("renders the outline grouped by module with required labels", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.goto(`/learn/${fixtures.ids.enroll_ben}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("AI Foundations");
    await expect(page.getByRole("heading", { name: "Module 1" })).toBeVisible();

    /*
     * Scoped to the badges. getByText matches substrings case-insensitively by
     * default, so a bare "Required" also matched the progress line's "3 of 3
     * required classes complete" and counted four.
     */
    await expect(page.getByText("Required", { exact: true })).toHaveCount(3);
    await expect(page.getByText("Complete", { exact: true })).toHaveCount(2);
  });

  test("denies an enrollment belonging to somebody else", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.goto(`/learn/${ENROLL_AMBER}`);
    // Reported as unavailable, never as "forbidden" — which would confirm it exists.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("not available");
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("amber");
  });

  test("denies an enrollment id that does not exist", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.goto("/learn/99999999-9999-4999-8999-999999999999");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("not available");
  });

  test("denies a class through an enrollment that is not the learner's", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.goto(`/learn/${ENROLL_AMBER}/classes/${CLASS_VIDEO}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("not available");
  });

  test("opens a class the learner owns, with previous and next", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    await page.goto(`/learn/${fixtures.ids.enroll_ben}/classes/${fixtures.ids.class_text}`);

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Class: text");
    await expect(page.getByRole("link", { name: "Previous" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Next" })).toBeVisible();
  });

  test("causes no completion by opening a class", async ({ page, request }) => {
    await signIn(page, "amber@example.invalid");

    const before = await page.request.get("/api/v1/enrollments");
    const beforeBody = await before.json();
    const amber = beforeBody.data.items[0];
    expect(amber.required_completed).toBe(0);

    // Open every class Amber has, twice, purely by GET.
    for (const pass of [1, 2]) {
      void pass;
      for (const cls of [fixtures.ids.class_video, fixtures.ids.class_text, fixtures.ids.class_audio]) {
        await page.goto(`/learn/${ENROLL_AMBER}/classes/${cls}`);
      }
    }

    const after = await page.request.get("/api/v1/enrollments");
    const afterBody = await after.json();
    /*
     * AC-066's last clause. Reading a class must never mark it done — the
     * handlers behind these routes are declared STABLE, so the database will
     * not let them write whatever the page does.
     */
    expect(afterBody.data.items[0].required_completed).toBe(0);
    expect(afterBody.data.items[0].progress_percent).toBe(0);
    void request;
  });

  test("the class API is a read and returns no completion", async ({ page }) => {
    await signIn(page, "amber@example.invalid");
    const res = await page.request.get(
      `/api/v1/enrollments/${ENROLL_AMBER}/classes/${CLASS_VIDEO}`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.progress.class_complete).toBe(false);
    expect(body.data.progress.content_complete).toBe(false);
  });

  test("never lists another learner's enrollment on the dashboard", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    const res = await page.request.get("/api/v1/enrollments");
    const ids = (await res.json()).data.items.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(ENROLL_AMBER);
    expect(ids).not.toContain(ENROLL_CORA);
  });
});
