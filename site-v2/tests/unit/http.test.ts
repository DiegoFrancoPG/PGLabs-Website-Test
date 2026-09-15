import { describe, it, expect } from "vitest";
import {
  jsonOk,
  jsonError,
  jsonRateLimited,
  resolveRequestId,
  isUuid,
  ERROR_STATUS,
} from "@/lib/http";

const KEY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("response envelope", () => {
  it("wraps success as {data, request_id}", async () => {
    const res = jsonOk({ status: "ok" }, KEY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: "ok" }, request_id: KEY });
  });

  it("always emits fields on an error, since the contract requires it", async () => {
    const body = await jsonError("NOT_FOUND", "Not found", KEY).json();
    expect(body).toEqual({
      error: { code: "NOT_FOUND", message: "Not found", fields: [] },
      request_id: KEY,
    });
  });

  it("maps each error code to the status in spec/05", () => {
    expect(ERROR_STATUS.UNAUTHENTICATED).toBe(401);
    expect(ERROR_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_STATUS.SESSION_SUPERSEDED).toBe(409);
    expect(ERROR_STATUS.ACCESS_UNAVAILABLE).toBe(422);
    expect(ERROR_STATUS.TUTOR_BUDGET_EXCEEDED).toBe(429);
    expect(ERROR_STATUS.NOT_CONFIGURED).toBe(503);
  });

  it("sends Retry-After on a temporary rate limit", () => {
    const res = jsonRateLimited("RATE_LIMITED", "Slow down", KEY, 12.2);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("13");
  });
});

describe("request id", () => {
  it("uses a valid Idempotency-Key as the request id", () => {
    const req = new Request("https://example.test/api/v1/me", {
      headers: { "Idempotency-Key": KEY },
    });
    expect(resolveRequestId(req)).toBe(KEY);
  });

  it("generates one when the header is absent", () => {
    const id = resolveRequestId(new Request("https://example.test/api/v1/health"));
    expect(isUuid(id)).toBe(true);
  });

  it("does not adopt a malformed key as the request id", () => {
    const req = new Request("https://example.test/api/v1/me", {
      headers: { "Idempotency-Key": "not-a-uuid" },
    });
    const id = resolveRequestId(req);
    expect(id).not.toBe("not-a-uuid");
    expect(isUuid(id)).toBe(true);
  });
});
