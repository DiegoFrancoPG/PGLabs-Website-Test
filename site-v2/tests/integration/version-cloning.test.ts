import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback } from "./db";

/*
 * AC-056 — a new version of something people are already learning.
 *
 * "Published version with existing enrollments. Clone to new version, edit,
 * publish, assign to new cohort. Existing learners keep original
 * IDs/requirements/media; new assignment can select new version."
 *
 * The whole scenario turns on one property: the clone must share NOTHING with
 * the version it came from. Not a class id, not a requirement, not a storage
 * key. T23 sidestepped it by creating an empty draft and recording the
 * omission; T27 clones the content, and every test here is a way of asking
 * whether the two versions can still touch each other.
 *
 * The storage half — the bytes — is settled by the application after this
 * transaction commits, so these tests assert on what the database owns: new
 * rows at new keys, PENDING until the copy is confirmed.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const { admin: ADMIN } = fixtures.ids;

async function asUser(client: Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}
const call = async (client: Client, action: string, payload: object) =>
  (
    await client.query(
      `SELECT public.pglearn_rpc('${action}', '${JSON.stringify(payload).replace(
        /'/g,
        "''"
      )}'::jsonb) AS out`
    )
  ).rows[0].out;

/**
 * A published programme with the shape that makes cloning interesting: two
 * modules, a required video with an asset and a caption, an optional text
 * class with an exercise, and indexed chunks.
 */
async function publishedProgram(client: Client) {
  await client.query("RESET ROLE");
  const program = (
    await client.query(
      "INSERT INTO app.programs(title, summary) VALUES ('Clone test programme', '') RETURNING id"
    )
  ).rows[0].id;
  const version = (
    await client.query(
      `INSERT INTO app.program_versions(program_id, version_number, title, description_md, state, published_at)
       VALUES ($1, 1, 'Version 1', 'The first one', 'draft', NULL) RETURNING id`,
      [program]
    )
  ).rows[0].id;
  const moduleA = (
    await client.query(
      "INSERT INTO app.modules(version_id, title, position) VALUES ($1,'Module one',0) RETURNING id",
      [version]
    )
  ).rows[0].id;
  const moduleB = (
    await client.query(
      "INSERT INTO app.modules(version_id, title, position) VALUES ($1,'Module two',1) RETURNING id",
      [version]
    )
  ).rows[0].id;

  const video = (
    await client.query(
      `INSERT INTO app.classes(module_id, version_id, title, position, kind, required, source_text, duration_ms)
       VALUES ($1,$2,'A video',0,'video',true,'spoken words',600000) RETURNING id`,
      [moduleA, version]
    )
  ).rows[0].id;
  const asset = (
    await client.query(
      `INSERT INTO app.assets(class_id, role, original_name, mime_type, bytes, storage_key, state)
       VALUES ($1,'primary','lesson.mp4','video/mp4',1024,$2,'ready') RETURNING id`,
      [video, `versions/${version}/classes/${video}/primary/lesson.mp4`]
    )
  ).rows[0].id;
  await client.query("UPDATE app.classes SET primary_asset_id=$1 WHERE id=$2", [asset, video]);
  await client.query(
    `INSERT INTO app.assets(class_id, role, original_name, mime_type, bytes, storage_key, playback_key, state)
     VALUES ($1,'caption','lesson.srt','application/x-subrip',256,$2,$3,'ready')`,
    [
      video,
      `versions/${version}/classes/${video}/caption/lesson.srt`,
      `playback/${version}/${video}/lesson.vtt`,
    ]
  );

  // An OPTIONAL text class: `required` is one of the things AC-056 says a
  // learner keeps, so the clone has to carry a non-default value.
  const text = (
    await client.query(
      `INSERT INTO app.classes(module_id, version_id, title, position, kind, required, body_md, source_text)
       VALUES ($1,$2,'Some reading',0,'text',false,'# Reading','Reading') RETURNING id`,
      [moduleB, version]
    )
  ).rows[0].id;
  await client.query(
    "INSERT INTO app.exercises(class_id, instructions_md) VALUES ($1,'Write something.')",
    [text]
  );
  await client.query(
    `INSERT INTO app.content_chunks(class_id, version_id, ordinal, text_content)
     VALUES ($1,$2,0,'Reading the first chunk'),($1,$2,1,'and the second')`,
    [text, version]
  );

  /*
   * Published only once the content is in place: a trigger makes a published
   * version's content read-only, which is the rule AC-056 exists to protect
   * and which this fixture must respect like any author would.
   */
  await client.query(
    "UPDATE app.program_versions SET state='published', published_at=now() WHERE id=$1",
    [version]
  );
  return { program, version, moduleA, moduleB, video, text, asset };
}

