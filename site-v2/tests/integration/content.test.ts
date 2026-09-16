import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-014 — draft editing and ordering.
 *
 * "Valid order contiguous and persisted; invalid reorder rejected atomically."
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const { admin: ADMIN, manager_a: MANAGER_A, amber: AMBER } = fixtures.ids;

const KEY = "f6000001-0000-4000-8000-000000000000";

async function asUser(client: import("pg").Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}
const rpc = (action: string, payload: object) =>
  `SELECT public.pglearn_rpc('${action}', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) AS out`;

/*
 * A fresh draft program with two modules of three classes each. Built through
 * the handlers, so the fixture itself exercises creation.
 */
async function draftProgram(client: import("pg").Client) {
  await asUser(client, ADMIN);
  const created = await client.query(
    rpc("create_program", { request_id: KEY, title: "Ordering Test", summary: "" })
  );
  const versionId = created.rows[0].out.version.id;

  const modules: string[] = [];
  const classes: Record<string, string[]> = {};
  for (const name of ["Module One", "Module Two"]) {
    const m = await client.query(
      rpc("create_module", { request_id: crypto.randomUUID(), version_id: versionId, title: name })
    );
    const moduleId = m.rows[0].out.id;
    modules.push(moduleId);
    classes[moduleId] = [];
    for (const title of ["A", "B", "C"]) {
      const c = await client.query(
        rpc("create_class", { request_id: crypto.randomUUID(), module_id: moduleId, title, kind: "text", body_md: "x" })
      );
      classes[moduleId].push(c.rows[0].out.id);
    }
  }
  return { versionId, modules, classes };
}

