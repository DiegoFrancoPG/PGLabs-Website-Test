# PGLearn handoff

## Current state

- Specification version: 1.0, 15 September 2026.
- Application implementation: T00–T26 done (including T03B). T27–T30 todo.
- Active task: none. Start T27.
- Last completed application task: T26.
- **Demo gate:** rehearsed and recorded in `tests/evaluation/demo-gate.md`. The journey works end to end; the tutor's answers and all outbound email are stubbed or queued for want of credentials.
- Acceptance scenarios passing: 55 of 67; AC-042 and AC-053 blocked with their automated halves recorded.
- **AC-017 remains partial, blocked on real media.**
- **AC-042 is blocked** on `OPENAI_API_KEY`; four of its five claims are tested and recorded in `tests/evaluation/tutor-synthetic-course.md`.
- **Real outbound email is blocked** on `RESEND_API_KEY`, `EMAIL_FROM` and a verified sender. Everything around it — scheduling, claiming, retrying, webhook verification and reconciliation — is implemented and tested against the database and the real routes.
- Specification validation: `python3 verify_spec.py` PASS — 66 operations, 70 schemas, 32 acyclic tasks. This validates the package, not the application.
- Inputs outstanding: the nine videos with transcripts and captions, OpenAI and Resend credentials with a verified sender, `CRON_SECRET` for the deployment, and the certificate issuer string if it should differ from the default "PGLearn". A development database is configured.

## Host application

PGLearn is being built inside the existing PG Labs marketing site (`site-v2`) rather than a new repository. The adaptation is described in `site-v2/plans/pglearn-integration-plan.md`, approved 15 September 2026.

## Contract and default changes, with reason

**D-01 — repository layout (adapts ADR-01 and the spec/01 repository map).**
One Next.js application serves both the marketing site and PGLearn. Next forbids `app/` and `src/app/` in the same project and site-v2 already uses root `app/`, so the spec's `src/app/` is root `app/`, split into `app/(marketing)/` and `app/(platform)/`. Feature modules will go in root `features/` and `lib/` alongside the existing `components/`. Reason: one product surface, one domain, one Vercel deployment.

Route-group names in parentheses do not appear in URLs, so **every path in spec/04-ui.md resolves exactly as specified** — `/login`, `/learn/[enrollmentId]/classes/[classId]`, `/manage/[orgId]/reports`, `/admin/operations`.

