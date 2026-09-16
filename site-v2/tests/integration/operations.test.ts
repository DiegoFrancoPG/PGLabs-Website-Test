import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback, sqlStateOf } from "./db";
import { operationStatusSchema } from "@/features/operations/operations";

/*
 * AC-051 — redacted operations.
 *
 * "Failed invitation with action link in private outbox payload. Admin opens
 * operations, inspect logs/browser bundle. Status available; signed
 * link/cookie/key/prompt/response body absent."
 *
 * The browser-bundle half is in tests/e2e/operations.spec.ts, where the page
 * is rendered and its HTML searched. Here the question is narrower and
 * sharper: can the link reach the API at all?
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const { admin: ADMIN, manager_a: MANAGER_A, amber: AMBER } = fixtures.ids;

/** The kind of secret an invitation's outbox payload really does carry. */
const ACTION_LINK =
  "https://kviq.supabase.co/auth/v1/verify?token=pkce_a1b2c3d4e5f6SECRETTOKEN&type=invite";

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

/** A failed invitation whose payload holds an Auth action link. */
async function failedInvitation(client: Client) {
  await client.query("RESET ROLE");
  const result = await client.query(
    `INSERT INTO app.notification_outbox(user_id, kind, event_key, recipient_email, payload,
                                         status, scheduled_at, first_attempt_at, attempts, last_error)
     VALUES ($1, 'invitation', 'invitation:' || gen_random_uuid()::text, 'amber@example.invalid',
             jsonb_build_object('action_url', $2::text, 'subject', 'Your PGLearn invitation'),
             'failed', now(), now(), 3, 'the provider rejected the message (422)')
     RETURNING *`,
    [AMBER, ACTION_LINK]
  );
  return result.rows[0];
}

describe.skipIf(!hasDatabase)("AC-051 the action link never leaves the database", () => {
  it("is in the payload, which is the thing being defended", async () => {
    await inRollback(async (client) => {
      const message = await failedInvitation(client);
      // The premise: the secret really is there.
      expect(message.payload.action_url).toBe(ACTION_LINK);
    });
  });

  it("is absent from what an admin can read", async () => {
    await inRollback(async (client) => {
      await failedInvitation(client);
      await asUser(client, ADMIN);

      const listed = await call(client, "list_notifications", { limit: 50 });
      const everything = JSON.stringify(listed);

      // The status is there…
      expect(listed.items.length).toBeGreaterThan(0);
      const invitation = listed.items.find(
        (i: { kind: string }) => i.kind === "invitation"
      );
      expect(invitation.status).toBe("failed");
      expect(invitation.attempts).toBe(3);
      expect(invitation.last_error).toContain("rejected");

      // …and the link is not, in any form.
      expect(everything).not.toContain("pkce_");
      expect(everything).not.toContain("SECRETTOKEN");
      expect(everything).not.toContain("token=");
      expect(everything).not.toContain("action_url");
      expect(everything).not.toContain("payload");
      expect(everything).not.toContain("subject");
    });
  });

  it("returns exactly the seven fields the contract declares, and no more", async () => {
    await inRollback(async (client) => {
      await failedInvitation(client);
      await asUser(client, ADMIN);
      const listed = await call(client, "list_notifications", { limit: 50 });

      for (const item of listed.items) {
        // The schema is strict: an extra field is a parse failure, not a
        // silent pass-through to a screen.
        expect(() => operationStatusSchema.parse(item)).not.toThrow();
        expect(Object.keys(item).sort()).toEqual([
          "attempts", "created_at", "id", "kind", "last_error", "recipient_email", "status",
        ]);
      }
    });
  });

  it("carries no tutor prompt, question or answer either", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const listed = await call(client, "list_notifications", { limit: 50 });
      const jobs = await call(client, "list_jobs", { limit: 20 });
      const everything = `${JSON.stringify(listed)} ${JSON.stringify(jobs)}`.toLowerCase();
      for (const forbidden of ["question", "answer", "prompt", "response", "html", "body"]) {
        expect(everything).not.toContain(forbidden);
      }
    });
  });

  it("is refused to a manager and to a learner", async () => {
    await inRollback(async (client) => {
      for (const actor of [MANAGER_A, AMBER]) {
        await asUser(client, actor);
        expect(await sqlStateOf(client, rpc("list_notifications", {}))).toBe("42501");
        expect(await sqlStateOf(client, rpc("list_jobs", {}))).toBe("42501");
        expect(
          await sqlStateOf(client, rpc("retry_notification", {
            request_id: crypto.randomUUID(), notification_id: crypto.randomUUID(),
          }))
        ).toBe("42501");
      }
    });
  });
});

