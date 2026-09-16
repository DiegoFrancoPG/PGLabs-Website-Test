import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-023 — grant revoked during a session.
 * AC-027 — heartbeat replay and ordering.
 * AC-028 — two playback tabs.
 * AC-030 — explicit text completion.
 *
 * Plus the completion chain spec/03 §4 steps 6–7 describe: class, then
 * program, then certificate and its outbox record, in one transaction.
 *
 * Every test runs as Amber through the real dispatcher, as the browser role,
 * inside a transaction that is rolled back. Amber's fixture enrollment is
 * available (past due, but the hard end is in October) with nothing done.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  amber: AMBER, ben: BEN,
  enroll_amber: ENROLL_AMBER, enroll_ben: ENROLL_BEN,
  class_video: CLASS_VIDEO, class_text: CLASS_TEXT, class_audio: CLASS_AUDIO,
  exercise_audio: EXERCISE_AUDIO, grant_a: GRANT_A,
} = fixtures.ids;

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

async function start(client: Client, enrollment: string, cls: string) {
  return call(client, "start_playback", {
    request_id: crypto.randomUUID(), enrollment_id: enrollment, class_id: cls,
  });
}

interface Beat {
  sequence: number;
  position: number;
  interval: [number, number] | null;
  elapsed?: number;
  rate?: number;
  eventId?: string;
}

function heartbeat(enrollment: string, cls: string, session: string, b: Beat) {
  return {
    enrollment_id: enrollment,
    class_id: cls,
    event_id: b.eventId ?? crypto.randomUUID(),
    session_id: session,
    sequence: b.sequence,
    position_ms: b.position,
    elapsed_ms: b.elapsed ?? 15_000,
    rate: b.rate ?? 1,
    interval: b.interval ? { start_ms: b.interval[0], end_ms: b.interval[1] } : null,
  };
}

/*
 * now() is fixed for the whole of a transaction, so inside a rolled-back test
 * every heartbeat looks like it arrived at the same instant as the session
 * started — and the plausibility bound would allow only two seconds of
 * clock slack per beat. Backdating the session's last receipt is how the
 * test lets fifteen seconds pass; in production each heartbeat is its own
 * transaction and the clock moves by itself.
 */
async function letTimePass(client: Client, sessionId: string, ms: number, actor: string) {
  await client.query("RESET ROLE");
  await client.query(
    "UPDATE app.playback_sessions SET last_received_at = last_received_at - ($2 || ' milliseconds')::interval WHERE id=$1",
    [sessionId, String(ms)]
  );
  await asUser(client, actor);
}

/*
 * Reads a table directly. The browser role cannot see the app schema at all —
 * that is ADR-03 working — so a test that wants to inspect stored state has to
 * step out of the role it is testing as, and step back in.
 */
async function inspect<T>(client: Client, actor: string, sql: string, params: unknown[]): Promise<T> {
  await client.query("RESET ROLE");
  const rows = (await client.query(sql, params)).rows;
  await asUser(client, actor);
  return rows as T;
}

/*
 * Plays [from, to) beat by beat, returning the last result.
 *
 * `step` is how much media each beat carries. The default is the player's own
 * fifteen seconds at rate 1. Watching ten minutes that way is forty round
 * trips to a hosted database, so the long tests pass 60_000: thirty seconds of
 * wall clock at rate 2, which is the most a single heartbeat may ever claim.
 */
async function play(
  client: Client, actor: string, enrollment: string, cls: string, session: string,
  from: number, to: number, startSeq: number, step = 15_000
) {
  const elapsed = Math.min(step, 30_000);
  const rate = step / elapsed;
  let seq = startSeq;
  let result;
  for (let at = from; at < to; at += step) {
    const end = Math.min(at + step, to);
    await letTimePass(client, session, elapsed, actor);
    result = await call(
      client, "record_progress",
      heartbeat(enrollment, cls, session, {
        sequence: seq, position: end, interval: [at, end], elapsed, rate,
      })
    );
    expect(result.accepted).toBe(true);
    seq += 1;
  }
  return { result, nextSequence: seq };
}

