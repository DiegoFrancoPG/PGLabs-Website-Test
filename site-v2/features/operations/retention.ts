import { serviceClient } from "@/lib/supabase/server";

/*
 * The nightly retention run.
 *
 * spec/05: "Retention job: purge expired auth links, chats >30 days, raw
 * learning events/idempotency >30 days, rate windows >35 days, non-text tutor
 * usage >180 days. Preserve normalized class_progress, exercises, certificates
 * and training history."
 *
 * Every rule lives in the database (supabase/migrations/…_m28_retention.sql),
 * where the rows are. This is the thin half: it runs the job as service_role
 * and reports counts.
 */

export interface RetentionResult {
  runId: string;
  counts: Record<string, number>;
  /** Everything the run removed, across all rules. */
  removed: number;
}

export async function runRetention(): Promise<RetentionResult> {
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("pglearn_job", {
    job: "retention.run",
    payload: {},
  });
  if (error) throw new Error(`retention failed: ${error.code ?? ""}`);

  const result = data as { run_id: string; counts: Record<string, number | string> };
  const counts: Record<string, number> = {};
  for (const [rule, value] of Object.entries(result.counts ?? {})) counts[rule] = Number(value);

  return {
    runId: result.run_id,
    counts,
    removed: Object.values(counts).reduce((total, value) => total + value, 0),
  };
}
