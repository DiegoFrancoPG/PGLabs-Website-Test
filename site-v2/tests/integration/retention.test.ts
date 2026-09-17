import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback, sqlStateOf } from "./db";

/*
 * AC-057 — retention.
 *
 * "Chat >30 days, current month usage, raw progress events. Run retention job.
 * Expired text/links removed; progress/certificates remain; durable no-text
 * usage ledger preserves monthly accounting."
 *
 * Two halves, and the second matters more than the first. Deleting old rows is
 * easy; the job earns its place by what it leaves alone — a learner's progress,
 * their certificate, and the month's spend accounting, which has to survive the
 * deletion of the very chats it accounts for.
 *
 * Everything runs inside the rollback, so the fixture's own history is intact
 * afterwards.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  amber: AMBER,
  enroll_amber: ENROLLMENT,
  version_shared: VERSION,
  class_video: CLASS,
} = fixtures.ids;

const run = async (client: Client) =>
  (await client.query(`SELECT public.pglearn_job('retention.run', '{}'::jsonb) AS out`)).rows[0].out;

/** A chat of `age` days ago, with one question and one answer in it. */
async function chat(client: Client, days: number): Promise<{ session: string; request: string }> {
  const session = (
    await client.query(
      `INSERT INTO app.tutor_sessions(enrollment_id, created_at, updated_at)
       VALUES ($1, now() - ($2 || ' days')::interval, now() - ($2 || ' days')::interval)
       RETURNING id`,
      [ENROLLMENT, days]
    )
  ).rows[0].id;
  const request = (
    await client.query(
      `INSERT INTO app.tutor_requests(id, session_id, class_id, question, intent, status, answer,
                                      mode, reserved_usd, actual_usd, created_at, finished_at)
       VALUES (gen_random_uuid(), $1, $2, 'What does this mean?', 'explanation', 'completed',
               'It means this.', 'explanation', 0.01, 0.008,
               now() - ($3 || ' days')::interval, now() - ($3 || ' days')::interval)
       RETURNING id`,
      [session, CLASS, days]
    )
  ).rows[0].id;
  // The ledger entry the chat produced, which is not the chat.
  await client.query(
    `INSERT INTO app.tutor_usage(request_id, user_id, period_start, reserved_usd, actual_usd,
                                 input_tokens, output_tokens, outcome, created_at)
     VALUES ($1, $2, date_trunc('month', now() - ($3 || ' days')::interval)::date,
             0.01, 0.008, 400, 120, 'settled', now() - ($3 || ' days')::interval)`,
    [request, AMBER, days]
  );
  return { session, request };
}

async function event(client: Client, days: number): Promise<string> {
  return (
    await client.query(
      `INSERT INTO app.learning_events(id, enrollment_id, class_id, version_id, kind, received_at, payload)
       VALUES (gen_random_uuid(), $1, $2, $3, 'heartbeat', now() - ($4 || ' days')::interval, '{}'::jsonb)
       RETURNING id`,
      [ENROLLMENT, CLASS, VERSION, days]
    )
  ).rows[0].id;
}

const exists = async (client: Client, table: string, id: string, column = "id") =>
  (await client.query(`SELECT count(*)::int AS n FROM app.${table} WHERE ${column} = $1`, [id]))
    .rows[0].n === 1;

