# PGLearn × site-v2 — integration plan

Status: **approved**. Written 15 September 2026. Baseline committed (`76d4cca`) and **T00 complete** — see `HANDOFF.md` for evidence.
Adapts `PGLearn/pglearn-implementation/` (spec v1.0) onto the existing `site-v2` Next.js app.
T01–T30 are all still `todo`; T00 (added by this plan) is done.

---

## 1. Decisions taken

| # | Decision | Effect on the spec |
|---|---|---|
| D-01 | **One Next.js app.** `site-v2` becomes the PGLearn application repo. Marketing routes and platform routes live in the same app, split by route groups. | Adapts ADR-01's repository map. One Vercel project, one domain. |
| D-02 | **PG Labs `design-system-v2` is the visual language** for learner, manager and admin screens. | **Overrides ADR-16's** "neutral slate with indigo actions and PGLearn text branding". |
| D-03 | Marketing `/` stays the index and gains the entry points into the platform (Sign in, and a PGLearn overview page). | New, additive. |

D-01 and D-02 are deliberate deviations. Per `AGENTS.md` ("Change a contract deliberately, record why") they get written into `HANDOFF.md` → *Contract or default changes* as part of T01, together with the reason (single product surface, one brand, one deploy). **No security, authorization, progress or data contract changes** — spec/02, spec/03 and `contracts/` are adopted verbatim.

---

## 2. Target layout

Next.js does not allow `app/` and `src/app/` to coexist. `site-v2` already uses root `app/`, so the spec's `src/app/` becomes root `app/`, and PGLearn's feature modules sit at root alongside the existing `components/` and `lib/`.

```
site-v2/
  app/
    layout.tsx                  ← stripped to <html><body>{children}</body></html>
    globals.css
    (marketing)/
      layout.tsx                ← Navbar + Footer + pt-18 (moved out of root layout)
      page.tsx  services/  ai-readiness/  work/  about/  contact/
      learning/page.tsx         ← NEW: public PGLearn overview, CTA → /login
    (platform)/
      layout.tsx                ← app shell, noindex, no-store, force-dynamic
      login/  forgot-password/  set-password/  invitations/[id]/
      learn/                    learn/[enrollmentId]/classes/[classId]/
      certificates/[id]/  settings/
      manage/[orgId]/           manage/[orgId]/cohorts/[cohortId]/  manage/[orgId]/reports/
      admin/                    admin/organizations/ admin/programs/ admin/individuals/
                                admin/reports/ admin/operations/
    auth/callback/route.ts      ← outside both groups (spec 05: public Auth SDK callback)
    api/v1/**/route.ts          ← 56 operations from contracts/api.json
  features/{identity,organizations,content,enrollment,learning,
            certificates,reports,notifications,tutor}/
  lib/{auth,db,validation,clock,providers}/   ← extends existing lib/{schema,utils}.ts
  components/                   ← marketing sections/layout (unchanged)
  supabase/migrations/          ← M01–M05
  tests/{unit,integration,e2e}/
  middleware.ts
  vercel.json
  spec/ contracts/ tasks.json HANDOFF.md AGENTS.md verify_spec.py   ← moved from PGLearn/
```

Route groups `(marketing)` / `(platform)` do not appear in URLs, so **every path in `spec/04-ui.md` is preserved exactly** — `/login`, `/learn`, `/manage/[orgId]`, `/admin/operations` all resolve as specified.

Path aliases in `tsconfig.json` gain `@/features/*`; `@ds` / `@ds/*` stay as-is.

---

## 3. Shell separation — the load-bearing detail

The current root `app/layout.tsx` wraps *everything* in the marketing masthead, footer and `pt-18`, and carries site-wide metadata. Four things move:

1. **Navbar/Footer → `(marketing)/layout.tsx`.** Root layout keeps only `<html lang="en">`, `<body>` and `globals.css`.
2. **Metadata splits.** Root keeps `metadataBase` and fonts. Marketing keeps the PG Labs title template, OpenGraph, `robots: index,follow` and the `organizationSchema` JSON-LD. Platform sets `robots: { index: false, follow: false }` — authenticated pages must never be indexed.
3. **The Figma capture script moves to the marketing layout, dev-only.** `<script src="https://mcp.figma.com/mcp/html-to-design/capture.js">` is a third-party script that currently loads on every page. Spec 05 requires a CSP allowing only app/storage/provider origins on authenticated pages; it cannot ship on platform routes.
4. **Rendering mode splits.** Marketing pages stay statically generated (the index stays fast). Platform routes are `force-dynamic` with `Cache-Control: private, no-store` per spec 05.

