import { test, expect } from "@playwright/test";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/*
 * AC-007 — anonymous and logout.
 * AC-064 — foreign Origin mutation.
 */

test.describe("AC-007 anonymous access", () => {
  test("a protected page redirects an anonymous visitor to sign in", async ({ page }) => {
    await page.goto("/learn");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Sign in");
  });

  test("settings redirects too, and remembers where the visitor was going", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings|\/login\?next=\/settings/);
  });

  test("the API answers 401 rather than redirecting", async ({ request }) => {
    const res = await request.get("/api/v1/me");
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("no protected response may be cached for another user", async ({ request }) => {
    for (const path of ["/api/v1/me", "/learn", "/settings"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.headers()["cache-control"], path).toContain("no-store");
      expect(res.headers()["cache-control"], path).toContain("private");
    }
  });

  test("protected pages are never indexed", async ({ request }) => {
    const res = await request.get("/learn", { maxRedirects: 0 });
    expect(res.headers()["x-robots-tag"]).toContain("noindex");
  });
});

test.describe("AC-064 foreign Origin mutation", () => {
  test("rejects a mutation from an attacker Origin with 403", async ({ request }) => {
    const res = await request.patch("/api/v1/me", {
      headers: {
        Origin: "https://attacker.example",
        "Idempotency-Key": UUID,
        "Content-Type": "application/json",
      },
      data: { display_name: "Taken over" },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  test("rejects a mutation with no Origin header at all", async ({ playwright, baseURL }) => {
    // A bare API context sends no Origin, which is what a non-browser client does.
    const api = await playwright.request.newContext({ baseURL });
    const res = await api.patch("/api/v1/me", {
      headers: { "Idempotency-Key": UUID, "Content-Type": "application/json" },
      data: { display_name: "Taken over" },
    });
    expect(res.status()).toBe(403);
    await api.dispose();
  });

  test("is refused before authentication is even considered", async ({ request }) => {
    /*
     * The anonymous same-origin request gets 401 from the route, while the
     * foreign-origin one gets 403 from the middleware. Different statuses
     * prove the Origin check runs first — so a valid session cookie replayed
     * from another site never reaches the handler.
     */
    const foreign = await request.patch("/api/v1/me", {
      headers: {
        Origin: "https://attacker.example",
        "Idempotency-Key": UUID,
        "Content-Type": "application/json",
      },
      data: { display_name: "x" },
    });
    const sameOrigin = await request.patch("/api/v1/me", {
      headers: {
        Origin: "http://127.0.0.1:3001",
        "Idempotency-Key": UUID,
        "Content-Type": "application/json",
      },
      data: { display_name: "x" },
    });
    expect(foreign.status()).toBe(403);
    expect(sameOrigin.status()).toBe(401);
  });

  test("a same-origin GET is never blocked by the Origin rule", async ({ request }) => {
    const res = await request.get("/api/v1/health", { headers: { Origin: "https://attacker.example" } });
    // Reads are side-effect free, so the rule applies to mutations only.
    expect(res.status()).toBe(200);
  });

  test("requires a UUID Idempotency-Key on a mutation", async ({ request }) => {
    const res = await request.patch("/api/v1/me", {
      headers: {
        Origin: "http://127.0.0.1:3001",
        "Content-Type": "application/json",
      },
      data: { display_name: "x" },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
