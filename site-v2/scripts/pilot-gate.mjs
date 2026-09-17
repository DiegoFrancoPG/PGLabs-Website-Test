#!/usr/bin/env node
/*
 * AC-060 — the pilot gate.
 *
 * "Given all pilot tasks implemented and content/manager ready, run the full
 * release checklist before real cohort onboarding. All mandatory scenario
 * evidence present; manager can operate without DB changes; unresolved critical
 * security/progress defect blocks release."
 *
 * The gate is a reconciliation, not an opinion, so it is computed rather than
 * written: this reads tasks.json and tests/acceptance.json and produces
 * tests/evaluation/pilot-gate.md.
 *
 * What it will not do is round up. A scenario with no evidence is not "assumed
 * covered by another test"; a task marked done whose scenarios are not passed
 * is reported as the contradiction it is. The gate's whole value is that it
 * says no when the answer is no.
 *
 *   node scripts/pilot-gate.mjs           # write the report
 *   node scripts/pilot-gate.mjs --check   # exit 1 if the gate is not open
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

const tasks = JSON.parse(readFileSync(path.join(root, "tasks.json"), "utf8"));
const acceptance = JSON.parse(readFileSync(path.join(root, "tests/acceptance.json"), "utf8"));
const taskList = Array.isArray(tasks) ? tasks : tasks.tasks;
const scenarios = Array.isArray(acceptance) ? acceptance : acceptance.scenarios;
const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));

/*
 * Security and progress are the two areas AC-060 names as blocking. A scenario
 * belongs to one of them by what it is about, which is recorded here rather
 * than inferred from wording: this list is short enough to be read and argued
 * with, and a guess would be worse than a judgement somebody can correct.
 */
const CRITICAL = new Set([
  "AC-002", "AC-003", "AC-004", "AC-005", // schema, RLS and the browser roles
  "AC-006", "AC-007", "AC-064", // session verification and cross-context refusal
  "AC-008", "AC-009", // invitation acceptance and recovery
  "AC-023", "AC-024", "AC-025", "AC-026", "AC-027", // playback and progress
  "AC-028", "AC-029", "AC-030", // completion and the certificate transaction
  "AC-031", "AC-032", "AC-033", // exercises
  "AC-034", "AC-035", // certificates and revocation
  "AC-039", "AC-040", "AC-041", // tutor scope and privacy
  "AC-057", // retention must not eat a learner's record
  "AC-059", // "no lost acknowledged updates" is a progress defect if it fails
]);

/*
 * AC-060 is this checklist. It cannot block itself, or the gate could never
 * open; it is passed by running this and by the parts only a person can do.
 */
const SELF = "AC-060";

/*
 * Evidence lives in two places, and both count.
 *
 * The scenarios closed from T13 onward carry their own `evidence` string. The
 * earlier ones were recorded the other way round — the evidence is in the
 * owning task's `evidence` array in tasks.json. That is a difference in where
 * it was written, not in whether it exists, so the gate looks in both rather
 * than declaring twenty scenarios unevidenced because of a change of habit.
 */
function evidenceFor(scenarioId) {
  const scenario = byId.get(scenarioId);
  if ((scenario?.evidence ?? "").trim()) return "scenario";
  for (const task of taskList) {
    if (!(task.acceptance_ids ?? []).includes(scenarioId)) continue;
    if ((task.evidence ?? []).length > 0) return `task ${task.id}`;
  }
  return null;
}

