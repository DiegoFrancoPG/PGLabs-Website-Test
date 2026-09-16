import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { hasDatabase, databaseUrl, inRollback, sqlStateOf, withClient } from "./db";
import { renderCertificatePdf, CertificateFontError } from "@/lib/certificate-pdf";

/*
 * AC-034 — two concurrent final completions produce one of everything.
 * AC-035 — the snapshot survives a rename, an expiry and a revocation.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  admin: ADMIN, manager_a: MANAGER_A, manager_b: MANAGER_B,
  amber: AMBER, ben: BEN, cora: CORA,
  enroll_amber: ENROLL_AMBER, enroll_cora: ENROLL_CORA,
  certificate_cora: CERT_CORA, class_audio: CLASS_AUDIO, class_video: CLASS_VIDEO,
  class_text: CLASS_TEXT, exercise_audio: EXERCISE_AUDIO, grant_a: GRANT_A,
} = fixtures.ids;

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

describe.skipIf(!hasDatabase)("AC-034 two concurrent final completions", () => {
  it("writes one completion timestamp, one certificate and one notification", async () => {
    /*
     * Two REAL connections, not two calls on one. The point of the scenario is
     * the race, and a race needs two transactions that overlap in time — which
     * a single client cannot produce however the statements are ordered.
     *
     * This test therefore cannot roll back: the transactions have to commit to
     * contend. It puts Amber back afterwards.
     */
    const a = new Client({ connectionString: databaseUrl()!, ssl: { rejectUnauthorized: false } });
    const b = new Client({ connectionString: databaseUrl()!, ssl: { rejectUnauthorized: false } });
    const setup = new Client({ connectionString: databaseUrl()!, ssl: { rejectUnauthorized: false } });
    await Promise.all([a.connect(), b.connect(), setup.connect()]);

    try {
      // Everything but the last required class is done.
      await setup.query("SET session_replication_role = 'replica'");
      await setup.query(
        `INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges,
                                        position_ms, content_completed_at, completed_at)
         SELECT $1, c.id, e.version_id, int8multirange(int8range(0, 600000)), 600000, now(), now()
           FROM app.enrollments e, app.classes c
          WHERE e.id = $1 AND c.id = ANY($2::uuid[])
         ON CONFLICT (enrollment_id, class_id) DO UPDATE
           SET content_completed_at = now(), completed_at = now()`,
        [ENROLL_AMBER, [CLASS_VIDEO, CLASS_TEXT]]
      );
      // The audio's media is finished; only the exercise is missing.
      await setup.query(
        `INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges,
                                        position_ms, content_completed_at)
         SELECT $1, $2, e.version_id, int8multirange(int8range(0, 600000)), 600000, now()
           FROM app.enrollments e WHERE e.id = $1
         ON CONFLICT (enrollment_id, class_id) DO UPDATE SET content_completed_at = now()`,
        [ENROLL_AMBER, CLASS_AUDIO]
      );
      await setup.query("RESET session_replication_role");

      // Both connections submit the final completion at once.
      const submit = async (client: Client, response: string) => {
        await client.query("BEGIN");
        await asUser(client, AMBER);
        try {
          const out = await client.query(rpc("complete_exercise", {
            request_id: crypto.randomUUID(),
            enrollment_id: ENROLL_AMBER,
            exercise_id: EXERCISE_AUDIO,
            response,
            confirmed: true,
          }));
          await client.query("COMMIT");
          return { ok: true as const, out: out.rows[0].out };
        } catch (err) {
          await client.query("ROLLBACK");
          return { ok: false as const, code: (err as { code?: string }).code };
        }
      };

      const [first, second] = await Promise.all([
        submit(a, "The first submission."),
        submit(b, "The second submission."),
      ]);

      // One of them may lose — that is correct, and is not what is being tested.
      expect([first.ok, second.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);

      const counts = await setup.query(
        `SELECT
           (SELECT count(*) FROM app.exercise_completions WHERE enrollment_id=$1) AS responses,
           (SELECT count(*) FROM app.certificates WHERE enrollment_id=$1) AS certificates,
           (SELECT count(*) FROM app.notification_outbox WHERE enrollment_id=$1 AND kind='certificate') AS notifications,
           (SELECT count(*) FROM app.enrollments WHERE id=$1 AND completed_at IS NOT NULL) AS completed`,
        [ENROLL_AMBER]
      );
      const row = counts.rows[0];
      expect(Number(row.responses)).toBe(1);
      expect(Number(row.certificates)).toBe(1);
      expect(Number(row.notifications)).toBe(1);
      expect(Number(row.completed)).toBe(1);
    } finally {
      // Amber back to untouched, whatever happened above.
      await setup.query("SET session_replication_role = 'replica'");
      for (const statement of [
        "DELETE FROM app.notification_outbox WHERE enrollment_id=$1",
        "DELETE FROM app.certificates WHERE enrollment_id=$1",
        "DELETE FROM app.exercise_completions WHERE enrollment_id=$1",
        "DELETE FROM app.learning_events WHERE enrollment_id=$1",
        "DELETE FROM app.playback_sessions WHERE enrollment_id=$1",
        "DELETE FROM app.class_progress WHERE enrollment_id=$1",
        `UPDATE app.enrollments SET started_at=NULL, last_activity_at=NULL, completed_at=NULL,
            last_class_id=NULL, resume_generation=0 WHERE id=$1`,
      ]) {
        await setup.query(statement, [ENROLL_AMBER]);
      }
      await setup.query("DELETE FROM app.idempotency_records WHERE actor_id=$1", [AMBER]);
      await setup.query("RESET session_replication_role");
      await Promise.all([a.end(), b.end(), setup.end()]);
    }
  }, 90_000);
});

