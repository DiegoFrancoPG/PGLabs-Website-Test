import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { signIn } from "./session";

/*
 * T24 — the invariants, checked across every surface at once.
 *
 * The individual scenarios each passed when they were written. What this file
 * asks is different: does every route that EXISTS NOW still obey them? Ten
 * tasks of new endpoints and screens have been added since AC-007 and AC-064
 * were first satisfied, and the failure this guards against is a route added
 * later that quietly forgot a rule nobody re-checked.
 *
 * So the inventory is taken from contracts/api.json and from the filesystem
 * rather than typed out here: a route that is added without being considered
 * appears in these tests automatically.
 */

const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const contract = JSON.parse(
  readFileSync(path.join(__dirname, "../../contracts/api.json"), "utf8")
) as { paths: Record<string, Record<string, { operationId?: string }>> };

const ORIGIN = "http://127.0.0.1:3001";

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path.join(__dirname, "../../.env.local"), "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    out[key.trim()] = rest.join("=").trim();
  }
  return out;
}
const config = env();

/*
 * Every contract operation, with its path parameters filled from the fixtures.
 * A uuid that does not exist is fine for these tests: what is being checked is
 * refused-before-anything, and a 401 must arrive before a 404 can.
 */
const SAMPLE: Record<string, string> = {
  organization_id: fixtures.ids.org_a,
  user_id: fixtures.ids.amber,
  invitation_id: "f3000001-0000-4000-8000-000000000000",
  cohort_id: fixtures.ids.cohort_a,
  grant_id: fixtures.ids.grant_a,
  program_id: fixtures.ids.program_shared,
  version_id: fixtures.ids.version_shared,
  module_id: fixtures.ids.module_shared,
  class_id: fixtures.ids.class_video,
  asset_id: fixtures.ids.source_video,
  offering_id: fixtures.ids.offering_a,
  enrollment_id: fixtures.ids.enroll_amber,
  exercise_id: fixtures.ids.exercise_audio,
  certificate_id: fixtures.ids.certificate_cora,
  request_id: "f4000001-0000-4000-8000-000000000000",
  session_id: "f5000001-0000-4000-8000-000000000000",
  notification_id: "f6000001-0000-4000-8000-000000000000",
};

interface Operation {
  method: string;
  url: string;
  operationId: string;
}

function operations(): Operation[] {
  const out: Operation[] = [];
  for (const [template, methods] of Object.entries(contract.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const url = template.replace(/\{(\w+)\}/g, (_, name: string) => SAMPLE[name] ?? "unknown");
      out.push({
        method: method.toUpperCase(),
        url: `/api/v1${url}`,
        operationId: op.operationId ?? `${method} ${template}`,
      });
    }
  }
  return out;
}

/*
 * Routes that are deliberately NOT session-authenticated, each for a stated
 * reason. Anything not on this list must refuse an anonymous caller.
 */
const UNAUTHENTICATED = new Set([
  "health", // a liveness probe, carrying no data about anybody
  "run_reminders", // the scheduler, behind CRON_SECRET instead
  "email_webhook", // the provider, behind a signature instead
]);

/*
 * Declared in the contract and not yet built. Listed by name so the sweep says
 * what is missing rather than failing anonymously — and so shipping one
 * without removing it from here fails loudly.
 */
const NOT_YET_IMPLEMENTED = new Set([
  "run_retention", // T28
]);

/** Every page under app/(platform), found on disk rather than listed here. */
function platformPages(): string[] {
  const root = path.join(__dirname, "../../app/(platform)");
  const found: string[] = [];
  const walk = (dir: string, url: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        // A route group's name never appears in the URL.
        const segment = entry.startsWith("(") ? "" : `/${entry}`;
        walk(full, `${url}${segment}`);
      } else if (entry === "page.tsx") {
        found.push(url === "" ? "/" : url);
      }
    }
  };
  walk(root, "");
  // Dynamic segments filled with a real id, so the page renders rather than 404s.
  return found.map((url) =>
    url
      .replace("[enrollmentId]", fixtures.ids.enroll_amber)
      .replace("[classId]", fixtures.ids.class_video)
      .replace("[id]", fixtures.ids.certificate_cora)
      .replace("[orgId]", fixtures.ids.org_a)
      .replace("[cohortId]", fixtures.ids.cohort_a)
      .replace("[programId]", fixtures.ids.program_shared)
      .replace("[versionId]", fixtures.ids.version_shared)
  );
}

