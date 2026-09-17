import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback, withClient, publicEnv } from "./db";

/*
 * T24 — the database's boundaries, checked across every action at once.
 *
 * AC-003, AC-004, AC-021, AC-023, AC-032, AC-039 and AC-065 each passed when
 * they were written. This asks the question they cannot ask individually: with
 * sixty-odd dispatched actions now in place, does the security model still
 * hold for ALL of them?
 *
 * The action list is read from the dispatcher itself, so an action added later
 * is covered here without anybody remembering to add it.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  manager_a: MANAGER_A, manager_b: MANAGER_B,
  amber: AMBER, ben: BEN, dana: DANA,
  org_a: ORG_A, enroll_amber: ENROLL_AMBER, enroll_personal: ENROLL_PERSONAL,
} = fixtures.ids;

async function asUser(client: Client, userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("SET LOCAL ROLE authenticated");
}

/** Every action the dispatcher will accept, read from its own source. */
async function dispatchedActions(client: Client): Promise<string[]> {
  const result = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS body
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'pglearn_rpc'`
  );
  const body = result.rows[0].body as string;
  return [...body.matchAll(/WHEN '([a-z_]+)' THEN/g)].map((match) => match[1]);
}

describe.skipIf(!hasDatabase)("AC-003 and AC-004 — the shape of the security model", () => {
  it("exposes exactly one function to the browser role, and it is the dispatcher", async () => {
    await withClient(async (client) => {
      const reachable = await client.query(
        `SELECT n.nspname || '.' || p.proname AS name
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('app', 'public')
            AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
          ORDER BY 1`
      );
      const names = reachable.rows.map((row) => row.name as string);

      // The one door. Everything else — including every app.* handler — is
      // reached only through it, under SECURITY DEFINER.
      expect(names).toContain("public.pglearn_rpc");
      expect(names).not.toContain("public.pglearn_job");
      expect(names).not.toContain("public.pglearn_provision");
      expect(names.filter((name) => name.startsWith("app."))).toEqual([]);
    });
  });

  it("gives the browser role no table privileges at all", async () => {
    await withClient(async (client) => {
      const granted = await client.query(
        `SELECT table_schema || '.' || table_name AS name, privilege_type
           FROM information_schema.role_table_grants
          WHERE grantee IN ('authenticated', 'anon') AND table_schema = 'app'`
      );
      // ADR-03: no browser-role privileges on the app schema. RLS is the
      // second line; this is the first.
      expect(granted.rows).toEqual([]);
    });
  });

  it("keeps RLS enabled on every app table", async () => {
    await withClient(async (client) => {
      const without = await client.query(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relkind = 'r' AND NOT c.relrowsecurity
          ORDER BY 1`
      );
      expect(without.rows.map((row) => row.relname)).toEqual([]);
    });
  });

  it("refuses every unknown action the same way it refuses a denied one", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      for (const action of ["", "drop_everything", "get_me ", "GET_ME", "list_notifications_"]) {
        await client.query("SAVEPOINT probe");
        let code = "";
        try {
          await client.query("SELECT public.pglearn_rpc($1, '{}'::jsonb)", [action]);
        } catch (err) {
          code = (err as { code?: string }).code ?? "";
        }
        await client.query("ROLLBACK TO SAVEPOINT probe");
        // 42501 for all of them: an unknown action must be indistinguishable
        // from one the caller is not allowed to use.
        expect(code, action).toBe("42501");
      }
    });
  });

  it("refuses every dispatched action to an unauthenticated caller", async () => {
    await inRollback(async (client) => {
      const actions = await dispatchedActions(client);
      expect(actions.length).toBeGreaterThan(50);

      // A browser role with no claims: auth.uid() is null.
      await client.query("SET LOCAL ROLE authenticated");
      const wrong: string[] = [];
      for (const action of actions) {
        await client.query("SAVEPOINT probe");
        let code = "";
        try {
          await client.query("SELECT public.pglearn_rpc($1, '{}'::jsonb)", [action]);
        } catch (err) {
          code = (err as { code?: string }).code ?? "";
        }
        await client.query("ROLLBACK TO SAVEPOINT probe");
        // 28000 is "authentication required". Anything else means the action
        // did something before establishing who was asking.
        if (code !== "28000") wrong.push(`${action} → ${code}`);
      }
      expect(wrong).toEqual([]);
    });
  });

  it("refuses every dispatched action to a suspended account", async () => {
    await inRollback(async (client) => {
      const actions = await dispatchedActions(client);
      await client.query("RESET ROLE");
      await client.query("UPDATE app.profiles SET status='suspended' WHERE id=$1", [AMBER]);
      await asUser(client, AMBER);

      const wrong: string[] = [];
      for (const action of actions) {
        await client.query("SAVEPOINT probe");
        let code = "";
        try {
          await client.query("SELECT public.pglearn_rpc($1, '{}'::jsonb)", [action]);
        } catch (err) {
          code = (err as { code?: string }).code ?? "";
        }
        await client.query("ROLLBACK TO SAVEPOINT probe");
        if (code !== "42501") wrong.push(`${action} → ${code}`);
      }
      // Every one, including the onboarding-exempt ones: suspension is not
      // the same as not having finished signing up.
      expect(wrong).toEqual([]);
    });
  });

  it("allows only the onboarding-exempt actions before an invitation is accepted", async () => {
    await inRollback(async (client) => {
      const actions = await dispatchedActions(client);
      /*
       * Dana has never accepted. spec/02 names the exempt set exactly: "active
       * profile and onboarded profile except the own-account onboarding
       * actions get_me, get_invitation and accept_invitation".
       *
       * update_me is deliberately NOT among them — there is nothing somebody
       * needs to change about their profile before accepting the invitation
       * that creates it.
       */
      const exempt = new Set(["get_me", "get_invitation", "accept_invitation"]);
      await asUser(client, DANA);

      const wrong: string[] = [];
      for (const action of actions) {
        await client.query("SAVEPOINT probe");
        let code = "";
        try {
          await client.query("SELECT public.pglearn_rpc($1, '{}'::jsonb)", [action]);
        } catch (err) {
          code = (err as { code?: string }).code ?? "";
        }
        await client.query("ROLLBACK TO SAVEPOINT probe");

        const refused = code === "42501";
        if (exempt.has(action) && refused) wrong.push(`${action} was refused but is exempt`);
        if (!exempt.has(action) && !refused) wrong.push(`${action} → ${code || "allowed"}`);
      }
      expect(wrong).toEqual([]);
    });
  });
});