describe.skipIf(!hasDatabase)("start_playback", () => {
  it("opens a session at the saved position without counting as activity", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const s = await start(client, ENROLL_AMBER, CLASS_VIDEO);
      expect(s.generation).toBe(1);
      expect(s.position_ms).toBe(0);
      expect(s.next_sequence).toBe(1);

      const me = await call(client, "list_my_enrollments", {});
      const amber = me.items.find((e: { id: string }) => e.id === ENROLL_AMBER);
      // spec/03: "Starting a session alone does not count as learning activity."
      expect(amber.started_at).toBeNull();
      expect(amber.last_activity_at).toBeNull();
      // But the class opened is remembered, so Continue lands here.
      expect(amber.continue_class_id).toBe(CLASS_VIDEO);
    });
  });

  it("returns the same session when a start is retried with the same key", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const payload = { request_id: crypto.randomUUID(), enrollment_id: ENROLL_AMBER, class_id: CLASS_VIDEO };
      const first = await call(client, "start_playback", payload);
      const second = await call(client, "start_playback", payload);
      expect(second.session_id).toBe(first.session_id);
      expect(second.generation).toBe(first.generation);
    });
  });

  it("refuses a text class, another learner's enrollment and an unknown class", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      expect(await sqlStateOf(client, rpc("start_playback", { enrollment_id: ENROLL_AMBER, class_id: CLASS_TEXT }))).toBe("22023");
      expect(await sqlStateOf(client, rpc("start_playback", { enrollment_id: ENROLL_BEN, class_id: CLASS_VIDEO }))).toBe("P0002");
      expect(await sqlStateOf(client, rpc("start_playback", { enrollment_id: ENROLL_AMBER, class_id: crypto.randomUUID() }))).toBe("P0002");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-027 heartbeat replay and order", () => {
  it("credits a replay nothing, refuses a stale sequence and rejects a reused id", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const s = await start(client, ENROLL_AMBER, CLASS_VIDEO);

      // Sequences 1, 2 and 3, each fifteen seconds of playback.
      const { result: third } = await play(client, AMBER, ENROLL_AMBER, CLASS_VIDEO, s.session_id, 0, 45_000, 1);
      expect(third.progress.coverage_ms).toBe(45_000);
      expect(third.progress.position_ms).toBe(45_000);

      // Sequence 3 again, byte for byte. The retry of a request that already
      // landed: nothing more is credited, and no activity is recorded.
      const eventId = crypto.randomUUID();
      const beat = heartbeat(ENROLL_AMBER, CLASS_VIDEO, s.session_id, {
        sequence: 4, position: 60_000, interval: [45_000, 60_000], eventId,
      });
      await letTimePass(client, s.session_id, 15_000, AMBER);
      const accepted = await call(client, "record_progress", beat);
      expect(accepted.accepted).toBe(true);
      expect(accepted.progress.coverage_ms).toBe(60_000);

      const activityBefore = (await inspect<{ last_activity_at: Date }[]>(
        client, AMBER, "SELECT last_activity_at FROM app.enrollments WHERE id=$1", [ENROLL_AMBER]
      ))[0].last_activity_at;
      await letTimePass(client, s.session_id, 15_000, AMBER);
      const replay = await call(client, "record_progress", beat);
      expect(replay.accepted).toBe(true);
      expect(replay.progress.coverage_ms).toBe(60_000);
      const activityAfter = (await inspect<{ last_activity_at: Date }[]>(
        client, AMBER, "SELECT last_activity_at FROM app.enrollments WHERE id=$1", [ENROLL_AMBER]
      ))[0].last_activity_at;
      expect(String(activityAfter)).toBe(String(activityBefore));
      const events = await inspect<{ n: number }[]>(
        client, AMBER, "SELECT count(*)::int AS n FROM app.learning_events WHERE enrollment_id=$1", [ENROLL_AMBER]
      );
      expect(events[0].n).toBe(4);

      // A NEW event with an OLD sequence: refused, nothing moves.
      const stale = await call(client, "record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, s.session_id, {
        sequence: 2, position: 20_000, interval: [200_000, 215_000],
      }));
      expect(stale.accepted).toBe(false);
      expect(stale.reason).toBe("stale_sequence");
      expect(stale.progress.position_ms).toBe(60_000);
      expect(stale.progress.coverage_ms).toBe(60_000);

      // The same event id with a different body is a conflict.
      expect(await sqlStateOf(client, rpc("record_progress", { ...beat, position_ms: 90_000 }))).toBe("23505");

      // And after all of that, the record is exactly what sequence 4 left.
      const after = await call(client, "get_learning_class", { enrollment_id: ENROLL_AMBER, class_id: CLASS_VIDEO });
      expect(after.progress.position_ms).toBe(60_000);
      expect(after.progress.coverage_ms).toBe(60_000);
      expect(after.progress.content_complete).toBe(false);
    });
  });

  it("returns 404 for an event id that belongs to somebody else's enrollment", async () => {
    await inRollback(async (client) => {
      await asUser(client, BEN);
      const bens = await start(client, ENROLL_BEN, CLASS_AUDIO);
      const eventId = crypto.randomUUID();
      await letTimePass(client, bens.session_id, 15_000, BEN);
      await call(client, "record_progress", heartbeat(ENROLL_BEN, CLASS_AUDIO, bens.session_id, {
        sequence: 1, position: 15_000, interval: [0, 15_000], eventId,
      }));

      await asUser(client, AMBER);
      const s = await start(client, ENROLL_AMBER, CLASS_VIDEO);
      expect(await sqlStateOf(client, rpc("record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, s.session_id, {
        sequence: 1, position: 15_000, interval: [0, 15_000], eventId,
      })))).toBe("P0002");
    });
  });

  it("saves position without credit when no interval is sent, and that is not activity", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const s = await start(client, ENROLL_AMBER, CLASS_VIDEO);
      const paused = await call(client, "record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, s.session_id, {
        sequence: 1, position: 125_000, interval: null, elapsed: 0,
      }));
      expect(paused.accepted).toBe(true);
      expect(paused.progress.position_ms).toBe(125_000);
      expect(paused.progress.coverage_ms).toBe(0);
      const row = (await inspect<{ started_at: Date | null; last_activity_at: Date | null }[]>(
        client, AMBER, "SELECT started_at, last_activity_at FROM app.enrollments WHERE id=$1", [ENROLL_AMBER]
      ))[0];
      expect(row.started_at).toBeNull();
      expect(row.last_activity_at).toBeNull();
    });
  });
});