describe.skipIf(!hasDatabase)("AC-035 the snapshot outlives the things it describes", () => {
  it("keeps the original name after the profile is renamed", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      await client.query("UPDATE app.profiles SET display_name='Cora Renamed' WHERE id=$1", [CORA]);
      await client.query("UPDATE app.programs SET title='A Different Title' WHERE id=$1", [
        fixtures.ids.program_shared,
      ]);

      await asUser(client, CORA);
      const certificate = await call(client, "get_certificate", { certificate_id: CERT_CORA });
      // The snapshot is what was earned, not what things are called now.
      expect(certificate.learner_name).toBe("Cora");
      expect(certificate.program_title).toBe("AI Foundations");
    });
  });

  it("stays readable to its owner after course access has ended", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      // The whole grant expires: the course is over for everyone on it.
      await client.query("UPDATE app.program_grants SET ends_at='2026-09-14T00:00:00Z' WHERE id=$1", [GRANT_A]);

      await asUser(client, CORA);
      // The enrollment itself is now unavailable…
      const enrollments = await call(client, "list_my_enrollments", {});
      const cora = enrollments.items.find((e: { id: string }) => e.id === ENROLL_CORA);
      expect(cora.availability).toBe("expired");
      // …and the certificate is still hers to read and to download.
      const certificate = await call(client, "get_certificate", { certificate_id: CERT_CORA });
      expect(certificate.id).toBe(CERT_CORA);
      const forPdf = await call(client, "get_certificate_pdf", { certificate_id: CERT_CORA });
      expect(forPdf.learner_name).toBe("Cora");
    });
  });

  it("is readable by an admin and by the organization's manager, and by nobody else", async () => {
    await inRollback(async (client) => {
      for (const reader of [CORA, ADMIN, MANAGER_A]) {
        await asUser(client, reader);
        const certificate = await call(client, "get_certificate", { certificate_id: CERT_CORA });
        expect(certificate.id).toBe(CERT_CORA);
      }

      // Another learner, and a manager of a different organization.
      for (const stranger of [AMBER, BEN, MANAGER_B]) {
        await asUser(client, stranger);
        expect(
          await sqlStateOf(client, rpc("get_certificate", { certificate_id: CERT_CORA }))
        ).toBe("P0002");
        expect(
          await sqlStateOf(client, rpc("get_certificate_pdf", { certificate_id: CERT_CORA }))
        ).toBe("P0002");
      }
    });
  });

  it("answers the same way for an invented id as for somebody else's", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      expect(
        await sqlStateOf(client, rpc("get_certificate", { certificate_id: crypto.randomUUID() }))
      ).toBe("P0002");
    });
  });

  it("keeps metadata visible after revocation and refuses only the PDF", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const revoked = await call(client, "revoke_certificate", {
        request_id: crypto.randomUUID(),
        certificate_id: CERT_CORA,
        reason: "Issued against the wrong enrollment.",
      });
      expect(revoked.revoked_at).not.toBeNull();
      expect(revoked.revocation_reason).toBe("Issued against the wrong enrollment.");
      // The snapshot itself is untouched by revocation.
      expect(revoked.learner_name).toBe("Cora");

      await asUser(client, CORA);
      const metadata = await call(client, "get_certificate", { certificate_id: CERT_CORA });
      expect(metadata.revoked_at).not.toBeNull();
      expect(metadata.learner_name).toBe("Cora");
      expect(
        await sqlStateOf(client, rpc("get_certificate_pdf", { certificate_id: CERT_CORA }))
      ).toBe("PGL41");
    });
  });

  it("revokes once: the same reason repeats, a different one is refused", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const payload = {
        request_id: crypto.randomUUID(),
        certificate_id: CERT_CORA,
        reason: "Awarded in error.",
      };
      const first = await call(client, "revoke_certificate", payload);

      // Same reason, new request id: idempotent.
      const repeat = await call(client, "revoke_certificate", {
        ...payload, request_id: crypto.randomUUID(),
      });
      expect(repeat.revoked_at).toBe(first.revoked_at);

      // A different reason does not overwrite it silently.
      expect(
        await sqlStateOf(client, rpc("revoke_certificate", {
          request_id: crypto.randomUUID(), certificate_id: CERT_CORA, reason: "Another reason.",
        }))
      ).toBe("PGL41");

      const after = await call(client, "get_certificate", { certificate_id: CERT_CORA });
      expect(after.revocation_reason).toBe("Awarded in error.");
    });
  });

  it("lets only a platform admin revoke, and requires a reason of 1 to 500 characters", async () => {
    await inRollback(async (client) => {
      // The learner and their manager may both READ it; neither may withdraw it.
      for (const actor of [CORA, MANAGER_A]) {
        await asUser(client, actor);
        expect(
          await sqlStateOf(client, rpc("revoke_certificate", {
            request_id: crypto.randomUUID(), certificate_id: CERT_CORA, reason: "No.",
          }))
        ).toBe("42501");
      }

      await asUser(client, ADMIN);
      for (const reason of ["", "   ", "x".repeat(501)]) {
        expect(
          await sqlStateOf(client, rpc("revoke_certificate", {
            request_id: crypto.randomUUID(), certificate_id: CERT_CORA, reason,
          }))
        ).toBe("22023");
      }
    });
  });

  it("refuses to change a snapshot even from outside the API", async () => {
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        // The M02 trigger, checked directly: no path rewrites a certificate.
        expect(
          await sqlStateOf(client, `UPDATE app.certificates SET learner_name='Someone Else' WHERE id='${CERT_CORA}'`)
        ).toBe("23514");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });
});

