import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { hasDatabase, databaseUrl, inRollback, sqlStateOf } from "./db";

/*
 * AC-040 — a validated answer with server-built class links.
 * AC-041 — an empty corpus answers unsupported without a call; an invalid
 *          model response fails visibly and invents nothing.
 * AC-043 — atomic reservation, duplicate pending, exhausted quota.
 * AC-044 — existing failure/pending retrieved without auto-send; unknown cost
 *          reservation retained; a manager gets 404.
 *
 * The provider is never called from here. What is tested is the transaction
 * around it: what is reserved before, what is recorded after, and what a
 * second request sees. The adapter's own behaviour is in
 * tests/unit/tutor-output.test.ts, with a stub in place of the network.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  amber: AMBER, ben: BEN, manager_a: MANAGER_A, admin: ADMIN,
  enroll_amber: ENROLL_AMBER, enroll_ben: ENROLL_BEN,
  class_video: CLASS_VIDEO,
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

const ask = (overrides: object = {}) => ({
  request_id: crypto.randomUUID(),
  enrollment_id: ENROLL_AMBER,
  class_id: CLASS_VIDEO,
  session_id: null,
  question: "What makes a prompt specific?",
  intent: "explanation",
  input_bytes: 8000,
  input_rate: 0.25,
  output_rate: 2.0,
  budget: 10,
  ...overrides,
});

/** Settles a reservation the way the application would, as service_role. */
async function finish(client: Client, payload: object) {
  await client.query("RESET ROLE");
  const result = await client.query(
    `SELECT public.pglearn_job('tutor.finish', '${JSON.stringify(payload).replace(/'/g, "''")}'::jsonb) AS out`
  );
  return result.rows[0].out;
}

