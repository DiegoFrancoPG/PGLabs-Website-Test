# PGLearn — implementation specification v1.0

Prepared 15 September 2026. Target: finish a controlled end-to-end demo today, followed by verification before the 40-person client pilot.

This is a portable specification package for implementation by a human, GPT/Codex, or Claude Code. It contains contracts, reference database DDL, decisions, acceptance scenarios and an ordered task ledger. **It does not contain the application.** The supplied validation checks this specification package; it does not demonstrate that the application passes its acceptance tests.

## Start here

1. Put the contents of this folder at the root of the PGLearn application repository. Merge the provided agent instructions with any existing instructions; preserve applicable repository rules.
2. Read [decisions](spec/01-decisions.md), then [data/security](spec/02-data-and-security.md) and [behavior](spec/03-behavior.md).
3. Use [API contracts](contracts/api.json) as OpenAPI 3.1 input and [schema.sql](contracts/schema.sql) as reference migration DDL. Schema creation is only the first migration: authorization functions and behavioral triggers specified in the data document must be implemented before deployment.
4. Use the [task map](TASKS.md) to scan the sequence; follow [tasks.json](tasks.json) in dependency order. All tasks start as `todo`; no application capability is marked complete.
5. Run `python3 verify_spec.py` to check package consistency. During implementation, build the application tests from [acceptance.json](tests/acceptance.json) and [fixtures.json](tests/fixtures.json). Structural request examples are in [api-examples.json](tests/api-examples.json); [schema-smoke.sql](tests/schema-smoke.sql) checks the reference DDL.
6. Record decisions and evidence in [HANDOFF.md](HANDOFF.md) and the task ledger before handing work to another agent.

## Document authority

Explicit user instructions take precedence. Within this package: `spec/01-decisions.md` resolves scope/defaults; `contracts/api.json` owns HTTP shapes; `contracts/schema.sql` owns persisted column types/constraints; the other specification files own business/security/UI behavior; acceptance scenarios own named example outcomes. These describe different parts of one contract, not competing alternatives. If they conflict, resolve and update all affected files before implementing the conflicting behavior.

Earlier product documents provide context. This package supersedes their provisional implementation choices, including illustrative endpoints, completion parameters, reminder handling and date behavior. It preserves confirmed user requirements. Implementers may choose local component/function organization inside the prescribed feature modules; observable behavior and security boundaries require an explicit recorded contract change.

## Contents

- [01 — Decisions, scope and stack](spec/01-decisions.md)
- [02 — Database, permissions and migrations](spec/02-data-and-security.md)
- [03 — Business state transitions and algorithms](spec/03-behavior.md)
- [04 — Screens, fields and UI states](spec/04-ui.md)
- [05 — Integrations, environment and operations](spec/05-integrations-operations.md)
- [06 — Sources and implementation notes](spec/06-sources.md)
- [HTTP contract](contracts/api.json), [database DDL](contracts/schema.sql)
- [Implementation task ledger](tasks.json), [acceptance scenarios](tests/acceptance.json), [fixtures](tests/fixtures.json)
- [Shared agent instructions](AGENTS.md), [Claude entrypoint](CLAUDE.md), [handoff ledger](HANDOFF.md)
- [Environment variable template](.env.example), [package validation evidence](VALIDATION.md)

## Initial implementation prompt

> Implement PGLearn from this repository’s specification. Read AGENTS.md, README.md, spec/01-decisions.md and HANDOFF.md, then select the first unblocked task in tasks.json. Read its referenced contracts and acceptance scenarios. Implement that task, run its meaningful checks, and record evidence before marking it done. Continue to the next unblocked task within the requested scope. Preserve existing work. Use adapters and clearly labeled fixtures when external credentials/content are absent; keep real-integration checks pending. Do not invent product requirements or claim a mocked provider is a working integration.

## Handoff prompt

> Continue PGLearn from HANDOFF.md and tasks.json. Inspect the current diff and reported checks before changing code. Resume the listed task or choose the first unblocked task. Reuse the existing schema, API contracts and dependencies. Resolve documented failures before adding unrelated features. Report exactly what was implemented, verified and remains blocked.

## Review prompt

> Review the implementation against the task’s contract and acceptance IDs. Focus on unauthorized data access, enrollment/grant mismatches, duplicate completion, invalid progress evidence, email retries, tutor grounding and missing UI states. Run relevant tests. Give actionable findings with file/line evidence. Do not mark tasks done from code appearance alone.

The same-day target is a constraint on implementation order and UI polish, not evidence of feasibility or permission to skip required behavior. Demo readiness and pilot readiness have separate gates in the task ledger.
