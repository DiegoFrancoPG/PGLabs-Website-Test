import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * D-05 — a video class that plays from YouTube (migration M29).
 *
 * The claims: the database holds a YouTube id and nothing else; one class has
 * one source; publication asks a YouTube class for its id, duration and source
 * text but not for uploaded media or captions; the id is frozen with the rest
 * of a published version and travels into a clone; and progress on it is
 * earned by exactly the same heartbeat rules as an uploaded video.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  admin: ADMIN,
  amber: AMBER,
  enroll_amber: ENROLL_AMBER,
  class_video: CLASS_VIDEO,
} = fixtures.ids;

const YOUTUBE_ID = "dQw4w9WgXcQ";
const DURATION = 600_000;

async function asUser(client: Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}
const rpc = (action: string, payload: object) =>
  `SELECT public.pglearn_rpc('${action}', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) AS out`;

async function call(client: Client, action: string, payload: object) {
  return (await client.query(rpc(action, payload))).rows[0].out;
}

interface Issue {
  path: string;
  message: string;
}

/** A draft with one text class, so the version publishes once the video does. */
async function draft(client: Client) {
  await asUser(client, ADMIN);
  const program = await call(client, "create_program", {
    request_id: crypto.randomUUID(), title: "YouTube pilot", summary: "",
  });
  const versionId = program.version.id;
  const mod = await call(client, "create_module", {
    request_id: crypto.randomUUID(), version_id: versionId, title: "Module",
  });
  await call(client, "create_class", {
    request_id: crypto.randomUUID(), module_id: mod.id, title: "Reading", kind: "text",
    body_md: "Read this.", source_text: "Read this.",
  });
  return { versionId, moduleId: mod.id as string };
}

async function youtubeClass(client: Client, moduleId: string, extra: object = {}) {
  return call(client, "create_class", {
    request_id: crypto.randomUUID(), module_id: moduleId, title: "1. What AI actually is",
    kind: "video", youtube_video_id: YOUTUBE_ID, duration_ms: DURATION,
    source_text: "What the video says, from its transcript.", ...extra,
  });
}

