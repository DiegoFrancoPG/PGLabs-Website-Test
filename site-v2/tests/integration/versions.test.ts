import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * clone_version — "give me this program's draft".
 *
 * The contract declares POST /programs/{program_id}/versions and this had no
 * handler until T23. The reason it needed one is a gap the contract leaves:
 * `Program` carries only `latest_published_version_id`, and no operation lists
 * a program's versions — so once an author navigates away from a draft,
 * nothing in the API can tell them its id again.
 *
 * Hence: an existing draft is RETURNED rather than a second one created.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  admin: ADMIN, manager_a: MANAGER_A, amber: AMBER,
  program_shared: PROGRAM, version_shared: VERSION,
} = fixtures.ids;

/*
 * A programme of this suite's own, published, with no draft.
 *
 * The fixture's shared programme is not used for the create-a-draft cases:
 * tests/e2e/admin.spec.ts opens a draft on it against the same database, so a
 * test that asserted "no draft exists yet" would pass or fail depending on
 * what else had run. Each test establishes what it needs.
 */
async function freshProgram(client: Client): Promise<string> {
  await client.query("RESET ROLE");
  const program = (
    await client.query(
      "INSERT INTO app.programs(title, summary) VALUES ('Draft test programme', '') RETURNING id"
    )
  ).rows[0].id;
  await client.query(
    `INSERT INTO app.program_versions(program_id, version_number, title, state, published_at)
     VALUES ($1, 1, 'Version 1', 'published', now())`,
    [program]
  );
  return program;
}

async function asUser(client: Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}
const rpc = (action: string, payload: object) =>
  `SELECT public.pglearn_rpc('${action}', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) AS out`;
const call = async (client: Client, action: string, payload: object) =>
  (await client.query(rpc(action, payload))).rows[0].out;

describe.skipIf(!hasDatabase)("clone_version", () => {
  it("creates the next draft when a program has only published versions", async () => {
    await inRollback(async (client) => {
      const program = await freshProgram(client);
      await asUser(client, ADMIN);
      const result = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: program,
      });

      expect(result.created).toBe(true);
      expect(result.version.state).toBe("draft");
      // The fixture's published version is 1, so the draft is 2.
      expect(result.version.version_number).toBe(2);
      expect(result.version.program_id).toBe(program);
    });
  });

  it("returns the existing draft instead of making a second one", async () => {
    await inRollback(async (client) => {
      const program = await freshProgram(client);
      await asUser(client, ADMIN);
      const first = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: program,
      });
      // A different request id — a new request, not a retry.
      const second = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: program,
      });

      expect(second.created).toBe(false);
      expect(second.version.id).toBe(first.version.id);

      await client.query("RESET ROLE");
      const drafts = await client.query(
        "SELECT count(*)::int AS n FROM app.program_versions WHERE program_id=$1 AND state='draft'",
        [program]
      );
      // This is the property the editor relies on: one draft at a time, so
      // "open the draft" always lands on the same work.
      expect(drafts.rows[0].n).toBe(1);
    });
  });

  it("is idempotent for one request id", async () => {
    await inRollback(async (client) => {
      const program = await freshProgram(client);
      await asUser(client, ADMIN);
      const payload = { request_id: crypto.randomUUID(), program_id: program };
      const first = await call(client, "clone_version", payload);
      const second = await call(client, "clone_version", payload);
      expect(second.version.id).toBe(first.version.id);
    });
  });

  it("does not copy the published version's content", async () => {
    await inRollback(async (client) => {
      const program = await freshProgram(client);
      await asUser(client, ADMIN);
      const draft = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: program,
      });

      const detail = await call(client, "get_version", { version_id: draft.version.id });
      /*
       * spec/04 lists "new draft version cloning" under "Deferred to later
       * releases", and an asset's storage_key is UNIQUE — a copied class could
       * not carry its media without moving the object. So the draft starts
       * empty, and that is a recorded limitation rather than a bug.
       */
      expect(detail.modules).toEqual([]);
      expect(detail.classes).toEqual([]);
    });
  });

  it("leaves the published version untouched", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      await call(client, "clone_version", { request_id: crypto.randomUUID(), program_id: PROGRAM });

      const published = await call(client, "get_version", { version_id: VERSION });
      expect(published.version.state).toBe("published");
      expect(published.classes.length).toBeGreaterThan(0);
    });
  });

  it("records who created a draft", async () => {
    await inRollback(async (client) => {
      const program = await freshProgram(client);
      await asUser(client, ADMIN);
      const draft = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: program,
      });

      await client.query("RESET ROLE");
      const audit = await client.query(
        "SELECT * FROM app.audit_events WHERE action='clone_version' AND entity_id=$1",
        [draft.version.id]
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].actor_id).toBe(ADMIN);
    });
  });

  it("is refused to a manager and to a learner", async () => {
    await inRollback(async (client) => {
      for (const actor of [MANAGER_A, AMBER]) {
        await asUser(client, actor);
        expect(
          await sqlStateOf(client, rpc("clone_version", {
            request_id: crypto.randomUUID(), program_id: PROGRAM,
          }))
        ).toBe("42501");
      }
    });
  });

  it("refuses a program that does not exist", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      expect(
        await sqlStateOf(client, rpc("clone_version", {
          request_id: crypto.randomUUID(), program_id: crypto.randomUUID(),
        }))
      ).toBe("P0002");
    });
  });
});