function classify() {
  const rows = [];
  for (const scenario of scenarios) {
    rows.push({
      id: scenario.id,
      title: scenario.title,
      layer: scenario.layer ?? "",
      status: scenario.status ?? "not_run",
      critical: CRITICAL.has(scenario.id),
      evidence: evidenceFor(scenario.id),
    });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

function main() {
  const rows = classify();
  const blocking = [];
  const conditions = [];
  const notes = [];

  for (const row of rows) {
    if (row.status === "passed" && !row.evidence) {
      blocking.push(`${row.id} is marked passed with no evidence`);
    }
    if (row.critical && row.id !== SELF && row.status !== "passed") {
      blocking.push(`${row.id} (${row.title}) is ${row.status} and is critical`);
    }
    if (!row.critical && row.status !== "passed") {
      // A scenario blocked on something the client owes — media, a provider
      // key, a backup plan — is a CONDITION of release, not a defect in it.
      // Conflating the two would either hold the software hostage to a video
      // file or let a real defect hide among them.
      if (row.status === "blocked" && row.id !== SELF) conditions.push(`${row.id} (${row.title})`);
      else notes.push(`${row.id} (${row.title}) — ${row.status}`);
    }
  }

  // A task cannot be done while a scenario it owns is not passed.
  for (const task of taskList) {
    if (task.status !== "done") {
      /*
       * An unfinished task blocks, rather than being noted. AC-060's own
       * premise is "all pilot tasks implemented", so a gate that opened over
       * one that is not would be answering a different question. T30 is the
       * exception: it is this checklist, and it finishes by running it.
       */
      if (task.id === "T30") notes.push(`${task.id} (${task.title}) — ${task.status}`);
      else blocking.push(`${task.id} (${task.title}) is ${task.status}`);
      continue;
    }
    for (const id of task.acceptance_ids ?? []) {
      const scenario = byId.get(id);
      if (!scenario) {
        blocking.push(`${task.id} claims ${id}, which is not in the ledger`);
        continue;
      }
      if (scenario.status === "not_run") {
        blocking.push(`${task.id} is done but ${id} was never run`);
      }
    }
  }

  const counts = rows.reduce((total, row) => {
    total[row.status] = (total[row.status] ?? 0) + 1;
    return total;
  }, {});

  const lines = [];
  lines.push("# Pilot gate");
  lines.push("");
  lines.push(
    "AC-060: *\"All mandatory scenario evidence present; manager can operate without DB changes; unresolved critical security/progress defect blocks release.\"*"
  );
  lines.push("");
  lines.push(
    `Generated by \`scripts/pilot-gate.mjs\` from \`tasks.json\` and \`tests/acceptance.json\` on ${new Date().toISOString().slice(0, 10)}. It is a reconciliation of the ledgers, not a judgement about them: if a number here is wrong, the ledger is wrong.`
  );
  lines.push("");
  lines.push(`## Where the scenarios stand`);
  lines.push("");
  lines.push("| Status | Scenarios |");
  lines.push("| --- | --- |");
  for (const [status, count] of Object.entries(counts).sort()) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push(`| **total** | **${rows.length}** |`);
  lines.push("");

  lines.push("## The gate");
  lines.push("");
  if (blocking.length === 0) {
    lines.push(
      "**OPEN on the software** — no critical scenario is outstanding, every passed scenario carries evidence, and every pilot task is done."
    );
    lines.push("");
    lines.push(
      conditions.length === 0
        ? "There are no outstanding conditions."
        : `Release is still subject to ${conditions.length} condition${conditions.length === 1 ? "" : "s"} below, which are inputs rather than defects. A real cohort is not onboarded until they are settled.`
    );
  } else {
    lines.push("**CLOSED.** Each of these blocks release on its own:");
    lines.push("");
    for (const item of blocking) lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push("## Conditions before a real cohort");
  lines.push("");
  lines.push(
    "These are blocked on inputs the software cannot supply itself. None is a defect; every one of them must be settled before real learners are onboarded, and each scenario's own evidence in `tests/acceptance.json` says exactly what it is waiting for."
  );
  lines.push("");
  if (conditions.length === 0) {
    lines.push("None.");
  } else {
    for (const item of conditions) lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push("## Not blocking, but not done");
  lines.push("");
  if (notes.length === 0) {
    lines.push("Nothing outstanding.");
  } else {
    for (const item of notes) lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push("## Manager operation");
  lines.push("");
  lines.push(
    "`handoff/manager-runbook.md` is the procedure a manager follows, written only from the screens. AC-060's \"manager can operate without DB changes\" is satisfied by that runbook being complete AND by somebody following it end to end on the pilot data — the second half is a person's job, not this script's, and it is recorded in AC-060's own evidence when it has been done."
  );
  lines.push("");

  lines.push("## Every scenario");
  lines.push("");
  lines.push("| ID | Scenario | Layer | Status | Critical | Evidence in |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| ${row.id} | ${row.title} | ${row.layer} | ${row.status} | ${row.critical ? "yes" : ""} | ${row.evidence ?? "—"} |`
    );
  }
  lines.push("");

  const report = `${lines.join("\n")}\n`;
  writeFileSync(path.join(root, "tests/evaluation/pilot-gate.md"), report);
  console.log(`pilot gate: ${blocking.length === 0 ? "OPEN" : "CLOSED"}`);
  for (const item of blocking) console.log(`  blocking: ${item}`);
  console.log(`  ${conditions.length} conditions, ${notes.length} outstanding`);

  if (CHECK && blocking.length > 0) process.exitCode = 1;
}

main();
