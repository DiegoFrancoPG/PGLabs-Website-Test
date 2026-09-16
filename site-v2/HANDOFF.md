# PGLearn handoff

## Current state

- Specification version: 1.0, 15 September 2026.
- Application implementation: T00–T07 done (including T03B). T08–T30 todo.
- Active task: none. Start T08.
- Last completed application task: T07.
- Acceptance scenarios passing: 13 of 67 — AC-001 to AC-011, AC-013 and AC-064. **AC-012 is partial and blocked on T11.**
- Specification validation: `python3 verify_spec.py` PASS — 66 operations, 70 schemas, 31 acyclic tasks. This validates the package, not the application.
- Inputs outstanding: actual media/source content, final course details, Resend and OpenAI credentials with sender setup, and the certificate issuer string (see below). A development database is configured.

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
- T07: cohorts, cohort membership and catalog grants; AC-013 passed, AC-012 partial pending T11. Enrollment guard corrected so cancellation survives a lapsed membership.
- T06: organizations, memberships and invitation creation; AC-010 and AC-011 passed. Idempotency mechanism added; last-manager trigger corrected to fire immediately.
- T05: invitation acceptance and password recovery; AC-008 and AC-009 passed against real Auth. Fixture accounts created through the Auth admin API; db:reset:test became three-phase.
- T04: session verification, profile services, Origin rule and admin bootstrap; AC-006, AC-007, AC-064 passed. Mobile navigation gap recorded.
- T03B: M05 fixtures seeded and verified against expected_report; AC-001 closed.
- T03: M02–M04 applied; AC-004 and AC-005 passed as real browser roles. Published-version INSERT blocked beyond spec's letter; schema-smoke.sql retired to M01-only.
- T02: M01 applied to a hosted development project; AC-002 and AC-003 passed against a real database. Remote-reset deviation from spec/02 recorded. M05 found unowned.
