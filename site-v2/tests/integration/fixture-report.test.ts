import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasDatabase, withClient } from "./db";

/*
 * The fixture's expected_report is the oracle for reporting. These assert the
 * SEEDED DATABASE reproduces it exactly, which is spec/02 M05's required
 * evidence: "Deterministic totals and repeatable fixture seed."
 *
 * The numbers are not incidental. `overdue` proves that completing before the
 * due date does not count as late, and `average_progress` proves the mean is
 * taken over everyone assigned rather than only those who started.
 *
 * Requires a freshly seeded database: npm run db:reset:test.
 */
const fixtures = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures.json"), "utf8")
);
const expected = fixtures.expected_report;
const NOW = fixtures.now;
const OFFERING = fixtures.ids.offering_a;

const REPORT_SQL = `
WITH required AS (
  SELECT e.id AS enrollment_id,
         count(*) FILTER (WHERE c.required) AS req,
         count(*) FILTER (WHERE c.required AND cp.completed_at IS NOT NULL) AS done
  FROM app.enrollments e
  JOIN app.classes c ON c.version_id = e.version_id
  LEFT JOIN app.class_progress cp ON cp.enrollment_id = e.id AND cp.class_id = c.id
  WHERE e.offering_id = $1
  GROUP BY e.id),
rows_ AS (
  SELECT e.*, r.done, r.req, round(r.done::numeric * 100 / r.req, 1) AS pct
  FROM app.enrollments e JOIN required r ON r.enrollment_id = e.id
  WHERE e.offering_id = $1)
SELECT count(*)::int AS assigned,
       count(*) FILTER (WHERE started_at IS NULL)::int AS not_started,
       count(*) FILTER (WHERE started_at IS NOT NULL AND completed_at IS NULL)::int AS in_progress,
       count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed,
       count(*) FILTER (WHERE completed_at IS NULL AND $2::timestamptz > due_at)::int AS overdue,
       round(count(*) FILTER (WHERE completed_at IS NOT NULL)::numeric * 100 / count(*), 1)::float8 AS completion_rate,
       round(avg(pct), 1)::float8 AS average_progress
FROM rows_`;

describe.skipIf(!hasDatabase)("seeded fixtures reproduce expected_report", () => {
  it("matches every total in the fixture", async () => {
    await withClient(async (client) => {
      const r = await client.query(REPORT_SQL, [OFFERING, NOW]);
      expect(r.rows[0]).toEqual({
        assigned: expected.assigned,
        not_started: expected.not_started,
        in_progress: expected.in_progress,
        completed: expected.completed,
        overdue: expected.overdue,
        completion_rate: expected.completion_rate,
        average_progress: expected.average_progress,
      });
    });
  });

  it("matches each learner's progress percentage", async () => {
    await withClient(async (client) => {
      const r = await client.query(
        `SELECT p.display_name, round(
             count(*) FILTER (WHERE c.required AND cp.completed_at IS NOT NULL)::numeric * 100
             / NULLIF(count(*) FILTER (WHERE c.required), 0), 1)::float8 AS pct
         FROM app.enrollments e
         JOIN app.profiles p ON p.id = e.user_id
         JOIN app.classes c ON c.version_id = e.version_id
         LEFT JOIN app.class_progress cp ON cp.enrollment_id = e.id AND cp.class_id = c.id
         WHERE e.offering_id = $1 GROUP BY p.display_name`,
        [OFFERING]
      );
      const actual = Object.fromEntries(
        r.rows.map((row) => [row.display_name.toLowerCase(), row.pct])
      );
      expect(actual).toEqual(expected.row_progress_percent);
    });
  });

  it("does not count a learner who finished before the due date as overdue", async () => {
    await withClient(async (client) => {
      const r = await client.query(
        `SELECT completed_at < due_at AS finished_in_time FROM app.enrollments WHERE id = $1`,
        [fixtures.ids.enroll_cora]
      );
      expect(r.rows[0].finished_in_time).toBe(true);
    });
  });

  it("keeps the personal enrollment out of every organization report", async () => {
    await withClient(async (client) => {
      const r = await client.query(
        "SELECT organization_id, offering_id FROM app.enrollments WHERE id = $1",
        [fixtures.ids.enroll_personal]
      );
      expect(r.rows[0]).toEqual({ organization_id: null, offering_id: null });
    });
  });

  it("keeps organization B's learner out of offering A's report", async () => {
    await withClient(async (client) => {
      const r = await client.query(
        "SELECT count(*)::int AS n FROM app.enrollments WHERE offering_id = $1 AND user_id = $2",
        [OFFERING, fixtures.ids.multi]
      );
      expect(r.rows[0].n).toBe(0);
    });
  });

  it("issues exactly one certificate, to the learner who finished", async () => {
    await withClient(async (client) => {
      const r = await client.query(
        "SELECT c.learner_name, c.enrollment_id FROM app.certificates c"
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].enrollment_id).toBe(fixtures.ids.enroll_cora);
    });
  });
});
