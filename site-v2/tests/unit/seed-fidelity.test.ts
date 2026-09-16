import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * supabase/seed.sql is generated from tests/fixtures.json. This fails if the
 * checked-in file is stale, so a fixture edit cannot silently leave the seed
 * behind — the same guard M01 has against contracts/schema.sql.
 *
 * Needs no database.
 */
const root = path.join(__dirname, "../..");
const seedPath = path.join(root, "supabase/seed.sql");

describe("seed generated from fixtures.json", () => {
  it("is up to date with the fixture contract", () => {
    const before = readFileSync(seedPath, "utf8");
    execFileSync("node", [path.join(root, "scripts/generate-seed.mjs")], { cwd: root });
    expect(readFileSync(seedPath, "utf8")).toBe(before);
  });

  it("commits no password and no real recipient", () => {
    // Comments are prose and may legitimately mention the word; only the
    // statements are inspected.
    const statements = readFileSync(seedPath, "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    // fixtures.json: "Do not commit passwords ... no real outbound recipients."
    expect(statements).not.toMatch(/password|encrypted_pw|crypt\(/i);
    for (const address of statements.match(/[\w.+-]+@[\w.-]+/g) ?? []) {
      expect(address).toMatch(/@example\.invalid$/);
    }
  });

  it("uses the fixture's own identifiers rather than generating new ones", () => {
    const fixtures = JSON.parse(readFileSync(path.join(root, "tests/fixtures.json"), "utf8"));
    const seed = readFileSync(seedPath, "utf8");
    for (const alias of ["amber", "ben", "cora", "dana", "offering_a", "enroll_cora", "certificate_cora"]) {
      expect(seed).toContain(fixtures.ids[alias]);
    }
    // Every UUID in the seed must come from the fixture's id table.
    const known = new Set(Object.values(fixtures.ids));
    for (const uuid of seed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) {
      expect(known.has(uuid)).toBe(true);
    }
  });
});
