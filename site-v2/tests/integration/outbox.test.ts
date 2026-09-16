import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback } from "./db";

/*
 * AC-045 — one learning message per learner per local day, and a second run
 *          that sends nothing more.
 * AC-047 — the recheck immediately before sending, and what cannot be recalled.
 * AC-048 — a timeout is not a failure: retry inside the window, uncertain at
 *          the cutoff, and the daily slot retained either way.
 *
 * The scheduler is service-role only, so these run as the owner. The rules it
 * applies are also tested against a fixed clock in tests/unit/reminders.test.ts;
 * what is tested here is the transaction around them.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  amber: AMBER, ben: BEN, cora: CORA, dana: DANA,
  enroll_amber: ENROLL_AMBER,
  grant_a: GRANT_A,
} = fixtures.ids;

/** Amber's local noon, in UTC. The fixture profiles are all UTC. */
const NOON = "2026-09-15T12:00:00Z";

async function job(client: Client, name: string, payload: object = {}) {
  const result = await client.query(
    `SELECT public.pglearn_job($1, $2::jsonb) AS out`, [name, JSON.stringify(payload)]
  );
  return result.rows[0].out;
}

async function outboxFor(client: Client, userId: string) {
  const result = await client.query(
    `SELECT * FROM app.notification_outbox WHERE user_id=$1
      AND kind IN ('inactivity','due_soon','due_today','overdue') ORDER BY created_at`,
    [userId]
  );
  return result.rows;
}

