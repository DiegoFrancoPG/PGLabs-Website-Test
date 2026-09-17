import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GET } from "@/app/api/v1/health/route";
import { isUuid } from "@/lib/http";

/*
 * Checks the route's real response against contracts/api.json rather than a
 * shape copied into the test, so a contract edit that the handler does not
 * follow fails here. spec/01: "contracts/api.json owns HTTP shapes."
 *
 * No database and no provider: AC-001 requires the bootstrap to be verifiable
 * "without calling external providers".
 */

type Json = Record<string, unknown>;

const api = JSON.parse(
  readFileSync(path.join(__dirname, "../../contracts/api.json"), "utf8")
) as Json;

function deref(node: unknown): Json {
  const obj = node as Json;
  if (obj && typeof obj === "object" && "$ref" in obj) {
    const segments = String(obj.$ref).replace(/^#\//, "").split("/");
    return deref(segments.reduce<unknown>((acc, key) => (acc as Json)[key], api));
  }
  return obj;
}

/** Enough of JSON Schema for these contracts: required, enum, type, additionalProperties. */
function validate(rawSchema: unknown, value: unknown, at = "$"): string[] {
  const schema = deref(rawSchema);
  const problems: string[] = [];
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [`${at}: expected object`];
    }
    const record = value as Json;
    const properties = (schema.properties ?? {}) as Json;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in record)) problems.push(`${at}.${key}: required but missing`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!properties[key]) problems.push(`${at}.${key}: not permitted by contract`);
      }
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (key in record) problems.push(...validate(sub, record[key], `${at}.${key}`));
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string") problems.push(`${at}: expected string`);
    else if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      problems.push(`${at}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`);
    }
  }
  return problems;
}

const healthOperation = ((api.paths as Json)["/health"] as Json).get as Json;
const successSchema = (
  ((healthOperation.responses as Json)["200"] as Json).content as Json
)["application/json"] as Json;
const successBodySchema = successSchema.schema;

describe("GET /api/v1/health", () => {
  it("is declared public in the contract", () => {
    expect(healthOperation.operationId).toBe("health");
    expect(healthOperation["x-access"]).toBe("public");
    expect(healthOperation.security).toEqual([]);
  });

  it("answers 200 with a body the contract accepts", async () => {
    const res = await GET(new Request("http://localhost:3001/api/v1/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(validate(successBodySchema, body)).toEqual([]);
    expect(body.data.status).toBe("ok");
    expect(isUuid(body.request_id)).toBe(true);
  });

  it("returns status and version only — spec/05 forbids anything else here", async () => {
    const body = await (await GET(new Request("http://localhost:3001/api/v1/health"))).json();
    expect(Object.keys(body.data).sort()).toEqual(["status", "version"]);
    expect(Object.keys(body).sort()).toEqual(["data", "request_id"]);
  });

  it("does not echo a caller-supplied Idempotency-Key that is not a UUID", async () => {
    const res = await GET(
      new Request("http://localhost:3001/api/v1/health", {
        headers: { "Idempotency-Key": "../../etc/passwd" },
      })
    );
    const body = await res.json();
    expect(body.request_id).not.toBe("../../etc/passwd");
    expect(isUuid(body.request_id)).toBe(true);
  });

  it("detects a handler that drifts from the contract", () => {
    expect(validate(successBodySchema, { data: { status: "ok" }, request_id: "x" }))
      .toContain("$.data.version: required but missing");
    expect(validate(successBodySchema, { data: { status: "degraded", version: "1" }, request_id: "x" }))
      .toContain('$.data.status: "degraded" not in ["ok"]');
  });
});