**D-02 — design system (overrides ADR-16's "neutral slate with indigo actions and PGLearn text branding").**
Learner, manager and admin screens use the PG Labs `design-system-v2` tokens and components (ink/steel/brand-azure, Lora + Nunito Sans). Reason: PGLearn is a PG Labs product surface, not a separate brand, and it sits on the PG Labs domain.

Accessibility constraint carried from the token definitions: `brand-500` (#59C4ED) is only 2:1 on white and must never carry small type. Platform text on light grounds uses `brand-600`/`brand-700`; `azure-500` is the button fill with an `ink-800` label.

**No security, data or API contract changes.** spec/02 (private `app` schema, RLS, the three `pglearn_*` entrypoints, the authorization predicates, the disclosure matrix), spec/03, spec/05 and `contracts/` are adopted verbatim.

## T00 — Prepare site-v2 as the PGLearn application shell

- **Task ID and status:** T00, done.
- **Implementer / branch / commit:** Claude Code / `pglearn-integration` / baseline `76d4cca`.
- **Files changed:** `site-v2/app/layout.tsx` (reduced to document shell), new `site-v2/app/(marketing)/layout.tsx` and `site-v2/app/(platform)/layout.tsx`, 6 marketing pages moved into `(marketing)/`, new `site-v2/app/not-found.tsx`, `site-v2/next.config.mjs`, `site-v2/lib/utils.ts`, 8 new `design-system-v2/src/components/ui/*` components plus barrel, 24 design-system components switched to relative imports, `.gitignore`, two `package-lock.json`.
- **Acceptance IDs exercised:** none. T00 predates the specification's acceptance scenarios.
- **Commands and results:**
  - `npm run build` (site-v2): PASS. 7 marketing routes prerendered static.
  - `npx tsc -p tsconfig.json --noEmit` (design-system-v2): PASS.
  - `python3 verify_spec.py`: PASS.
  - Rendered-HTML parity diff against baseline `76d4cca`: the 6 marketing pages are identical in every DOM node and meta tag, except the JSON-LD block, whose 501-byte payload is byte-identical but now renders in `<body>` rather than `<head>` (supported by Google and idiomatic for Next App Router).
  - Generated CSS delta against baseline: one added rule, `.min-h-screen`, from the new platform shell.
- **Real integrations exercised:** none. T00 touches no provider.
- **Unresolved failures / blocked checks:** none.
- **Next unblocked task:** T01.

### Decisions T00 deferred to T01 — all resolved

1. Next.js upgraded 14.2.35 → 16.3.5, React 18 → 19. See T01 below.
2. `clsx`, `tailwind-merge` and `class-variance-authority` removed from site-v2's direct dependencies; they resolve from the design system, which is the only thing that imports them.
3. The tutor drawer is still not built. It is a composition of `Dialog` and belongs to T19.

### Problems found and fixed in the baseline

- `site-v2/node_modules` and `design-system-v2/node_modules` were both **symlinks** into the v1 `site`/`design-system` trees, and neither package had a lockfile. ADR-01 requires an exact committed `package-lock.json`. Both now have real installs and committed lockfiles.
- `next.config.mjs` declared `transpilePackages: ["../design-system"]` — the v1 design system, while `tsconfig.json` aliases resolve to v2. Removed; the build does not need it.
- Every `design-system-v2` component imported `@/lib/utils`, an alias that resolved against the **consumer's** tsconfig. The design system was silently using site-v2's `cn`. Component sources now use relative imports; stories keep the alias, which Storybook's vite config resolves.
- `site-v2/lib/utils.ts` was a byte-identical copy of the design system's. It is now a re-export. The duplicate had put two `tailwind-merge` instances in the bundle (~8 kB on `/work`).
- The Figma `html-to-design` capture script loaded on every page from the root layout. It is now in the marketing layout and development-only, so it can never load on an authenticated route — spec/05 permits only app, storage and provider origins there.
- `.gitignore` did not cover `.next/`, `*.tsbuildinfo` or `design-system-v2/.vite-storybook-cache/`, and its `node_modules/` pattern did not match the symlinks.
- The 404 page lost its chrome when the root layout was emptied, so `app/not-found.tsx` now renders the masthead and footer explicitly. The baseline 404 had also emitted contradictory robots meta tags (`noindex` and `index, follow`); it is now `noindex` only.

### Input still needed

ADR-11 defaults the certificate issuer to "PGLearn", but under D-02 PGLearn is a PG Labs product. Confirm the issuer string — "PGLearn", "PG Labs", or "PGLearn by PG Labs" — before T15.

## T01 — Bootstrap repository and shared contracts

- **Task ID and status:** T01, done. AC-001 partially exercised — see below.
- **Implementer / branch / commit:** Claude Code / `pglearn-integration`.
- **Files changed:** `lib/clock.ts`, `lib/http.ts`, `lib/env.ts`, `instrumentation.ts`, `app/api/v1/health/route.ts`, `next.config.mjs`, `package.json`, `eslint.config.mjs`, `vitest.config.mts`, `playwright.config.ts`, `scripts/db-reset-test.mjs`, `tests/unit/{clock,http,env}.test.ts`, `tests/integration/health-contract.test.ts`, `tests/e2e/{health,marketing}.spec.ts`, both lockfiles.
- **Acceptance IDs exercised:** AC-001, **partially** — see the limitation below.
- **Commands and results:** all seven required scripts pass.

  | Script | Result |
  |---|---|
  | `npm run lint` | PASS |
  | `npm run typecheck` | PASS |
  | `npm run test:unit` | PASS — 22 tests |
  | `npm run test:integration` | PASS — 5 tests |
  | `npm run test:e2e` | PASS — 12 tests across 390px and 1440px |
  | `npm run build` | PASS — marketing routes still prerendered static |
  | `npm run db:reset:test` | Guards verified; reset itself blocked until T02 |
  | `python3 verify_spec.py` | PASS |

- **Real integrations exercised:** none, and none are reachable yet. No database, email or model call exists in this task. AC-001 explicitly requires the bootstrap to be verifiable "without calling external providers", and it is.
- **Unresolved failures / blocked checks:** AC-001's second clause, "reset creates schema and deterministic fixtures", cannot pass until the M01 migration lands at T02 and fixtures at M05. The `db:reset:test` script exists, refuses unsafe targets, and explains what is missing. `tests/acceptance.json` still records AC-001 as `not_run`, because the full scenario has not passed.
- **Contract or default changes, with reason:** dependency versions only, under ADR-01's instruction to resolve currently supported patched versions. No API, schema or security change.
- **Next unblocked task:** T02.

### Dependency resolution (ADR-01)

`next@14.2.35` was the newest 14.x, but the entire Next 14 line was covered by current advisories — cache poisoning, SSRF, several DoS paths, and a **critical unauthenticated RCE in the Image Optimization API**, which matters because the marketing site uses `next/image` throughout. The remediation is `next@16.3.5`, which requires React 19.

Upgraded, since ADR-01 says to resolve patched versions and not to assume the specification's date freezes them, and the application has no users yet.

Verified by rebuilding the T00 commit and comparing rendered output: **all seven marketing pages are identical in every visible word and every meta tag** across the upgrade. `npm audit` reports 0 vulnerabilities.

Two things the upgrade required:
- Next 16 builds with Turbopack, which only resolves modules inside its root. The design system is a sibling directory reached through the `@ds` path alias, so `turbopack.root` is lifted one level.
- `@types/node` was pinned to `^20` while ADR-01 requires the Node 22 runtime. Aligned to `^22`.

### What T01 established

- **`lib/clock.ts`** — the injected `Clock` from spec/05. Nothing reads a header, query parameter or body, so a caller cannot move the clock.
- **`lib/http.ts`** — the `{data, request_id}` / `{error:{code,message,fields}, request_id}` envelopes, the full spec/05 error-code to HTTP-status map, and `Retry-After` on temporary rate limits. `fields` is always emitted, because the contract marks it required.
- **`lib/env.ts`** — Zod validation with a deliberate two-way split: core configuration fails loudly, optional integration keys report `NOT_CONFIGURED`. There is no third path, so a missing secret can never select a mock. Validation errors name variables, never values.
- **`instrumentation.ts`** — runs that check at server startup.
- **`/api/v1/health`** — status and version only, per spec/05. It does not probe the database or any provider.
- **`tests/integration/health-contract.test.ts`** — validates the route's real response against `contracts/api.json` rather than a copied shape, so a contract edit the handler ignores fails here. Includes negative cases proving the validator catches drift.

### Notes for T02

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are in `.env.example` but not yet in `lib/env.ts`'s core schema. Promote them as the features that use them land — Auth at T04, jobs at T21 — so the schema always describes what the app actually requires.
- `scripts/db-reset-test.mjs` expects `supabase/config.toml`. T02 should `supabase init`, add the M01 migration, and add the Supabase CLI as a dev dependency so the script runs from a clean checkout.

## D-03 — public entry point into PGLearn

Not a specification task; the third decision in the integration plan. Added while T02 was blocked on a database, because it needs none.

- `/learning` — public overview of PGLearn, linked from the masthead and footer.
- **Every claim traces to spec/01's confirmed product requirements.** spec/01 says "Do not invent product requirements", so the page carries no pricing (payments are deferred), no outcome or mastery claim, and no accreditation language (ADR-11: "no accreditation claim").
- **No sign-up call to action**, because ADR-05 disables public sign-up. Both calls to action lead to `/contact`. The Sign in link joins the masthead at T05, when `/login` exists — linking to it now would ship a 404.
- Four Playwright tests hold that boundary, including negative assertions that the page never says "sign up", "free trial", "accredit" or "mastery".
- `SectionHeading` always renders `h2`, so the hero `h1` is written by hand, as every other marketing page does. The page had no `h1` until an e2e test caught it.

**The copy is mine and needs your review.** It is accurate against the specification, but it is marketing copy for your platform and someone at PG Labs should own the wording.

## Remote development database — deliberate deviation from spec/02

spec/02 says development migrations "can reset only the explicitly designated local/test database" and to "never reset a remote pilot project as a verification shortcut."

Development runs against the **hosted** Supabase project `kviqthksrpyyrduoiupg`, which the user has stated is also the intended proof-of-concept project. The risk was raised explicitly — repeated resets destroy everything in it — and the user chose this deliberately over a separate development project.

**The condition this rests on:** nothing of value goes into that project until T02–T11 is finished. If content, test organizations or real accounts are added before then, a reset will destroy them without warning.

`scripts/db-reset-test.mjs` permits a remote target only when it is named by ref in `PGLEARN_DEV_PROJECT_REF` and that ref matches the configured project — spec/02's "explicitly designated" database. It still refuses `APP_ENV=pilot` and `production`, refuses any other host, and refuses a mismatch between the designated ref and the configured one rather than guessing. `--yes` suppresses the CLI's own prompt, which an npm script cannot answer; the two opt-ins above are the protection instead.

Costs that have already materialised: the integration suite takes ~56s against a remote database versus milliseconds locally, and one run failed on a transient disconnect before passing on retry.

## T02 — Schema migration and constraint tests

- **Task ID and status:** T02, done.
- **Acceptance IDs exercised:** AC-002 and AC-003, both fully.
- **Files changed:** `supabase/migrations/20260915000001_m01_schema.sql`, `supabase/config.toml`, `tests/integration/db.ts`, `tests/integration/database-constraints.test.ts`, `tests/unit/migration-fidelity.test.ts`, `scripts/db-reset-test.mjs`, `.env.example` untouched.
- **Commands and results:**
  - `supabase db push` — 32 tables in schema `app`, 69 indexes, 183 constraints.
  - `tests/schema-smoke.sql` — 32/32 under `ON_ERROR_STOP=1`, then `ROLLBACK`.
  - `npm run test:integration` — 35 tests passing.
  - `npm run db:reset:test` — verified end to end against the remote project; dropped, reapplied M01, smoke suite passes again afterwards.
- **Real integrations exercised:** yes — a real Supabase PostgreSQL 17.6 instance and the live Data API. No mocks.
- **Unresolved failures / blocked checks:** none for T02. See the M05 gap below.
- **Next unblocked task:** T03.

### AC-003 went further than the smoke test

`tests/schema-smoke.sql` checks `has_table_privilege`, which is privilege metadata. AC-003 says "including through Data API", so that was verified against the live REST endpoint as well: `app.enrollments` and `app.profiles` are unreachable with the publishable key **and** with the service role key, because schema `app` is not in the Data API's exposed schemas. That is the defense in depth spec/02 describes, confirmed rather than assumed.

### A test that passed for the wrong reason

The `class_progress` completion case initially passed while proving nothing: its `UPDATE` matched no row, because the fixture graph had no progress row yet. The suite now carries a guard that asserts every `UPDATE` case actually matches a row, so a vacuous pass fails.

### Ledger gap: migration M05 is unowned — CLOSED by T03B

spec/02's migration sequence lists **M05 — test/demo fixtures via explicit seed command**, with "deterministic totals and repeatable fixture seed" as its evidence. No task in `tasks.json` lists it as an implementation target. `tests/fixtures.json` exists with the expected report totals, and `supabase/seed.sql` does not.

Consequence at the time: AC-001 could not pass. Resolved by adding **T03B** to the ledger — see below. AC-001 now passes.

## T03 — Relationship guards and permission boundary

- **Task ID and status:** T03, done.
- **Acceptance IDs exercised:** AC-004 and AC-005, both fully, against a real database as the real browser roles.
- **Files changed:** `supabase/migrations/20260915000002_m02_guards.sql`, `..._m03_rpc.sql`, `..._m04_service.sql`, `tests/integration/database-security.test.ts`, `tests/integration/database-constraints.test.ts` (fixture restructured).
- **Commands and results:** `npm run db:reset:test` applies M01–M04 cleanly; 27 unit and 55 integration tests passing; lint, typecheck, build and `verify_spec.py` all pass.
- **Real integrations exercised:** yes — every security test runs as `anon` or `authenticated` with a `request.jwt.claims` subject, which is how Supabase presents a session to Postgres. spec/02 asks for exactly this: "Tests must call RPC directly using user JWTs as well as through application routes."
- **Next unblocked task:** T04.

### What the boundary now guarantees

- `pglearn_rpc` is the **only** function in `public` that any browser role can execute. Verified by querying `has_function_privilege` across the whole schema rather than by inspection.
- The actor comes from `auth.uid()` alone. Payloads carrying `user_id`, `actor_id`, `sub`, `role` or `is_admin` are ignored — all five shapes are tested.
- An unknown action, an injection-shaped action and a wrong-case action all return the same `42501` as an unauthorized one, so the dispatcher cannot be used to enumerate which operations exist.
- All three entrypoints are `SECURITY DEFINER` with `search_path=""` exactly, asserted rather than assumed.
- The internal `app.*` predicates and handlers are unreachable from a browser role.

### Deliberate strengthening beyond spec/02's wording

spec/02 says "any UPDATE/DELETE of published version content … is rejected". **INSERT is blocked too** for modules, classes, exercises and assets, because ADR-07 makes published versions immutable and adding a class to one would mutate it.

`content_chunks` is the deliberate exception and keeps INSERT allowed: spec/05 creates chunks *during* the publication transaction, so blocking them would make publication impossible. The precision of spec/02's wording appears to be exactly this reason.

### tests/schema-smoke.sql no longer applies after M02

Its own header scopes it: "These checks cover reference DDL only, not missing RPC/triggers/application behavior." Its fixture builds an offering on a **draft** version, which M02 now correctly rejects, so it fails from M02 onward by design.

It passed 32/32 against M01 at T02 and that evidence stands. The living replacement is `tests/integration/database-constraints.test.ts`, whose fixture now publishes a version before creating offerings and keeps a second draft version for the content rules. **Do not "fix" the smoke test** — it is a vendored M01 artifact.

### Handler allowlist is intentionally almost empty

`pglearn_rpc` dispatches `get_me` and nothing else. The allowlist is deny-by-default, so each later task adds only the actions it implements. That is why an unimplemented operation and a nonexistent one are indistinguishable from outside, which is the desired property.

## T03B — Deterministic test fixtures (migration M05)

Added to the ledger because spec/02's migration sequence lists M05 but no task in specification v1.0 owned it, which left AC-001 unsatisfiable. Scope split at the user's direction: the data half now, Auth passwords at T05.

- **Acceptance IDs exercised:** AC-001, now fully.
- **Files:** `scripts/generate-seed.mjs`, generated `supabase/seed.sql`, `tests/unit/seed-fidelity.test.ts`, `tests/integration/fixture-report.test.ts`.

**The seed is generated from `tests/fixtures.json`**, not hand-written, so it cannot drift from the fixture contract — the same guard M01 has against `contracts/schema.sql`. `seed-fidelity.test.ts` fails if the checked-in file is stale.

**It reproduces `expected_report` exactly**: assigned 4, not_started 2, in_progress 1, completed 1, overdue 3, completion_rate 25.0, average_progress 41.7, and all four per-learner percentages. Those numbers are the oracle T16 will be measured against, and they are not incidental — `overdue 3` proves that finishing before the due date is not late, and `average_progress 41.7` proves the mean is taken over everyone assigned rather than only those who started.

**Repeatable**, as spec/02 M05 requires: two consecutive resets both yield 6 enrollments, 5 progress rows, 1 certificate, 9 profiles.

**No passwords and no routable recipients.** Every address is `@example.invalid`, a reserved TLD that cannot receive mail, asserted by test rather than by convention.

### Two things the seed changed about existing tests

Introducing committed fixture data broke 30 integration tests that had quietly assumed an empty database. Both causes were real test defects, not seed problems:

1. They reused the fixture's own UUIDs and email addresses, so their inserts collided with committed rows. They now use a `f0000000-` namespace and `probe-` addresses that cannot collide.
2. Some assertions counted rows **globally** (`SELECT count(*) FROM app.cohort_offerings`). They now scope to their own data. An unscoped count would have silently started passing or failing for the wrong reason as the seed grew.

### Known limitations, deliberately not hidden

- **The seeded version is published by direct write**, so it does not exercise T10's publication validation, and its classes carry no media assets. `fixtures.json` says so itself: "real media checks require actual assets." T10 must build its own publication test rather than relying on this fixture.
- **`enroll_multi_a` is seeded nowhere.** `fixtures.json` says the `multi` learner has enrollments in "A and B offerings", but the only organization A offering is `offering_a`, and adding `multi` there would make `assigned` 5 and break `expected_report`. The fixture is ambiguous; `expected_report` is authoritative, so `multi` is seeded into organization B only. Worth resolving before T16.
- `tests/acceptance.json` now records `passed` for the five scenarios that have evidence. Specification v1.0 shipped every scenario as `not_run` and used no other value; this is the field's intended use, recorded here as a deliberate change.

## T04 — Verified session and profile services

- **Status:** done. AC-006, AC-007 and AC-064 all pass.
- **Checks:** 44 unit, 74 integration, 42 e2e; lint, typecheck, build, `verify_spec.py`.

### What it establishes

- `lib/auth.ts` verifies sessions with `getUser()`, never `getSession()`. ADR-05 requires server-side verification; `getSession()` only decodes a cookie the client can edit, so nothing may use it to decide authority.
- `lib/supabase/server.ts` exposes two clients with deliberately different authority: the user-scoped one, whose queries run as the signed-in user so `auth.uid()` is correct inside the RPC, and the service one, which takes no cookies at all because nothing it does may be driven by a browser-supplied identity.
- `proxy.ts` refreshes the session and enforces the Origin rule, matched only on platform paths so the marketing site stays statically served.
- `scripts/bootstrap-admin.mjs`, per spec/05: a script, not a route, so there is no HTTP path to becoming an admin. It creates no account and sets no password, refuses an account that has not completed password setup, and prints only the user id.

### Three findings worth keeping

1. **`get_me` did not match the contract.** M03 returned a convenience shape; `contracts/api.json` defines `Me` as `{profile, platform_admin, contexts}`. Corrected, and M03 was amended in place rather than superseded — spec/02 permits that until real records exist, and none do.
2. **AC-064's evidence is the difference between two status codes.** A foreign-Origin PATCH returns 403 while the identical same-origin request returns 401. That ordering is the actual security property: a valid session cookie replayed from another site is refused before the handler runs, so there is no state change to undo.
3. **A learner cannot promote themselves by lying in their own JWT.** A session whose claims assert `is_admin` and `user_role=platform_admin` still reads `platform_admin: false`, because the flag is read from `app.platform_admins`, never from a claim.

### Pre-existing gap: no mobile navigation — RESOLVED

The masthead nav was `hidden md:flex` with no mobile menu anywhere in the site, so at 390px every section was unreachable from the header; only the footer carried them. That predates PGLearn but blocked spec/04's 390px requirement for the way into the platform.

Fixed after T04 at the user's direction. `components/layout/Navbar.tsx` now collapses the links behind a disclosure below `md`:

- A **disclosure, not a modal dialog**. The panel is short and does not trap the page, so it needs no focus trap and no scroll lock to be correct — less machinery to get wrong.
- `aria-expanded` and `aria-controls` on the button, an accessible name that changes with state, a 44px touch target, Escape to close with focus returned to the button, and full keyboard operation.
- The panel lives **inside** `<nav>`, because it is navigation. It was briefly a sibling, which is what the first test run caught.
- The call to action moves into the panel below `md`: at 390px it cannot sit beside the logo, which is why the header was already cramped.
- Closing happens on the link's click, not in a `useEffect` watching `pathname` — React 19's lint rightly rejects setting state in an effect for this, since it cascades renders.

Eight e2e tests cover it at 390px, including keyboard-only operation, focus return and a check that the page does not overflow horizontally. Desktop rendering is unchanged: same links, same CTA, same classes.

### Notes for T05 — addressed

Both items were completed by T05: the three pages exist, and fixture accounts have passwords.

## T05 — Invitation onboarding and password recovery

- **Status:** done. AC-008 and AC-009 pass.
- **Checks:** 44 unit, 85 integration, 56 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### Auth owns auth.users — a correction worth reading before touching the seed

M05 originally wrote `auth.users` rows directly. They existed in the table but were **invisible to the Auth admin API**, so no fixture account could be given a password. Reproducing GoTrue's expectations by hand meant `instance_id`, `aud`, `role`, and several token columns it scans into non-nullable strings — get any wrong and the account is unusable in a way that only shows up later.

Fixture Auth accounts are now created through the Auth admin API, which accepts the fixture's deterministic ids. `supabase/seed.sql` no longer touches `auth.users` at all, which is what spec/02 means by leaving the Auth schema untouched.

`npm run db:reset:test` is therefore three phases, in this order: migrations (`--no-seed`), Auth accounts, then application fixtures. The ordering is forced — `app.profiles` has a foreign key to `auth.users`.

**Do not add `INSERT INTO auth.users` back to the seed.**

### AC-009 is verified against real Auth, not a mock

The invite link is generated by the Auth admin API and redeemed with its one-time token, which is what following the emailed link does. That covers the whole journey — no password, cannot sign in, session from the token, refused while un-onboarded, password set *before* onboarding, acceptance granting access — without needing mail delivery, which remains T21's gate.

The existing-account half runs through the real interface: signs in with the password it already has, never visits `/set-password`, accepts, and the same password still works afterwards.

### Test isolation: one database, so files run serially

`fileParallelism: false` for integration. Vitest parallelises files by default, and there is **one** development database — a suite creating and deleting accounts interfered with one reading shared state, which showed up as tests failing in different combinations on each run.

Two related defects were fixed at the same time, both mine:

1. **Assertions that counted rows globally** (`SELECT count(*) FROM app.profiles`). They now scope to rows the test owns. An unscoped count reads whatever anything else happened to be doing.
2. **Tests that assumed the seeded state instead of establishing it.** The onboarding suite assumed Dana starts un-onboarded; suites that commit had already onboarded her. Each test now sets up what it needs inside its own rolled-back transaction, and the one suite that commits restores what it changed.

### Password recovery reveals nothing

`/forgot-password` returns identical wording for a known and an unknown address — including when the provider itself errors, which is logged rather than surfaced. An error shown only for real addresses would be exactly the account-existence oracle spec/03 forbids. The e2e test compares the two rendered responses rather than trusting the implementation.

### Still outstanding

- Creating invitations is T06; T05 implements acceptance. Tests create pending invitations directly.
- `delivery_status` reads from the outbox and reports `pending` until T21 sends anything.

## T06 — Organization and invitation administration

- **Status:** done. AC-010 and AC-011 pass.
- **Checks:** 44 unit, 101 integration, 65 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.
- All six operations ship with `/api/v1` routes and feature services. **Admin organization forms are not built** — the API and services are, and UI integration is T23.

### Idempotency is a shared mechanism, and authorization runs first

`app.idempotency_records` now backs every mutating handler that takes a `request_id`. spec/05 is explicit that "cached success is not an access bypass", so each handler **authorizes before consulting the replay cache**. A caller who has since lost permission gets refused even when replaying a key that once worked.

The canonical hash sorts keys and excludes `request_id`, so the same intent hashes identically regardless of key order; a different body under the same key is a conflict rather than a silent replay.

### The last-manager trigger was firing too late

M02 declared it `DEFERRABLE INITIALLY DEFERRED`, so it only raised at COMMIT — the handler returned success and the failure surfaced afterwards, detached from the statement that caused it. It is now `INITIALLY IMMEDIATE`, so a refused change fails on its own statement with a precise error. Still `DEFERRABLE`, so a caller who genuinely needs to remove before adding can `SET CONSTRAINTS ALL DEFERRED`; adding first and removing second needs nothing special.

**This was only visible because a test asserted the error, not the outcome.** A test checking "the manager is still there" would have passed against the deferred version too.

### A false pass worth remembering when writing e2e tests

Playwright's `page.request` does **not** send an `Origin` header, and `proxy.ts` rejects a cookie-authenticated mutation without one. Every POST in the new suite was returning 403 — including the tests that *expected* 403, which were passing for entirely the wrong reason and proving nothing about authorization.

Those tests now send `Origin` explicitly. Any future e2e test that posts through `page.request` must do the same, or it is testing the Origin rule and nothing else.

### Auth and Postgres are reconciled, not transacted

`createInvitation` establishes the Auth identity first — idempotently by normalized email — then does the database work, idempotently by request id. A crash between the two leaves an Auth identity with no invitation, which is harmless and reconciled by the next attempt, because spec/03 is clear that "pending Auth identity alone grants no learning access".

The action link is never returned from the service. Tests assert the real HTTP response body contains no `action_link`, `hashed_token`, `email_otp` or verify URL.

## T07 — Cohorts and catalog grants

- **Status:** done. AC-013 passes in full; **AC-012 is partial**, see below.
- **Checks:** 44 unit, 120 integration, 65 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.
- All nine operations ship with `/api/v1` routes and services. Manager screens are T23.

### AC-012 is cross-task, and stays `not_run`

Three of its four clauses pass here: removal cancels the enrollment and keeps progress, re-adding does not restore it, and a cancelled learner has no access. The fourth — "explicit valid reactivation restores access" — needs `update_enrollment`, which `contracts/api.json` and the ledger both assign to **T11**.

`tasks.json` records the partial evidence and the dependency; the scenario is not marked passed. That is what the ledger's completion rule requires: "For explicitly cross-task checks, record partial evidence and dependency; never mark the full scenario passed early."

### A guard that made the specification's own behaviour impossible

M02's `enrollment_relationships` required an active `cohort_members` row on **every** update of an organization enrollment. But spec/03 requires removing a cohort member to *cancel* their active enrollments — and by then the member is no longer active, so the cancellation was rejected by the very rule meant to protect it.

The membership checks now run **only while the enrollment is active**. Cancelling is always allowed; creating or reactivating is not.

That correction also gives reactivation exactly the shape spec/03 asks for: setting a cancelled enrollment back to active re-runs the checks, which is "admin can explicitly reactivate cancelled enrollment **if all predicates pass**". T11 gets that behaviour for free rather than having to add it.

### A personal grant cannot leak into an organization's catalog

`list_grants` matches a manager only through `g.organization_id IS NOT NULL AND app.org_manager(...)`. A personal grant's subject is a user and its `organization_id` is null, so it can never satisfy that predicate — the exclusion is structural rather than a filter someone could forget. Asking for another organization's grants explicitly is refused `42501` rather than returning an empty list, so the response never implies "that organization has no catalog".

### Revocation and expiry need no migration of enrollment rows

Revoking a grant flips `enrollment_availability` to `revoked`, and shortening its window flips it to `expired`, both while the enrollment row itself is untouched. spec/03: "Backend checks actual current grant each request, so revoking/shortening it takes effect without rewriting enrollment history."

## T08 — Draft content authoring and ordering

- **Status:** done. AC-014 passes.
- **Checks:** 44 unit, 137 integration, 65 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.
- All 13 operations ship with `/api/v1` routes and services. The authoring UI is T23.

### The reorder needs the deferral, and the test proves it

spec/03: "The transaction defers position uniqueness checks, rewrites positions and restores constraints."

The handler does exactly that, and the test that matters reverses a three-class module completely. Moving the first item to the end collides with an existing position part-way through the rewrite, even though the final arrangement is valid — so the test fails against an implementation that skips the deferral. `SET CONSTRAINTS ALL IMMEDIATE` afterwards is what makes a violation surface on this operation rather than at COMMIT.

Rejection is checked by comparing the **entire row set** before and after, not just a count, so a partial rewrite would fail the test.

### One comparison covers three kinds of invalid list

The handler requires `ordered_ids` to be exactly the current sibling set. That single check rejects a foreign child, a missing sibling and a partial list alike — a set that does not match cannot be a reordering of it. Duplicates are caught separately, because a list containing the same child twice does not describe an order at all.

### A literal allowlist invites one specific mistake

ADR-03 forbids building the dispatch from a table, so every migration that adds actions recreates the whole `CASE`. The failure mode is writing a handler and never registering it, which leaves an operation silently unreachable and indistinguishable from one that does not exist.

`tests/integration/dispatcher.test.ts` now reads the **live database** and asserts that every `app.handle_*` function is reachable, that every dispatched action has a handler, and that every action corresponds to an `operationId` the contract declares.

### Deliberately not dispatched

`clone_version` appears on `/programs/{id}/versions` but belongs to **T27**, which is pilot scope. It has no handler, so it is refused exactly like any unknown action.

## T09 — Private uploads, captions and file access

- **Status:** done, with real-media checks BLOCKED. AC-015, AC-016 and AC-062 pass; **AC-017 is partial**.
- **Checks:** 80 unit, 155 integration, 65 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.
- Built and tested with **synthetic files**, at the user's direction, so the pipeline could be finished before the client media arrives.

### What is blocked, and why no test can close it

`fixtures.json` says it plainly: "real media checks require actual assets." Still outstanding:

- playback of an actual MP4 with its caption track attached;
- AC-017's "play generated VTT" clause;
- the T25 demo gate, which spec/01 says "a feature with only a mock is explicitly incomplete at".

`tests/acceptance.json` therefore records **AC-017 as `not_run`**. Its conversion rules all pass; the playback half does not, and marking the scenario passed would misreport that.

### The storage key is composed in the database

A hostile filename cannot reach the path, because the path is not built where the filename arrives. `authorize_upload` composes `versions/{version}/classes/{class}/{asset}/{name}` from ids it holds itself, and the application sanitizes the basename before it ever gets there.

The sanitizer is an **allowlist**, not a blocklist: anything outside `[A-Za-z0-9._-]` becomes an underscore, so there is no control character, separator, quote or encoding left that could alter a key. Runs of dots collapse to one, so `..` cannot appear even where it would be harmless.

### Captions are not sanitized — markup is never carried through

Cue text is reduced to plain text: tags removed, script and style contents dropped entirely, and entities **replaced rather than decoded**. Decoding would turn `&lt;` back into a real angle bracket and hand back the markup that was just removed, which is the classic way a sanitizer reintroduces what it stripped.

Overlapping cues are preserved in their original order. Two people speaking at once is ordinary, and an implementation that sorted or de-overlapped would corrupt real subtitles — so the test asserts the order as written.

### AC-062 is about what a replay must NOT do

`authorize_download` is the one handler deliberately **not** idempotency-cached. Authorization runs on every call and the URL is minted afterwards, so a request that succeeded while a grant was active is refused once it is revoked. The test issues the identical request twice across a revocation and asserts the second one fails.

### Finalization reads back what was reserved

The route calls `finalize_upload` twice: once with `inspect: true` to read the reserved role, type, size and key, then again with the verdict. Neither side of the comparison comes from the request — spec/03 has finalization check the stored object *against what was reserved*, so trusting the caller for both would check nothing.

Folded into the same action rather than given its own, because spec/02 requires the allowlist to correspond to `operationId` values and there is no operation for reading back a reservation. The dispatcher test would have rejected a new action; it caught this while it was still a draft.

## T10 — Publication and frozen content

- **Status:** done. AC-018 and AC-019 pass.
- **Checks:** 80 unit, 181 integration, 65 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### Chunking is done in SQL, on purpose

spec/03 requires publication to be "one transaction after validation and chunk indexing". The chunker is therefore a PL/pgSQL function, so the chunks derive from the **stored** source text inside that transaction. Computing them in the application and sending them in the request would index whatever the caller chose to send, which is not the same thing at all.

`substring()` counts characters rather than bytes, so spec/05's "keep UTF-8 boundaries intact" holds by construction — a byte-oriented split is exactly what would break it.

### A refusal is data, not an exception

`publish_version` returns its issues rather than raising. The draft is untouched either way, and the caller needs **every** problem at once: spec/04 has the editor list missing fields per class, and one error at a time would make preparing a nine-video course a guessing game. The route turns a non-empty issue list into 422 `PUBLISH_INCOMPLETE` with the per-field entries the contract expects.

### AC-019 is tested as the table owner, not through a handler

Eleven destructive edits — rename, revert to draft, delete, add or remove a module, edit or delete a class, make a class optional, add an asset, edit an exercise — are each refused while running with **database privileges**, not via the API. spec/02 is explicit that "RLS alone does not secure a buggy privileged function", so the freeze has to hold against direct SQL or it does not hold.

The test that says the most: adding a class to a published version is refused, and the required-class count is unchanged afterwards. If that edit were possible, **every enrolled learner's percentage would silently drop** — that is the concrete harm, rather than immutability as an abstraction.

### One check is unreachable, deliberately

`publication_issues` validates class and module titles, but the schema's `CHECK` already makes an empty title impossible to store. The validation stays as a second line; a test that tried to exercise it was rewritten to use failures that can actually occur.

## T11 — Dated offerings and enrollment

- **Status:** done. AC-020, AC-021, AC-022, AC-063 and AC-065 pass, and **AC-012 is closed**.
- **Checks:** 103 unit, 203 integration, 65 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### AC-012 closed without writing the rule twice

`update_enrollment` does not re-implement the reactivation predicates. It sets `status` back to `active` and lets the M02 trigger re-run, which is literally spec/03's "admin can explicitly reactivate cancelled enrollment **if all predicates pass**". A learner still out of the cohort is refused; one who has been re-added succeeds, with progress intact.

That fell out of the correction made at T07 — scoping the membership checks to active enrollments — rather than needing new logic here.

### The three date boundaries do not behave the same way

ADR-10 makes **start inclusive, due inclusive for on-time completion, and the hard access end EXCLUSIVE**. `lib/schedule.ts` holds that as pure logic and the unit suite pins every case at the exact millisecond: at `E` no write is accepted, at `E-1ms` one is; at `D` a completion is on time, at `D+1ms` it is late but still permitted while access lasts.

Getting one of these backwards is the kind of mistake that only surfaces on the day a cohort's deadline lands, which is why they are tested at the boundary rather than around it.

### AC-063 is all-or-nothing twice over

Every selected enrollment is validated before any is written, and an enrollment that was **not** named keeps the dates it was created with. A completed learner's schedule can never be edited (spec/02), so one completed row in the selection makes the whole call write nothing — asserted by comparing every row before and after, not a count.

A date change also cannot outrun the grant: after moving the due date, revoking the grant still flips availability to `revoked`. spec/03's "backend checks actual current grant each request" means the new dates are not a way around it.

### Privacy is structural, not filtered

`can_report` matches a manager only through a non-null `organization_id`. A personal enrollment has none, so it cannot appear in an organisation's reporting by construction — not because a filter remembered to exclude it. And every change manager A makes in their own organisation leaves the multi-organisation learner's row in B byte-identical.

## T12 — Learner dashboard and class experience

- **Status:** done. AC-066 passes.
- **Checks:** 103 unit, 203 integration, 77 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### "No completion is caused by GET" is enforced, not intended

The three read handlers are declared `STABLE`. Postgres will not let a stable function write, so a GET cannot mark a class done however the route behaves. The e2e test opens every one of a learner's classes **twice** and asserts `required_completed` is still 0 afterwards.

### A real gap the tests exposed

Signing in as somebody who has **not accepted their invitation** crashed `/learn`. `get_me` is onboarding-exempt so it answered, but `list_my_enrollments` is not, and the refusal surfaced as a broken page.

That refusal is correct — spec/03's "neither gains access before acceptance". What was wrong was the page. `/learn` now checks `onboarded_at` first and shows a Finish setting up your account state.

spec/04 says an unaccepted invitation should "resume invitation flow", but **the contract has no operation for listing your own invitations** — only `GET /invitations/{id}`. So the person is pointed back at the link they were emailed rather than guessed at. Worth revisiting if that operation is ever added.

### Placeholders are marked, not faked

The class page renders the body, outline position, handout list and previous/next. The player (T13), the exercise response form (T14) and the tutor drawer (T19) each show a short note saying what arrives with them, rather than a disabled control that looks broken.

### Two test-locator traps worth remembering

- `getByText("You haven't…")` with an ASCII apostrophe silently never matches a page using a typographic one.
- `getByText` matches **substrings, case-insensitively** by default, so a bare `"Required"` also matched the progress line's "3 of 3 required classes complete". Badge assertions need `{ exact: true }`.

## T13 — Durable playback, text progress and resume

- **Status:** done. AC-023 through AC-030 pass. Real-media playback remains blocked.
- **Checks:** 130 unit, 218 integration, 79 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### Three SQLSTATEs of our own, and a correction to T09 and T12

spec/05 names error codes that no standard SQLSTATE describes, and the dispatcher's only channel back to the application is the error it raises. Three custom classes now carry them:

| SQLSTATE | Code | Status |
| --- | --- | --- |
| `PGL22` | `ACCESS_UNAVAILABLE` | 422 |
| `PGL28` | `SESSION_SUPERSEDED` | 409 |
| `PGL29` | `INVALID_PROGRESS` | 422 |

`PGL22` also corrects an earlier mistake. T09's `authorize_download` and T12's `get_learning_class` raised `22023`, so a learner whose access had been revoked was told the **request** was invalid. spec/05 is explicit: "after ownership is established, blocked learning returns ACCESS_UNAVAILABLE with an availability reason in fields". Both now raise `PGL22` with the reason (`revoked`, `not_started`, `expired`, …) in the error's `DETAIL`, which `lib/rpc.ts` turns into `fields: [{path: "availability", …}]`.

### A position is not coverage

The distinction the whole of ADR-09 rests on. `position_ms` is where the playhead is; `played_ranges` (an `int8multirange`) is what was actually watched. Seeking to the end sets a position and earns nothing. Replaying the same three minutes ten times is three minutes, because a multirange union normalises overlaps — a sum would have said thirty.

Completion is `coverage * 100 >= duration_ms * 90`, integer arithmetic on both sides, so no duration's threshold depends on a float being exact.

### What makes a claimed interval believable

Each heartbeat carries an interval of media time and a claim about how long it took. The bound is `min(elapsed_ms, max(0, server_now − last_received_at) + 2000) × rate + 1000`, capped at 60 s. The middle term is the important one: a client that claims fifteen seconds elapsed but whose last beat arrived three seconds ago is believed for three seconds, not fifteen. The server's clock wins.

The same rule is written twice on purpose — in `lib/progress.ts` and in the migration. The database is the authority; the module exists so the rule can be tested exhaustively (27 unit cases) and so the player can pre-validate rather than send something it knows will be refused.

### The event id is the idempotency key

`record_progress` does **not** use `app.idempotency_lookup`. The heartbeat carries its own `event_id`, and `learning_events` has it as a primary key, so the database already decides replay: same id and same body returns current progress with no new credit and no activity; same id with a different body is a `23505` conflict. Routing it through the generic table as well would give two answers to one question.

`start_playback` **does** use the generic mechanism, and must: a retried start that opened a second session would supersede the session its own first attempt opened.

### Completion in one place

`app.settle_completion(enrollment, class, t)` is the atomic helper the task asks for. It decides class completion (content **and** exercise, per ADR-08), recomputes required classes, and on the last one sets the enrollment's `completed_at`, inserts the certificate snapshot `ON CONFLICT DO NOTHING`, and queues the certificate email — all in the transaction that earned it. T14's exercise path will call the same function, so the two routes into completion cannot disagree.

The certificate stores the learner's name and the program title **as they were**. A later rename cannot alter what was earned.

### Two test traps this task exposed

- The integration tests run inside a rolled-back transaction, where `now()` never moves. Every heartbeat therefore looked simultaneous and the plausibility bound allowed only the 2 s of clock slack. The helper backdates `last_received_at` to let time pass. It also revealed that ten minutes of media at fifteen seconds a beat is forty round trips to a hosted database — the long tests now play at rate 2 in sixty-second beats, the most a single heartbeat may ever claim, and the suite went from 198 s to 66 s.
- A Playwright `test.skip(condition)` stops the **tests** but not `beforeAll`/`afterAll`. The mobile project, every test of which was skipped, was still running this spec's cleanup and deleting the playback session out from under the desktop run. The hooks now carry the same guard. The spec also moved off Amber onto the `personal` learner, because `learning-navigation.spec.ts` asserts Amber has no progress and the two files run in parallel against one database.

## T14 — Short-response exercise completion

- **Status:** done. AC-031, AC-032 and AC-033 pass.
- **Checks:** 143 unit, 231 integration, 79 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### Two languages that count differently

`"🙂".length` is 2 in JavaScript and 1 to `char_length` in PostgreSQL. A 2,000-emoji response is therefore exactly at the limit for the database and 4,000 "characters" to a form validating on `.length` — the browser would refuse what the database would have stored, and the counter under the box would be wrong by a factor of two for anybody writing with emoji or with any astral character.

`lib/exercise.ts` counts with `[...text].length`, which iterates by code point, and normalises to NFC first so that `e` + combining acute counts as the one character it renders as. `app.normalize_response` does the same in SQL with `normalize(…, NFC)` and a `btrim` whose character set is built from `chr()` codes rather than escapes. The unit tests and the integration tests assert the same four boundary submissions on both sides, because AC-031's word is "consistently".

### A resend is not a second answer

"First successful response is final/read-only in v1" could be read as refusing every repeat. It does not: a repeat of the **same** text — a double click, a retried request, a reload — returns what was saved. Only a **different** response after completion is `PGL40` / 409 `EXERCISE_ALREADY_COMPLETED`. The generic idempotency mechanism covers the same-request-id case; the text comparison covers the rest.

### Completion has one implementation

`app.settle_completion` is called by both the heartbeat and the exercise. Whichever half of a class arrives second completes it, and neither path holds an opinion about the other. AC-033 is tested in both orders for that reason.

## T15 — Certificates and the completion transaction

- **Status:** done. AC-034 and AC-035 pass.
- **Checks:** 156 unit, 244 integration, 84 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### Most of this task was already built

`app.settle_completion` (T13) inserts the snapshot `ON CONFLICT DO NOTHING` and queues its notification in the transaction that earns it, and `certificates_immutable` (T02) has always refused to let a snapshot change. What T15 added is reading, the PDF, revocation — and a test that actually proves the atomicity claim.

### A race needs two transactions

AC-034 asks what happens when two final completions arrive at once. Two calls on one connection cannot answer that, however they are ordered: they are sequential by construction. The test therefore opens **two real connections** and submits from both at the same moment, which means it has to commit rather than roll back — it restores the fixture learner in a `finally` instead. Afterwards there is exactly one response, one `completed_at`, one certificate and one outbox record.

### Empty boxes are worse than no certificate

spec/03: "Bundle a licensed font supporting the actual learner names, including accented characters; do not silently replace unsupported characters."

The fonts are committed under `assets/fonts` — Lora and Nunito Sans, SIL OFL 1.1, the same faces the site loads from Google — so a certificate does not depend on a CDN still serving the same bytes in ten years. The licences are committed beside them.

Coverage is checked against the font's own character map through fontkit before anything is drawn. A name the font cannot render raises `CertificateFontError`, naming the characters, and nothing is produced. A certificate reading "□□ □□" for somebody's name would look official and be wrong; a 503 saying it cannot be produced yet is honest, and names what has to be added.

### What revocation does and does not touch

Revoked metadata stays readable — that is the point of recording a revocation rather than deleting a row. Only the PDF is refused, with 409 `CERTIFICATE_REVOKED`. One revoke is idempotent for the same reason; a **different** reason is refused rather than ignored, so an admin learns their reason was not the one recorded. Only a platform admin may revoke, although the learner and their organization's manager may both read.

Reading is deliberately **not** gated on enrollment availability. spec/03 says "including after course access expiry", and a certificate that stops being readable when the course window closes would be worth nothing.

## T16 — Scoped manager and admin reporting

- **Status:** done. AC-036, AC-037 and AC-038 pass.
- **Checks:** 167 unit, 263 integration, 91 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### Scope is computed, not trusted

`app.report_scope` turns the caller into a set of organization ids — or `NULL` for a platform admin, who is not organization-bound. Every row is intersected with that set, so a manager's `organization_id` filter can only narrow what they may already see, never widen it. A personal enrollment has no `organization_id` at all, so no manager's scope can reach one; that is structural rather than a filter somebody remembered to write.

### The summary is not the page

AC-037's last clause: "summary uses all matching records not just one page". The handler therefore runs the row query twice — once unpaged for the summary, once paged for the items. A summary computed from the rows in hand would describe the page and look entirely reasonable while being wrong.

### The first real pagination

Every earlier list handler returns `next_cursor: NULL`. This one pages properly, and the cursor is the **sort key of the last row** rather than an offset, so rows do not shift under a manager who is paging while somebody finishes a class. The key is the uuid followed by the name: the uuid has a fixed width and goes first, because Postgres text cannot contain a NUL and there is no separator a display name could not also contain.

### `   =HYPERLINK(...)` is the whole point

A spreadsheet treats a cell beginning `=`, `+`, `-`, `@` or a tab as a formula. A learner who puts one in their display name would have it run in their manager's spreadsheet — reading the row beside it and sending it somewhere. The defence prefixes an apostrophe, and it looks **past leading whitespace**, because a check on the raw first character sees a space, passes it through, and the spreadsheet (which ignores the space) runs the formula anyway. That is AC-038's exact case.

Only user-entered columns are defended. A timestamp or a uuid cannot begin with `=`, and prefixing one would corrupt the value it carries.

### `enroll_multi_a` is resolved

Recorded at T11 as ambiguous. `expected_report` is authoritative, and the report now reproduces it exactly with `multi` enrolled in organization B only — `assigned` is 4, as the fixture says. The unused `enroll_multi_a` id stays in `fixtures.json` because `verify_spec.py` checks the id table against the document, and removing it is a specification change rather than an implementation one.

## T17, T18, T19 — The course tutor

- **Status:** done. AC-039, AC-040, AC-041, AC-043, AC-044 and AC-067 pass. **AC-042 is blocked** on `OPENAI_API_KEY`.
- **Checks:** 486 unit and integration, 98 e2e; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### Three steps, and why they are separate

1. **`ask_tutor` reserves.** One transaction under the caller's own identity: the per-user lock, the in-flight check, the rate windows, the monthly budget lock, the pending request and the usage reservation.
2. **The provider is called** — outside any transaction. A database transaction must never wait on a network round trip, and the point of reserving first is that the spend is recorded *before* the call rather than after it.
3. **`pglearn_job('tutor.finish')` settles**, through the service-role dispatcher M04 reserved for exactly this, acting only on a request id step 1 already authorized.

A crash between 2 and 3 leaves the reservation held and the request pending; `tutor.reap` sweeps it to failed after sixty seconds and marks the usage `uncertain`. spec/05: "Never release unknown usage simply because frontend disconnected." The money is only given back when we know the provider was never called.

### The corpus is bounded once

`app.tutor_sources` opens with a CTE over the enrollment's **pinned** version, and the current-class selection, the ranked selection and every tie-break draw from that CTE. No ordering mistake downstream can reach another programme, because nothing downstream can see one. AC-039's test plants organization B's material and then asks for it verbatim; it never arrives as a source.

The question goes through `websearch_to_tsquery`, not `to_tsquery`: it is typed by a person, and a question consisting of `&&` or `'; DROP TABLE` must be a question rather than an error.

### Bytes, not characters

The 24,000 limit is UTF-8 bytes. A question in Japanese is three bytes a character, so a character-counted budget would send three times what it meant to — a cost and a context-window problem, not a cosmetic one. What gets dropped when the budget binds: oldest history first, then the lowest-ranked non-current sources. The system instructions are never truncated, and the current class's sources are kept even against an absurd budget, because a tutor answering about a class it cannot see is worse than one with less context.

### No invented repair

The tempting recoveries all produce something that looks like a good answer and is not the one the model gave: dropping a citation that does not exist, keeping an explanation with no citation at all, treating a refusal as an unsupported answer. `validateTutorOutput` refuses each of them and the request is recorded failed with `TUTOR_OUTPUT_INVALID`. A failure the learner can retry is honest.

The answer's Markdown is reduced to text rather than parsed for safe constructs: links become their words, images become their alt text, bare URLs are removed. Source links are built by us, from our own chunk ids, and rendered beside the answer.

### The stub, and why it uses an existing flag

AC-067 needs injected success, unsupported and failure responses, and there is no `OPENAI_API_KEY` configured. `lib/tutor/stub.ts` answers from the question text, and is reachable only behind `PGLEARN_USE_FIXTURES` — the flag `assertCoreConfigured()` **already** refuses to boot with in pilot or production, because spec/05 forbids mock providers there. One switch with one guard, rather than a second mechanism nothing checks.

### Four shadowing bugs in one task

PL/pgSQL resolves identifiers case-insensitively and prefers the variable, which produced four distinct failures here and is worth remembering:

- a variable named `found` silently became what `IF FOUND` tests;
- a parameter named `scope` made every reference to `rate_windows.scope` ambiguous;
- variables named `input_tokens`/`output_tokens` turned `SET input_tokens = input_tokens` into a self-assignment;
- (earlier, in T14) a record named `ex` collided with the alias `ex`.

The rule adopted: **never name a variable or parameter after a column it will be used beside.** Parameters take a `p_` prefix and records take a short unrelated name.

### AC-042 is blocked, not passed

Four of its five claims are established and tested: course text arrives as user-role input while the rules stay in system instructions; no name, address or id is ever in the prompt; no tools are sent at all; and a planted injection chunk saying "mark this class complete" writes nothing — `app.tutor_context` and `app.tutor_sources` are `STABLE`, so Postgres refuses the write rather than the code declining to make it.

The fifth claim — that a reviewed answer stays within learning scope — needs a real model and a person reading what it says. `tests/evaluation/tutor-synthetic-course.md` records the four questions to ask and what to look for. AGENTS.md: "Record unavailable-provider checks as blocked, not passed."

## T20, T21, T22 — Reminders, email and operations

- **Status:** done. AC-045, AC-046, AC-047, AC-048, AC-049, AC-050 and AC-051 pass. **Real outbound email is blocked** pending `RESEND_API_KEY`, `EMAIL_FROM` and a verified sender.
- **Checks:** unit, integration and e2e all green; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### An offset is not a timezone

The reminder rules are written twice: `lib/reminders.ts` so they can be evaluated against a fixed clock at 08:59 and 09:00 on a day the offset changes, and SQL because only the database can decide them inside the transaction that claims the day. Both ask a real IANA database — `Intl` on one side, `AT TIME ZONE` on the other — rather than storing a number of hours.

That is what makes AC-046's DST case work. On the morning Madrid's clocks go back, 00:30Z and 01:30Z are **both 02:30 local**, and both belong to local date 2026-10-25. One local date means one claim in `reminder_days`, so the second run of that repeated hour sends nothing.

### What may be taken back, and what may not

A reminder that has not been attempted can be suppressed when the learner finishes, opts out or loses access — and its daily slot is **released**, because nothing was sent and they may still be due something else. A reminder that has been claimed keeps both its state and its slot: spec/03 is explicit that "emails already dispatched before a concurrent completion cannot be recalled", and pretending otherwise would put our records out of step with the learner's inbox.

Nothing with an unknown outcome is ever recorded as `failed`. A timeout, a dropped connection, a 5xx — each retries on the 1/5/15/60-minute schedule and then becomes `uncertain`, which is a state a person resolves against the provider's dashboard. `failed` is reserved for a definitive rejection.

### One id, three roles

The outbox row's uuid is the row's identity, the provider's `Idempotency-Key`, and the thing a retry must not change. Resend deduplicates on that key for 24 hours and the behavioural cutoff is 23, so a retry inside the window can never produce a second email — but only if the key is frozen, which is why the retry test asserts the id, recipient and payload are all unchanged across an attempt.

### A verification that returned undefined

`svix`'s `verify()` throws on a bad signature and returns the parsed payload — except in this version, where it resolves to `undefined`. Reading `.data` off that threw, the catch turned it into a 401, and **every correctly signed callback was rejected** while every forged one was rejected for the right reason. The tests caught it because one of them asserted a good signature is accepted, not only that a bad one is refused.

Verification and parsing are now separate: the raw body is verified, and only then parsed. That is the honest split anyway — verification answers "are these bytes authentic", not "what do they say".

### AC-051 is a test about absence, so it plants the secret first

A failed invitation whose outbox payload really does carry an Auth action link, then: the token must not appear in the API response, in the rendered HTML, or in **any script the browser downloads**. The last one is checked by collecting every `/_next/static/*.js` the page loads and searching it.

The `OperationStatus` DTO has no payload field, the handlers select columns explicitly, and the Zod schema is `.strict()` — so a handler that started returning more would fail the parse rather than pass it quietly to a screen.

### Two test-infrastructure changes the new specs forced

**One sign-in per learner, not per test.** Every spec used to sign in inside each test. That worked until there were enough specs: Supabase Auth throttles sign-ins, and past a certain number per run the form stops answering — which surfaced as three *unrelated* tests timing out on `waitForURL("**/learn")` while their own subjects were fine. `tests/e2e/session.ts` now establishes a session once per email and reuses its cookies. `auth.spec.ts` and `invitations.spec.ts` deliberately still sign in through the form, because that is what they are testing.

**The scheduler runs in its own project, last.** Every other spec owns a learner or an organization and can run beside its neighbours. The scheduler owns nobody and touches everybody: one run plans a reminder for every eligible learner in the database. Beside the others it made three unrelated specs fail — not because either was wrong, but because they disagreed about whose state it was. It is now a `scheduler` project with `dependencies` on the two viewport projects and a single worker.

### Five shadowing bugs now

Added to the four from T17–T19: a parameter named `payload` against `notification_outbox.payload`, and a variable named `kind` against its `kind` column. The rule was already written down and I broke it twice more. It is now stated at the top of both migrations: **parameters take `p_`, and no variable is named after a column it sits beside.**

## T23 — The admin and manager screens

- **Status:** done. **AC-053 is blocked** on its manual half; what a machine can check is automated.
- **Checks:** unit, integration and e2e all green; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### A contract gap, and what was done about it

`Program` carries only `latest_published_version_id`, and **no operation lists a program's versions**. So an author who creates a draft, navigates away and comes back has no way to find it again — the id exists only in the response that created it.

`clone_version` was declared in the contract (`POST /programs/{program_id}/versions`) and had no handler. It now answers *"give me this program's draft"*: an existing draft is **returned** rather than a second one created, which makes it the way back to work in progress and keeps one draft per program.

It does **not** copy the previous version's content. spec/04 lists "new draft version cloning" under "Deferred to later releases", and an asset's `storage_key` is `UNIQUE` — a copied class could not carry its media without moving the stored object or inventing a second reference to it. So a new draft starts empty, and that is a recorded limitation rather than a half-built feature.

### An authorization assumption that was wrong

The admin pages inferred admin rights from a refusal: call `list_programs`, and treat `FORBIDDEN` as "not an administrator". But `list_programs` **deliberately answers a manager too** — a manager needs to know which programmes they may assign. So a manager could open `/admin/programs` and see the catalog with New program and Archive controls.

Every write behind those controls was refused by the database, so nothing could actually be done. But the screen should never have rendered, and the fix is the general lesson: **establish a right, do not infer it from the absence of a refusal.** The admin pages now read `platform_admin` from `get_me`.

Caught by an e2e test that signed in as a manager and asserted the admin routes were unavailable.

### What is automated about AC-053, and what is not

Automated: every visible control on the admin screens has an accessible name (a label's `htmlFor`, an `aria-label` or an `aria-labelledby` — a placeholder is explicitly not accepted); focus moves through the page under Tab without trapping; `aria-current` marks the navigation item in view; the editor carries an `aria-live` region for save and error summaries.

Not automated, and needing a person: whether the focus ring is actually visible against each background, whether each error message reads sensibly to somebody who did not write it, and whether input survives a real provider failure. Recorded as **blocked**, not passed.

### The browser upload path is not yet exercised

T09 uploaded through the server with synthetic files. The file picker added here does what spec/02 requires — the bytes go straight to storage and never through a serverless function — but that path has not run against real storage from a real browser, because there is no real media yet.

Two details it gets right by construction and one that needs checking with a real file: the signed URL already carries its token as a query parameter, so no `Authorization` header is sent (the token is a storage grant, not a bearer credential); `x-upsert` matches the reservation; and whether the response codes and CORS behave as expected is what the client's first video will tell us. Recorded against AC-052.

### Reordering is up/down, not drag

spec/04 asks for up and down controls. That is not a simplification — a drag handle is unusable from a keyboard without a great deal of extra work, and two buttons with `aria-label="Move Module 1 up"` are operable by everybody on the first try.

## T24 — Cross-context verification

- **Status:** done. AC-003, AC-004, AC-007, AC-021, AC-023, AC-032, AC-038, AC-039, AC-064 and AC-065 re-verified together against the finished surface.
- **Checks:** unit, integration and e2e all green; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### A verification pass is only worth running if it can fail

Each of these scenarios passed when it was written. The question T24 asks is different: **with everything that has been added since, does every route still obey the rules?** A test that re-asserts the same ten cases answers nothing.

So the inventories are read rather than written: the operation list comes from `contracts/api.json`, the page list from walking `app/(platform)`, and the action list from `pg_get_functiondef` of the dispatcher itself. A route or an action added later appears in these tests without anybody remembering to add it.

That caught two things.

### Two contract operations had no route at all

`GET /invitations/{invitation_id}` and `POST /invitations/{invitation_id}/accept` are declared in the contract and had **no API route**. The invitation page calls the feature service directly, because it renders on the server — so the flow worked, AC-009 passed, and nothing was visibly broken. But the two declared endpoints did not exist, and an operation nobody can call is not implemented.

Both now exist. This is exactly the class of gap that only a sweep finds: every individual test passed because every individual test went through the page.

### A wrong assumption in my own test

I wrote the onboarding sweep assuming `update_me` was exempt before an invitation is accepted. It is not — spec/02 names the set exactly: *"except the own-account onboarding actions `get_me`, `get_invitation` and `accept_invitation`"*. The implementation was right and the test was wrong.

Worth recording because of how it would have gone the other way: had I "fixed" the code to match the test, an un-onboarded account would have gained a write it should not have. A test written from memory rather than from the specification is how a wrong assumption becomes a passing check.

### What the sweep says about what is missing

`run_retention` is declared in the contract and not built — it is T28's. It is listed **by name** in the sweep's `NOT_YET_IMPLEMENTED` set rather than silently skipped, so the gap is stated, and so shipping it without removing the entry fails loudly.

## T25 — The demo gate, rehearsed

- **Status:** done. **AC-054 is blocked**, and `tests/evaluation/demo-gate.md` is the disclosure its own wording requires.
- **Checks:** unit, integration and e2e all green; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### The journey found three defects that every other test had passed over

`tests/e2e/demo-journey.spec.ts` does the whole thing once, through the interface: author a programme, publish it, grant it, make a cohort, assign it with dates, sign in as the learner, complete it, collect the certificate and its PDF, and see it in the manager's report and CSV.

It found three things wrong with code written at T23 — each of which would have failed in front of the client:

1. **The class editor could not save.** Every mutation route requires an `Idempotency-Key`. `ClassEditor`, `ArchiveProgram` and three calls in `VersionEditor` sent none. The version editor's `send()` helper took an `idempotent = false` parameter, which is exactly how it happened: an optional safety measure is one that gets left off. The helper now always sends one.

2. **A text class could never be published.** Publication requires source text on every class, and nothing ever set it for a text class — so the "Needs source text" badge was permanent and Publish always refused. Saving the body now sets both, which is what spec/02's *"every class has source text from body/transcript"* means when the class *is* the body.

3. **Assignment was refused every time.** `AssignProgram` sent `organization_id` and `program_id`, which `OfferingCreate` does not have — the cohort and the grant carry them between them. The API rejects unknown keys rather than ignoring them, so every assignment failed validation.

What they have in common is worth stating: the T23 tests exercised **navigation and rendering**, and all three defects were in **writes**. A page that renders correctly and refuses every save looks entirely healthy from the outside.

### Why AC-054 is blocked and not passed

Its "then" has two halves. The first — publish → grant → invite → enrol → learn → response → certificate → report — passes, for real. The second is *"real controlled reminder/tutor verified"*, and neither can be: the tutor answers from a stub because there is no model key, and no email is sent because there is no provider key or verified sender.

The same clause also says *"mocked-only features disclosed incomplete"*, which is why the gate record exists and why this is recorded as blocked. A gate that passes with its integrations stubbed is not a gate.

## T26 — Bulk roster import

- **Status:** done. AC-055 passes.
- **Checks:** unit, integration and e2e all green; lint, typecheck, build, `verify_spec.py`, `db:reset:test`.

### No new contract, as the task requires

The apply calls `create_invitation` once per row and `add_cohort_members` once — the same commands a manager uses one person at a time. Nothing about importing four hundred people needs a mechanism that importing one does not.

Each row's `Idempotency-Key` is **derived** from the file's content and the row's address rather than generated. Applying the same file twice is therefore the same request each time, not a second invitation — and invitations are idempotent by normalised email anyway, so there are two independent reasons a repeated import cannot duplicate anybody.

### The preview is the plan

Not an estimate of what might happen: apply acts on exactly the rows the preview showed, and every row — valid or not — is carried through, so somebody reading "3 of 6 will be imported" can see which three and why.

The CSV parser is written out rather than `split(",")`, because a roster is precisely the file that contains `"Doe, Jane"`. It reads quoted commas, doubled quotes, CRLF and LF, a record spanning lines, a leading BOM, and a file with no header at all.

### A mistake worth recording

`lib/roster.ts` imported `normalizeEmail` from the invitation feature service. That service imports the **service-role** Supabase client, so the roster importer — which runs in the browser — pulled server-only code into the client bundle. The build refused it, correctly and loudly.

`normalizeEmail` now lives in `lib/email-address.ts`, which is pure. The lesson is about direction: `lib/` may not import from `features/`, because `features/` is where the server lives.

### Four of my expectations were wrong, and the code was right

Writing the integration tests I assumed: a foreign cohort would be 404; `create_invitation` would take an email. Neither is so. A foreign cohort is **42501**, because the id came from the caller and "not permitted" discloses nothing they did not already have; and `create_invitation` takes a **user_id**, because the Auth identity is established first — spec/03's *"Auth and Postgres cannot be one distributed transaction"*.

## T27 — A new version of something people are already learning

- **Status:** done. AC-056 passes.
- **Checks:** `npm run test:integration -- version-cloning` (11), full unit and integration suites, lint, typecheck, build, `verify_spec.py`, e2e.

### What T23 deferred, and why this is the release that pays it

T23 implemented `clone_version` as "give me this program's draft" and created that draft **empty**, recording the omission: spec/04 listed version cloning under deferred work, and an asset's `storage_key` is `UNIQUE`, so a copied class could not point at the media it came from.

AC-056 is the scenario that makes the omission untenable — *"clone to new version, edit, publish, assign to new cohort"* — because an author who must retype a whole course is not cloning it. T27 clones the content: modules, classes, exercises, indexed chunks and media.

### Independent identity is the property, not a side effect

The task's own target says *"independent asset identity/requirements"*, and AC-056 spells out what it is for: *"existing learners keep original IDs/requirements/media."*

So the clone shares **nothing** with its source. Every module, class, exercise, chunk and asset is a new row at a new id, and each file is copied to a new storage key derived from the new ids. A learner's progress rows point at the old class ids; nothing an author does in the draft can reach them — not renaming a class, not making an optional one required, not deleting the draft, which would otherwise take a published version's files with it.

The integration tests ask this the other way round: is there any row, key or file the two versions still have in common? There is not.

### Two phases, because storage is not in the transaction

The database cannot wait on an object store, so the clone is split the way an upload already is — a reservation inside the transaction, a transfer outside it:

1. `clone_version` copies everything the database owns and creates the new asset rows **pending**, at the keys their objects must land at. It returns the list of copies to perform.
2. `draftVersion` performs each copy server-side in storage (`copyObject`, not download-and-re-upload: these are video files), then settles each asset through the `clone.finish` job.

A file that does not copy leaves its asset `failed` with its reason. That is not a loose end but the correct outcome: publication refuses a class whose primary asset is not ready, so a half-copied clone cannot go live, and `ClassEditor` already shows the failed asset next to the class with "Upload it again."

`clone.finish` goes through the service-role job dispatcher rather than `pglearn_rpc`, for the same reason `finalize_upload` does: it is an internal step of an operation the contract declares, and the user-facing allowlist must keep matching `contracts/api.json` operation for operation. It re-checks that the actor is a platform administrator, because `service_role` cannot read `auth.uid()`.

### A contract conformance fix found on the way

The clone route was returning `{version, created}` as its `data`. The contract's 201 carries a `Version` and `additionalProperties: false`. It now returns the version itself, and the clone's summary is not returned at all — it does not need to be, because every copied file is an asset row and `get_version` already reports each one's state on the screen the author lands on.

## T28 — Retention, and the restore that has not been rehearsed

- **Status:** done for AC-057. AC-058 stays **blocked**, with `tests/evaluation/restore-runbook.md` as the procedure it is blocked on performing.
- **Checks:** `npm run test:integration -- retention` (10), the scheduler e2e project, lint, typecheck, build, `verify_spec.py`.

### One statement per rule

`app.job_retention_run` is one `DELETE` per rule from spec/05, in an order the foreign keys allow, each counting what it removed. It is deliberately not clever: a retention job that computed which rows to keep would become a second definition of what the product remembers, competing with the one in spec/05.

Every rule deletes on the row's **own** timestamp, never on a parent's — so a learner who was active yesterday does not lose last year's events, and a dormant one does not keep them.

The whole run reads one clock. A job that called `now()` per statement could keep a row under one rule and delete it under the next.

### What it must not touch

`class_progress`, `exercise_completions`, `certificates` and `enrollments` are named in no statement in the file, and a test asserts the counts are identical across a run that deleted chats and events. spec/05 has already said what must remain true afterwards: *"If a progress event was purged after 30 days, closed/superseded session and monotonic progress still prevent duplicate completion."* The normalized row is the record; the event was the evidence of one delivery of it.

The tutor ledger is the subtle one. Chats go at 30 days and the ledger stays 180 — which only works because `tutor_usage.request_id` has no foreign key to `tutor_requests`. That absence is not an oversight in the schema; it is what lets month-end spend accounting survive the deletion of the chats it accounts for, and there is a test that deletes the chat and re-sums the month.

### Auth links

spec/05 requires purging expired auth links from the outbox. **This implementation never puts one there** — the invitation email links to our own application, and Auth sends its own action link — so the statement has nothing to find today. It runs anyway, because spec/05 permits the outbox to hold one temporarily, and a retention job that only purges what today's code writes would silently stop covering tomorrow's. The payload is stripped rather than the row deleted: the outbox row is the delivery record AC-050 reads.

### The endpoint

`/api/v1/jobs/retention` at `15 3 * * *`, added to `vercel.json` now that the handler exists, as spec/05 instructs. Same rule as the reminder scheduler and for a sharper reason: retention **deletes**, so a signed-in platform administrator cannot run it. The secret is the only caller.

The response is the contract's `JobResult`, which declares `additionalProperties: false` — so the per-rule breakdown does not travel in it. It is written to `app.job_runs.counts`, where an operator looks at a run afterwards anyway and where it outlives the request.

### AC-058 is blocked on doing it, not on writing it

The runbook is complete: what to back up and why it is two separate things, the RPO/RTO targets, the rehearsal in a disposable project, and the verification that ends with a class actually **playing** — the step that fails when only the database was restored.

It cannot be performed yet: the development project is on a plan with no daily backups, creating and deleting a second project needs authorisation, and the only media in the system is synthetic (AC-017, AC-052). A rehearsal that was not measured would not be evidence, so AC-058 is recorded blocked rather than assumed.

## Update this section after each implementation task

- Task ID and status:
- Implementer / branch / commit:
- Files changed:
- Acceptance IDs exercised:
- Commands and results:
- Real integrations exercised:
- Unresolved failures / blocked checks:
- Contract or default changes, with reason:
- Next unblocked task:

## Change log

- v1.0: implementation contracts established; all application tasks are todo.
- T00: site-v2 adopted as the host application; deviations D-01 and D-02 recorded.
- T01: bootstrap complete; Next 14 → 16 and React 18 → 19 under ADR-01; AC-001 partially exercised.
- T28: retention implemented as one statement per rule with the nightly cron, and the restore runbook written. AC-057 passed; AC-058 blocked on a backup-bearing plan, a disposable project and real media.
- T27: version cloning done properly — content, exercises, chunks and media, each at a new identity, with the file copies settled outside the transaction. AC-056 passed. The clone route corrected to return a Version, as the contract declares.
- T26: bulk roster import — preview, explicit apply, derived per-row idempotency keys, and no new API contract. AC-055 passed. A server-only import in browser code caught by the build and moved to lib/email-address.
- T25: the demo gate rehearsed end to end and recorded in tests/evaluation/demo-gate.md; AC-054 blocked on the tutor and email credentials. Three T23 defects found and fixed — all of them writes that the rendering tests could not see.
- T24: cross-context verification driven by the contract, the filesystem and the dispatcher's own source. Two contract operations found to have no route (get_invitation, accept_invitation) and implemented; one wrong assumption in a test corrected against spec/02.
- T23: the application shell with role navigation, and the admin and manager screens — catalog, version editor with upload and publish, organizations, individuals, platform reports, cohort rosters and assignment. clone_version implemented to close a contract gap; admin pages corrected to establish rather than infer admin rights. AC-053 partially automated, recorded blocked.
- T20-T22: reminder eligibility with real timezone handling, the outbox state machine, Resend and webhook verification, the hourly cron, and redacted operations; AC-045 to AC-051 passed. PGL46 added for DELIVERY_UNCERTAIN. Real outbound email still blocked on a provider key.
- T17-T19: tutor retrieval and privacy, the model adapter with budget reservation and settlement, and the drawer; AC-039, AC-040, AC-041, AC-043, AC-044, AC-067 passed and AC-042 recorded blocked pending OPENAI_API_KEY. PGL43/44/45 added.
- T16: scoped reporting, real cursor pagination and the CSV export; AC-036, AC-037, AC-038 passed. PGL42 added for EXPORT_LIMIT; the enroll_multi_a fixture ambiguity resolved in favour of expected_report.
- T15: certificate reading, PDF rendering with bundled OFL fonts, and revocation; AC-034 and AC-035 passed. PGL41 added for CERTIFICATE_REVOKED.
- T14: short-response exercises, Unicode-correct counting and read-only saved responses; AC-031, AC-032, AC-033 passed. PGL40 added for EXERCISE_ALREADY_COMPLETED.
- T13: playback sessions, heartbeats, coverage, text completion and the completion/certificate chain; AC-023 to AC-030 passed. Three custom SQLSTATEs added; T09 and T12 corrected to return ACCESS_UNAVAILABLE rather than VALIDATION_ERROR. Real-media playback still blocked.
- T12: learner dashboard, outline and class shell; AC-066 passed. Un-onboarded sign-in gap found and fixed.
- T11: offerings, enrollment, date boundaries and bulk date updates; AC-020, AC-021, AC-022, AC-063, AC-065 passed and AC-012 closed.
- T10: publication validation, in-transaction chunk indexing and the published freeze; AC-018 and AC-019 passed.
- T09: uploads, caption conversion and download authorization; AC-015, AC-016, AC-062 passed with synthetic files. AC-017 partial and real-media checks blocked pending client assets.
- T08: content authoring, ordering and the reorder deferral; AC-014 passed. Dispatcher completeness now tested against the live database.
- T07: cohorts, cohort membership and catalog grants; AC-013 passed, AC-012 partial pending T11. Enrollment guard corrected so cancellation survives a lapsed membership.
- T06: organizations, memberships and invitation creation; AC-010 and AC-011 passed. Idempotency mechanism added; last-manager trigger corrected to fire immediately.
- T05: invitation acceptance and password recovery; AC-008 and AC-009 passed against real Auth. Fixture accounts created through the Auth admin API; db:reset:test became three-phase.
- T04: session verification, profile services, Origin rule and admin bootstrap; AC-006, AC-007, AC-064 passed. Mobile navigation gap recorded.
- T03B: M05 fixtures seeded and verified against expected_report; AC-001 closed.
- T03: M02–M04 applied; AC-004 and AC-005 passed as real browser roles. Published-version INSERT blocked beyond spec's letter; schema-smoke.sql retired to M01-only.
- T02: M01 applied to a hosted development project; AC-002 and AC-003 passed against a real database. Remote-reset deviation from spec/02 recorded. M05 found unowned.
