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
  test("is reachable from the masthead at both widths", async ({ page }, testInfo) => {
    await page.goto("/");
    const isNarrow = (testInfo.project.use.viewport?.width ?? 1440) < 768;

    // Below md the links live behind the disclosure button.
    if (isNarrow) {
      await page.getByRole("button", { name: "Open menu" }).click();
    }

    const link = page.getByRole("navigation").getByRole("link", { name: "Learning", exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL("**/learning");
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

/*
 * The mobile menu. Until it existed, every section was unreachable from the
 * masthead on a phone, which spec/04's 390px requirement would not accept.
 */
test.describe("mobile menu", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) >= 768, "below md only");

  test("is closed to begin with, and its control says so", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Open menu" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Learning", exact: true })
    ).toBeHidden();
  });

  test("opens, exposes every section, and reports its state", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    for (const label of ["Services", "AI Readiness", "Learning", "Work", "About"]) {
      await expect(page.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
    }
  });

  test("carries the call to action, which does not fit beside the logo", async ({ page }) => {
    await page.goto("/");
    // Scoped to the masthead: the page body carries its own CTA with the same label.
    const headerCta = page.getByRole("banner").getByRole("link", { name: /talk to an ai expert/i });
    await expect(headerCta).toBeHidden();
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(headerCta).toBeVisible();
  });

  test("closes on Escape and gives focus back to its button", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Open menu" });
    await toggle.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
  });

  test("is operable by keyboard alone", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Close menu" })).toBeVisible();
  });

  test("closes itself after navigating", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("navigation").getByRole("link", { name: "About", exact: true }).click();
    await page.waitForURL("**/about");
    await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  test("does not overflow the viewport at 390px", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(overflow).toBe(false);
  });
});