describe.skipIf(!hasDatabase)("AC-043 the reservation transaction", () => {
  it("reserves before anything is sent, and records what it might cost", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const reservation = await call(client, "ask_tutor", ask());

      expect(reservation.replay).toBe(false);
      expect(reservation.session_id).not.toBeNull();
      // 8000 bytes at $0.25/M plus 2048 output tokens at $2.00/M.
      expect(Number(reservation.reserved_usd)).toBeCloseTo(0.002 + 0.004096, 6);
      // The context the prompt is built from comes back with it.
      expect(reservation.context.sources.length).toBeGreaterThan(0);
      expect(reservation.context.class.id).toBe(CLASS_VIDEO);

      await client.query("RESET ROLE");
      const request = (await client.query(
        "SELECT * FROM app.tutor_requests WHERE id=$1", [reservation.request_id]
      )).rows[0];
      expect(request.status).toBe("pending");
      expect(request.answer).toBeNull();

      const usage = (await client.query(
        "SELECT * FROM app.tutor_usage WHERE request_id=$1", [reservation.request_id]
      )).rows[0];
      expect(usage.outcome).toBe("reserved");
      expect(usage.actual_usd).toBeNull();
      // The ledger holds ids and money, never the question.
      expect(Object.keys(usage)).not.toContain("question");
    });
  });

  it("allows one in-flight question, and refuses the second", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      await call(client, "ask_tutor", ask());
      // A second tab, a different question, while the first is still pending.
      expect(
        await sqlStateOf(client, rpc("ask_tutor", ask({ question: "Another question entirely?" })))
      ).toBe("PGL43");
    });
  });

  it("allows the next question once the first has finished", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const first = await call(client, "ask_tutor", ask());
      await finish(client, {
        request_id: first.request_id, outcome: "completed", answer: "An answer.",
        mode: "explanation", citations: [], input_tokens: 1000, output_tokens: 200,
        actual_usd: 0.00065,
      });

      await asUser(client, AMBER);
      const second = await call(client, "ask_tutor", ask({ question: "And what about audience?" }));
      expect(second.replay).toBe(false);
    });
  });

  it("stops after three questions in a minute", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      for (let i = 0; i < 3; i += 1) {
        const reservation = await call(client, "ask_tutor", ask({ question: `Question number ${i}?` }));
        await finish(client, {
          request_id: reservation.request_id, outcome: "completed", answer: "a",
          mode: "unsupported", citations: [], input_tokens: 1, output_tokens: 1, actual_usd: 0,
        });
        await asUser(client, AMBER);
      }
      expect(
        await sqlStateOf(client, rpc("ask_tutor", ask({ question: "One question too many?" })))
      ).toBe("PGL44");
    });
  });

  it("refuses when the month's budget is already committed", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      // An unresolved reservation counts against the budget at its RESERVED
      // value: spec/05 reserves against "actual costs + unresolved reservations".
      await client.query(
        `INSERT INTO app.tutor_usage(request_id, user_id, period_start, reserved_usd, outcome)
         VALUES (gen_random_uuid(), $1, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 9.999, 'reserved')`,
        [AMBER]
      );
      await asUser(client, AMBER);
      expect(await sqlStateOf(client, rpc("ask_tutor", ask()))).toBe("PGL45");
    });
  });

  it("counts a settled request at what it really cost, not what was reserved", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      await client.query(
        `INSERT INTO app.tutor_usage(request_id, user_id, period_start, reserved_usd, actual_usd, outcome)
         VALUES (gen_random_uuid(), $1, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 9.999, 0.001, 'settled')`,
        [AMBER]
      );
      await asUser(client, AMBER);
      // Reserved 9.999 but actually cost 0.001, so there is room for another.
      const reservation = await call(client, "ask_tutor", ask());
      expect(reservation.replay).toBe(false);
    });
  });

  it("refuses a question that is empty, too long, or of an unknown intent", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      for (const bad of [
        ask({ question: "   " }),
        ask({ question: "x".repeat(2001) }),
        ask({ intent: "grade_me" }),
      ]) {
        expect(await sqlStateOf(client, rpc("ask_tutor", bad))).toBe("22023");
      }
    });
  });

  it("refuses another learner's enrollment and a class outside the version", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      expect(
        await sqlStateOf(client, rpc("ask_tutor", ask({ enrollment_id: ENROLL_BEN })))
      ).toBe("P0002");
      expect(
        await sqlStateOf(client, rpc("ask_tutor", ask({ class_id: crypto.randomUUID() })))
      ).toBe("P0002");
    });
  });

  it("refuses once access is revoked, without reserving anything", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      await client.query("UPDATE app.program_grants SET status='revoked' WHERE id=$1", [
        fixtures.ids.grant_a,
      ]);
      await asUser(client, AMBER);
      expect(await sqlStateOf(client, rpc("ask_tutor", ask()))).toBe("PGL22");

      await client.query("RESET ROLE");
      const usage = await client.query(
        "SELECT count(*)::int AS n FROM app.tutor_usage WHERE user_id=$1", [AMBER]
      );
      expect(usage.rows[0].n).toBe(0);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-043 and AC-044 replay and retrieval", () => {
  it("returns the stored answer for the same key and body, with no new reservation", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const body = ask();
      const reservation = await call(client, "ask_tutor", body);
      await finish(client, {
        request_id: reservation.request_id, outcome: "completed",
        answer: "A specific prompt names the task.", mode: "explanation",
        citations: [], input_tokens: 1200, output_tokens: 300, actual_usd: 0.0009,
      });

      await asUser(client, AMBER);
      const replay = await call(client, "ask_tutor", body);
      expect(replay.replay).toBe(true);
      expect(replay.answer.status).toBe("completed");
      expect(replay.answer.answer).toBe("A specific prompt names the task.");

      await client.query("RESET ROLE");
      const usage = await client.query(
        "SELECT count(*)::int AS n FROM app.tutor_usage WHERE user_id=$1", [AMBER]
      );
      expect(usage.rows[0].n).toBe(1);
    });
  });

  it("returns 409 while the same key is still pending", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const body = ask();
      await call(client, "ask_tutor", body);
      expect(await sqlStateOf(client, rpc("ask_tutor", body))).toBe("PGL43");
    });
  });

  it("refuses the same key with a different question", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const body = ask();
      const reservation = await call(client, "ask_tutor", body);
      await finish(client, {
        request_id: reservation.request_id, outcome: "completed", answer: "a",
        mode: "unsupported", citations: [], input_tokens: 1, output_tokens: 1, actual_usd: 0,
      });
      await asUser(client, AMBER);
      expect(
        await sqlStateOf(client, rpc("ask_tutor", { ...body, question: "A different question?" }))
      ).toBe("23505");
    });
  });

  it("keeps a failed request failed until a new key is used", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const body = ask();
      const reservation = await call(client, "ask_tutor", body);
      await finish(client, {
        request_id: reservation.request_id, outcome: "failed", error_code: "TUTOR_OUTPUT_INVALID",
      });

      await asUser(client, AMBER);
      // The same key returns the recorded failure. It does not retry by itself.
      const replay = await call(client, "ask_tutor", body);
      expect(replay.replay).toBe(true);
      expect(replay.answer.status).toBe("failed");
      expect(replay.answer.error_code).toBe("TUTOR_OUTPUT_INVALID");

      // A new key is the learner explicitly asking again.
      const retry = await call(client, "ask_tutor", { ...body, request_id: crypto.randomUUID() });
      expect(retry.replay).toBe(false);
    });
  });

  it("lets the learner read their own request and refuses everybody else", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const reservation = await call(client, "ask_tutor", ask());

      await asUser(client, AMBER);
      const read = await call(client, "get_tutor_request", { request_id: reservation.request_id });
      expect(read.status).toBe("pending");
      expect(read.answer).toBeNull();

      // spec/05: "Managers get no raw chat or per-person question reporting."
      for (const other of [MANAGER_A, ADMIN, BEN]) {
        await asUser(client, other);
        expect(
          await sqlStateOf(client, rpc("get_tutor_request", { request_id: reservation.request_id }))
        ).toBe("P0002");
      }
    });
  });

  it("polling a pending request consumes no quota", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const reservation = await call(client, "ask_tutor", ask());
      for (let i = 0; i < 10; i += 1) {
        await call(client, "get_tutor_request", { request_id: reservation.request_id });
      }
      await client.query("RESET ROLE");
      const window = await client.query(
        "SELECT count FROM app.rate_windows WHERE scope='tutor.minute' AND key=$1", [AMBER]
      );
      // One question asked, ten polls: the window still says one.
      expect(window.rows[0].count).toBe(1);
    });
  });

  it("lists a session's history to its owner only", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const reservation = await call(client, "ask_tutor", ask());
      await finish(client, {
        request_id: reservation.request_id, outcome: "completed", answer: "An answer.",
        mode: "explanation", citations: [], input_tokens: 1, output_tokens: 1, actual_usd: 0,
      });

      await asUser(client, AMBER);
      const history = await call(client, "list_tutor_history", { session_id: reservation.session_id });
      expect(history.items).toHaveLength(1);
      expect(history.items[0].answer).toBe("An answer.");

      await asUser(client, BEN);
      expect(
        await sqlStateOf(client, rpc("list_tutor_history", { session_id: reservation.session_id }))
      ).toBe("P0002");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-040 and AC-044 settlement", () => {
  it("builds every citation link from our own ids", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const reservation = await call(client, "ask_tutor", ask());
      // However many the question actually retrieved — the synthetic fixture
      // has one chunk per class, so this is one or two, not a fixed number.
      const sourceIds = (reservation.context.sources as { id: string }[]).map((s) => s.id);
      expect(sourceIds.length).toBeGreaterThan(0);
      const cited = sourceIds.slice(0, 2);

      await finish(client, {
        request_id: reservation.request_id, outcome: "completed",
        answer: "A specific prompt names the task, the audience and the output.",
        mode: "explanation", citations: cited,
        input_tokens: 1500, output_tokens: 400, actual_usd: 0.001175,
      });

      await asUser(client, AMBER);
      const answer = await call(client, "get_tutor_request", { request_id: reservation.request_id });
      expect(answer.status).toBe("completed");
      expect(answer.citations).toHaveLength(cited.length);
      for (const citation of answer.citations) {
        // spec/05: built server-side from verified enrollment/class ids.
        expect(citation.href).toBe(`/learn/${ENROLL_AMBER}/classes/${citation.class_id}`);
        expect(citation.href.startsWith("/learn/")).toBe(true);
        expect(citation.title).toBeTruthy();
      }
    });
  });

  it("settles the ledger with what the call actually cost", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const reservation = await call(client, "ask_tutor", ask());
      await finish(client, {
        request_id: reservation.request_id, outcome: "completed", answer: "a", mode: "unsupported",
        citations: [], input_tokens: 1200, output_tokens: 300, actual_usd: 0.0009,
      });

      await client.query("RESET ROLE");
      const usage = (await client.query(
        "SELECT * FROM app.tutor_usage WHERE request_id=$1", [reservation.request_id]
      )).rows[0];
      expect(usage.outcome).toBe("settled");
      expect(Number(usage.actual_usd)).toBeCloseTo(0.0009, 6);
      expect(usage.input_tokens).toBe(1200);
    });
  });

  it("retains the reservation when the usage is unknown", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const reservation = await call(client, "ask_tutor", ask());
      const reserved = Number(reservation.reserved_usd);

      // A timeout: the request failed and nobody knows what it cost.
      await finish(client, {
        request_id: reservation.request_id, outcome: "failed", error_code: "PROVIDER_UNAVAILABLE",
      });

      await client.query("RESET ROLE");
      const usage = (await client.query(
        "SELECT * FROM app.tutor_usage WHERE request_id=$1", [reservation.request_id]
      )).rows[0];
      // spec/05: "Never release unknown usage simply because frontend disconnected."
      expect(usage.outcome).toBe("uncertain");
      expect(usage.actual_usd).toBeNull();
      expect(Number(usage.reserved_usd)).toBeCloseTo(reserved, 6);
    });
  });

  it("releases the reservation only when the provider was never called", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const reservation = await call(client, "ask_tutor", ask());
      await finish(client, {
        request_id: reservation.request_id, outcome: "not_invoked",
        answer: "I don't have any course material for this class yet.",
      });

      await client.query("RESET ROLE");
      const usage = (await client.query(
        "SELECT * FROM app.tutor_usage WHERE request_id=$1", [reservation.request_id]
      )).rows[0];
      expect(usage.outcome).toBe("not_invoked");
      expect(Number(usage.actual_usd)).toBe(0);

      const request = (await client.query(
        "SELECT * FROM app.tutor_requests WHERE id=$1", [reservation.request_id]
      )).rows[0];
      expect(request.status).toBe("completed");
      expect(request.mode).toBe("unsupported");
    });
  });

  it("settles once: a second settlement changes nothing", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const reservation = await call(client, "ask_tutor", ask());
      await finish(client, {
        request_id: reservation.request_id, outcome: "completed", answer: "The first answer.",
        mode: "explanation", citations: [], input_tokens: 1, output_tokens: 1, actual_usd: 0.1,
      });
      const second = await finish(client, {
        request_id: reservation.request_id, outcome: "completed", answer: "A different answer.",
        mode: "explanation", citations: [], input_tokens: 9999, output_tokens: 9999, actual_usd: 9,
      });
      expect(second.settled).toBe(false);

      await client.query("RESET ROLE");
      const request = (await client.query(
        "SELECT answer FROM app.tutor_requests WHERE id=$1", [reservation.request_id]
      )).rows[0];
      expect(request.answer).toBe("The first answer.");
    });
  });

  it("sweeps an abandoned pending request and keeps its reservation", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      const reservation = await call(client, "ask_tutor", ask());

      await client.query("RESET ROLE");
      await client.query(
        "UPDATE app.tutor_requests SET created_at = now() - interval '5 minutes' WHERE id=$1",
        [reservation.request_id]
      );
      const swept = (await client.query(
        `SELECT public.pglearn_job('tutor.reap', '{}'::jsonb) AS out`
      )).rows[0].out;
      expect(Number(swept.reaped)).toBe(1);

      const request = (await client.query(
        "SELECT * FROM app.tutor_requests WHERE id=$1", [reservation.request_id]
      )).rows[0];
      expect(request.status).toBe("failed");
      expect(request.error_code).toBe("TUTOR_ABANDONED");

      const usage = (await client.query(
        "SELECT outcome FROM app.tutor_usage WHERE request_id=$1", [reservation.request_id]
      )).rows[0];
      // The provider may have been reached; the money is not given back.
      expect(usage.outcome).toBe("uncertain");
    });
  });

  it("is not reachable by a browser role, whatever it sends", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      // pglearn_job is service_role only (spec/02).
      expect(
        await sqlStateOf(client, `SELECT public.pglearn_job('tutor.finish', '{}'::jsonb)`)
      ).toBe("42501");
      expect(
        await sqlStateOf(client, `SELECT app.job_tutor_finish('{}'::jsonb)`)
      ).toBe("42501");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-043 two tabs racing for the last of the budget", () => {
  it("lets exactly one through", async () => {
    /*
     * Two real connections again. The budget lock is only meaningful if two
     * transactions can contend for it, which one client cannot arrange.
     */
    const a = new Client({ connectionString: databaseUrl()!, ssl: { rejectUnauthorized: false } });
    const b = new Client({ connectionString: databaseUrl()!, ssl: { rejectUnauthorized: false } });
    const setup = new Client({ connectionString: databaseUrl()!, ssl: { rejectUnauthorized: false } });
    await Promise.all([a.connect(), b.connect(), setup.connect()]);

    const spent = crypto.randomUUID();
    try {
      /*
       * The budget is PROJECT-wide, not per learner (spec/05: "configured
       * project monthly budget"), so this test cannot assume the month is
       * empty — anybody else's question counts, and this suite shares a
       * database with the e2e specs.
       *
       * So it reads what the month has actually committed and sets a budget
       * with room for exactly ONE more reservation. That is the condition the
       * race needs, stated relative to reality rather than assumed.
       *
       * It failed once because of exactly this: a question asked elsewhere had
       * already committed more than the fixed budget, and BOTH attempts were
       * refused rather than one.
       */
      await setup.query("DELETE FROM app.tutor_usage WHERE user_id=$1", [BEN]);
      const committed = Number(
        (
          await setup.query(
            `SELECT COALESCE(sum(COALESCE(actual_usd, reserved_usd)), 0) AS spent
               FROM app.tutor_usage
              WHERE period_start = date_trunc('month', now() AT TIME ZONE 'UTC')::date
                AND outcome <> 'not_invoked'`
          )
        ).rows[0].spent
      );
      // One reservation is 8000 bytes at $0.25/M plus 2048 tokens at $2.00/M.
      const reservation = 0.002 + 0.004096;
      const budget = Number((committed + reservation + 0.000001).toFixed(6));
      void spent;

      const attempt = async (client: Client) => {
        await client.query("BEGIN");
        await asUser(client, BEN);
        try {
          const out = await client.query(rpc("ask_tutor", ask({
            enrollment_id: ENROLL_BEN, question: "Racing question?", budget,
          })));
          await client.query("COMMIT");
          return { ok: true as const, out: out.rows[0].out };
        } catch (err) {
          await client.query("ROLLBACK");
          return { ok: false as const, code: (err as { code?: string }).code };
        }
      };

      const [first, second] = await Promise.all([attempt(a), attempt(b)]);
      const winners = [first, second].filter((r) => r.ok);
      const losers = [first, second].filter((r) => !r.ok);

      // One reservation, one refusal — never two reservations over the budget.
      expect(winners, `codes: ${losers.map((l) => l.code).join(", ")}`).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(["PGL45", "PGL43"]).toContain(losers[0].code);

      const total = await setup.query(
        `SELECT COALESCE(sum(COALESCE(actual_usd, reserved_usd)), 0) AS spent
           FROM app.tutor_usage
          WHERE period_start = date_trunc('month', now() AT TIME ZONE 'UTC')::date
            AND user_id = $1 AND outcome <> 'not_invoked'`,
        [BEN]
      );
      // Exactly one reservation for this learner: the race produced one.
      expect(Number(total.rows[0].spent)).toBeLessThanOrEqual(reservation + 0.000001);
    } finally {
      await setup.query("DELETE FROM app.tutor_usage WHERE user_id=$1", [BEN]);
      await setup.query(
        `DELETE FROM app.tutor_requests WHERE session_id IN
           (SELECT s.id FROM app.tutor_sessions s JOIN app.enrollments e ON e.id=s.enrollment_id
             WHERE e.user_id=$1)`, [BEN]
      );
      await setup.query(
        `DELETE FROM app.tutor_sessions WHERE enrollment_id IN
           (SELECT id FROM app.enrollments WHERE user_id=$1)`, [BEN]
      );
      await setup.query("DELETE FROM app.rate_windows WHERE key=$1", [BEN]);
      await Promise.all([a.end(), b.end(), setup.end()]);
    }
  }, 60_000);
});
