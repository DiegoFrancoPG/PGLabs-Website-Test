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

/*
 * D-03: the marketing site is the index PGLearn was added to, so there has to
 * be a public way in. These pin the entry point down until /login exists at
 * T05 and the Sign in link joins the masthead.
 */
test.describe("PGLearn entry point", () => {
  test("is reachable from the masthead", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Learning", exact: true }).first().click();
    await expect(page).toHaveURL(/\/learning$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Structured learning");
  });

  test("offers no public sign-up, because ADR-05 disables it", async ({ page }) => {
    await page.goto("/learning");
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toMatch(/sign up|create an account|start free|free trial/);
    // Access is arranged with PG Labs, so the calls to action lead to contact.
    await expect(page.getByRole("link", { name: /talk to us about access/i })).toHaveAttribute(
      "href",
      "/contact"
    );
  });

  test("makes no accreditation or mastery claim, per ADR-11", async ({ page }) => {
    await page.goto("/learning");
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toMatch(/accredit|certified by|guarantee|mastery/);
  });

  test("states the privacy boundary managers are held to", async ({ page }) => {
    await page.goto("/learning");
    await expect(page.getByText(/never what someone wrote or asked/i)).toBeVisible();
  });
});