describe.skipIf(!hasDatabase)("AC-057 what retention removes", () => {
  it("removes a chat older than thirty days and keeps a recent one", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const old = await chat(client, 40);
      const recent = await chat(client, 3);

      await run(client);

      expect(await exists(client, "tutor_requests", old.request)).toBe(false);
      expect(await exists(client, "tutor_sessions", old.session)).toBe(false);
      // Thirty days is a boundary, not a mood.
      expect(await exists(client, "tutor_requests", recent.request)).toBe(true);
      expect(await exists(client, "tutor_sessions", recent.session)).toBe(true);
    });
  });

  it("keeps an old session that still holds a recent question", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const old = await chat(client, 40);
      // The learner came back to the same chat yesterday.
      await client.query(
        `UPDATE app.tutor_requests SET created_at = now() - interval '1 day' WHERE id=$1`,
        [old.request]
      );
      await client.query("UPDATE app.tutor_sessions SET updated_at = now() WHERE id=$1", [
        old.session,
      ]);

      await run(client);

      expect(await exists(client, "tutor_requests", old.request)).toBe(true);
      expect(await exists(client, "tutor_sessions", old.session)).toBe(true);
    });
  });

  it("removes raw progress events older than thirty days", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const old = await event(client, 45);
      const recent = await event(client, 2);

      await run(client);

      expect(await exists(client, "learning_events", old)).toBe(false);
      expect(await exists(client, "learning_events", recent)).toBe(true);
    });
  });

  it("removes idempotency records at thirty days and rate windows at thirty-five", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const oldKey = crypto.randomUUID();
      const recentKey = crypto.randomUUID();
      for (const [key, days] of [
        [oldKey, 31],
        [recentKey, 29],
      ] as [string, number][]) {
        await client.query(
          `INSERT INTO app.idempotency_records(actor_id, action, request_id, request_hash, response, created_at)
           VALUES ($1, 'retention_probe', $2, 'hash', '{}'::jsonb, now() - ($3 || ' days')::interval)`,
          [AMBER, key, days]
        );
      }
      await client.query(
        `INSERT INTO app.rate_windows(scope, key, window_start, count)
         VALUES ('retention_probe', 'old', now() - interval '36 days', 1),
                ('retention_probe', 'recent', now() - interval '34 days', 1)`
      );

      await run(client);

      const kept = await client.query(
        "SELECT request_id FROM app.idempotency_records WHERE action='retention_probe'"
      );
      expect(kept.rows.map((row) => row.request_id)).toEqual([recentKey]);

      const windows = await client.query(
        "SELECT key FROM app.rate_windows WHERE scope='retention_probe' ORDER BY key"
      );
      // 35 days, because a window is keyed by its start and the limits reading
      // it look back over a period of their own.
      expect(windows.rows.map((row) => row.key)).toEqual(["recent"]);
    });
  });

  it("strips an auth link from a delivered message without losing the message", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const id = (
        await client.query(
          `INSERT INTO app.notification_outbox(user_id, kind, event_key, recipient_email, payload,
                                               status, scheduled_at, delivered_at)
           VALUES ($1, 'invitation', $2, 'amber@example.invalid',
                   '{"action_link":"https://auth.example/verify?token=secret","display_name":"Amber"}'::jsonb,
                   'delivered', now() - interval '2 days', now() - interval '2 days')
           RETURNING id`,
          [AMBER, `retention-probe-${crypto.randomUUID()}`]
        )
      ).rows[0].id;

      await run(client);

      const row = await client.query("SELECT payload, status FROM app.notification_outbox WHERE id=$1", [
        id,
      ]);
      // The delivery record remains — AC-050 reads it — with the link gone.
      expect(row.rows[0].status).toBe("delivered");
      expect(row.rows[0].payload).toEqual({ display_name: "Amber" });
    });
  });

  it("reports what it removed, rule by rule, and records the run", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      await chat(client, 40);
      await event(client, 40);

      const result = await run(client);
      expect(Number(result.counts.tutor_requests)).toBeGreaterThanOrEqual(1);
      expect(Number(result.counts.learning_events)).toBeGreaterThanOrEqual(1);

      const recorded = await client.query("SELECT kind, status, counts FROM app.job_runs WHERE id=$1", [
        result.run_id,
      ]);
      expect(recorded.rows[0].kind).toBe("retention");
      expect(recorded.rows[0].status).toBe("completed");
      // The per-rule breakdown lives here, because the contract's JobResult
      // cannot carry it and an operator looks at the run afterwards anyway.
      expect(recorded.rows[0].counts).toEqual(result.counts);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-057 what retention must not touch", () => {
  it("leaves progress, exercises, certificates and enrollments exactly as they were", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      await chat(client, 40);
      await event(client, 40);

      const snapshot = async () => ({
        progress: (await client.query("SELECT count(*)::int AS n FROM app.class_progress")).rows[0].n,
        exercises: (await client.query("SELECT count(*)::int AS n FROM app.exercise_completions"))
          .rows[0].n,
        certificates: (await client.query("SELECT count(*)::int AS n FROM app.certificates")).rows[0]
          .n,
        enrollments: (await client.query("SELECT count(*)::int AS n FROM app.enrollments")).rows[0].n,
        sessions: (await client.query("SELECT count(*)::int AS n FROM app.playback_sessions")).rows[0]
          .n,
      });

      const before = await snapshot();
      expect(before.progress).toBeGreaterThan(0);
      await run(client);
      expect(await snapshot()).toEqual(before);
    });
  });

  it("keeps the month's accounting after the chats it accounted for are gone", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      /*
       * A chat from 40 days ago: old enough for the text to go, and — since
       * tutor_usage is kept for 180 days — its ledger row stays. That is the
       * property spec/05 asks for in so many words: "Ledger survives chat
       * deletion to preserve month-end spend accounting."
       */
      const old = await chat(client, 40);
      const month = (
        await client.query("SELECT period_start FROM app.tutor_usage WHERE request_id=$1", [
          old.request,
        ])
      ).rows[0].period_start;
      const spendBefore = (
        await client.query(
          "SELECT sum(actual_usd)::numeric AS total FROM app.tutor_usage WHERE period_start=$1",
          [month]
        )
      ).rows[0].total;

      await run(client);

      expect(await exists(client, "tutor_requests", old.request)).toBe(false);
      const ledger = await client.query(
        "SELECT request_id, actual_usd, input_tokens FROM app.tutor_usage WHERE request_id=$1",
        [old.request]
      );
      // The row is still there, still costed, and still carries no text: it
      // never had any.
      expect(ledger.rows).toHaveLength(1);
      expect(Object.keys(ledger.rows[0])).not.toContain("question");

      const spendAfter = (
        await client.query(
          "SELECT sum(actual_usd)::numeric AS total FROM app.tutor_usage WHERE period_start=$1",
          [month]
        )
      ).rows[0].total;
      expect(spendAfter).toEqual(spendBefore);
    });
  });

  it("removes a ledger row only after a hundred and eighty days", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const old = await chat(client, 200);
      const within = await chat(client, 170);

      await run(client);

      expect(await exists(client, "tutor_usage", old.request, "request_id")).toBe(false);
      expect(await exists(client, "tutor_usage", within.request, "request_id")).toBe(true);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-057 who may run it", () => {
  it("refuses a signed-in learner, and a platform administrator too", async () => {
    await inRollback(async (client) => {
      for (const who of [AMBER, fixtures.ids.admin]) {
        await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: who, role: "authenticated" }),
        ]);
        await client.query("SET LOCAL ROLE authenticated");
        /*
         * pglearn_job is service_role only. Retention deletes things, and being
         * signed in — even as an administrator — is not authorisation to run
         * the scheduler's work.
         */
        expect(
          await sqlStateOf(client, `SELECT public.pglearn_job('retention.run', '{}'::jsonb)`)
        ).toBe("42501");
        await client.query("RESET ROLE");
      }
    });
  });
});
