import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback } from "./db";

/*
 * AC-049 — delivery callbacks.
 *
 * "Valid delivered callback before provider ID save; duplicate event; forged
 * signature. Process and reconcile callbacks. One event record; reconciliation
 * reaches delivered; accepted callback cannot downgrade it; forged event
 * 401/no write."
 *
 * The forged-signature half is in tests/e2e/jobs.spec.ts, where a real request
 * reaches the real route and is refused before anything is written — it is a
 * property of the route, not of the database.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const { amber: AMBER, enroll_amber: ENROLL_AMBER } = fixtures.ids;

const NOW = "2026-09-15T12:00:00Z";

async function job(client: Client, name: string, payload: object = {}) {
  const result = await client.query(`SELECT public.pglearn_job($1, $2::jsonb) AS out`, [
    name,
    JSON.stringify(payload),
  ]);
  return result.rows[0].out;
}

/** An outbox row that has been sent and has a provider id. */
async function sentMessage(client: Client, providerId: string | null = "prov_1") {
  const result = await client.query(
    `INSERT INTO app.notification_outbox(user_id, enrollment_id, kind, event_key, recipient_email,
                                         payload, status, scheduled_at, first_attempt_at,
                                         attempts, provider_id, accepted_at)
     VALUES ($1, $2, 'overdue', 'learning/test/' || gen_random_uuid()::text, 'amber@example.invalid',
             '{}'::jsonb, 'accepted', $3, $3, 1, $4, $3)
     RETURNING *`,
    [AMBER, ENROLL_AMBER, NOW, providerId]
  );
  return result.rows[0];
}

const event = (overrides: object = {}) => ({
  provider_event_id: `evt_${crypto.randomUUID()}`,
  provider_email_id: "prov_1",
  type: "delivered",
  now: NOW,
  ...overrides,
});

