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
  test("is reachable from the site chrome at both widths", async ({ page }, testInfo) => {
    await page.goto("/");

    /*
     * The masthead nav is `hidden md:flex`, and site-v2 ships no mobile menu at
     * all — so at 390px the only route to any section is the footer. That is a
     * pre-existing gap in the marketing site, recorded in HANDOFF; this test
     * asserts what is actually reachable rather than pretending otherwise.
     */
    const isNarrow = (testInfo.project.use.viewport?.width ?? 1440) < 768;
    const link = isNarrow
      ? page.getByRole("contentinfo").getByRole("link", { name: "Learning", exact: true })
      : page.getByRole("navigation").getByRole("link", { name: "Learning", exact: true });

    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL("**/learning");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Structured learning");
  });

  test("the masthead navigation is desktop-only, which is a known gap", async ({ page }, testInfo) => {
    await page.goto("/");
    const navLinks = page.getByRole("navigation").getByRole("link", { name: "Learning", exact: true });
    const isNarrow = (testInfo.project.use.viewport?.width ?? 1440) < 768;
    // Pins the current behaviour so that adding a mobile menu later fails here
    // and forces this expectation to be updated deliberately.
    await expect(navLinks).toBeVisible({ visible: !isNarrow });
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