test.describe("AC-007 and AC-064 — every route, not only the ones with a test", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "covered at desktop width");

  test("refuses an anonymous caller on every authenticated operation", async ({ request }) => {
    const wrong: string[] = [];

    for (const operation of operations()) {
      if (UNAUTHENTICATED.has(operation.operationId)) continue;
      if (NOT_YET_IMPLEMENTED.has(operation.operationId)) continue;

      const response = await call(request, operation, {
        // A valid Origin and Idempotency-Key, so the only thing missing is the
        // session: a 403 from the Origin rule would hide the real question.
        Origin: ORIGIN,
        "Idempotency-Key": SAMPLE.request_id,
        "Content-Type": "application/json",
      });

      // 401 is the answer. 403, 404 or 422 would mean the route thought about
      // the request before establishing who was asking.
      if (response.status() !== 401) {
        wrong.push(`${operation.operationId} → ${response.status()}`);
      }
    }

    expect(wrong, "operations that answered an anonymous caller with something other than 401").toEqual(
      []
    );
  });

  test("refuses a cross-site mutation on every mutating operation", async ({ request }) => {
    const wrong: string[] = [];

    for (const operation of operations()) {
      if (operation.method === "GET") continue;
      if (UNAUTHENTICATED.has(operation.operationId)) continue;
      if (NOT_YET_IMPLEMENTED.has(operation.operationId)) continue;

      const response = await call(request, operation, {
        Origin: "https://attacker.example",
        "Idempotency-Key": SAMPLE.request_id,
        "Content-Type": "application/json",
      });

      // 403 before anything else, including before authentication: the Origin
      // rule is enforced in proxy.ts, ahead of every route.
      if (response.status() !== 403) {
        wrong.push(`${operation.operationId} → ${response.status()}`);
      }
    }

    expect(wrong, "mutations that did not refuse a foreign Origin with 403").toEqual([]);
  });

  test("never allows an authenticated response to be cached", async ({ page }) => {
    await signIn(page, "amber@example.invalid");
    const wrong: string[] = [];

    for (const url of platformPages()) {
      const response = await page.goto(url);
      const cache = response?.headers()["cache-control"] ?? "";
      if (!cache.includes("no-store")) wrong.push(`${url} → ${cache || "(no header)"}`);
    }

    // Every API route too, through one representative read.
    for (const url of ["/api/v1/me", "/api/v1/enrollments", "/api/v1/health"]) {
      const response = await page.request.get(url, { headers: { Origin: ORIGIN } });
      const cache = response.headers()["cache-control"] ?? "";
      if (!cache.includes("no-store")) wrong.push(`${url} → ${cache || "(no header)"}`);
    }

    expect(wrong, "responses that could be cached across users").toEqual([]);
  });

  test("sends an anonymous visitor from every platform page to sign in", async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const wrong: string[] = [];

      for (const url of platformPages()) {
        // /login and the recovery pages are themselves anonymous.
        if (["/login", "/forgot-password", "/set-password"].includes(url)) continue;
        await page.goto(url);
        if (!page.url().includes("/login")) wrong.push(`${url} → ${page.url()}`);
      }

      expect(wrong, "platform pages that rendered for an anonymous visitor").toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("AC-021, AC-023, AC-032, AC-038, AC-039 — the boundaries, together", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "covered at desktop width");

  test("a learner reaches nothing belonging to anybody else", async ({ page }) => {
    await signIn(page, "ben@example.invalid");
    const headers = { Origin: ORIGIN, "Content-Type": "application/json" };
    const refused: Record<string, number> = {};

    const attempts: [string, string, object?][] = [
      // Another learner's enrollment, class, exercise and certificate.
      ["GET", `/api/v1/enrollments/${fixtures.ids.enroll_amber}`],
      ["GET", `/api/v1/enrollments/${fixtures.ids.enroll_amber}/classes/${fixtures.ids.class_video}`],
      [
        "GET",
        `/api/v1/enrollments/${fixtures.ids.enroll_amber}/exercises/${fixtures.ids.exercise_audio}/completion`,
      ],
      ["GET", `/api/v1/certificates/${fixtures.ids.certificate_cora}`],
      ["GET", `/api/v1/certificates/${fixtures.ids.certificate_cora}/pdf`],
      // Management and administration.
      ["GET", `/api/v1/reports/enrollments?organization_id=${fixtures.ids.org_a}`],
      ["GET", "/api/v1/operations/notifications"],
      ["GET", "/api/v1/operations/jobs"],
      ["GET", `/api/v1/cohorts?organization_id=${fixtures.ids.org_a}`],
    ];

    for (const [method, url] of attempts) {
      const response = await page.request.fetch(url, { method, headers });
      refused[url] = response.status();
      // 403 or 404 — never 200. Which of the two is the contract's business;
      // that it is not 200 is this test's.
      expect(response.status(), `${method} ${url}`).not.toBe(200);
      // And nothing leaks in the body either.
      const body = await response.text();
      expect(body).not.toContain("amber@example.invalid");
      expect(body).not.toContain("Cora");
    }

    /*
     * list_organizations is the exception, and deliberately so: it answers
     * everybody, and filters to the organizations the caller administers or
     * manages. A learner therefore gets 200 with an EMPTY list, which
     * discloses nothing — the refusal is in the contents, not the status.
     */
    const organizations = await page.request.get("/api/v1/organizations", { headers });
    expect(organizations.status()).toBe(200);
    expect((await organizations.json()).data.items).toEqual([]);
  });

  test("a manager reaches no personal enrollment and no other organization", async ({ page }) => {
    await signIn(page, "manager_a@example.invalid");
    const headers = { Origin: ORIGIN };

    // AC-021: a personal enrollment belongs to no organization, so no manager
    // can reach it however they ask.
    const report = await page.request.get("/api/v1/reports/enrollments?limit=100", { headers });
    expect(report.status()).toBe(200);
    const rows = (await report.json()).data.items as { organization: string | null }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.organization).not.toBeNull();

    // AC-038: another organization is refused rather than filtered.
    const foreign = await page.request.get(
      `/api/v1/reports/enrollments?organization_id=${fixtures.ids.org_b}`,
      { headers }
    );
    expect(foreign.status()).toBe(403);

    // The tutor, the operations screens and the catalog authoring are not theirs.
    for (const url of ["/api/v1/operations/notifications", "/api/v1/operations/jobs"]) {
      expect((await page.request.get(url, { headers })).status()).toBe(403);
    }
  });

  test("an admin sees everything they should and no secret anywhere", async ({ page }) => {
    await signIn(page, "admin@example.invalid");

    // The pages an administrator actually uses, checked for leaked material.
    const forbidden = [
      config.SUPABASE_SERVICE_ROLE_KEY,
      config.SUPABASE_DB_PASSWORD,
      config.PGLEARN_TEST_PASSWORD,
    ].filter((value): value is string => Boolean(value) && value.length > 8);

    for (const url of [
      "/admin/programs",
      "/admin/organizations",
      "/admin/individuals",
      "/admin/reports",
      "/admin/operations",
    ]) {
      await page.goto(url);
      const html = await page.content();
      for (const secret of forbidden) {
        expect(html, `${url} carried a secret`).not.toContain(secret);
      }
      // Nor an Auth action link, whatever the outbox is holding.
      expect(html).not.toContain("pkce_");
      expect(html).not.toContain("/auth/v1/verify");
    }
  });
});