describe.skipIf(!hasDatabase)("D-05 YouTube video classes: authoring", () => {
  it("stores the id and returns it in the Class DTO", async () => {
    await inRollback(async (client) => {
      const { moduleId } = await draft(client);
      const cls = await youtubeClass(client, moduleId);
      expect(cls.youtube_video_id).toBe(YOUTUBE_ID);
      expect(cls.primary_asset_id).toBeNull();
      expect(Number(cls.duration_ms)).toBe(DURATION);
    });
  });

  it("refuses anything that is not an eleven-character id", async () => {
    await inRollback(async (client) => {
      const { moduleId } = await draft(client);
      for (const bad of [
        `https://youtu.be/${YOUTUBE_ID}`,
        `${YOUTUBE_ID}"><script>`,
        "short",
      ]) {
        const state = await sqlStateOf(
          client,
          rpc("create_class", {
            request_id: crypto.randomUUID(), module_id: moduleId, title: "Bad",
            kind: "video", youtube_video_id: bad,
          })
        );
        expect(state).toBe("23514");
      }
    });
  });

  it("refuses a YouTube id on an audio class", async () => {
    await inRollback(async (client) => {
      const { moduleId } = await draft(client);
      const state = await sqlStateOf(
        client,
        rpc("create_class", {
          request_id: crypto.randomUUID(), module_id: moduleId, title: "Audio",
          kind: "audio", youtube_video_id: YOUTUBE_ID,
        })
      );
      expect(state).toBe("23514");
    });
  });

  it("never takes an audio class's file away because a YouTube id came with the patch", async () => {
    await inRollback(async (client) => {
      const { moduleId } = await draft(client);
      const cls = await call(client, "create_class", {
        request_id: crypto.randomUUID(), module_id: moduleId, title: "Audio", kind: "audio",
      });
      const upload = await call(client, "authorize_upload", {
        request_id: crypto.randomUUID(), class_id: cls.id, role: "primary",
        original_name: "talk.mp3", mime_type: "audio/mpeg", bytes: 1024,
      });
      await call(client, "finalize_upload", { asset_id: upload.asset.id, ok: true });

      const after = await call(client, "update_class", {
        class_id: cls.id, kind: "audio", youtube_video_id: YOUTUBE_ID,
      });
      expect(after.primary_asset_id).toBe(upload.asset.id);
      expect(after.youtube_video_id).toBeNull();
    });
  });

  it("drops the id when the class leaves the video format, and clears it on request", async () => {
    await inRollback(async (client) => {
      const { moduleId } = await draft(client);
      const cls = await youtubeClass(client, moduleId);

      const audio = await call(client, "update_class", { class_id: cls.id, kind: "audio" });
      expect(audio.youtube_video_id).toBeNull();

      const back = await call(client, "update_class", {
        class_id: cls.id, kind: "video", youtube_video_id: YOUTUBE_ID,
      });
      expect(back.youtube_video_id).toBe(YOUTUBE_ID);

      // An unrelated edit leaves it alone; an explicit null removes it.
      const renamed = await call(client, "update_class", { class_id: cls.id, title: "Renamed" });
      expect(renamed.youtube_video_id).toBe(YOUTUBE_ID);
      const cleared = await call(client, "update_class", { class_id: cls.id, youtube_video_id: null });
      expect(cleared.youtube_video_id).toBeNull();
    });
  });

  it("keeps one source per class: an uploaded primary and a YouTube id replace each other", async () => {
    await inRollback(async (client) => {
      const { moduleId } = await draft(client);
      const cls = await call(client, "create_class", {
        request_id: crypto.randomUUID(), module_id: moduleId, title: "Uploaded",
        kind: "video", duration_ms: DURATION,
      });

      // Upload and finalize a primary, as the finalize route would.
      const reserved = await call(client, "authorize_upload", {
        request_id: crypto.randomUUID(), class_id: cls.id, role: "primary",
        original_name: "lesson.mp4", mime_type: "video/mp4", bytes: 1024,
      });
      await call(client, "finalize_upload", { asset_id: reserved.asset.id, ok: true });

      const chosen = await call(client, "update_class", { class_id: cls.id, youtube_video_id: YOUTUBE_ID });
      expect(chosen.youtube_video_id).toBe(YOUTUBE_ID);
      expect(chosen.primary_asset_id).toBeNull();

      // Uploading again makes the file the source once more.
      const again = await call(client, "authorize_upload", {
        request_id: crypto.randomUUID(), class_id: cls.id, role: "primary",
        original_name: "lesson-v2.mp4", mime_type: "video/mp4", bytes: 2048,
      });
      await call(client, "finalize_upload", { asset_id: again.asset.id, ok: true });

      await client.query("RESET ROLE");
      const row = (
        await client.query("SELECT primary_asset_id, youtube_video_id FROM app.classes WHERE id=$1", [cls.id])
      ).rows[0];
      expect(row.primary_asset_id).toBe(again.asset.id);
      expect(row.youtube_video_id).toBeNull();
    });
  });
});

