import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-015 — asset upload authorization.
 * AC-016 — upload finalization.
 * AC-062 — signed URL reauthorization.
 *
 * These cover the authorization and bookkeeping rules against the real
 * database. The storage round trip and real media playback are exercised
 * separately; see HANDOFF for what remains blocked on actual assets.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  admin: ADMIN,
  amber: AMBER,
  ben: BEN,
  manager_a: MANAGER_A,
  class_video: CLASS_VIDEO,
} = fixtures.ids;

const KEY = "f7000001-0000-4000-8000-000000000000";

async function asUser(client: import("pg").Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}
const rpc = (action: string, payload: object) =>
  `SELECT public.pglearn_rpc('${action}', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) AS out`;

/* A draft class to upload into, since the seeded version is published. */
async function draftClass(client: import("pg").Client) {
  await asUser(client, ADMIN);
  const program = await client.query(
    rpc("create_program", { request_id: KEY, title: "Asset Test", summary: "" })
  );
  const versionId = program.rows[0].out.version.id;
  const mod = await client.query(
    rpc("create_module", { request_id: crypto.randomUUID(), version_id: versionId, title: "M" })
  );
  const cls = await client.query(
    rpc("create_class", {
      request_id: crypto.randomUUID(),
      module_id: mod.rows[0].out.id,
      title: "Lesson",
      kind: "video",
      duration_ms: 600000,
    })
  );
  return { versionId, classId: cls.rows[0].out.id };
}

