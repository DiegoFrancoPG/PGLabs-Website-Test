# PGLearn handoff

## Current state

- Specification version: 1.0, 15 September 2026.
- Application implementation: T00 done. No specification task (T01–T30) has started.
- Active task: none. Start T01.
- Last completed application task: T00 (added by the integration plan, not part of specification v1.0).
- Specification validation: `python3 verify_spec.py` PASS — 66 operations, 70 schemas, 31 acyclic tasks. This validates the package, not the application.
- Inputs outstanding: actual media/source content, final course details, service credentials and sender setup. Plus the certificate issuer string (see below).

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

### Decisions T00 deliberately deferred to T01

1. **Next.js is on an unpatched major.** `next@14.2.35` is the newest 14.x, but the whole 14 line is covered by the current advisories, including a critical RCE in the Image Optimization API; npm's remediation is `next@16.3.5`. ADR-01 assigns "resolve currently supported patched versions" to T01, so T00 stayed on the baseline version. **T01 must decide 14 → 16 (and React 18 → 19) before further UI work.**
2. `site-v2/package.json` still lists `clsx`, `tailwind-merge` and `class-variance-authority`, which site-v2 no longer imports directly. Harmless now; leaving them allows the bundle duplication described below to return. T01 owns the dependency set.
3. The tutor drawer is not built. It is a composition of `Dialog` and belongs to T19.

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