`middleware.ts` refreshes the Supabase SSR session, but its `matcher` covers **only** platform paths (`/login`, `/set-password`, `/forgot-password`, `/invitations/:path*`, `/auth/callback`, `/learn/:path*`, `/certificates/:path*`, `/settings`, `/manage/:path*`, `/admin/:path*`, `/api/v1/:path*`). Marketing routes never hit auth middleware.

---

## 4. Marketing ↔ platform touchpoints (D-03)

- `Navbar` gains a **Sign in** link → `/login`. The existing "Talk to an AI expert for free" primary CTA stays.
- New `(marketing)/learning/page.tsx` — public PGLearn overview built from existing DS-v2 section components, CTA → `/login`. Public content only; no enrollment, no signup (ADR-05: public sign-up disabled, invite-only).
- Footer gains a Learning link.
- `/learn` when signed out → redirect to `/login`. `/login` when signed in → `/learn`.

---

## 5. Design system work (D-02)

`design-system-v2` currently exports: Button, Input, Label, Textarea, Badge, Card, Separator + 10 custom marketing components. The UI contract in spec/04 needs more. The Radix dependencies are **already installed** in DS-v2, so these are wrappers, not new dependencies:

| Needed by spec/04 | Status |
|---|---|
| Select (IANA timezone, org selector, filters) | `@radix-ui/react-select` installed, no wrapper |
| Checkbox ("I completed this practical exercise", reminders) | needs dep |
| Dialog (publish confirmation, keyboard-operable per spec/04) | `@radix-ui/react-dialog` installed, no wrapper |
| Table (roster, reports, operations) | none |
| Progress, Skeleton, Alert/`aria-live` region, Tabs, Drawer (tutor) | Tabs installed; rest none |