describe.skipIf(!hasDatabase)("AC-029 implausible progress is refused by the database too", () => {
  it("rejects an interval longer than the elapsed time could cover", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const s = await start(client, ENROLL_AMBER, CLASS_VIDEO);
      await letTimePass(client, s.session_id, 15_000, AMBER);
      expect(await sqlStateOf(client, rpc("record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, s.session_id, {
        sequence: 1, position: 500_000, interval: [0, 500_000],
      })))).toBe("PGL29");
      // Nothing was recorded by the refused beat.
      const after = await call(client, "get_learning_class", { enrollment_id: ENROLL_AMBER, class_id: CLASS_VIDEO });
      expect(after.progress.coverage_ms).toBe(0);
      expect(after.progress.position_ms).toBe(0);
    });
  });

  it("believes the server's clock over the client's elapsed_ms", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const s = await start(client, ENROLL_AMBER, CLASS_VIDEO);
      // No time has passed on the server. 15s claimed; only 2s slack + 1s allowance is believable.
      expect(await sqlStateOf(client, rpc("record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, s.session_id, {
        sequence: 1, position: 15_000, interval: [0, 15_000],
      })))).toBe("PGL29");
      const ok = await call(client, "record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, s.session_id, {
        sequence: 1, position: 3_000, interval: [0, 3_000],
      }));
      expect(ok.accepted).toBe(true);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-028 two playback tabs", () => {
  it("supersedes tab A when tab B starts, and A cannot overwrite the resume point", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const a = await start(client, ENROLL_AMBER, CLASS_VIDEO);
      await play(client, AMBER, ENROLL_AMBER, CLASS_VIDEO, a.session_id, 0, 30_000, 1);

      const b = await start(client, ENROLL_AMBER, CLASS_VIDEO);
      expect(b.generation).toBe(a.generation + 1);
      expect(b.position_ms).toBe(30_000);

      // A's next heartbeat: 409 SESSION_SUPERSEDED, and it changes nothing.
      await letTimePass(client, a.session_id, 15_000, AMBER);
      expect(await sqlStateOf(client, rpc("record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, a.session_id, {
        sequence: 3, position: 45_000, interval: [30_000, 45_000],
      })))).toBe("PGL28");

      // B writes.
      await letTimePass(client, b.session_id, 15_000, AMBER);
      const fromB = await call(client, "record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, b.session_id, {
        sequence: 1, position: 200_000, interval: [185_000, 200_000],
      }));
      expect(fromB.accepted).toBe(true);
      expect(fromB.progress.position_ms).toBe(200_000);

      // A tries once more, a pure position save this time. Still refused.
      expect(await sqlStateOf(client, rpc("record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, a.session_id, {
        sequence: 4, position: 10_000, interval: null, elapsed: 0,
      })))).toBe("PGL28");

      const after = await call(client, "get_learning_class", { enrollment_id: ENROLL_AMBER, class_id: CLASS_VIDEO });
      expect(after.progress.position_ms).toBe(200_000);
      expect(after.progress.coverage_ms).toBe(45_000);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-023 grant revoked during a session", () => {
  it("rejects the next heartbeat and keeps what was recorded before", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const s = await start(client, ENROLL_AMBER, CLASS_VIDEO);
      await play(client, AMBER, ENROLL_AMBER, CLASS_VIDEO, s.session_id, 0, 30_000, 1);

      await client.query("RESET ROLE");
      await client.query("UPDATE app.program_grants SET status='revoked' WHERE id=$1", [GRANT_A]);
      await asUser(client, AMBER);

      await letTimePass(client, s.session_id, 15_000, AMBER);
      // ACCESS_UNAVAILABLE, with the reason.
      await client.query("SAVEPOINT revoked");
      let detail = "";
      try {
        await client.query(rpc("record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, s.session_id, {
          sequence: 3, position: 45_000, interval: [30_000, 45_000],
        })));
      } catch (err) {
        const e = err as { code?: string; detail?: string };
        expect(e.code).toBe("PGL22");
        detail = e.detail ?? "";
      }
      await client.query("ROLLBACK TO SAVEPOINT revoked");
      expect(detail).toBe("revoked");

      // The thirty seconds recorded before the revocation are still there.
      await client.query("RESET ROLE");
      const row = (await client.query(
        "SELECT position_ms, played_ranges::text AS ranges FROM app.class_progress WHERE enrollment_id=$1 AND class_id=$2",
        [ENROLL_AMBER, CLASS_VIDEO]
      )).rows[0];
      expect(row.position_ms).toBe("30000");
      expect(row.ranges).toBe("{[0,30000)}");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-030 text explicit completion", () => {
  it("leaves completion null after GET and sets it only on POST", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const read = await call(client, "get_learning_class", { enrollment_id: ENROLL_AMBER, class_id: CLASS_TEXT });
      expect(read.progress.content_complete).toBe(false);
      expect(read.progress.class_complete).toBe(false);

      const eventId = crypto.randomUUID();
      const done = await call(client, "complete_text", { enrollment_id: ENROLL_AMBER, class_id: CLASS_TEXT, event_id: eventId });
      expect(done.accepted).toBe(true);
      expect(done.progress.content_complete).toBe(true);
      // No exercise on the text class, so content complete is class complete.
      expect(done.progress.class_complete).toBe(true);
      expect(done.progress.required_completed).toBe(1);
      expect(done.progress.required_total).toBe(3);

      // Replaying the same event changes nothing and records nothing new.
      const again = await call(client, "complete_text", { enrollment_id: ENROLL_AMBER, class_id: CLASS_TEXT, event_id: eventId });
      expect(again.progress.class_complete).toBe(true);
      const events = await inspect<{ n: number }[]>(
        client, AMBER,
        "SELECT count(*)::int AS n FROM app.learning_events WHERE enrollment_id=$1 AND class_id=$2",
        [ENROLL_AMBER, CLASS_TEXT]
      );
      expect(events[0].n).toBe(1);

      // Completing a text class is learning activity.
      const me = await call(client, "list_my_enrollments", {});
      const amber = me.items.find((e: { id: string }) => e.id === ENROLL_AMBER);
      expect(amber.started_at).not.toBeNull();
      expect(amber.state).toBe("in_progress");
    });
  });

  it("refuses text completion for a media class", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      expect(await sqlStateOf(client, rpc("complete_text", {
        enrollment_id: ENROLL_AMBER, class_id: CLASS_VIDEO, event_id: crypto.randomUUID(),
      }))).toBe("22023");
    });
  });
});