describe("the certificate PDF", () => {
  const data = {
    id: "3f1a5c8e-0b0e-4a6f-9c2b-6a1e0d4b7c55",
    learner_name: "Cora",
    program_title: "AI Foundations",
    version_number: 1,
    issuer: "PGLearn",
    completed_at: "2026-09-12T12:00:00Z",
    issued_at: "2026-09-12T12:00:00Z",
  };

  it("renders a PDF from the stored snapshot", async () => {
    const pdf = await renderCertificatePdf(data, "https://example.invalid/certificates/x");
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("renders accented names, which is why the font is bundled", async () => {
    const pdf = await renderCertificatePdf(
      { ...data, learner_name: "Ólafur Ó Súilleabháin", program_title: "Fundamentos de la IA" },
      "https://example.invalid/certificates/x"
    );
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe("%PDF-");
  });

  it("refuses rather than printing empty boxes for a name it cannot draw", async () => {
    /*
     * spec/03: "do not silently replace unsupported characters". A certificate
     * with somebody's name rendered as □□□ is worse than no certificate: it
     * looks official and is wrong.
     */
    await expect(
      renderCertificatePdf({ ...data, learner_name: "田中 花子" }, "https://example.invalid/c")
    ).rejects.toThrow(CertificateFontError);
  });

  it("names the characters it could not render, so the gap can be closed", async () => {
    try {
      await renderCertificatePdf({ ...data, learner_name: "田中" }, "https://example.invalid/c");
    } catch (err) {
      expect((err as CertificateFontError).missing).toContain("田");
    }
  });
});
