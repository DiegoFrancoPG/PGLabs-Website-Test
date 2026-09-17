import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-031 — the four boundary submissions, checked against the DATABASE this
 *          time. tests/unit/exercise.test.ts asserts the same four in the
 *          application; the scenario's word is "consistently", and one half
 *          alone would not show that.
 * AC-032 — failure atomicity, cross-context denial, and retry.
 * AC-033 — an exercise saved before the media is finished.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  amber: AMBER, ben: BEN, manager_a: MANAGER_A, personal: PERSONAL,
  enroll_amber: ENROLL_AMBER, enroll_ben: ENROLL_BEN, enroll_personal: ENROLL_PERSONAL,
  class_audio: CLASS_AUDIO, exercise_audio: EXERCISE_AUDIO,
} = fixtures.ids;

const RESPONSE = "I would practise a sales follow-up with invented customer details.";

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

const submit = (enrollment: string, exercise: string, response: string, extra: object = {}) => ({
  request_id: crypto.randomUUID(),
  enrollment_id: enrollment,
  exercise_id: exercise,
  response,
  confirmed: true,
  ...extra,
});

describe.skipIf(!hasDatabase)("AC-031 the database agrees with the application", () => {
  it("refuses whitespace only, refuses without confirmation, accepts 2000, refuses 2001", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);

      // Whitespace only — including the Unicode kinds a plain btrim would keep.
      for (const blank of ["   ", "\n\t", " 　"]) {
        expect(
          await sqlStateOf(client, rpc("complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, blank)))
        ).toBe("22023");
      }

      expect(
        await sqlStateOf(
          client,
          rpc("complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, RESPONSE, { confirmed: false }))
        )
      ).toBe("22023");

      expect(
        await sqlStateOf(client, rpc("complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, "a".repeat(2001))))
      ).toBe("22023");

      const accepted = await call(client, "complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, "a".repeat(2000)));
      expect(accepted.progress.exercise_complete).toBe(true);
    });
  });

  it("counts code points, so 2000 emoji fit and 2001 do not", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      // 4000 UTF-16 units. A length check written in JavaScript would refuse it.
      const accepted = await call(client, "complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, "🙂".repeat(2000)));
      expect(accepted.progress.exercise_complete).toBe(true);

      const saved = await call(client, "get_exercise_completion", {
        enrollment_id: ENROLL_AMBER, exercise_id: EXERCISE_AUDIO,
      });
      expect([...saved.response].length).toBe(2000);
    });
  });

  it("refuses 2001 emoji", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      expect(
        await sqlStateOf(client, rpc("complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, "🙂".repeat(2001))))
      ).toBe("22023");
    });
  });

  it("normalises to NFC before counting and before storing", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      // 2000 characters written as e + combining acute: 4000 code points until composed.
      await call(client, "complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, "é".repeat(2000)));
      const saved = await call(client, "get_exercise_completion", {
        enrollment_id: ENROLL_AMBER, exercise_id: EXERCISE_AUDIO,
      });
      expect([...saved.response].length).toBe(2000);
      expect(saved.response.startsWith("é")).toBe(true);
    });
  });

  it("stores the trimmed text, not the text as sent", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      await call(client, "complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, `　  ${RESPONSE}  \n`));
      const saved = await call(client, "get_exercise_completion", {
        enrollment_id: ENROLL_AMBER, exercise_id: EXERCISE_AUDIO,
      });
      expect(saved.response).toBe(RESPONSE);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-032 failure, cross-context and retry", () => {
  it("writes neither response nor completion when the transaction fails", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);

      /*
       * The injected failure: a statement that raises after the handler's
       * INSERT, inside the same transaction. The response and the completion
       * are one row, so there is no state in which one survives the other.
       */
      await client.query("SAVEPOINT attempt");
      try {
        await client.query(rpc("complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, RESPONSE)));
        await client.query("SELECT 1 / 0");
        throw new Error("the injected failure did not fire");
      } catch (err) {
        expect((err as { code?: string }).code).toBe("22012");
      }
      await client.query("ROLLBACK TO SAVEPOINT attempt");

      expect(
        await sqlStateOf(client, rpc("get_exercise_completion", {
          enrollment_id: ENROLL_AMBER, exercise_id: EXERCISE_AUDIO,
        }))
      ).toBe("P0002");

      await client.query("RESET ROLE");
      const rows = await client.query(
        "SELECT count(*)::int AS n FROM app.exercise_completions WHERE enrollment_id=$1", [ENROLL_AMBER]
      );
      expect(rows.rows[0].n).toBe(0);
      await asUser(client, AMBER);

      // And the retry afterwards succeeds — exactly once.
      const retried = await call(client, "complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, RESPONSE));
      expect(retried.progress.exercise_complete).toBe(true);
      await client.query("RESET ROLE");
      const after = await client.query(
        "SELECT count(*)::int AS n FROM app.exercise_completions WHERE enrollment_id=$1", [ENROLL_AMBER]
      );
      expect(after.rows[0].n).toBe(1);
    });
  });

  it("returns the first answer to a retry with the same request id and body", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const payload = submit(ENROLL_AMBER, EXERCISE_AUDIO, RESPONSE);
      const first = await call(client, "complete_exercise", payload);
      const second = await call(client, "complete_exercise", payload);
      expect(second).toEqual(first);

      await client.query("RESET ROLE");
      const rows = await client.query(
        "SELECT count(*)::int AS n FROM app.exercise_completions WHERE enrollment_id=$1", [ENROLL_AMBER]
      );
      expect(rows.rows[0].n).toBe(1);
    });
  });

  it("treats a repeat of the same text under a new request id as the retry it is", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      await call(client, "complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, RESPONSE));
      // Same response, different request id: a resend, not a second answer.
      const again = await call(client, "complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, `  ${RESPONSE} `));
      expect(again.progress.exercise_complete).toBe(true);
    });
  });

  it("refuses a different response once one is saved, with EXERCISE_ALREADY_COMPLETED", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      await call(client, "complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, RESPONSE));
      expect(
        await sqlStateOf(client, rpc("complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, "A different answer.")))
      ).toBe("PGL40");

      // The saved response is untouched: read-only means read-only.
      const saved = await call(client, "get_exercise_completion", {
        enrollment_id: ENROLL_AMBER, exercise_id: EXERCISE_AUDIO,
      });
      expect(saved.response).toBe(RESPONSE);
    });
  });

  it("denies another learner's enrollment and an exercise outside the pinned version", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      // Ben's enrollment.
      expect(
        await sqlStateOf(client, rpc("complete_exercise", submit(ENROLL_BEN, EXERCISE_AUDIO, RESPONSE)))
      ).toBe("P0002");
      // An exercise that does not exist at all.
      expect(
        await sqlStateOf(client, rpc("complete_exercise", submit(ENROLL_AMBER, crypto.randomUUID(), RESPONSE)))
      ).toBe("P0002");

      // An exercise belonging to a program this learner is not enrolled in.
      await client.query("RESET ROLE");
      const other = await client.query(
        `SELECT ex.id FROM app.exercises ex JOIN app.classes cl ON cl.id = ex.class_id
          WHERE cl.version_id <> (SELECT version_id FROM app.enrollments WHERE id=$1) LIMIT 1`,
        [ENROLL_AMBER]
      );
      await asUser(client, AMBER);
      if (other.rows.length > 0) {
        expect(
          await sqlStateOf(client, rpc("complete_exercise", submit(ENROLL_AMBER, other.rows[0].id, RESPONSE)))
        ).toBe("P0002");
      }
    });
  });

  it("never lets a manager read a learner's response", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      await call(client, "complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, RESPONSE));

      // spec/03: "No grades and no managers reading responses."
      await asUser(client, MANAGER_A);
      expect(
        await sqlStateOf(client, rpc("get_exercise_completion", {
          enrollment_id: ENROLL_AMBER, exercise_id: EXERCISE_AUDIO,
        }))
      ).toBe("P0002");

      await asUser(client, BEN);
      expect(
        await sqlStateOf(client, rpc("get_exercise_completion", {
          enrollment_id: ENROLL_AMBER, exercise_id: EXERCISE_AUDIO,
        }))
      ).toBe("P0002");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-033 an exercise saved before the media is finished", () => {
  it("keeps the class incomplete until the media criterion passes, then completes it once", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);

      const saved = await call(client, "complete_exercise", submit(ENROLL_AMBER, EXERCISE_AUDIO, RESPONSE));
      expect(saved.progress.exercise_complete).toBe(true);
      // ADR-08: both halves. The media has not been watched at all.
      expect(saved.progress.content_complete).toBe(false);
      expect(saved.progress.class_complete).toBe(false);
      expect(saved.progress.required_completed).toBe(0);

      // The response is read-only from here.
      const read = await call(client, "get_exercise_completion", {
        enrollment_id: ENROLL_AMBER, exercise_id: EXERCISE_AUDIO,
      });
      expect(read.response).toBe(RESPONSE);
      expect(read.confirmed_at).not.toBeNull();

      // Now finish the audio: 540000 of 600000 in sixty-second beats.
      const session = await call(client, "start_playback", {
        request_id: crypto.randomUUID(), enrollment_id: ENROLL_AMBER, class_id: CLASS_AUDIO,
      });
      let last;
      for (let at = 0; at < 540_000; at += 60_000) {
        await client.query("RESET ROLE");
        await client.query(
          "UPDATE app.playback_sessions SET last_received_at = last_received_at - interval '30 seconds' WHERE id=$1",
          [session.session_id]
        );
        await asUser(client, AMBER);
        last = await call(client, "record_progress", {
          enrollment_id: ENROLL_AMBER, class_id: CLASS_AUDIO,
          event_id: crypto.randomUUID(), session_id: session.session_id,
          sequence: at / 60_000 + 1, position_ms: at + 60_000,
          elapsed_ms: 30_000, rate: 2,
          interval: { start_ms: at, end_ms: at + 60_000 },
        });
      }

      expect(last.progress.content_complete).toBe(true);
      expect(last.progress.class_complete).toBe(true);
      expect(last.progress.required_completed).toBe(1);

      // Completed once: the timestamp does not move on a later heartbeat.
      await client.query("RESET ROLE");
      const first = (await client.query(
        "SELECT completed_at FROM app.class_progress WHERE enrollment_id=$1 AND class_id=$2",
        [ENROLL_AMBER, CLASS_AUDIO]
      )).rows[0].completed_at;
      await client.query(
        "UPDATE app.playback_sessions SET last_received_at = last_received_at - interval '30 seconds' WHERE id=$1",
        [session.session_id]
      );
      await asUser(client, AMBER);
      await call(client, "record_progress", {
        enrollment_id: ENROLL_AMBER, class_id: CLASS_AUDIO,
        event_id: crypto.randomUUID(), session_id: session.session_id,
        sequence: 100, position_ms: 600_000, elapsed_ms: 30_000, rate: 2,
        interval: { start_ms: 540_000, end_ms: 600_000 },
      });
      await client.query("RESET ROLE");
      const second = (await client.query(
        "SELECT completed_at FROM app.class_progress WHERE enrollment_id=$1 AND class_id=$2",
        [ENROLL_AMBER, CLASS_AUDIO]
      )).rows[0].completed_at;
      expect(String(second)).toBe(String(first));
    });
  }, 90_000);

  it("completes the class immediately when the media was already finished", async () => {
    await inRollback(async (client) => {
      /*
       * The other order. The personal learner's enrollment is untouched by the
       * fixture progress, so the media is marked complete directly and only the
       * exercise is left — which must complete the class on the spot.
       */
      await client.query("RESET ROLE");
      await client.query(
        `INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges, position_ms, content_completed_at)
         SELECT $1, $2, e.version_id, int8multirange(int8range(0, 600000)), 600000, now()
           FROM app.enrollments e WHERE e.id = $1`,
        [ENROLL_PERSONAL, CLASS_AUDIO]
      );
      await asUser(client, PERSONAL);

      const done = await call(client, "complete_exercise", submit(ENROLL_PERSONAL, EXERCISE_AUDIO, RESPONSE));
      expect(done.progress.content_complete).toBe(true);
      expect(done.progress.exercise_complete).toBe(true);
      expect(done.progress.class_complete).toBe(true);
    });
  });
});