describe.skipIf(!hasDatabase)("AC-045 one message per learner per local day", () => {
  it("plans the highest-priority reminder, and a second run plans nothing", async () => {
    await inRollback(async (client) => {
      const first = await job(client, "reminders.plan", { now: NOON });
      expect(Number(first.planned)).toBeGreaterThan(0);

      // Amber is overdue (due 2026-09-13) and has never started, so she is
      // also inactive. Overdue wins, and she gets exactly one message.
      const amber = await outboxFor(client, AMBER);
      expect(amber).toHaveLength(1);
      expect(amber[0].kind).toBe("overdue");
      expect(amber[0].recipient_email).toBe("amber@example.invalid");
      expect(amber[0].event_key).toBe(
        `learning/${ENROLL_AMBER}/overdue/${amber[0].payload.due_at.replace(/\.000Z$/, "Z").replace(/\+00:00$/, "Z")}`
          .replace(/T(\d\d:\d\d:\d\d)\.\d+Z/, "T$1Z")
      );

      // The day is claimed.
      const claim = await client.query(
        "SELECT * FROM app.reminder_days WHERE user_id=$1", [AMBER]
      );
      expect(claim.rows).toHaveLength(1);
      expect(claim.rows[0].outbox_id).toBe(amber[0].id);

      // AC-045: "duplicate run makes no new send".
      const second = await job(client, "reminders.plan", { now: NOON });
      expect(Number(second.planned)).toBe(0);
      expect(await outboxFor(client, AMBER)).toHaveLength(1);
    });
  });

  it("sends nothing to a learner who has not accepted their invitation", async () => {
    await inRollback(async (client) => {
      await job(client, "reminders.plan", { now: NOON });
      // AC-045: "pending Dana receives none." She is not onboarded.
      expect(await outboxFor(client, DANA)).toHaveLength(0);
    });
  });

  it("sends nothing to a learner who has finished", async () => {
    await inRollback(async (client) => {
      await job(client, "reminders.plan", { now: NOON });
      // Cora completed before the due date.
      expect(await outboxFor(client, CORA)).toHaveLength(0);
    });
  });

  it("sends nothing outside the local sending window", async () => {
    await inRollback(async (client) => {
      const early = await job(client, "reminders.plan", { now: "2026-09-15T08:59:00Z" });
      expect(Number(early.planned)).toBe(0);
      const late = await job(client, "reminders.plan", { now: "2026-09-15T18:00:00Z" });
      expect(Number(late.planned)).toBe(0);

      // And at 09:00 exactly, it does.
      const open = await job(client, "reminders.plan", { now: "2026-09-15T09:00:00Z" });
      expect(Number(open.planned)).toBeGreaterThan(0);
    });
  });

  it("respects the learner's own timezone rather than the server's", async () => {
    await inRollback(async (client) => {
      // 22:00 UTC is 09:00 the next day in Auckland: inside the window there,
      // outside it everywhere the fixtures sit.
      await client.query("UPDATE app.profiles SET timezone='Pacific/Auckland' WHERE id=$1", [AMBER]);

      const planned = await job(client, "reminders.plan", { now: "2026-09-15T22:00:00Z" });
      expect(Number(planned.planned)).toBeGreaterThan(0);
      const amber = await outboxFor(client, AMBER);
      expect(amber).toHaveLength(1);
      // The claim is for the local date, which is already the 16th there.
      // The driver hands a DATE back as a Date at local midnight, so the
      // string form carries this machine's timezone. The date parts are what
      // the claim actually holds.
      const claim = await client.query(
        "SELECT local_date::text AS local_date FROM app.reminder_days WHERE user_id=$1", [AMBER]
      );
      expect(claim.rows[0].local_date).toBe("2026-09-16");
    });
  });

  it("stops entirely when the learner turns reminders off", async () => {
    await inRollback(async (client) => {
      await client.query("UPDATE app.profiles SET reminders_enabled=false WHERE id=$1", [AMBER]);
      await job(client, "reminders.plan", { now: NOON });
      expect(await outboxFor(client, AMBER)).toHaveLength(0);
    });
  });

  it("stops when access is revoked, without a second copy of the access rules", async () => {
    await inRollback(async (client) => {
      await client.query("UPDATE app.program_grants SET status='revoked' WHERE id=$1", [GRANT_A]);
      await job(client, "reminders.plan", { now: NOON });
      expect(await outboxFor(client, AMBER)).toHaveLength(0);
      expect(await outboxFor(client, BEN)).toHaveLength(0);
    });
  });

  it("does not let a certificate email consume the learning slot", async () => {
    await inRollback(async (client) => {
      // A certificate notification already exists for this learner today.
      await client.query(
        `INSERT INTO app.notification_outbox(user_id, enrollment_id, kind, event_key,
                                             recipient_email, payload, scheduled_at)
         VALUES ($1, $2, 'certificate', 'certificate:test', 'amber@example.invalid', '{}'::jsonb, $3)`,
        [AMBER, ENROLL_AMBER, NOON]
      );

      await job(client, "reminders.plan", { now: NOON });
      // spec/03: "Invitations/certificates do not consume that learning slot."
      expect(await outboxFor(client, AMBER)).toHaveLength(1);
    });
  });

  it("starts a new campaign when the due date moves", async () => {
    await inRollback(async (client) => {
      await job(client, "reminders.plan", { now: NOON });
      const before = await outboxFor(client, AMBER);
      expect(before).toHaveLength(1);

      // A manager extends the deadline, and the next local day comes round.
      await client.query("UPDATE app.enrollments SET due_at='2026-09-30T17:00:00Z' WHERE id=$1", [
        ENROLL_AMBER,
      ]);
      await job(client, "reminders.plan", { now: "2026-09-27T12:00:00Z" });

      const after = await outboxFor(client, AMBER);
      expect(after).toHaveLength(2);
      // A different campaign key, so the new deadline is a new message.
      expect(after[1].event_key).not.toBe(after[0].event_key);
      expect(after[1].kind).toBe("due_soon");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-047 the recheck immediately before sending", () => {
  it("suppresses a pending reminder for a learner who has since finished", async () => {
    await inRollback(async (client) => {
      await job(client, "reminders.plan", { now: NOON });
      const [message] = await outboxFor(client, AMBER);
      expect(message.status).toBe("pending");

      // She finishes before the sender gets to it.
      await client.query("SET session_replication_role = 'replica'");
      await client.query(
        "UPDATE app.enrollments SET completed_at=$2, started_at=$2 WHERE id=$1",
        [ENROLL_AMBER, NOON]
      );
      await client.query("SET session_replication_role = 'origin'");

      const claimed = await job(client, "reminders.claim", { now: NOON });
      expect(Number(claimed.suppressed)).toBeGreaterThan(0);

      const after = await client.query("SELECT * FROM app.notification_outbox WHERE id=$1", [
        message.id,
      ]);
      expect(after.rows[0].status).toBe("suppressed");
      // No provider call: nothing was ever claimed for sending.
      expect(after.rows[0].first_attempt_at).toBeNull();
      expect((claimed.claimed as unknown[]).some((c) => (c as { id: string }).id === message.id)).toBe(
        false
      );

      // "suppressed slot may be released only before provider invocation" —
      // nothing was sent, so the day is given back.
      const claim = await client.query("SELECT * FROM app.reminder_days WHERE user_id=$1", [AMBER]);
      expect(claim.rows).toHaveLength(0);
    });
  });

  it("suppresses when the learner opts out, and when access is revoked", async () => {
    await inRollback(async (client) => {
      await job(client, "reminders.plan", { now: NOON });
      await client.query("UPDATE app.profiles SET reminders_enabled=false WHERE id=$1", [AMBER]);
      await client.query("UPDATE app.program_grants SET status='revoked' WHERE id=$1", [GRANT_A]);

      await job(client, "reminders.claim", { now: NOON });

      const rows = await outboxFor(client, AMBER);
      for (const row of rows) expect(row.status).toBe("suppressed");
    });
  });

  it("cannot recall a message that has already been attempted", async () => {
    await inRollback(async (client) => {
      await job(client, "reminders.plan", { now: NOON });
      const [message] = await outboxFor(client, AMBER);

      // The sender has it in hand.
      const claimed = await job(client, "reminders.claim", { now: NOON });
      expect((claimed.claimed as { id: string }[]).some((c) => c.id === message.id)).toBe(true);

      // Only now does she finish.
      await client.query("SET session_replication_role = 'replica'");
      await client.query(
        "UPDATE app.enrollments SET completed_at=$2, started_at=$2 WHERE id=$1",
        [ENROLL_AMBER, NOON]
      );
      await client.query("SET session_replication_role = 'origin'");

      const again = await job(client, "reminders.claim", { now: NOON });
      const after = await client.query("SELECT * FROM app.notification_outbox WHERE id=$1", [
        message.id,
      ]);
      /*
       * AC-047: "already-dispatched email cannot be recalled." The row keeps
       * its sending state and its claimed day; pretending otherwise would put
       * the database out of step with what the learner actually received.
       */
      expect(after.rows[0].status).toBe("sending");
      expect(after.rows[0].first_attempt_at).not.toBeNull();
      expect(Number(again.suppressed)).toBe(0);
      const claim = await client.query("SELECT * FROM app.reminder_days WHERE user_id=$1", [AMBER]);
      expect(claim.rows).toHaveLength(1);
    });
  });

  it("claims at most twenty, leases them for five minutes, and skips the locked", async () => {
    await inRollback(async (client) => {
      await job(client, "reminders.plan", { now: NOON });
      const claimed = await job(client, "reminders.claim", { now: NOON });
      const items = claimed.claimed as { id: string; attempts: number; first_attempt_at: string }[];
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(20);

      for (const item of items) {
        expect(item.attempts).toBe(1);
        // "Set first_attempt_at before the network request."
        expect(item.first_attempt_at).not.toBeNull();
      }

      const leases = await client.query(
        "SELECT claimed_until, scheduled_at FROM app.notification_outbox WHERE id = ANY($1::uuid[])",
        [items.map((i) => i.id)]
      );
      for (const lease of leases.rows) {
        const held = new Date(lease.claimed_until).getTime() - Date.parse(NOON);
        expect(held).toBe(5 * 60 * 1000);
      }

      // A second claim in the same instant takes nothing: the leases are live.
      const again = await job(client, "reminders.claim", { now: NOON });
      expect(again.claimed).toEqual([]);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-048 a timeout is not proof of failure", () => {
  async function claimOne(client: Client) {
    await job(client, "reminders.plan", { now: NOON });
    const claimed = await job(client, "reminders.claim", { now: NOON });
    return (claimed.claimed as { id: string }[])[0];
  }

  it("retries after one, five, fifteen and sixty minutes", async () => {
    await inRollback(async (client) => {
      const message = await claimOne(client);
      const expected = [1, 5, 15, 60];

      let at = NOON;
      for (let attempt = 0; attempt < expected.length; attempt += 1) {
        const result = await job(client, "reminders.finish", {
          id: message.id, outcome: "unknown", error: "timeout", now: at,
        });
        expect(result.status).toBe("pending");

        const row = await client.query(
          "SELECT scheduled_at, attempts FROM app.notification_outbox WHERE id=$1", [message.id]
        );
        const waited = (new Date(row.rows[0].scheduled_at).getTime() - Date.parse(at)) / 60000;
        expect(waited).toBe(expected[attempt]);

        // The next attempt, at the moment it becomes due.
        at = new Date(row.rows[0].scheduled_at).toISOString();
        await job(client, "reminders.claim", { now: at });
      }
    });
  });

  it("stops after five attempts, as uncertain rather than failed", async () => {
    await inRollback(async (client) => {
      const message = await claimOne(client);
      let at = NOON;
      for (let i = 0; i < 5; i += 1) {
        await job(client, "reminders.finish", { id: message.id, outcome: "unknown", now: at });
        const row = await client.query(
          "SELECT scheduled_at, status, attempts FROM app.notification_outbox WHERE id=$1",
          [message.id]
        );
        if (row.rows[0].status === "uncertain") break;
        at = new Date(row.rows[0].scheduled_at).toISOString();
        await job(client, "reminders.claim", { now: at });
      }

      const final = await client.query(
        "SELECT status, attempts FROM app.notification_outbox WHERE id=$1", [message.id]
      );
      // Never 'failed': nobody knows whether the provider sent it.
      expect(final.rows[0].status).toBe("uncertain");
      expect(final.rows[0].attempts).toBeLessThanOrEqual(5);
    });
  });

  it("moves to uncertain at twenty-three hours, and does not resend blindly", async () => {
    await inRollback(async (client) => {
      const message = await claimOne(client);
      const cutoff = new Date(Date.parse(NOON) + 23 * 60 * 60 * 1000).toISOString();

      const result = await job(client, "reminders.finish", {
        id: message.id, outcome: "unknown", error: "no response", now: cutoff,
      });
      expect(result.status).toBe("uncertain");

      // Nothing claims it again: an uncertain message needs reconciliation,
      // not another send.
      const claimed = await job(client, "reminders.claim", { now: cutoff });
      expect((claimed.claimed as { id: string }[]).some((c) => c.id === message.id)).toBe(false);

      // AC-048: "daily slot retained." The learner may have received it.
      const claim = await client.query("SELECT * FROM app.reminder_days WHERE user_id=$1", [AMBER]);
      expect(claim.rows).toHaveLength(1);
    });
  });

  it("keeps the same identity and payload across a retry", async () => {
    await inRollback(async (client) => {
      const message = await claimOne(client);
      const before = await client.query(
        "SELECT event_key, recipient_email, payload FROM app.notification_outbox WHERE id=$1",
        [message.id]
      );

      await job(client, "reminders.finish", { id: message.id, outcome: "unknown", now: NOON });
      const at = new Date(Date.parse(NOON) + 60_000).toISOString();
      await job(client, "reminders.claim", { now: at });

      const after = await client.query(
        "SELECT id, event_key, recipient_email, payload FROM app.notification_outbox WHERE id=$1",
        [message.id]
      );
      // "Freeze recipient/template/rendered payload across retry." The id is
      // also the provider's Idempotency-Key, so it must not move either.
      expect(after.rows[0].id).toBe(message.id);
      expect(after.rows[0].event_key).toBe(before.rows[0].event_key);
      expect(after.rows[0].recipient_email).toBe(before.rows[0].recipient_email);
      expect(after.rows[0].payload).toEqual(before.rows[0].payload);
    });
  });

  it("accepts a definitive rejection as a failure", async () => {
    await inRollback(async (client) => {
      const message = await claimOne(client);
      const result = await job(client, "reminders.finish", {
        id: message.id, outcome: "rejected", error: "mailbox does not exist", now: NOON,
      });
      expect(result.status).toBe("failed");

      const row = await client.query(
        "SELECT status, last_error FROM app.notification_outbox WHERE id=$1", [message.id]
      );
      expect(row.rows[0].last_error).toContain("mailbox does not exist");
    });
  });

  it("records an acceptance with the provider's id", async () => {
    await inRollback(async (client) => {
      const message = await claimOne(client);
      await job(client, "reminders.finish", {
        id: message.id, outcome: "accepted", provider_id: "prov_123", now: NOON,
      });
      const row = await client.query(
        "SELECT status, provider_id, accepted_at, claimed_until FROM app.notification_outbox WHERE id=$1",
        [message.id]
      );
      expect(row.rows[0].status).toBe("accepted");
      expect(row.rows[0].provider_id).toBe("prov_123");
      expect(row.rows[0].accepted_at).not.toBeNull();
      expect(row.rows[0].claimed_until).toBeNull();
    });
  });

  it("recovers an expired lease without restarting the retry count", async () => {
    await inRollback(async (client) => {
      const message = await claimOne(client);
      // The sender died. Six minutes later the five-minute lease has expired.
      const later = new Date(Date.parse(NOON) + 6 * 60 * 1000).toISOString();

      // Several fixture learners are due, so the count is "at least this one";
      // the row itself is what the test is about.
      const recovered = await job(client, "reminders.recover", { now: later });
      expect(Number(recovered.recovered)).toBeGreaterThanOrEqual(1);

      const row = await client.query(
        "SELECT status, attempts, first_attempt_at FROM app.notification_outbox WHERE id=$1",
        [message.id]
      );
      expect(row.rows[0].status).toBe("pending");
      // The attempt still counts, and the 23-hour clock still runs from the
      // first one — "Recover lease with same identity".
      expect(row.rows[0].attempts).toBe(1);
      expect(new Date(row.rows[0].first_attempt_at).toISOString()).toBe(
        new Date(NOON).toISOString()
      );
    });
  });

  it("sweeps anything still unresolved after twenty-three hours", async () => {
    await inRollback(async (client) => {
      const message = await claimOne(client);
      const later = new Date(Date.parse(NOON) + 24 * 60 * 60 * 1000).toISOString();

      const swept = await job(client, "reminders.recover", { now: later });
      expect(Number(swept.uncertain)).toBeGreaterThanOrEqual(1);

      const row = await client.query(
        "SELECT status, last_error FROM app.notification_outbox WHERE id=$1", [message.id]
      );
      expect(row.rows[0].status).toBe("uncertain");
      expect(row.rows[0].last_error).toContain("23 hours");
    });
  });

  it("is not reachable by a browser role", async () => {
    await inRollback(async (client) => {
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: AMBER, role: "authenticated" }),
      ]);
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SAVEPOINT probe");
      let code = "";
      try {
        await client.query(`SELECT public.pglearn_job('reminders.plan', '{}'::jsonb)`);
      } catch (err) {
        code = (err as { code?: string }).code ?? "";
      }
      await client.query("ROLLBACK TO SAVEPOINT probe");
      expect(code).toBe("42501");
    });
  });
});