describe.skipIf(!hasDatabase)("D-05 YouTube video classes: publication", () => {
  it("publishes a YouTube class with no uploaded media and no caption asset", async () => {
    await inRollback(async (client) => {
      const { versionId, moduleId } = await draft(client);
      await youtubeClass(client, moduleId);

      const result = await call(client, "publish_version", { version_id: versionId });
      expect(result.issues as Issue[]).toEqual([]);
      expect(result.version.state).toBe("published");
    });
  });

  it("still requires its duration and its source text", async () => {
    await inRollback(async (client) => {
      const { versionId, moduleId } = await draft(client);
      const cls = await youtubeClass(client, moduleId, { duration_ms: null, source_text: "" });

      const result = await call(client, "publish_version", { version_id: versionId });
      const paths = (result.issues as Issue[]).map((i) => i.path);
      expect(paths).toContain(`class[${cls.id}].duration_ms`);
      expect(paths).toContain(`class[${cls.id}].source_text`);
      // Neither of the uploaded-media rules applies to it.
      expect(paths).not.toContain(`class[${cls.id}].primary_asset_id`);
      expect(paths).not.toContain(`class[${cls.id}].captions`);
      expect(result.version.state).toBe("draft");
    });
  });

  it("still requires media and captions of a video class without a YouTube id", async () => {
    await inRollback(async (client) => {
      const { versionId, moduleId } = await draft(client);
      const cls = await youtubeClass(client, moduleId, { youtube_video_id: null });

      const result = await call(client, "publish_version", { version_id: versionId });
      const paths = (result.issues as Issue[]).map((i) => i.path);
      expect(paths).toContain(`class[${cls.id}].primary_asset_id`);
      expect(paths).toContain(`class[${cls.id}].captions`);
    });
  });

  it("freezes the id with the rest of a published version", async () => {
    await inRollback(async (client) => {
      const { versionId, moduleId } = await draft(client);
      const cls = await youtubeClass(client, moduleId);
      await call(client, "publish_version", { version_id: versionId });

      const state = await sqlStateOf(
        client,
        rpc("update_class", { class_id: cls.id, youtube_video_id: "aaaaaaaaaaa" })
      );
      expect(state).not.toBeNull();
    });
  });

  it("carries the id into a cloned draft", async () => {
    await inRollback(async (client) => {
      const { versionId, moduleId } = await draft(client);
      await youtubeClass(client, moduleId);
      const published = await call(client, "publish_version", { version_id: versionId });

      const clone = await call(client, "clone_version", {
        request_id: crypto.randomUUID(), program_id: published.version.program_id,
      });
      expect(clone.created).toBe(true);
      // Nothing to copy in storage: the recording stays on YouTube.
      expect(clone.copies).toEqual([]);
      const target = clone.version.id;

      await client.query("RESET ROLE");
      const cloned = (
        await client.query(
          "SELECT youtube_video_id, duration_ms FROM app.classes WHERE version_id=$1 AND kind='video'",
          [target]
        )
      ).rows;
      expect(cloned).toHaveLength(1);
      expect(cloned[0].youtube_video_id).toBe(YOUTUBE_ID);
      expect(Number(cloned[0].duration_ms)).toBe(DURATION);
    });
  });

  it("does not copy a file the class was switched away from, so the clone can finish", async () => {
    await inRollback(async (client) => {
      const { versionId, moduleId } = await draft(client);
      const cls = await youtubeClass(client, moduleId, { youtube_video_id: null });
      const upload = await call(client, "authorize_upload", {
        request_id: crypto.randomUUID(), class_id: cls.id, role: "primary",
        original_name: "lesson.mp4", mime_type: "video/mp4", bytes: 1024,
      });
      await call(client, "finalize_upload", { asset_id: upload.asset.id, ok: true });
      const handout = await call(client, "authorize_upload", {
        request_id: crypto.randomUUID(), class_id: cls.id, role: "handout",
        original_name: "notes.pdf", mime_type: "application/pdf", bytes: 1024,
      });
      await call(client, "finalize_upload", { asset_id: handout.asset.id, ok: true });
      await call(client, "update_class", { class_id: cls.id, youtube_video_id: YOUTUBE_ID });
      const published = await call(client, "publish_version", { version_id: versionId });
      expect(published.issues).toEqual([]);

      const clone = await call(client, "clone_version", {
        request_id: crypto.randomUUID(), program_id: published.version.program_id,
      });
      // The handout is copied; the abandoned upload is not.
      expect(clone.copies.map((c: { role: string }) => c.role)).toEqual(["handout"]);

      // Finishing every copy succeeds and leaves the class on YouTube.
      await client.query("RESET ROLE");
      for (const copy of clone.copies) {
        await client.query("SELECT public.pglearn_job('clone.finish', $1::jsonb)", [
          JSON.stringify({ actor: ADMIN, asset_id: copy.asset_id, ok: true }),
        ]);
      }
      const row = (
        await client.query(
          "SELECT youtube_video_id, primary_asset_id FROM app.classes WHERE version_id=$1 AND kind='video'",
          [clone.version.id]
        )
      ).rows[0];
      expect(row.youtube_video_id).toBe(YOUTUBE_ID);
      expect(row.primary_asset_id).toBeNull();
    });
  });
});

