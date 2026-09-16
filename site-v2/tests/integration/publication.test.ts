import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-018 — publication guard.
 * AC-019 — published immutability.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  admin: ADMIN,
  manager_a: MANAGER_A,
  version_shared: PUBLISHED_VERSION,
  class_video: PUBLISHED_CLASS,
  enroll_amber: ENROLL_AMBER,
} = fixtures.ids;

async function asUser(client: import("pg").Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}
const rpc = (action: string, payload: object) =>
  `SELECT public.pglearn_rpc('${action}', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) AS out`;

interface Issue {
  path: string;
  message: string;
}

/**
 * A draft that would publish cleanly. Each test then breaks exactly one thing,
 * which is what makes a failure point at the rule rather than at the fixture.
 */
async function publishableDraft(client: import("pg").Client) {
  await asUser(client, ADMIN);
  const program = await client.query(
    rpc("create_program", { request_id: crypto.randomUUID(), title: "Publishable", summary: "" })
  );
  const versionId = program.rows[0].out.version.id;
  const mod = await client.query(
    rpc("create_module", { request_id: crypto.randomUUID(), version_id: versionId, title: "Module" })
  );
  const moduleId = mod.rows[0].out.id;

  // A text class avoids needing media, so the media rules can be tested apart.
  const cls = await client.query(
    rpc("create_class", {
      request_id: crypto.randomUUID(),
      module_id: moduleId,
      title: "Reading",
      kind: "text",
      required: true,
      body_md: "# Verify outputs\n\nCheck claims against reliable sources.",
      source_text: "Check AI claims against reliable sources before acting on them.",
    })
  );
  return { versionId, moduleId, classId: cls.rows[0].out.id };
}

async function publish(client: import("pg").Client, versionId: string) {
  const r = await client.query(rpc("publish_version", { version_id: versionId }));
  return r.rows[0].out as { version: { state: string }; issues: Issue[] };
}

