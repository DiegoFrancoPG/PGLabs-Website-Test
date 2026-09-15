import { test, expect } from "@playwright/test";

/*
 * The marketing site is the index PGLearn was added to. These guard the
 * boundary established at T00: the public pages stay public and indexable,
 * and the Figma capture script never ships to production.
 */
test.describe("marketing shell", () => {
  test("home renders the masthead, footer and organisation schema", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "PG Labs" }).first()).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

    const schema = await page.locator('script[type="application/ld+json"]').textContent();
    expect(JSON.parse(schema ?? "{}")["@type"]).toBe("Organization");
  });

  test("stays indexable", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.headers()["x-robots-tag"]).toBeUndefined();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index/);
  });

  test("does not load the Figma capture script in a production build", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('script[src*="mcp.figma.com"]')).toHaveCount(0);
  });

  test("an unknown URL returns a 404 page that still looks like the site", async ({ page }) => {
    const res = await page.goto("/no-such-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("could not be found");
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });
});