describe.skipIf(!hasDatabase)("AC-021 and AC-065 — what each role can never see", () => {
  it("shows a manager no personal enrollment through any action they may call", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);

      const report = (
        await client.query(
          `SELECT public.pglearn_rpc('report_enrollments', '{"limit":100}'::jsonb) AS out`
        )
      ).rows[0].out;
      const ids = report.items.map((row: { enrollment_id: string }) => row.enrollment_id);
      expect(ids).not.toContain(ENROLL_PERSONAL);

      const exported = (
        await client.query(`SELECT public.pglearn_rpc('export_enrollments', '{}'::jsonb) AS out`)
      ).rows[0].out;
      expect(
        exported.items.map((row: { enrollment_id: string }) => row.enrollment_id)
      ).not.toContain(ENROLL_PERSONAL);

      // And nothing in either body names the individual learner.
      const everything = `${JSON.stringify(report)} ${JSON.stringify(exported)}`;
      expect(everything).not.toContain("personal@example.invalid");
    });
  });

  it("keeps two managers' organizations entirely separate", async () => {
    await inRollback(async (client) => {
      for (const [manager, own, foreign] of [
        [MANAGER_A, "Demo Organization A", "Demo Organization B"],
        [MANAGER_B, "Demo Organization B", "Demo Organization A"],
      ] as const) {
        await asUser(client, manager);
        const report = (
          await client.query(
            `SELECT public.pglearn_rpc('report_enrollments', '{"limit":100}'::jsonb) AS out`
          )
        ).rows[0].out;
        const body = JSON.stringify(report);
        expect(body).toContain(own);
        expect(body).not.toContain(foreign);
      }
    });
  });

  it("preserves history when a learner is removed from an organization", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      const before = await client.query(
        "SELECT count(*)::int AS n FROM app.class_progress WHERE enrollment_id=$1",
        [fixtures.ids.enroll_ben]
      );
      await client.query(
        "UPDATE app.memberships SET status='removed' WHERE user_id=$1 AND organization_id=$2",
        [BEN, ORG_A]
      );

      // AC-065: the record survives; only access stops.
      const after = await client.query(
        "SELECT count(*)::int AS n FROM app.class_progress WHERE enrollment_id=$1",
        [fixtures.ids.enroll_ben]
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);

      await asUser(client, MANAGER_A);
      const report = (
        await client.query(
          `SELECT public.pglearn_rpc('report_enrollments', '{"limit":100}'::jsonb) AS out`
        )
      ).rows[0].out;
      // Still reportable: "reporting still covers historical rows whose learner
      // has since been removed from the organization" (M02's comment).
      expect(JSON.stringify(report)).toContain("ben@example.invalid");

      // But Ben can no longer learn.
      await asUser(client, BEN);
      const enrollments = (
        await client.query(`SELECT public.pglearn_rpc('list_my_enrollments', '{}'::jsonb) AS out`)
      ).rows[0].out;
      const ben = enrollments.items.find(
        (row: { id: string }) => row.id === fixtures.ids.enroll_ben
      );
      expect(ben.availability).toBe("membership_inactive");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-023, AC-032 and AC-039 — revocation stops everything at once", () => {
  it("closes every learning path the moment a grant is revoked", async () => {
    await inRollback(async (client) => {
      await asUser(client, AMBER);
      // Everything works first, so the test is about the change rather than
      // about a learner who never had access.
      const before = (
        await client.query(
          `SELECT public.pglearn_rpc('get_learning_class', $1::jsonb) AS out`,
          [JSON.stringify({ enrollment_id: ENROLL_AMBER, class_id: fixtures.ids.class_video })]
        )
      ).rows[0].out;
      expect(before.class.id).toBe(fixtures.ids.class_video);

      await client.query("RESET ROLE");
      await client.query("UPDATE app.program_grants SET status='revoked' WHERE id=$1", [
        fixtures.ids.grant_a,
      ]);
      await asUser(client, AMBER);

      // Every door, one after another: reading the class, playing it,
      // recording progress, completing text, saving an exercise, downloading
      // an asset, asking the tutor.
      const attempts: [string, object][] = [
        ["get_learning_class", { enrollment_id: ENROLL_AMBER, class_id: fixtures.ids.class_video }],
        ["start_playback", { enrollment_id: ENROLL_AMBER, class_id: fixtures.ids.class_video }],
        ["complete_text", {
          enrollment_id: ENROLL_AMBER, class_id: fixtures.ids.class_text,
          event_id: crypto.randomUUID(),
        }],
        ["complete_exercise", {
          request_id: crypto.randomUUID(), enrollment_id: ENROLL_AMBER,
          exercise_id: fixtures.ids.exercise_audio, response: "Trying anyway.", confirmed: true,
        }],
        ["authorize_download", {
          asset_id: fixtures.ids.source_video, enrollment_id: ENROLL_AMBER, preview: false,
        }],
        ["ask_tutor", {
          request_id: crypto.randomUUID(), enrollment_id: ENROLL_AMBER,
          class_id: fixtures.ids.class_video, session_id: null,
          question: "Can I still ask?", intent: "explanation",
        }],
      ];

      const allowed: string[] = [];
      for (const [action, payload] of attempts) {
        await client.query("SAVEPOINT probe");
        let code = "";
        try {
          await client.query("SELECT public.pglearn_rpc($1, $2::jsonb)", [
            action,
            JSON.stringify(payload),
          ]);
        } catch (err) {
          code = (err as { code?: string }).code ?? "";
        }
        await client.query("ROLLBACK TO SAVEPOINT probe");
        // PGL22 (access unavailable) or P0002 (not found) — never success.
        if (code === "") allowed.push(action);
      }
      expect(allowed, "actions that still worked after the grant was revoked").toEqual([]);

      // What was already recorded is untouched: revocation stops new work, it
      // does not erase old work.
      await client.query("RESET ROLE");
      const progress = await client.query(
        "SELECT count(*)::int AS n FROM app.class_progress WHERE enrollment_id=$1",
        [fixtures.ids.enroll_cora]
      );
      expect(progress.rows[0].n).toBeGreaterThan(0);
    });
  });

  it("never lets one learner's identity substitute for another's", async () => {
    await inRollback(async (client) => {
      // Ben, asking about everything of Amber's by id.
      await asUser(client, BEN);
      const attempts: [string, object][] = [
        ["get_enrollment", { enrollment_id: ENROLL_AMBER }],
        ["get_learning_class", { enrollment_id: ENROLL_AMBER, class_id: fixtures.ids.class_video }],
        ["start_playback", { enrollment_id: ENROLL_AMBER, class_id: fixtures.ids.class_video }],
        ["get_exercise_completion", {
          enrollment_id: ENROLL_AMBER, exercise_id: fixtures.ids.exercise_audio,
        }],
        ["get_certificate", { certificate_id: fixtures.ids.certificate_cora }],
        ["ask_tutor", {
          request_id: crypto.randomUUID(), enrollment_id: ENROLL_AMBER,
          class_id: fixtures.ids.class_video, session_id: null,
          question: "Whose is this?", intent: "explanation",
        }],
      ];

      const allowed: string[] = [];
      for (const [action, payload] of attempts) {
        await client.query("SAVEPOINT probe");
        let code = "";
        try {
          await client.query("SELECT public.pglearn_rpc($1, $2::jsonb)", [
            action,
            JSON.stringify(payload),
          ]);
        } catch (err) {
          code = (err as { code?: string }).code ?? "";
        }
        await client.query("ROLLBACK TO SAVEPOINT probe");
        if (code === "") allowed.push(action);
      }
      expect(allowed, "actions that answered about another learner's record").toEqual([]);
    });
  });

  it("derives the actor from auth.uid() and not from anything in the payload", async () => {
    await inRollback(async (client) => {
      await asUser(client, BEN);
      // Every shape of "please be somebody else" the payload could carry.
      for (const payload of [
        { user_id: AMBER },
        { actor: AMBER },
        { actor_id: AMBER },
        { sub: AMBER },
      ]) {
        const me = (
          await client.query(`SELECT public.pglearn_rpc('get_me', $1::jsonb) AS out`, [
            JSON.stringify(payload),
          ])
        ).rows[0].out;
        // Always Ben, whatever was asked for.
        expect(me.profile.email).toBe("ben@example.invalid");
      }
    });
  });
});

describe.skipIf(!hasDatabase)("the service role is not a browser role", () => {
  it("publishes no service key to anything the browser receives", async () => {
    // The key exists for the server's own use; what matters is that it is not
    // in what a browser is given. The bundle is checked in
    // tests/e2e/cross-context.spec.ts; this checks the environment contract.
    expect(publicEnv.serviceRoleKey.length).toBeGreaterThan(0);
    expect(publicEnv.publishableKey).not.toBe(publicEnv.serviceRoleKey);
    // A publishable key is safe to ship; a service key never is.
    expect(publicEnv.publishableKey.startsWith("sb_publishable_")).toBe(true);
  });
});