describe.skipIf(!hasDatabase)("AC-049 a verified callback", () => {
  it("records one event and moves the message to delivered", async () => {
    await inRollback(async (client) => {
      const message = await sentMessage(client);
      const result = await job(client, "email.event", event());
      expect(result.applied).toBe(true);
      expect(result.status).toBe("delivered");

      const row = await client.query("SELECT * FROM app.notification_outbox WHERE id=$1", [
        message.id,
      ]);
      expect(row.rows[0].status).toBe("delivered");
      expect(row.rows[0].delivered_at).not.toBeNull();
    });
  });

  it("keeps exactly one record when the same event arrives twice", async () => {
    await inRollback(async (client) => {
      await sentMessage(client);
      const body = event();

      const first = await job(client, "email.event", body);
      const second = await job(client, "email.event", body);

      expect(first.applied).toBe(true);
      expect(second.duplicate).toBe(true);
      expect(second.applied).toBe(false);

      const records = await client.query(
        "SELECT count(*)::int AS n FROM app.email_webhook_events WHERE provider_event_id=$1",
        [body.provider_event_id]
      );
      expect(records.rows[0].n).toBe(1);
    });
  });

  it("does not let an accepted callback downgrade a delivered message", async () => {
    await inRollback(async (client) => {
      const message = await sentMessage(client);
      await job(client, "email.event", event({ type: "delivered" }));

      // The provider's 'sent' callback arrives after its 'delivered' one,
      // which is normal: the order is not guaranteed.
      const late = await job(client, "email.event", event({ type: "accepted" }));
      expect(late.applied).toBe(false);

      const row = await client.query("SELECT status FROM app.notification_outbox WHERE id=$1", [
        message.id,
      ]);
      expect(row.rows[0].status).toBe("delivered");
    });
  });

  it("records a bounce as a final failure even after delivery was reported", async () => {
    await inRollback(async (client) => {
      const message = await sentMessage(client);
      await job(client, "email.event", event({ type: "delivered" }));
      await job(client, "email.event", event({ type: "bounced" }));

      const row = await client.query(
        "SELECT status, last_error FROM app.notification_outbox WHERE id=$1", [message.id]
      );
      // A bounce is news about the mailbox, not about our bookkeeping order.
      expect(row.rows[0].status).toBe("failed");
      expect(row.rows[0].last_error).toBe("bounced");
    });
  });

  it("refuses an event with no id or no type", async () => {
    await inRollback(async (client) => {
      await client.query("SAVEPOINT probe");
      let code = "";
      try {
        await job(client, "email.event", { provider_email_id: "prov_1" });
      } catch (err) {
        code = (err as { code?: string }).code ?? "";
      }
      await client.query("ROLLBACK TO SAVEPOINT probe");
      expect(code).toBe("22023");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-049 a callback that overtakes the provider id", () => {
  it("keeps the event and applies it once the id is saved", async () => {
    await inRollback(async (client) => {
      // The message is still in flight: no provider id yet.
      const message = await sentMessage(client, null);
      await client.query(
        "UPDATE app.notification_outbox SET status='sending', accepted_at=NULL WHERE id=$1",
        [message.id]
      );

      const early = await job(client, "email.event", event({ provider_email_id: "prov_late" }));
      expect(early.applied).toBe(false);
      expect(early.pending_reconciliation).toBe(true);

      // The event is retained rather than discarded.
      const kept = await client.query(
        "SELECT count(*)::int AS n FROM app.email_webhook_events WHERE provider_email_id='prov_late'"
      );
      expect(kept.rows[0].n).toBe(1);

      // The send finishes and the id lands.
      await client.query(
        "UPDATE app.notification_outbox SET provider_id='prov_late', status='accepted' WHERE id=$1",
        [message.id]
      );

      const reconciled = await job(client, "email.reconcile", { now: NOW });
      expect(Number(reconciled.applied)).toBe(1);

      const row = await client.query("SELECT status FROM app.notification_outbox WHERE id=$1", [
        message.id,
      ]);
      expect(row.rows[0].status).toBe("delivered");
    });
  });

  it("reconciles nothing twice", async () => {
    await inRollback(async (client) => {
      const message = await sentMessage(client, "prov_twice");
      await job(client, "email.event", event({ provider_email_id: "prov_twice" }));

      const again = await job(client, "email.reconcile", { now: NOW });
      expect(Number(again.applied)).toBe(0);

      const row = await client.query("SELECT status FROM app.notification_outbox WHERE id=$1", [
        message.id,
      ]);
      expect(row.rows[0].status).toBe("delivered");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-049 a bounced address stops receiving learning mail", () => {
  it("is excluded from the scheduler until an operator clears it", async () => {
    await inRollback(async (client) => {
      // Amber's address bounces.
      const message = await sentMessage(client, "prov_bounce");
      await job(client, "email.event", event({ provider_email_id: "prov_bounce", type: "bounced" }));

      const bounced = await client.query("SELECT app.email_bounced($1) AS b", [
        "amber@example.invalid",
      ]);
      expect(bounced.rows[0].b).toBe(true);

      await job(client, "reminders.plan", { now: NOW });
      const planned = await client.query(
        `SELECT count(*)::int AS n FROM app.notification_outbox
          WHERE user_id=$1 AND id <> $2 AND kind IN ('inactivity','due_soon','due_today','overdue')`,
        [AMBER, message.id]
      );
      // spec/05: "do not retry bounced addresses automatically."
      expect(planned.rows[0].n).toBe(0);

      // Everybody else still gets theirs.
      const others = await client.query(
        `SELECT count(*)::int AS n FROM app.notification_outbox
          WHERE user_id <> $1 AND kind IN ('inactivity','due_soon','due_today','overdue')`,
        [AMBER]
      );
      expect(others.rows[0].n).toBeGreaterThan(0);
    });
  });

  it("resumes once the operator clears the failure", async () => {
    await inRollback(async (client) => {
      const message = await sentMessage(client, "prov_cleared");
      await job(client, "email.event", event({ provider_email_id: "prov_cleared", type: "bounced" }));

      // The operator resolves it — the row is no longer a standing bounce.
      await client.query(
        "UPDATE app.notification_outbox SET status='suppressed', last_error='cleared by operator' WHERE id=$1",
        [message.id]
      );
      const bounced = await client.query("SELECT app.email_bounced($1) AS b", [
        "amber@example.invalid",
      ]);
      expect(bounced.rows[0].b).toBe(false);

      await job(client, "reminders.plan", { now: NOW });
      const planned = await client.query(
        `SELECT count(*)::int AS n FROM app.notification_outbox
          WHERE user_id=$1 AND id <> $2 AND kind IN ('inactivity','due_soon','due_today','overdue')`,
        [AMBER, message.id]
      );
      expect(planned.rows[0].n).toBe(1);
    });
  });
});
