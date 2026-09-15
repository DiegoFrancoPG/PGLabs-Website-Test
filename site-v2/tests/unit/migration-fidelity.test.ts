import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/*
 * spec/01: "contracts/schema.sql owns persisted column types/constraints."
 * M01 is an adaptation of that file, so this asserts the two cannot diverge —
 * the only permitted difference is the outer BEGIN/COMMIT, which the Supabase
 * CLI supplies itself.
 *
 * Runs without a database, so a contract edit that forgets the migration fails
 * in the unit suite rather than at deploy time.
 */

const root = path.join(__dirname, "../..");
const contract = readFileSync(path.join(root, "contracts/schema.sql"), "utf8");
const migrationsDir = path.join(root, "supabase/migrations");
const m01Name = readdirSync(migrationsDir).find((f) => f.includes("m01_schema"));
const m01 = readFileSync(path.join(migrationsDir, m01Name!), "utf8");

/** The contract with its transaction wrapper removed. */
const expectedBody = contract.replace(/^BEGIN;\n/m, "").replace(/\nCOMMIT;\n?$/, "\n");

/** The migration with its own leading comment header removed. */
const actualBody = m01.slice(m01.indexOf("-- PGLearn v1.0 reference DDL"));

describe("M01 fidelity to contracts/schema.sql", () => {
  it("reproduces the contract DDL exactly", () => {
    expect(actualBody).toBe(expectedBody);
  });

  it("drops the transaction wrapper and nothing else", () => {
    expect(m01).not.toMatch(/^BEGIN;$/m);
    expect(m01).not.toMatch(/^COMMIT;$/m);
    // Every statement-initiating keyword in the contract survives.
    const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
    for (const re of [/^CREATE TABLE /gm, /^CREATE INDEX /gm, /^CREATE UNIQUE INDEX /gm, /^ALTER TABLE /gm]) {
      expect(count(actualBody, re)).toBe(count(contract, re));
    }
  });

  it("leaves the Supabase auth schema untouched, per spec/02 M01", () => {
    // A foreign key reference is expected; anything that modifies auth is not.
    expect(m01).toMatch(/REFERENCES auth\.users\(id\)/);
    expect(m01).not.toMatch(/\b(CREATE|ALTER|DROP)\s+(TABLE|SCHEMA|ROLE)\s+auth\b/i);
    expect(m01).not.toMatch(/\bDROP\s+/i);
  });

  it("keeps every app table private, with RLS on and no anon/authenticated grants", () => {
    expect(m01).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(m01).toMatch(/REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated/);
    expect(m01).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated/);
    // spec/02: "no permissive policy". M01 must not create one.
    expect(m01).not.toMatch(/CREATE POLICY/i);
    expect(m01).not.toMatch(/GRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE)/i);
  });

  it("defines no RPC, which belongs to M03", () => {
    expect(m01).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\./i);
    expect(m01).not.toMatch(/pglearn_rpc|pglearn_job|pglearn_provision/);
  });
});
