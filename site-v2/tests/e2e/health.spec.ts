import { test, expect } from "@playwright/test";

test.describe("GET /api/v1/health", () => {
  test("is reachable without a session and reports status and version", async ({ request }) => {
    const res = await request.get("/api/v1/health");
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.data.status).toBe("ok");
    expect(typeof body.data.version).toBe("string");
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("is never cached, since /api/v1 is covered by the no-store rule", async ({ request }) => {
    const res = await request.get("/api/v1/health");
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers()["x-robots-tag"]).toContain("noindex");
  });
});
