# PGLearn handoff

## Current state

- Specification version: 1.0, 15 September 2026.
- Application implementation: T00–T03 done. T04–T30 todo.
- Active task: none. Start T04.
- Last completed application task: T03.
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

### Ledger gap: migration M05 is unowned

spec/02's migration sequence lists **M05 — test/demo fixtures via explicit seed command**, with "deterministic totals and repeatable fixture seed" as its evidence. No task in `tasks.json` lists it as an implementation target. `tests/fixtures.json` exists with the expected report totals, and `supabase/seed.sql` does not.

Consequence: **AC-001 remains `not_run`.** Its first two clauses hold — the app shell builds, and reset creates the schema — but "deterministic fixtures" has nothing to create them. This needs either an explicit decision to fold M05 into T03, or a new task. It should not be left to be discovered at T24.

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
- T03: M02–M04 applied; AC-004 and AC-005 passed as real browser roles. Published-version INSERT blocked beyond spec's letter; schema-smoke.sql retired to M01-only.
- T02: M01 applied to a hosted development project; AC-002 and AC-003 passed against a real database. Remote-reset deviation from spec/02 recorded. M05 found unowned.