describe.skipIf(!hasDatabase)("AC-018 publication guard", () => {
  it("publishes a complete draft and indexes its source text", async () => {
    await inRollback(async (client) => {
      const { versionId, classId } = await publishableDraft(client);
      const result = await publish(client, versionId);

      expect(result.issues).toEqual([]);
      expect(result.version.state).toBe("published");

      await client.query("RESET ROLE");
      const chunks = await client.query(
        "SELECT ordinal, text_content FROM app.content_chunks WHERE class_id=$1 ORDER BY ordinal",
        [classId]
      );
      // Indexed in the same transaction that published it, per spec/03.
      expect(chunks.rows.length).toBeGreaterThan(0);
      expect(chunks.rows[0].text_content).toContain("reliable sources");
    });
  });

  it("refuses a version where every class is optional", async () => {
    await inRollback(async (client) => {
      const { versionId, classId } = await publishableDraft(client);
      await client.query(rpc("update_class", { class_id: classId, required: false }));

      const result = await publish(client, versionId);
      // Otherwise the program could be "completed" without doing anything.
      expect(result.issues.map((i) => i.path)).toContain("version.classes");
      expect(result.version.state).toBe("draft");
    });
  });

  it("refuses a class with no source text for the tutor", async () => {
    await inRollback(async (client) => {
      const { versionId, classId } = await publishableDraft(client);
      await client.query(rpc("update_class", { class_id: classId, source_text: "" }));

      const result = await publish(client, versionId);
      expect(result.issues.map((i) => i.path)).toContain(`class[${classId}].source_text`);
    });
  });

  it("refuses a video with no caption track", async () => {
    await inRollback(async (client) => {
      const { versionId, moduleId } = await publishableDraft(client);
      const video = await client.query(
        rpc("create_class", {
          request_id: crypto.randomUUID(), module_id: moduleId, title: "Video",
          kind: "video", source_text: "Spoken words.", duration_ms: 600000,
        })
      );
      const videoId = video.rows[0].out.id;

      const result = await publish(client, versionId);
      const paths = result.issues.map((i) => i.path);
      // spec/03: "each video has a valid caption track".
      expect(paths).toContain(`class[${videoId}].captions`);
      // And it is also missing its media, reported at the same time.
      expect(paths).toContain(`class[${videoId}].primary_asset_id`);
      expect(result.version.state).toBe("draft");
    });
  });

  it("refuses a module with no classes", async () => {
    await inRollback(async (client) => {
      const { versionId } = await publishableDraft(client);
      const empty = await client.query(
        rpc("create_module", { request_id: crypto.randomUUID(), version_id: versionId, title: "Empty" })
      );
      const result = await publish(client, versionId);
      expect(result.issues.map((i) => i.path)).toContain(
        `module[${empty.rows[0].out.id}].classes`
      );
    });
  });

  it("refuses positions that do not run from zero without gaps", async () => {
    await inRollback(async (client) => {
      const { versionId, classId } = await publishableDraft(client);
      await client.query("RESET ROLE");
      await client.query("UPDATE app.classes SET position = 5 WHERE id=$1", [classId]);
      await asUser(client, ADMIN);

      const result = await publish(client, versionId);
      expect(result.issues.some((i) => i.message.includes("without gaps"))).toBe(true);
    });
  });

  it("refuses an exercise on a class that is not required", async () => {
    await inRollback(async (client) => {
      const { versionId, classId } = await publishableDraft(client);
      await client.query(rpc("put_exercise", { class_id: classId, instructions_md: "Practise." }));
      // put_exercise makes the class required, so this forces the invalid state
      // the publish guard exists to catch.
      await client.query("RESET ROLE");
      await client.query("UPDATE app.classes SET required = false WHERE id=$1", [classId]);
      await asUser(client, ADMIN);

      const result = await publish(client, versionId);
      const paths = result.issues.map((i) => i.path);
      expect(paths).toContain(`class[${classId}].required`);
    });
  });

  it("refuses a handout that never finished uploading", async () => {
    await inRollback(async (client) => {
      const { versionId, classId } = await publishableDraft(client);
      await client.query(
        rpc("authorize_upload", {
          request_id: crypto.randomUUID(), class_id: classId, role: "handout",
          original_name: "notes.pdf", mime_type: "application/pdf", bytes: 1024,
        })
      );
      // Left pending: spec/03 says an attached handout must be ready.
      const result = await publish(client, versionId);
      expect(result.issues.map((i) => i.path)).toContain(`class[${classId}].handouts`);
    });
  });

  it("reports every problem at once, not the first one", async () => {
    await inRollback(async (client) => {
      const { versionId, classId } = await publishableDraft(client);
      /*
       * Three independent failures: nothing is required any more, the one class
       * has no source text, and a second module has no classes. Titles are not
       * used here because the schema CHECK already makes an empty one
       * impossible to store.
       */
      await client.query(rpc("update_class", { class_id: classId, required: false, source_text: "" }));
      await client.query(
        rpc("create_module", { request_id: crypto.randomUUID(), version_id: versionId, title: "Empty" })
      );

      const result = await publish(client, versionId);
      // spec/04 has the editor list missing fields per class; one at a time
      // would make preparing a nine-video course a guessing game.
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
      const paths = result.issues.map((i) => i.path);
      expect(paths).toContain("version.classes");
      expect(paths).toContain(`class[${classId}].source_text`);
    });
  });

  it("leaves the draft completely untouched when it refuses", async () => {
    await inRollback(async (client) => {
      const { versionId, classId } = await publishableDraft(client);
      await client.query(rpc("update_class", { class_id: classId, source_text: "" }));

      await client.query("RESET ROLE");
      const before = await client.query(
        `SELECT (SELECT state FROM app.program_versions WHERE id=$1) AS state,
                (SELECT count(*)::int FROM app.content_chunks WHERE version_id=$1) AS chunks`,
        [versionId]
      );
      await asUser(client, ADMIN);
      await publish(client, versionId);

      await client.query("RESET ROLE");
      const after = await client.query(
        `SELECT (SELECT state FROM app.program_versions WHERE id=$1) AS state,
                (SELECT count(*)::int FROM app.content_chunks WHERE version_id=$1) AS chunks`,
        [versionId]
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
      expect(after.rows[0].state).toBe("draft");
    });
  });

  it("refuses publication to anyone but a platform admin", async () => {
    await inRollback(async (client) => {
      const { versionId } = await publishableDraft(client);
      await client.query("RESET ROLE");
      await asUser(client, MANAGER_A);
      expect(await sqlStateOf(client, rpc("publish_version", { version_id: versionId }))).toBe(
        "42501"
      );
    });
  });

  it("is idempotent, and does not move published_at or reindex", async () => {
    await inRollback(async (client) => {
      const { versionId } = await publishableDraft(client);
      await publish(client, versionId);

      await client.query("RESET ROLE");
      const first = await client.query(
        `SELECT published_at, (SELECT count(*)::int FROM app.content_chunks WHERE version_id=$1) AS chunks
         FROM app.program_versions WHERE id=$1`,
        [versionId]
      );

      await asUser(client, ADMIN);
      await publish(client, versionId);

      await client.query("RESET ROLE");
      const second = await client.query(
        `SELECT published_at, (SELECT count(*)::int FROM app.content_chunks WHERE version_id=$1) AS chunks
         FROM app.program_versions WHERE id=$1`,
        [versionId]
      );
      expect(second.rows[0]).toEqual(first.rows[0]);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-019 published immutability", () => {
  it("has a published version with a live enrollment to protect", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const r = await client.query(
        `SELECT (SELECT state FROM app.program_versions WHERE id=$1) AS state,
                (SELECT count(*)::int FROM app.enrollments WHERE version_id=$1) AS enrollments`,
        [PUBLISHED_VERSION]
      );
      expect(r.rows[0].state).toBe("published");
      expect(r.rows[0].enrollments).toBeGreaterThan(0);
    });
  });

  it.each([
    ["rename the version", `UPDATE app.program_versions SET title='Edited' WHERE id='${PUBLISHED_VERSION}'`],
    ["return it to draft", `UPDATE app.program_versions SET state='draft' WHERE id='${PUBLISHED_VERSION}'`],
    ["delete it", `DELETE FROM app.program_versions WHERE id='${PUBLISHED_VERSION}'`],
    ["rename a module", `UPDATE app.modules SET title='Edited' WHERE version_id='${PUBLISHED_VERSION}'`],
    ["delete a module", `DELETE FROM app.modules WHERE version_id='${PUBLISHED_VERSION}'`],
    ["add a module", `INSERT INTO app.modules(version_id,title,position) VALUES('${PUBLISHED_VERSION}','Added',9)`],
    ["edit a class", `UPDATE app.classes SET title='Edited' WHERE id='${PUBLISHED_CLASS}'`],
    ["delete a class", `DELETE FROM app.classes WHERE id='${PUBLISHED_CLASS}'`],
    ["make a class optional", `UPDATE app.classes SET required=false WHERE id='${PUBLISHED_CLASS}'`],
    ["add an asset", `INSERT INTO app.assets(class_id,role,original_name,mime_type,bytes,storage_key,state) VALUES('${PUBLISHED_CLASS}','handout','x.pdf','application/pdf',1,'k','ready')`],
    ["edit an exercise", `UPDATE app.exercises SET instructions_md='Edited' WHERE class_id IN (SELECT id FROM app.classes WHERE version_id='${PUBLISHED_VERSION}')`],
  ])("refuses to %s, even with database privileges", async (_name, statement) => {
    await inRollback(async (client) => {
      /*
       * Run as the table owner, not through a handler. spec/02 is explicit that
       * "RLS alone does not secure a buggy privileged function" — the freeze has
       * to hold against direct SQL, which is what this proves.
       */
      await client.query("RESET ROLE");
      expect(await sqlStateOf(client, statement)).toBe("23514");
    });
  });

  it("leaves the completion denominator and source text exactly as they were", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const before = await client.query(
        `SELECT count(*) FILTER (WHERE required)::int AS required_classes,
                count(*)::int AS total_classes,
                md5(string_agg(source_text, '|' ORDER BY position)) AS source_fingerprint
         FROM app.classes WHERE version_id=$1`,
        [PUBLISHED_VERSION]
      );

      // Every edit an attacker or a bug might attempt.
      for (const statement of [
        `UPDATE app.classes SET required=false WHERE version_id='${PUBLISHED_VERSION}'`,
        `UPDATE app.classes SET source_text='replaced' WHERE version_id='${PUBLISHED_VERSION}'`,
        `DELETE FROM app.classes WHERE version_id='${PUBLISHED_VERSION}'`,
      ]) {
        await sqlStateOf(client, statement);
      }

      const after = await client.query(
        `SELECT count(*) FILTER (WHERE required)::int AS required_classes,
                count(*)::int AS total_classes,
                md5(string_agg(source_text, '|' ORDER BY position)) AS source_fingerprint
         FROM app.classes WHERE version_id=$1`,
        [PUBLISHED_VERSION]
      );
      // AC-019: "original denominator/source/assets unchanged."
      expect(after.rows[0]).toEqual(before.rows[0]);
    });
  });

  it("keeps an enrolled learner's progress meaningful, since the denominator cannot move", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const denominator = await client.query(
        "SELECT count(*)::int AS n FROM app.classes WHERE version_id=$1 AND required",
        [PUBLISHED_VERSION]
      );
      await sqlStateOf(
        client,
        `INSERT INTO app.classes(module_id,version_id,title,position,kind,required,body_md,source_text)
         SELECT module_id,version_id,'Extra',9,'text',true,'x','x' FROM app.classes WHERE id='${PUBLISHED_CLASS}'`
      );
      const after = await client.query(
        "SELECT count(*)::int AS n FROM app.classes WHERE version_id=$1 AND required",
        [PUBLISHED_VERSION]
      );
      /*
       * If a class could be added to a published version, every enrolled
       * learner's percentage would silently drop — which is the concrete harm
       * the freeze prevents.
       */
      expect(after.rows[0].n).toBe(denominator.rows[0].n);
      const enrolled = await client.query(
        "SELECT count(*)::int AS n FROM app.enrollments WHERE id=$1",
        [ENROLL_AMBER]
      );
      expect(enrolled.rows[0].n).toBe(1);
    });
  });
});