/*
 * Progress. The fixture's published video class is turned into a YouTube one
 * inside the rolled-back transaction — the freeze trigger is lifted for that
 * one statement, as the table owner — so Amber's real enrollment can play it.
 */
async function makeFixtureVideoYouTube(client: Client) {
  await client.query("RESET ROLE");
  await client.query("ALTER TABLE app.classes DISABLE TRIGGER classes_frozen");
  await client.query(
    "UPDATE app.classes SET primary_asset_id = NULL, youtube_video_id = $2, duration_ms = $3 WHERE id = $1",
    [CLASS_VIDEO, YOUTUBE_ID, DURATION]
  );
  await client.query("ALTER TABLE app.classes ENABLE TRIGGER classes_frozen");
}

async function letTimePass(client: Client, sessionId: string, ms: number) {
  await client.query("RESET ROLE");
  await client.query(
    "UPDATE app.playback_sessions SET last_received_at = last_received_at - ($2 || ' milliseconds')::interval WHERE id=$1",
    [sessionId, String(ms)]
  );
  await asUser(client, AMBER);
}

describe.skipIf(!hasDatabase)("D-05 YouTube video classes: learning", () => {
  it("gives the learner the id, and never a signed file URL", async () => {
    await inRollback(async (client) => {
      await makeFixtureVideoYouTube(client);
      await asUser(client, AMBER);

      const detail = await call(client, "get_learning_class", {
        enrollment_id: ENROLL_AMBER, class_id: CLASS_VIDEO,
      });
      expect(detail.class.youtube_video_id).toBe(YOUTUBE_ID);
      expect(detail.class.primary_asset_id).toBeNull();
      expect(Number(detail.class.duration_ms)).toBe(DURATION);
    });
  });

  it("completes at 90% coverage by the same heartbeat rules, and refuses a skipped span", async () => {
    await inRollback(async (client) => {
      await makeFixtureVideoYouTube(client);
      await asUser(client, AMBER);

      const session = await call(client, "start_playback", {
        request_id: crypto.randomUUID(), enrollment_id: ENROLL_AMBER, class_id: CLASS_VIDEO,
      });

      // A claimed interval the elapsed time cannot cover is refused, whatever player sent it.
      await letTimePass(client, session.session_id, 30_000);
      const skipped = await sqlStateOf(
        client,
        rpc("record_progress", {
          enrollment_id: ENROLL_AMBER, class_id: CLASS_VIDEO, event_id: crypto.randomUUID(),
          session_id: session.session_id, sequence: 1, position_ms: 300_000,
          elapsed_ms: 30_000, rate: 1, interval: { start_ms: 0, end_ms: 300_000 },
        })
      );
      expect(skipped).not.toBeNull();

      // Watched properly, at 2x so each beat may carry a minute.
      let seq = 2;
      let result;
      for (let at = 0; at < 540_000; at += 60_000) {
        await letTimePass(client, session.session_id, 30_000);
        result = await call(client, "record_progress", {
          enrollment_id: ENROLL_AMBER, class_id: CLASS_VIDEO, event_id: crypto.randomUUID(),
          session_id: session.session_id, sequence: seq, position_ms: at + 60_000,
          elapsed_ms: 30_000, rate: 2, interval: { start_ms: at, end_ms: at + 60_000 },
        });
        expect(result.accepted).toBe(true);
        seq += 1;
        if (at + 60_000 < 540_000) expect(result.progress.content_complete).toBe(false);
      }
      // 540 of 600 seconds is exactly 90%.
      expect(result.progress.coverage_ms).toBe(540_000);
      expect(result.progress.content_complete).toBe(true);
    });
  });
});