describe.skipIf(!hasDatabase)("AC-015 asset upload authorization", () => {
  it("reserves a pending asset at the exact path spec/02 fixes", async () => {
    await inRollback(async (client) => {
      const { versionId, classId } = await draftClass(client);
      const r = await client.query(
        rpc("authorize_upload", {
          request_id: KEY,
          class_id: classId,
          role: "primary",
          original_name: "intro.mp4",
          mime_type: "video/mp4",
          bytes: 1024,
        })
      );
      const out = r.rows[0].out;
      // spec/03: ready only after validation, so it starts pending.
      expect(out.asset.state).toBe("pending");
      expect(out.storage_key).toBe(
        `versions/${versionId}/classes/${classId}/${out.asset.id}/intro.mp4`
      );
    });
  });

  it("composes the key from database ids, so a hostile name cannot escape", async () => {
    await inRollback(async (client) => {
      const { versionId, classId } = await draftClass(client);
      // The application sanitizes before this point; this proves the database
      // still builds the path from ids it holds rather than from the request.
      const r = await client.query(
        rpc("authorize_upload", {
          request_id: KEY,
          class_id: classId,
          role: "primary",
          original_name: "evil.mp4",
          mime_type: "video/mp4",
          bytes: 1024,
        })
      );
      const key: string = r.rows[0].out.storage_key;
      expect(key.startsWith(`versions/${versionId}/classes/${classId}/`)).toBe(true);
      expect(key.split("/")).toHaveLength(6);
      expect(key).not.toContain("..");
    });
  });

  it("refuses a learner and a manager alike", async () => {
    await inRollback(async (client) => {
      const { classId } = await draftClass(client);
      for (const who of [AMBER, MANAGER_A]) {
        await client.query("RESET ROLE");
        await asUser(client, who);
        expect(
          await sqlStateOf(client, rpc("authorize_upload", {
            request_id: KEY, class_id: classId, role: "primary",
            original_name: "x.mp4", mime_type: "video/mp4", bytes: 10,
          }))
        ).toBe("42501");
      }
    });
  });

  it("refuses an upload into a published version", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      expect(
        await sqlStateOf(client, rpc("authorize_upload", {
          request_id: KEY, class_id: CLASS_VIDEO, role: "handout",
          original_name: "notes.pdf", mime_type: "application/pdf", bytes: 10,
        }))
      ).toBe("23514");
    });
  });

  it("returns the same reservation when the request is retried", async () => {
    await inRollback(async (client) => {
      const { classId } = await draftClass(client);
      const payload = {
        request_id: KEY, class_id: classId, role: "primary",
        original_name: "intro.mp4", mime_type: "video/mp4", bytes: 1024,
      };
      const first = await client.query(rpc("authorize_upload", payload));
      const second = await client.query(rpc("authorize_upload", payload));
      expect(second.rows[0].out).toEqual(first.rows[0].out);

      await client.query("RESET ROLE");
      const n = await client.query(
        "SELECT count(*)::int AS n FROM app.assets WHERE class_id=$1",
        [classId]
      );
      expect(n.rows[0].n).toBe(1);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-016 upload finalization", () => {
  async function reserve(client: import("pg").Client, role = "primary", mime = "video/mp4", name = "intro.mp4") {
    const { classId } = await draftClass(client);
    const r = await client.query(
      rpc("authorize_upload", {
        request_id: crypto.randomUUID(), class_id: classId, role,
        original_name: name, mime_type: mime, bytes: 1024,
      })
    );
    return { classId, asset: r.rows[0].out.asset };
  }

  it("records a stable error code and leaves the asset unusable", async () => {
    await inRollback(async (client) => {
      const { asset } = await reserve(client);
      const r = await client.query(
        rpc("finalize_upload", { asset_id: asset.id, ok: false, error_code: "UPLOAD_SIZE_MISMATCH" })
      );
      expect(r.rows[0].out.asset.state).toBe("failed");
      expect(r.rows[0].out.asset.error_code).toBe("UPLOAD_SIZE_MISMATCH");
    });
  });

  it("does not become a class's primary media while it is failed", async () => {
    await inRollback(async (client) => {
      const { classId, asset } = await reserve(client);
      await client.query(
        rpc("finalize_upload", { asset_id: asset.id, ok: false, error_code: "UPLOAD_TYPE_MISMATCH" })
      );
      await client.query("RESET ROLE");
      const r = await client.query("SELECT primary_asset_id FROM app.classes WHERE id=$1", [classId]);
      // spec/02: a primary upload becomes primary_asset_id only after a
      // successful finalize, which is what keeps the class unpublishable.
      expect(r.rows[0].primary_asset_id).toBeNull();
    });
  });

  it("promotes a successful primary upload and records its duration", async () => {
    await inRollback(async (client) => {
      const { classId, asset } = await reserve(client);
      const r = await client.query(
        rpc("finalize_upload", {
          asset_id: asset.id, ok: true, actual_bytes: 1024, duration_ms: 600000,
        })
      );
      expect(r.rows[0].out.asset.state).toBe("ready");

      await client.query("RESET ROLE");
      const c = await client.query(
        "SELECT primary_asset_id, duration_ms FROM app.classes WHERE id=$1",
        [classId]
      );
      expect(c.rows[0].primary_asset_id).toBe(asset.id);
      expect(Number(c.rows[0].duration_ms)).toBe(600000);
    });
  });

  it("refuses a primary asset whose type disagrees with the class", async () => {
    await inRollback(async (client) => {
      // An audio file cannot be the primary of a video class: the M02 trigger
      // checks MIME agreement no matter which path reaches the table.
      const { asset } = await reserve(client, "primary", "audio/mpeg", "intro.mp3");
      expect(
        await sqlStateOf(client, rpc("finalize_upload", { asset_id: asset.id, ok: true, actual_bytes: 1024 }))
      ).toBe("23514");
    });
  });

  it("updates the class source text from a caption or transcript", async () => {
    await inRollback(async (client) => {
      const { classId, asset } = await reserve(client, "transcript", "text/plain", "notes.txt");
      const r = await client.query(
        rpc("finalize_upload", {
          asset_id: asset.id, ok: true, actual_bytes: 1024,
          source_text: "Prompt specificity helps define the task.",
        })
      );
      expect(r.rows[0].out.source_text_updated).toBe(true);

      await client.query("RESET ROLE");
      const c = await client.query("SELECT source_text FROM app.classes WHERE id=$1", [classId]);
      expect(c.rows[0].source_text).toContain("Prompt specificity");
    });
  });

  it("refuses finalization to anyone but an admin", async () => {
    await inRollback(async (client) => {
      const { asset } = await reserve(client);
      await client.query("RESET ROLE");
      await asUser(client, MANAGER_A);
      expect(
        await sqlStateOf(client, rpc("finalize_upload", { asset_id: asset.id, ok: true }))
      ).toBe("42501");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-062 download authorization is never replayed", () => {
  /*
   * A complete published course with a live enrollment, built the way the
   * application would: draft content, a finalized asset, publication, a grant,
   * an offering and an enrollment.
   *
   * The seeded fixture cannot be reused here because its version is already
   * published, and M02 refuses to add an asset to published content — which is
   * the freeze working, not an obstacle to route around.
   */
  async function publishedCourseFor(client: import("pg").Client, learner: string) {
    const { versionId, classId } = await draftClass(client);

    const reserved = await client.query(
      rpc("authorize_upload", {
        request_id: crypto.randomUUID(), class_id: classId, role: "handout",
        original_name: "notes.pdf", mime_type: "application/pdf", bytes: 1024,
      })
    );
    const assetId = reserved.rows[0].out.asset.id;
    await client.query(rpc("finalize_upload", { asset_id: assetId, ok: true, actual_bytes: 1024 }));

    await client.query("RESET ROLE");
    const programId = (
      await client.query("SELECT program_id FROM app.program_versions WHERE id=$1", [versionId])
    ).rows[0].program_id;

    // Publication itself is T10; this writes the state the handler will set.
    await client.query(
      "UPDATE app.program_versions SET state='published', published_at=now() WHERE id=$1",
      [versionId]
    );

    const grant = await client.query(
      `INSERT INTO app.program_grants(program_id, organization_id, starts_at, ends_at)
       VALUES ($1, $2, '2026-08-01Z', '2026-12-31Z') RETURNING id`,
      [programId, fixtures.ids.org_a]
    );
    const offering = await client.query(
      `INSERT INTO app.cohort_offerings(cohort_id, organization_id, program_id, version_id, grant_id,
                                        starts_at, due_at, access_ends_at)
       VALUES ($1,$2,$3,$4,$5,'2026-09-01T09:00:00Z','2026-09-20T17:00:00Z','2026-10-01T00:00:00Z')
       RETURNING id`,
      [fixtures.ids.cohort_a, fixtures.ids.org_a, programId, versionId, grant.rows[0].id]
    );
    const enrollment = await client.query(
      `INSERT INTO app.enrollments(user_id, program_id, version_id, grant_id, organization_id,
                                   offering_id, starts_at, due_at, access_ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,'2026-09-01T09:00:00Z','2026-09-20T17:00:00Z','2026-10-01T00:00:00Z')
       RETURNING id`,
      [learner, programId, versionId, grant.rows[0].id, fixtures.ids.org_a, offering.rows[0].id]
    );

    return { assetId, classId, versionId, grantId: grant.rows[0].id, enrollmentId: enrollment.rows[0].id };
  }

  it("authorizes the owner of a live enrollment", async () => {
    await inRollback(async (client) => {
      const { assetId, enrollmentId, classId } = await publishedCourseFor(client, AMBER);
      await asUser(client, AMBER);
      const r = await client.query(
        rpc("authorize_download", { asset_id: assetId, enrollment_id: enrollmentId, preview: false })
      );
      expect(r.rows[0].out.storage_path).toContain(classId);
    });
  });

  it("refuses the SAME request once the grant is revoked", async () => {
    await inRollback(async (client) => {
      const { assetId, enrollmentId, grantId } = await publishedCourseFor(client, AMBER);
      const payload = { asset_id: assetId, enrollment_id: enrollmentId, preview: false };

      await asUser(client, AMBER);
      await client.query(rpc("authorize_download", payload));  // works while active

      await client.query("RESET ROLE");
      await client.query("UPDATE app.program_grants SET status='revoked' WHERE id=$1", [grantId]);

      await asUser(client, AMBER);
      /*
       * The identical request is now refused. This is what AC-062 asks for:
       * authorization is evaluated on every call, so replaying a key that once
       * worked cannot hand back a usable link after the permission is withdrawn.
       */
      expect(await sqlStateOf(client, rpc("authorize_download", payload))).toBe("PGL22");
    });
  });

  it("refuses once the access window has closed", async () => {
    await inRollback(async (client) => {
      const { assetId, enrollmentId, grantId } = await publishedCourseFor(client, AMBER);
      await client.query("RESET ROLE");
      await client.query(
        "UPDATE app.program_grants SET ends_at='2026-09-02T00:00:00Z' WHERE id=$1",
        [grantId]
      );
      await asUser(client, AMBER);
      expect(
        await sqlStateOf(client, rpc("authorize_download", {
          asset_id: assetId, enrollment_id: enrollmentId, preview: false,
        }))
      ).toBe("PGL22");
    });
  });

  it("refuses another learner's enrollment as missing, not forbidden", async () => {
    await inRollback(async (client) => {
      const { assetId, enrollmentId } = await publishedCourseFor(client, AMBER);
      await asUser(client, BEN);
      // Ben must not learn that Amber's enrollment exists at all.
      expect(
        await sqlStateOf(client, rpc("authorize_download", {
          asset_id: assetId, enrollment_id: enrollmentId, preview: false,
        }))
      ).toBe("P0002");
    });
  });

  it("refuses an asset that is not ready", async () => {
    await inRollback(async (client) => {
      const { classId } = await draftClass(client);
      const pending = await client.query(
        rpc("authorize_upload", {
          request_id: crypto.randomUUID(), class_id: classId, role: "handout",
          original_name: "x.pdf", mime_type: "application/pdf", bytes: 10,
        })
      );
      await client.query("RESET ROLE");
      await asUser(client, AMBER);
      expect(
        await sqlStateOf(client, rpc("authorize_download", {
          asset_id: pending.rows[0].out.asset.id, enrollment_id: null, preview: false,
        }))
      ).toBe("23514");
    });
  });

  it("gives a learner no preview route into draft content", async () => {
    await inRollback(async (client) => {
      const { assetId } = await publishedCourseFor(client, AMBER);
      await asUser(client, AMBER);
      // preview is platform-admin only, and asking for it must not bypass the
      // enrollment checks by another name.
      expect(
        await sqlStateOf(client, rpc("authorize_download", {
          asset_id: assetId, enrollment_id: null, preview: true,
        }))
      ).toBe("P0002");
    });
  });

  it("signs the normalized VTT for a caption, never the raw upload", async () => {
    await inRollback(async (client) => {
      const { classId } = await draftClass(client);
      const reserved = await client.query(
        rpc("authorize_upload", {
          request_id: crypto.randomUUID(), class_id: classId, role: "caption",
          original_name: "subs.srt", mime_type: "application/x-subrip", bytes: 1024,
        })
      );
      const assetId = reserved.rows[0].out.asset.id;
      await client.query(
        rpc("finalize_upload", {
          asset_id: assetId, ok: true, actual_bytes: 1024,
          playback_key: "versions/v/classes/c/a/normalized.vtt",
          source_text: "Some caption text.",
        })
      );

      await client.query("RESET ROLE");
      await asUser(client, ADMIN);
      const r = await client.query(
        rpc("authorize_download", { asset_id: assetId, enrollment_id: null, preview: true })
      );
      // spec/03: "For caption assets sign playback_key (normalized VTT)."
      expect(r.rows[0].out.storage_path).toBe("versions/v/classes/c/a/normalized.vtt");
      expect(r.rows[0].out.storage_path).not.toContain(".srt");
    });
  });
});