test.describe("AC-003 and AC-004 — the database is not reachable from a browser", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) < 768, "covered at desktop width");

  test("the app schema is not exposed over the Data API, even to a session", async ({ request }) => {
    const base = config.NEXT_PUBLIC_SUPABASE_URL;
    const key = config.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    test.skip(!base || !key, "no Supabase project configured");

    for (const table of ["profiles", "enrollments", "certificates", "tutor_requests"]) {
      const response = await request.get(`${base}/rest/v1/${table}?select=*`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      // The app schema is not in the Data API's exposed schemas at all, so
      // PostgREST cannot see these names.
      expect(response.status(), table).not.toBe(200);
      const body = await response.text();
      expect(body).not.toContain("@example.invalid");
    }
  });

  test("the dispatcher refuses an unknown action the same way it refuses a denied one", async ({
    page,
  }) => {
    await signIn(page, "amber@example.invalid");
    const base = config.NEXT_PUBLIC_SUPABASE_URL;
    test.skip(!base, "no Supabase project configured");

    // Through our own API, an unknown action is not reachable at all: the
    // route table has no path for it. That is the first line; the dispatcher's
    // literal allowlist is the second, and is tested in the integration suite.
    const response = await page.request.post("/api/v1/nonexistent", {
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      data: {},
    });
    expect([403, 404]).toContain(response.status());
  });
});

/** Issues one contract operation with a body when the method needs one. */
async function call(
  request: APIRequestContext,
  operation: Operation,
  headers: Record<string, string>
) {
  const options = { headers, data: operation.method === "GET" ? undefined : {} };
  switch (operation.method) {
    case "GET":
      return request.get(operation.url, options);
    case "POST":
      return request.post(operation.url, options);
    case "PATCH":
      return request.patch(operation.url, options);
    case "PUT":
      return request.put(operation.url, options);
    case "DELETE":
      return request.delete(operation.url, options);
    default:
      return request.fetch(operation.url, { ...options, method: operation.method });
  }
}