describe.skipIf(!hasDatabase)("completion chain (spec/03 §4 steps 6–7)", () => {
  it("completes a media class at 90% coverage, not before", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const s = await start(client, ENROLL_AMBER, CLASS_VIDEO);
      // 0 → 525000 in 15s beats, then one beat short of the line, then over it.
      const { nextSequence } = await play(client, AMBER, ENROLL_AMBER, CLASS_VIDEO, s.session_id, 0, 525_000, 1, 60_000);

      await letTimePass(client, s.session_id, 15_000, AMBER);
      const short = await call(client, "record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, s.session_id, {
        sequence: nextSequence, position: 539_999, interval: [525_000, 539_999],
      }));
      expect(short.progress.coverage_ms).toBe(539_999);
      expect(short.progress.content_complete).toBe(false);

      await letTimePass(client, s.session_id, 15_000, AMBER);
      const over = await call(client, "record_progress", heartbeat(ENROLL_AMBER, CLASS_VIDEO, s.session_id, {
        sequence: nextSequence + 1, position: 540_000, interval: [539_999, 540_000],
      }));
      expect(over.progress.coverage_ms).toBe(540_000);
      expect(over.progress.content_complete).toBe(true);
      expect(over.progress.class_complete).toBe(true);
      expect(over.progress.required_completed).toBe(1);
    });
  }, 60_000);

  it("holds a class with an exercise at content-complete until the exercise is saved", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const s = await start(client, ENROLL_AMBER, CLASS_AUDIO);
      const { result } = await play(client, AMBER, ENROLL_AMBER, CLASS_AUDIO, s.session_id, 0, DURATION, 1, 60_000);
      expect(result.progress.coverage_ms).toBe(DURATION);
      expect(result.progress.content_complete).toBe(true);
      expect(result.progress.exercise_complete).toBe(false);
      // ADR-08: both parts.
      expect(result.progress.class_complete).toBe(false);
      expect(result.progress.required_completed).toBe(0);
    });
  }, 60_000);

  it("issues the certificate and queues its email in the transaction that finishes the program", async () => {
    await inRollback(async (client) => {
      /*
       * Amber finishes video and text through the API. The audio exercise
       * response is T14's; here it is placed directly, as the fixture seed
       * does for Cora, so that the last heartbeat is what completes the program.
       */
      await asUser(client, AMBER);
      await call(client, "complete_text", { enrollment_id: ENROLL_AMBER, class_id: CLASS_TEXT, event_id: crypto.randomUUID() });
      const v = await start(client, ENROLL_AMBER, CLASS_VIDEO);
      await play(client, AMBER, ENROLL_AMBER, CLASS_VIDEO, v.session_id, 0, 540_000, 1, 60_000);

      await client.query("RESET ROLE");
      await client.query(
        "INSERT INTO app.exercise_completions(enrollment_id, exercise_id, response) VALUES ($1,$2,'A synthetic practice task.')",
        [ENROLL_AMBER, EXERCISE_AUDIO]
      );
      await asUser(client, AMBER);

      const a = await start(client, ENROLL_AMBER, CLASS_AUDIO);
      const { result } = await play(client, AMBER, ENROLL_AMBER, CLASS_AUDIO, a.session_id, 0, 540_000, 1, 60_000);
      expect(result.progress.class_complete).toBe(true);
      expect(result.progress.required_completed).toBe(3);
      expect(result.progress.certificate_id).not.toBeNull();

      await client.query("RESET ROLE");
      const cert = (await client.query(
        "SELECT * FROM app.certificates WHERE enrollment_id=$1", [ENROLL_AMBER]
      )).rows[0];
      expect(cert.id).toBe(result.progress.certificate_id);
      expect(cert.learner_name).toBe("Amber");
      expect(cert.program_title).toBe("AI Foundations");
      expect(cert.version_number).toBe(1);
      expect(cert.revoked_at).toBeNull();

      const enrollment = (await client.query("SELECT completed_at FROM app.enrollments WHERE id=$1", [ENROLL_AMBER])).rows[0];
      expect(enrollment.completed_at).not.toBeNull();

      const outbox = (await client.query(
        "SELECT kind, status, recipient_email, payload FROM app.notification_outbox WHERE enrollment_id=$1 AND kind='certificate'",
        [ENROLL_AMBER]
      )).rows;
      expect(outbox).toHaveLength(1);
      expect(outbox[0].status).toBe("pending");
      expect(outbox[0].recipient_email).toBe("amber@example.invalid");
      expect(outbox[0].payload.certificate_id).toBe(cert.id);

      // Finished, and the dashboard says so.
      await asUser(client, AMBER);
      const me = await call(client, "list_my_enrollments", {});
      const amber = me.items.find((e: { id: string }) => e.id === ENROLL_AMBER);
      expect(amber.state).toBe("completed");
      expect(amber.certificate_id).toBe(cert.id);
    });
  }, 90_000);
});