describe.skipIf(!hasDatabase)("AC-014 draft editing and ordering", () => {
  it("creates content at contiguous positions starting from zero", async () => {
    await inRollback(async (client) => {
      const { versionId, modules, classes } = await draftProgram(client);
      await client.query("RESET ROLE");

      const m = await client.query(
        "SELECT position FROM app.modules WHERE version_id=$1 ORDER BY position",
        [versionId]
      );
      expect(m.rows.map((r) => r.position)).toEqual([0, 1]);

      const c = await client.query(
        "SELECT position FROM app.classes WHERE module_id=$1 ORDER BY position",
        [modules[0]]
      );
      expect(c.rows.map((r) => r.position)).toEqual([0, 1, 2]);
      expect(classes[modules[0]]).toHaveLength(3);
    });
  });

  it("persists a valid reorder as a contiguous run", async () => {
    await inRollback(async (client) => {
      const { modules, classes } = await draftProgram(client);
      const moduleId = modules[0];
      const [a, b, c] = classes[moduleId];

      await asUser(client, ADMIN);
      // Reverse the order: the first item moves past both others, which is the
      // case a non-deferred unique constraint would reject part-way through.
      await client.query(
        rpc("reorder_content", { parent_kind: "module", parent_id: moduleId, ordered_ids: [c, b, a] })
      );

      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT id, position FROM app.classes WHERE module_id=$1 ORDER BY position",
        [moduleId]
      );
      expect(r.rows.map((x) => x.id)).toEqual([c, b, a]);
      expect(r.rows.map((x) => x.position)).toEqual([0, 1, 2]);
    });
  });

  it("reorders modules within a version too", async () => {
    await inRollback(async (client) => {
      const { versionId, modules } = await draftProgram(client);
      await asUser(client, ADMIN);
      await client.query(
        rpc("reorder_content", { parent_kind: "version", parent_id: versionId, ordered_ids: [modules[1], modules[0]] })
      );
      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT id, position FROM app.modules WHERE version_id=$1 ORDER BY position",
        [versionId]
      );
      expect(r.rows.map((x) => x.id)).toEqual([modules[1], modules[0]]);
      expect(r.rows.map((x) => x.position)).toEqual([0, 1]);
    });
  });

  it("rejects a list containing the same child twice", async () => {
    await inRollback(async (client) => {
      const { modules, classes } = await draftProgram(client);
      const moduleId = modules[0];
      const [a, b] = classes[moduleId];
      await asUser(client, ADMIN);
      expect(
        await sqlStateOf(client, rpc("reorder_content", { parent_kind: "module", parent_id: moduleId, ordered_ids: [a, b, a] }))
      ).toBe("22023");
    });
  });

  it("rejects a list containing a child of another parent", async () => {
    await inRollback(async (client) => {
      const { modules, classes } = await draftProgram(client);
      const [first, second] = modules;
      await asUser(client, ADMIN);
      const foreign = classes[second][0];
      expect(
        await sqlStateOf(client, rpc("reorder_content", {
          parent_kind: "module", parent_id: first,
          ordered_ids: [classes[first][0], classes[first][1], foreign],
        }))
      ).toBe("22023");
    });
  });

  it("rejects a partial list that omits a sibling", async () => {
    await inRollback(async (client) => {
      const { modules, classes } = await draftProgram(client);
      const moduleId = modules[0];
      await asUser(client, ADMIN);
      expect(
        await sqlStateOf(client, rpc("reorder_content", {
          parent_kind: "module", parent_id: moduleId,
          ordered_ids: [classes[moduleId][1], classes[moduleId][0]],
        }))
      ).toBe("22023");
    });
  });

  it("leaves every position exactly as it was when a reorder is rejected", async () => {
    await inRollback(async (client) => {
      const { modules, classes } = await draftProgram(client);
      const moduleId = modules[0];
      await client.query("RESET ROLE");
      const before = await client.query(
        "SELECT id, position FROM app.classes WHERE module_id=$1 ORDER BY position",
        [moduleId]
      );

      await asUser(client, ADMIN);
      await sqlStateOf(client, rpc("reorder_content", {
        parent_kind: "module", parent_id: moduleId,
        ordered_ids: [classes[moduleId][2], classes[moduleId][0], classes[modules[1]][0]],
      }));

      await client.query("RESET ROLE");
      const after = await client.query(
        "SELECT id, position FROM app.classes WHERE module_id=$1 ORDER BY position",
        [moduleId]
      );
      // Atomic: a rejected reorder writes nothing at all.
      expect(after.rows).toEqual(before.rows);
    });
  });

  it("makes a class required as soon as it carries an exercise", async () => {
    await inRollback(async (client) => {
      const { modules, classes } = await draftProgram(client);
      const target = classes[modules[0]][0];
      await asUser(client, ADMIN);
      await client.query(rpc("update_class", { class_id: target, required: false }));
      await client.query(rpc("put_exercise", { class_id: target, instructions_md: "Practise this." }));

      await client.query("RESET ROLE");
      const r = await client.query("SELECT required FROM app.classes WHERE id=$1", [target]);
      // ADR-08: "Required exercise implies class is required."
      expect(r.rows[0].required).toBe(true);
    });
  });

  it("keeps at most one exercise per class", async () => {
    await inRollback(async (client) => {
      const { modules, classes } = await draftProgram(client);
      const target = classes[modules[0]][0];
      await asUser(client, ADMIN);
      await client.query(rpc("put_exercise", { class_id: target, instructions_md: "First" }));
      await client.query(rpc("put_exercise", { class_id: target, instructions_md: "Second" }));

      await client.query("RESET ROLE");
      const r = await client.query(
        "SELECT count(*)::int AS n, max(instructions_md) AS text FROM app.exercises WHERE class_id=$1",
        [target]
      );
      // ADR-08: up to one per class. A second PUT replaces rather than adds.
      expect(r.rows[0]).toEqual({ n: 1, text: "Second" });
    });
  });

  it("deletes a draft class and everything hanging off it", async () => {
    await inRollback(async (client) => {
      const { modules, classes } = await draftProgram(client);
      const target = classes[modules[0]][0];
      await asUser(client, ADMIN);
      await client.query(rpc("put_exercise", { class_id: target, instructions_md: "x" }));
      await client.query(rpc("delete_class", { class_id: target }));

      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT (SELECT count(*)::int FROM app.classes WHERE id=$1) AS classes,
                (SELECT count(*)::int FROM app.exercises WHERE class_id=$1) AS exercises`,
        [target]
      );
      expect(r.rows[0]).toEqual({ classes: 0, exercises: 0 });
    });
  });

  it("refuses every authoring action to a manager", async () => {
    await inRollback(async (client) => {
      const { versionId, modules } = await draftProgram(client);
      await asUser(client, MANAGER_A);
      for (const call of [
        rpc("create_program", { request_id: KEY, title: "x", summary: "" }),
        rpc("get_version", { version_id: versionId }),
        rpc("create_module", { request_id: KEY, version_id: versionId, title: "x" }),
        rpc("update_module", { module_id: modules[0], title: "x" }),
        rpc("reorder_content", { parent_kind: "version", parent_id: versionId, ordered_ids: modules }),
      ]) {
        expect(await sqlStateOf(client, call)).toBe("42501");
      }
    });
  });

  it("shows a manager only the catalogue they are entitled to", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const r = await client.query(rpc("list_programs", {}));
      const ids = r.rows[0].out.items.map((p: { id: string }) => p.id);
      // Organization A holds a grant for the shared program only.
      expect(ids).toEqual([fixtures.ids.program_shared]);
      expect(ids).not.toContain(fixtures.ids.program_b_only);
    });
  });

  it("shows a learner nothing they hold no grant for", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const r = await client.query(rpc("list_programs", {}));
      // Amber learns through her organization's offering, not a grant of her own.
      expect(r.rows[0].out.items).toEqual([]);
    });
  });

  it("refuses to edit content once its version is published", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const published = fixtures.ids.version_shared;
      const detail = await client.query(rpc("get_version", { version_id: published }));
      const moduleId = detail.rows[0].out.modules[0].id;

      // The M02 freeze applies whatever path reaches the table.
      expect(await sqlStateOf(client, rpc("update_module", { module_id: moduleId, title: "Edited" }))).toBe("23514");
      expect(
        await sqlStateOf(client, rpc("create_class", { request_id: KEY, module_id: moduleId, title: "New", kind: "text" }))
      ).toBe("23514");
      expect(
        await sqlStateOf(client, rpc("delete_class", { class_id: fixtures.ids.class_video }))
      ).toBe("23514");
    });
  });
});