describe.skipIf(!hasDatabase)("AC-048 and AC-051 retrying, carefully", () => {
  it("queues a failed message again and records who did it", async () => {
    await inRollback(async (client) => {
      const message = await failedInvitation(client);
      await asUser(client, ADMIN);

      const retried = await call(client, "retry_notification", {
        request_id: crypto.randomUUID(), notification_id: message.id,
      });
      expect(retried.status).toBe("pending");
      expect(retried.attempts).toBe(0);

      await client.query("RESET ROLE");
      const row = await client.query("SELECT * FROM app.notification_outbox WHERE id=$1", [
        message.id,
      ]);
      // The retry schedule starts again, and the payload — with its link — is
      // untouched, because the message still has to be sendable.
      expect(row.rows[0].first_attempt_at).toBeNull();
      expect(row.rows[0].payload.action_url).toBe(ACTION_LINK);

      const audit = await client.query(
        "SELECT * FROM app.audit_events WHERE action='retry_notification' AND entity_id=$1",
        [message.id]
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].actor_id).toBe(ADMIN);
      // The audit record names the kind, not the contents.
      expect(JSON.stringify(audit.rows[0].metadata)).not.toContain("pkce_");
    });
  });

  it("refuses to resend a message with no confirmed outcome", async () => {
    await inRollback(async (client) => {
      const message = await failedInvitation(client);
      await client.query(
        "UPDATE app.notification_outbox SET status='uncertain' WHERE id=$1", [message.id]
      );

      await asUser(client, ADMIN);
      /*
       * AC-048's "no blind resend". The provider may already have delivered
       * it; sending again would be the second copy, and nobody can tell yet.
       */
      expect(
        await sqlStateOf(client, rpc("retry_notification", {
          request_id: crypto.randomUUID(), notification_id: message.id,
        }))
      ).toBe("PGL46");
    });
  });

  it("refuses to resend one that is already delivered or still pending", async () => {
    await inRollback(async (client) => {
      const message = await failedInvitation(client);
      for (const status of ["delivered", "accepted", "pending", "sending"]) {
        await client.query("RESET ROLE");
        await client.query("UPDATE app.notification_outbox SET status=$2 WHERE id=$1", [
          message.id, status,
        ]);
        await asUser(client, ADMIN);
        expect(
          await sqlStateOf(client, rpc("retry_notification", {
            request_id: crypto.randomUUID(), notification_id: message.id,
          }))
        ).toBe("23514");
      }
    });
  });

  it("is idempotent for one request id", async () => {
    await inRollback(async (client) => {
      const message = await failedInvitation(client);
      await asUser(client, ADMIN);
      const payload = { request_id: crypto.randomUUID(), notification_id: message.id };

      const first = await call(client, "retry_notification", payload);
      const second = await call(client, "retry_notification", payload);
      expect(second).toEqual(first);

      await client.query("RESET ROLE");
      const audit = await client.query(
        "SELECT count(*)::int AS n FROM app.audit_events WHERE action='retry_notification' AND entity_id=$1",
        [message.id]
      );
      // One deliberate act, one audit record.
      expect(audit.rows[0].n).toBe(1);
    });
  });

  it("shows a scheduler run without its message contents", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      await client.query(
        `SELECT public.pglearn_job('jobs.record', $1::jsonb)`,
        [JSON.stringify({ kind: "reminders", status: "completed", counts: { planned: 3, sent: 2 } })]
      );

      await asUser(client, ADMIN);
      const jobs = await call(client, "list_jobs", { limit: 20 });
      expect(jobs.items.length).toBeGreaterThan(0);
      expect(jobs.items[0].kind).toBe("reminders");
      expect(jobs.items[0].status).toBe("completed");
      // The DTO is shared with notifications, so a job has no recipient.
      expect(jobs.items[0].recipient_email).toBeNull();
    });
  });
});