**Accessibility constraint carried from the token file:** `brand-500` (#59C4ED) is only 2:1 on white and must never carry small type. Platform text-on-light uses `brand-600`/`brand-700`; `azure-500` is the button fill with `ink-800` label. This matters because spec/04 requires visible focus rings, inline field errors and readable status text throughout.

This is real work the spec does not budget for → **new task T00** (below).

---

## 6. Dependency and tooling changes

**Resolved in T00.** Both `site-v2/node_modules` *and* `design-system-v2/node_modules` were symlinks into the v1 trees, and neither package had a lockfile. Both now have real installs and committed lockfiles. `next.config.mjs`'s stale `transpilePackages: ["../design-system"]` was removed — the build does not need it.

Additions (exact patched versions resolved and pinned at T01 per ADR-01 — the spec's date does not freeze safe versions):

- `@supabase/supabase-js`, `@supabase/ssr` — Auth, RPC, Storage
- `zod` — validation (ADR-16)
- `pdf-lib` — certificates (ADR-16)
- `openai` — tutor adapter, committed version (ADR-13 / spec 05)
- `resend` + `svix` verification — email and webhooks (ADR-12)
- dev: `vitest`, `@playwright/test`, `supabase` CLI, `eslint-config-next`, `tsc` typecheck script

npm scripts required by `AGENTS.md`, none of which exist today: `lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `build`, `db:reset:test`.

Tailwind `content` globs gain `./features/**/*.{ts,tsx}`.

`vercel.json`: cron `/api/v1/jobs/reminders` at `0 * * * *` (T21). Retention cron `15 3 * * *` added **only when T28 ships its handler**.

---

## 7. Revised task sequence

The spec's dependency graph is unchanged. Two tasks are inserted and T01/T12/T23 are restated against site-v2.

| Task | Change |
|---|---|
| **T00** ✅ | Split root layout into `(marketing)`/`(platform)`, fix `next.config.mjs`, real install + committed lockfile, add the DS-v2 components from §5. Gate: marketing site renders byte-identically to today. |
| **T01** | As specified, adapted: `app/` not `src/app/`, `lib/clock`, `/api/v1/health`, test harness, env validation. AC-001. |
| T02–T11 | **Unchanged.** Schema M01, triggers M02, RPC M03, service functions + storage M04, fixtures M05; identity, orgs, cohorts, content, uploads, publication, enrollment. These are pure backend and are entirely indifferent to the site merge. |
| **T12** | Learner dashboard/class experience built on DS-v2 inside `(platform)`, not on a fresh Tailwind slate/indigo baseline. |
| T13–T22 | **Unchanged.** Playback, exercises, certificates, reporting, tutor, reminders, operations. |
| **T23** | Responsive integration (390px and 1440px) now also verifies the marketing↔platform boundary: no auth middleware on marketing, no Figma script on platform, no platform CSS regression to the index. |
| T24–T25 | Unchanged demo gates. T25 requires real provider/media evidence — mocks do not satisfy it. |
| T26–T30 | Unchanged pilot scope. |

**Sequencing note:** T02–T11 is roughly two thirds of the demo scope and touches no marketing code. If you want parallel work later, that is the clean seam — but `AGENTS.md` forbids two writers on one checkout, so it would need separate branches with agreed file ownership.

---

## 8. What this plan does *not* change

Adopted verbatim from the spec, because they are the security contract:

- Private `app` schema, RLS with no permissive policy, zero table privileges for `anon`/`authenticated` (ADR-03).
- The three entrypoints `public.pglearn_rpc` / `pglearn_job` / `pglearn_provision`, SECURITY DEFINER with `SET search_path = ''`, literal action allowlists, authorization enforced *inside* each handler.
- Every predicate in spec/02 (`can_learn`, `can_report`, `owns_enrollment`, …) and the disclosure matrix — managers never see exercise response bodies or tutor chats.
- All 56 OpenAPI operations, the `{data,request_id}` / `{error,request_id}` envelopes, the stable error codes, `Idempotency-Key` on every mutation.
- ADR-09 completion rules (90% unique timeline coverage, 1–2,000 code points + confirmation), ADR-10 date semantics, tutor retrieval/citation/budget rules.
- The service key stays server-only; no secret reaches the browser bundle.

---

## 9. Inputs needed before the relevant tasks

Nothing here blocks T00–T03. Each blocks only its own task, and per §9 of the spec these are expected to arrive during implementation.

| Input | Blocks |
|---|---|
| Supabase project (URL, publishable key, service role key) | T02 onward — or I run the local `supabase` CLI stack |
| Resend API key, verified sender domain, webhook secret | T21 (real send is a T25 gate; mocks do not pass it) |
| `OPENAI_API_KEY` | T18–T19 |
| The nine videos + transcripts/captions, final class names, exercises, handouts | T09 upload validation, T25 real-media gate |
| Real organization identity, cohort dates, timezone | T07, T11, pilot onboarding |
| **Certificate issuer string** — ADR-11 defaults to "PGLearn", but under D-02 this is a PG Labs product. "PGLearn", "PG Labs", or "PGLearn by PG Labs"? | T15 |

Adapters and clearly-labelled fixtures get built while these arrive. Per ADR-17, a missing secret never silently degrades to mock data.

---

## 10. Risks

1. **Regressing the live marketing site.** Mitigation: T00 is gated on the marketing pages rendering unchanged, and it is the only task that touches `components/layout/` or `app/layout.tsx`.
2. **Shared `globals.css` bleed.** Platform utility classes must not leak into marketing pages. Mitigation: scope platform styles under the `(platform)` layout; no new global element selectors.
3. **Untracked baseline.** `site-v2/`, `design-system-v2/` and `PGLearn/` are all **untracked in git** right now. Nothing is reviewable or revertable. Mitigation: commit the baseline before T00 starts.
4. **Timeline.** The spec targets a same-day demo (T01–T25) — that is an ordering constraint, not a feasibility claim, and the spec says so explicitly. T02–T22 is substantial backend work: migrations with triggers, 56 endpoints, a tutor retrieval pipeline, an email outbox with reconciliation. Treat the demo gate as the milestone, not the day.
5. **Marketing bundle weight.** Supabase/OpenAI/pdf-lib must stay out of marketing route bundles. Mitigation: server-only modules, verified in the T23 build output.

---

## 11. Progress

1. ✅ Baseline committed as `76d4cca` on branch `pglearn-integration`; `npm run build` verified passing first.
2. ✅ **T00 complete.** Evidence in `HANDOFF.md`. Six problems in the baseline were found and fixed along the way — see *Problems found and fixed*.
3. ⬜ Move the spec package from `PGLearn/pglearn-implementation/` to `site-v2/` root (README step 1: the spec lives at the root of the application repo), merging `AGENTS.md` with repo rules.
4. ⬜ **T01**, which must first resolve the Next.js 14 → 16 upgrade (see §6).

### Open decision carried into T01

`next@14.2.35` is the newest 14.x, but the entire 14 line is unpatched — npm's remediation is `next@16.3.5`, which also implies React 18 → 19. ADR-01 assigns version resolution to T01. This should be settled before any platform UI is built on top of it.
