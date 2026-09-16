# PGLearn × site-v2 — status against the plan

As of 15 September 2026, branch `pglearn-integration`, latest commit `ed1b979`.
Compare with [the integration plan](./pglearn-integration-plan.md). Evidence for every claim here is in [HANDOFF.md](../HANDOFF.md).

---

## Where things stand

| | |
|---|---|
| Tasks complete | **8 of 32** — T00, T01, T02, T03, T03B, T04, T05, T06 |
| Demo scope (T01–T25) | **8 of 27** |
| Pilot scope (T26–T30) | 0 of 5 |
| Acceptance scenarios passing | **12 of 67** — AC-001…AC-011, AC-064 |
| Tests | 44 unit, 101 integration, 65 end-to-end |
| Checks green | lint, typecheck, build, `verify_spec.py`, `db:reset:test` |

Every acceptance scenario marked passing was exercised against a **real PostgreSQL 17.6 database and real Supabase Auth**. Nothing is mocked. `tests/acceptance.json` records `passed` only where evidence exists; the other 55 remain `not_run`.

## What exists and works

**The whole security boundary.** Private `app` schema, RLS on all 32 tables, no table privileges for browser roles, and `pglearn_rpc` as the only function in `public` any browser role can execute — verified by querying privileges across the schema, not by reading code. The actor comes from `auth.uid()` alone; a learner asserting `is_admin` in their own JWT still reads as a learner.

**Ten of the 66 API operations**, each with its `/api/v1` route: `get_me`, `update_me`, `get_invitation`, `accept_invitation`, `list_organizations`, `create_organization`, `update_organization`, `update_membership`, `create_invitation`, `resend_invitation`.

**Five migrations**: schema, guard triggers and predicates, the user dispatcher, service entrypoints and private bucket, organizations and idempotency.

**Six platform pages**: `/login`, `/forgot-password`, `/set-password`, `/invitations/[id]`, `/settings`, and `/learn` (a placeholder until T12).

**The marketing site**, unchanged in substance and now with a mobile menu it never had.

## Deviations from the plan, and why

| | Decision | Status |
|---|---|---|
| D-01 | One app, `(marketing)` / `(platform)` route groups | Done. Every path in spec/04 resolves as written. |
| D-02 | PG Labs `design-system-v2` instead of ADR-16's slate/indigo | Done. Eight components added to the design system. |
| D-03 | `/learning` as the public entry point | Done, plus the mobile menu, which you asked for after T04. |

**Three things the plan did not anticipate**, all recorded in `HANDOFF.md`:

1. **Next.js 14 → 16 and React 18 → 19.** The whole Next 14 line was unpatched, including a critical RCE in the Image Optimization API. ADR-01 assigns version resolution to T01, so this was in scope; verified by diffing rendered output — every marketing page identical in visible text and meta tags. `npm audit` reports 0 vulnerabilities.
2. **T03B did not exist.** spec/02's migration sequence lists M05 (fixtures) but no task owned it, which left AC-001 unsatisfiable. Added to the ledger and completed.
3. **Development runs against the PoC Supabase project**, at your direction, which is a recorded deviation from spec/02's "never reset a remote pilot project". The condition still stands: **put nothing of value in `kviqthksrpyyrduoiupg` until T02–T11 is finished**, because `db:reset:test` destroys it repeatedly.

## What is left

| Tasks | What they cover | Blocked on |
|---|---|---|
| **T07** | Cohorts and catalog grants | Nothing — next up |
| **T08–T10** | Content authoring, uploads, publication | **T09 needs the real videos, transcripts and captions** |
| **T11** | Dated offerings and enrollment | Real cohort dates and timezone |
| **T12–T14** | Learner dashboard, playback, exercises | Nothing |
| **T15** | Certificates | **The issuer string — see below** |
| **T16** | Manager and admin reporting | The fixture ambiguity below |
| **T17–T19** | The tutor | `OPENAI_API_KEY` |
| **T20–T22** | Reminders, email, operations | `RESEND_API_KEY` and a verified sender domain |
| **T23–T25** | UI integration and the demo gates | Everything above, plus real assets |
| **T26–T30** | Pilot | The demo gate |

### Inputs needed from you

Nothing blocks T07, or T08 and T12–T14 after it. These block specific later tasks:

1. **The nine videos with transcripts and captions**, and the final class names, exercises and handouts. Blocks T09's upload validation and the T25 demo gate, which cannot be satisfied by fixtures.
2. **`OPENAI_API_KEY`** for the tutor (T18–T19).
3. **`RESEND_API_KEY` and a verified sender domain** for reminders (T21). Real delivery is a demo-gate requirement.
4. **The certificate issuer string.** ADR-11 defaults to "PGLearn", but under D-02 this is a PG Labs product. "PGLearn", "PG Labs", or "PGLearn by PG Labs"? Blocks T15.
5. **Real organization identity, cohort dates and timezone** for T11 and pilot onboarding.

### One open ambiguity in the specification

`fixtures.json` says the `multi` learner has enrollments in "A and B offerings", but organization A's only offering is `offering_a`, and adding them there would make `assigned` 5 and contradict `expected_report`. `expected_report` is authoritative, so `multi` is currently seeded into organization B only and `enroll_multi_a` is unused. **Worth resolving before T16**, which is where those numbers get consumed.

## Honest read on the schedule

The specification targets T01–T25 in a day and says itself that this is "a constraint on implementation order and UI polish, not evidence of feasibility". Eight tasks in, that judgement holds: the remaining demo scope includes an upload and publication pipeline with caption parsing, a playback and progress engine with 90%-coverage rules and session supersession, a tutor with retrieval, citation validation and budget accounting, and an email outbox with 23-hour reconciliation.

Two things are already slowing the loop and are worth naming: the integration suite takes about 60 seconds against a hosted database rather than milliseconds against a local one, and one run failed on a transient disconnect before passing on retry.

**Treat the demo gate as the milestone, not the date.**

## The pattern worth knowing about

Several defects so far were found because a test asserted *the error* rather than *the outcome*, or because a test was made to run twice. Examples, all in `HANDOFF.md`:

- The last-manager trigger fired at COMMIT instead of at the statement. A test checking "the manager is still there" would have passed against the broken version.
- Every e2e POST was returning 403 because Playwright's `page.request` sends no `Origin` header — so the tests expecting 403 were passing for the wrong reason and proving nothing.
- A constraint test ran an `UPDATE` that matched no row, so it passed while proving nothing.
- Hand-written `auth.users` rows existed in the table but were invisible to Supabase Auth.

The suites now guard against each of these classes directly.