describe.skipIf(!hasDatabase)("AC-056 cloning a published version", () => {
  it("copies every module, class and exercise, each at a new id", async () => {
    await inRollback(async (client) => {
      const source = await publishedProgram(client);
      await asUser(client, ADMIN);
      const result = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: source.program,
      });
      expect(result.created).toBe(true);
      const draft = result.version.id;

      await client.query("RESET ROLE");
      const counts = await client.query(
        `SELECT
           (SELECT count(*)::int FROM app.modules WHERE version_id=$1) AS modules,
           (SELECT count(*)::int FROM app.classes WHERE version_id=$1) AS classes,
           (SELECT count(*)::int FROM app.exercises e JOIN app.classes c ON c.id=e.class_id
             WHERE c.version_id=$1) AS exercises,
           (SELECT count(*)::int FROM app.content_chunks WHERE version_id=$1) AS chunks,
           (SELECT count(*)::int FROM app.assets a JOIN app.classes c ON c.id=a.class_id
             WHERE c.version_id=$1) AS assets`,
        [draft]
      );
      expect(counts.rows[0]).toEqual({
        modules: 2,
        classes: 2,
        exercises: 1,
        chunks: 2,
        assets: 2,
      });

      // Not one id in common. This is the whole of AC-056's "existing learners
      // keep original IDs": a learner's progress rows point at the old class
      // ids, and no row of the draft shares one.
      const shared = await client.query(
        `SELECT count(*)::int AS n FROM app.classes a JOIN app.classes b ON a.id = b.id
          WHERE a.version_id=$1 AND b.version_id=$2`,
        [source.version, draft]
      );
      expect(shared.rows[0].n).toBe(0);
    });
  });

  it("keeps each class's title, order, kind and requirement", async () => {
    await inRollback(async (client) => {
      const source = await publishedProgram(client);
      await asUser(client, ADMIN);
      const draft = (
        await call(client, "clone_version", {
          request_id: crypto.randomUUID(),
          program_id: source.program,
        })
      ).version.id;

      await client.query("RESET ROLE");
      const shape = (version: string) =>
        client.query(
          `SELECT m.title AS module, m.position AS module_position,
                  c.title, c.position, c.kind, c.required, c.body_md, c.source_text
             FROM app.modules m JOIN app.classes c ON c.module_id = m.id
            WHERE m.version_id = $1 ORDER BY m.position, c.position`,
          [version]
        );
      const before = await shape(source.version);
      const after = await shape(draft);
      expect(after.rows).toEqual(before.rows);
    });
  });

  it("gives every copied file its own key, and leaves it pending until it arrives", async () => {
    await inRollback(async (client) => {
      const source = await publishedProgram(client);
      await asUser(client, ADMIN);
      const result = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: source.program,
      });
      const draft = result.version.id;

      // The handler reports what the application must copy, one entry per file.
      expect(result.copies).toHaveLength(2);
      for (const copy of result.copies) {
        expect(copy.from).not.toBe(copy.to);
        expect(copy.to).toContain(draft);
        expect(copy.to).toContain(copy.asset_id);
      }
      // The caption's derived .vtt travels with it.
      const caption = result.copies.find((c: { role: string }) => c.role === "caption");
      expect(caption.from_playback).toContain(".vtt");

      await client.query("RESET ROLE");
      const assets = await client.query(
        `SELECT a.state, a.storage_key FROM app.assets a JOIN app.classes c ON c.id=a.class_id
          WHERE c.version_id=$1`,
        [draft]
      );
      // Pending, because the bytes are not there yet — and a class whose
      // primary asset is not ready cannot be published, so a half-copied
      // clone cannot go live by accident.
      for (const row of assets.rows) expect(row.state).toBe("pending");

      const collisions = await client.query(
        `SELECT count(*)::int AS n FROM app.assets a JOIN app.classes c ON c.id=a.class_id
          WHERE c.version_id=$1 AND a.storage_key IN
            (SELECT storage_key FROM app.assets x JOIN app.classes y ON y.id=x.class_id
              WHERE y.version_id=$2)`,
        [draft, source.version]
      );
      expect(collisions.rows[0].n).toBe(0);
    });
  });

  it("does not touch the published version or anybody enrolled on it", async () => {
    await inRollback(async (client) => {
      const source = await publishedProgram(client);
      const before = await client.query(
        `SELECT id, title, position, required, duration_ms, primary_asset_id
           FROM app.classes WHERE version_id=$1 ORDER BY id`,
        [source.version]
      );

      await asUser(client, ADMIN);
      await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: source.program,
      });

      await client.query("RESET ROLE");
      const after = await client.query(
        `SELECT id, title, position, required, duration_ms, primary_asset_id
           FROM app.classes WHERE version_id=$1 ORDER BY id`,
        [source.version]
      );
      expect(after.rows).toEqual(before.rows);

      const state = await client.query(
        "SELECT state FROM app.program_versions WHERE id=$1",
        [source.version]
      );
      expect(state.rows[0].state).toBe("published");
    });
  });

  it("edits to the draft do not reach the published version", async () => {
    await inRollback(async (client) => {
      const source = await publishedProgram(client);
      await asUser(client, ADMIN);
      const draft = (
        await call(client, "clone_version", {
          request_id: crypto.randomUUID(),
          program_id: source.program,
        })
      ).version.id;

      await client.query("RESET ROLE");
      const cloned = (
        await client.query(
          "SELECT id FROM app.classes WHERE version_id=$1 AND kind='text'",
          [draft]
        )
      ).rows[0].id;
      await client.query(
        "UPDATE app.classes SET title='Renamed in the draft', required=true WHERE id=$1",
        [cloned]
      );

      const original = await client.query(
        "SELECT title, required FROM app.classes WHERE id=$1",
        [source.text]
      );
      expect(original.rows[0]).toEqual({ title: "Some reading", required: false });
    });
  });

  it("returns the existing draft untouched rather than cloning twice", async () => {
    await inRollback(async (client) => {
      const source = await publishedProgram(client);
      await asUser(client, ADMIN);
      const payload = { program_id: source.program };
      const first = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        ...payload,
      });
      const second = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        ...payload,
      });

      expect(second.created).toBe(false);
      expect(second.version.id).toBe(first.version.id);
      // And no second copy of the content: pressing "Open draft" again is not
      // a way to end up with four modules.
      await client.query("RESET ROLE");
      const modules = await client.query(
        "SELECT count(*)::int AS n FROM app.modules WHERE version_id=$1",
        [first.version.id]
      );
      expect(modules.rows[0].n).toBe(2);
    });
  });

  it("clones nothing when the program has never been published", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const program = (
        await client.query(
          "INSERT INTO app.programs(title, summary) VALUES ('Never published', '') RETURNING id"
        )
      ).rows[0].id;

      await asUser(client, ADMIN);
      const result = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: program,
      });
      expect(result.created).toBe(true);
      expect(result.copies).toEqual([]);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-056 settling the copied files", () => {
  async function draftWithCopies(client: Client) {
    const source = await publishedProgram(client);
    await asUser(client, ADMIN);
    const result = await call(client, "clone_version", {
      request_id: crypto.randomUUID(),
      program_id: source.program,
    });
    await client.query("RESET ROLE");
    return { source, draft: result.version.id, copies: result.copies };
  }

  const job = async (client: Client, payload: object) =>
    (
      await client.query(
        `SELECT public.pglearn_job('clone.finish', '${JSON.stringify(payload).replace(
          /'/g,
          "''"
        )}'::jsonb) AS out`
      )
    ).rows[0].out;

  it("makes a class playable again once its file has been copied", async () => {
    await inRollback(async (client) => {
      const { copies } = await draftWithCopies(client);
      const primary = copies.find((c: { role: string }) => c.role === "primary");

      const out = await job(client, {
        actor: ADMIN,
        asset_id: primary.asset_id,
        ok: true,
        duration_ms: primary.duration_ms,
      });
      expect(out.state).toBe("ready");

      const row = await client.query(
        `SELECT c.duration_ms, c.primary_asset_id, a.state
           FROM app.assets a JOIN app.classes c ON c.id = a.class_id WHERE a.id=$1`,
        [primary.asset_id]
      );
      expect(row.rows[0].state).toBe("ready");
      expect(String(row.rows[0].duration_ms)).toBe(String(primary.duration_ms));
      expect(row.rows[0].primary_asset_id).toBe(primary.asset_id);
    });
  });

  it("records a file that did not copy, so publication stays blocked", async () => {
    await inRollback(async (client) => {
      const { draft, copies } = await draftWithCopies(client);
      const primary = copies.find((c: { role: string }) => c.role === "primary");

      const out = await job(client, {
        actor: ADMIN,
        asset_id: primary.asset_id,
        ok: false,
        error_code: "SOURCE_MISSING",
      });
      expect(out.state).toBe("failed");

      const row = await client.query("SELECT state, error_code FROM app.assets WHERE id=$1", [
        primary.asset_id,
      ]);
      expect(row.rows[0]).toEqual({ state: "failed", error_code: "SOURCE_MISSING" });

      // The class has no primary asset, which is what publish_version refuses on.
      await asUser(client, ADMIN);
      const published = await call(client, "publish_version", { version_id: draft });
      expect(published.issues.length).toBeGreaterThan(0);
      expect(published.version.state).toBe("draft");
    });
  });

  it("refuses to settle a copy for somebody who is not an administrator", async () => {
    await inRollback(async (client) => {
      const { copies } = await draftWithCopies(client);
      await expect(
        job(client, { actor: fixtures.ids.amber, asset_id: copies[0].asset_id, ok: true })
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("refuses to settle an asset belonging to a published version", async () => {
    await inRollback(async (client) => {
      const source = await publishedProgram(client);
      await expect(
        job(client, { actor: ADMIN, asset_id: source.asset, ok: true })
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
});

/*
 * The rest of AC-056: "new assignment can select v2; no silent migration."
 */
describe.skipIf(!hasDatabase)("AC-056 publishing the clone and assigning it", () => {
  const { program_shared: SEEDED, version_shared: SEEDED_VERSION } = fixtures.ids;

  /** Any draft left by another suite or by the e2e run, removed inside the transaction. */
  async function clearDrafts(client: Client, program: string) {
    const drafts = `SELECT id FROM app.program_versions WHERE program_id='${program}' AND state='draft'`;
    await client.query(
      `DELETE FROM app.assets WHERE class_id IN (SELECT id FROM app.classes WHERE version_id IN (${drafts}))`
    );
    await client.query(`DELETE FROM app.content_chunks WHERE version_id IN (${drafts})`);
    await client.query(
      `DELETE FROM app.exercises WHERE class_id IN (SELECT id FROM app.classes WHERE version_id IN (${drafts}))`
    );
    await client.query(`UPDATE app.classes SET primary_asset_id=NULL WHERE version_id IN (${drafts})`);
    await client.query(`DELETE FROM app.classes WHERE version_id IN (${drafts})`);
    await client.query(`DELETE FROM app.modules WHERE version_id IN (${drafts})`);
    await client.query(`DELETE FROM app.program_versions WHERE id IN (${drafts})`);
  }

  /*
   * "No silent migration" is asked of the SEEDED programme, because it is the
   * only one with real enrollments on it — which is the premise of the
   * scenario, "a published version with existing enrollments". Everything
   * happens inside the rollback, so the shared fixture is unharmed.
   */
  it("moves nobody to the new version", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      await clearDrafts(client, SEEDED);
      const before = await client.query(
        "SELECT id, version_id, last_class_id FROM app.enrollments WHERE program_id=$1 ORDER BY id",
        [SEEDED]
      );
      expect(before.rows.length).toBeGreaterThan(0);

      await asUser(client, ADMIN);
      await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: SEEDED,
      });

      await client.query("RESET ROLE");
      const after = await client.query(
        "SELECT id, version_id, last_class_id FROM app.enrollments WHERE program_id=$1 ORDER BY id",
        [SEEDED]
      );
      // Same enrollments, same version, same place in the course. Cloning is
      // not a migration and never becomes one.
      expect(after.rows).toEqual(before.rows);
      expect(new Set(after.rows.map((row) => row.version_id))).toEqual(new Set([SEEDED_VERSION]));
    });
  });

  /**
   * An organization, a grant and a cohort for the fixture programme, so a new
   * assignment has somewhere to land.
   */
  async function assignable(client: Client, program: string) {
    const organization = fixtures.ids.org_a;
    const grant = (
      await client.query(
        `INSERT INTO app.program_grants(program_id, organization_id, starts_at)
         VALUES ($1,$2, now() - interval '1 day') RETURNING id`,
        [program, organization]
      )
    ).rows[0].id;
    const cohort = (
      await client.query(
        "INSERT INTO app.cohorts(organization_id, name) VALUES ($1,'Next intake') RETURNING id",
        [organization]
      )
    ).rows[0].id;
    return { grant, cohort };
  }

  it("publishes the clone and lets a new assignment select it", async () => {
    await inRollback(async (client) => {
      const source = await publishedProgram(client);

      await asUser(client, ADMIN);
      const cloned = await call(client, "clone_version", {
        request_id: crypto.randomUUID(),
        program_id: source.program,
      });
      const draft = cloned.version.id;

      /*
       * The application's half, done here as it would be once the files land.
       * The text class carries an exercise in the fixture but is optional,
       * which publication refuses — so the draft is corrected first, which is
       * exactly what an author does with a draft.
       */
      await client.query("RESET ROLE");
      for (const copy of cloned.copies) {
        await client.query(`SELECT public.pglearn_job('clone.finish', $1::jsonb)`, [
          JSON.stringify({ actor: ADMIN, asset_id: copy.asset_id, ok: true }),
        ]);
      }
      await client.query(
        "UPDATE app.classes SET required=true WHERE version_id=$1 AND kind='text'",
        [draft]
      );

      await asUser(client, ADMIN);
      const published = await call(client, "publish_version", { version_id: draft });
      // A clone of a valid version is valid: copying loses nothing publication
      // asks for — not the duration, not the captions, not the source text.
      expect(published.issues).toEqual([]);
      expect(published.version.state).toBe("published");

      await client.query("RESET ROLE");
      const { grant, cohort } = await assignable(client, source.program);

      await asUser(client, ADMIN);
      const offering = await call(client, "create_offering", {
        request_id: crypto.randomUUID(),
        cohort_id: cohort,
        version_id: draft,
        grant_id: grant,
        starts_at: new Date(Date.now() + 86_400_000).toISOString(),
        due_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        access_ends_at: null,
      });
      // AC-056: "new assignment can select the new version."
      expect(offering.version_id ?? offering.offering?.version_id).toBe(draft);
    });
  });
});
