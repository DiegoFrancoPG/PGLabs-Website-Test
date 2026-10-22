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
- **D-05 (22 October 2026): a video class may play from YouTube** for the first cohort — migration M29, described below. Production needs `supabase db push` to apply M29 before the code that reads `youtube_video_id` is deployed.
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

**D-04 — PGLearn look and feel (supersedes D-02 for `app/(platform)/` only, 8 October 2026).**
From `/login` onward, PGLearn uses the SkillSphere shadcn theme (template v1.0.0) at the product owner's request; the marketing site keeps `design-system-v2` unchanged. How it is contained:

- The theme's tokens are CSS variables (`--ui-*`, OKLCH channels) defined only under `.pglearn` in `app/globals.css`; the (platform) layout renders that wrapper. Tailwind exposes them as `ui-*` colours (`bg-ui-card`, `text-ui-muted-foreground`, …) because the design system already owns the bare shadcn names with fixed brand values.
- Platform primitives live in `components/pglearn/ui/` and keep the design system's component APIs and variant names (`primary`, `subtle`, `azure`, `coral`, …), so callers changed only their import path. `@ds/components/ui/*` is no longer imported by any platform file.
- Type is Geist (the `geist` package, self-hosted, no build-time font fetch). Raw form controls use `.pglearn-field`, text links `.pglearn-link`.
- Dark mode is per-browser via the `pglearn-theme` cookie and toggles `.dark` on the `.pglearn` wrapper, never on `<html>`, so it cannot reach marketing pages. Select popovers portal into the wrapper so they inherit the theme.
- The template is Tailwind v4; the site is Tailwind v3. Only its tokens, geometry and visual language were ported — no template code or dependencies beyond `geist` were added.

Accessibility: alerts keep their `role`/`aria-live` contract, and focus is a 3px primary ring on every control. The original SkillSphere blue (3.7:1 behind white labels) was replaced by the PG Labs tokens below.

**D-04, revised 12 October 2026 — PG Labs tokens on the SkillSphere layouts.** At the product owner's request the platform keeps SkillSphere's layouts and components but takes every token from the PG Labs design system (the "PG Labs" Design System artifact, built from the Figma frame "PG Labs — Responsible AI for Nonprofits"):

- Colour: `surface-subtle` canvas, `surface` cards, `heading` / `text-body` text, `ink-900` for the one filled action, `border-tab` hairlines, `ink-45` control borders, `ink-4` hover wash, and `accent` (#59c4ed) only as rules, 6px bullets and progress — it is 2:1 on white, never text. Dark mode applies the system's dark-section tokens (`surface-dark`, `text-light`, `white-*`). Each `--ui-*` variable in `app/globals.css` names its source token.
- Type: Lora for titles (`title-is-3`, `heading-is-4`), Nunito Sans for UI and body (`body-m`, `button-label`, `eyebrow`, `caption`), as Tailwind `text-ui-*` sizes. Geist and the `geist` package are gone; the fonts already load site-wide.
- Shape: `radius-m` (8px) cards and fields, `radius-6` chips, pill buttons at `control-height` (44px), no shadows, a 2px `focus-ring` with 2px offset everywhere, the 1360px `container-max` with 24px gutters.
- Two deliberate additions, since the system defines neither: a filled ink pill for the primary action (the system's button is the outline pill), and status colours for errors and warnings, reusing design-system-v2's coral (text step #a13d29) and gold.
- The wordmark is the real PG Labs lockup (`public/images/PGlabs-logo.svg`) plus "Learn" in Lora, replacing the stock graduation-cap tile.

**D-05 — YouTube-hosted video for the pilot (adapts spec/03's private media and caption rules, 22 October 2026).**
At the product owner's request, the first cohort's nine videos are hosted on YouTube and embedded, so the pilot does not wait on a storage plan that accepts 1 GiB uploads. Migration M29 (`supabase/migrations/20261022000001_m29_youtube_video.sql`) adds `classes.youtube_video_id`; an uploaded file remains fully supported, and an author picks one source per class.

- **What is stored.** The eleven-character video id only, checked by a constraint; the editor reduces a pasted link to it (`lib/youtube.ts`). The learner's page renders a URL composed from that id on `www.youtube-nocookie.com`, so no caller-chosen URL or host reaches the page. The id requires `kind = 'video'` and no uploaded primary: choosing YouTube clears the primary, finalizing an uploaded primary clears the id, and leaving the video format drops it.
- **Progress is unchanged.** `components/learning/YouTubeFrame.tsx` gives `ClassPlayer` a handle with the same current time, rate and play/pause/timeupdate/ended events as a `<video>`, using YouTube's IFrame Player API (time is polled every 250 ms while playing). The intervals reach the same `record_progress` transaction and the same 90% rule; the server does not know which player sent them. Resume uses the embed's `start` parameter, so it does not autoplay.
- **Seek fix, both players.** A detected seek now closes the open interval where the seek began. Before, it closed at the new playhead, so a forward seek claimed the skipped span and the server rejected the whole beat as implausible, losing the watched part with it.
- **Publication.** A YouTube class needs its id, a duration and source text (upload the transcript, as for a file), but no uploaded primary and no caption asset: captions are YouTube's own (`cc_load_policy=1`). The duration is read from the player in the editor and can be corrected; it must match the video, because completion is 90% of it.
- **Cloning** carries the id; a primary file a class was switched away from is not copied.
- **Referrer.** Platform pages send `Referrer-Policy: same-origin`, and YouTube refuses embeds that arrive with no Referer. The iframe alone sets `strict-origin-when-cross-origin`, sending the origin and never the path, which carries enrollment and class ids.

**The cost, accepted for the pilot.** The media is as private as the YouTube video is: set each video to **Unlisted** with embedding allowed, and anyone holding the link can watch it, enrolled or not, including after a grant is revoked — AC-023 still stops progress and certificates, but not viewing on YouTube. Viewing also sends the learner's IP and the PGLearn origin to YouTube. `contracts/schema.sql` stays the v1.0 reference DDL that M01 must reproduce (`tests/unit/migration-fidelity.test.ts`); the column is M29's. `contracts/api.json` carries `youtube_video_id` on `Class`, `ClassWrite` and `ClassPatch`.

**Evidence.** `tests/unit/youtube.test.ts` (link parsing and the embed URL) and `tests/integration/youtube.test.ts` (14 tests: constraints, one source per class, publication, freeze, clone, and Amber completing a YouTube class at exactly 90% through `record_progress`). Run against PostgreSQL 17.10 with all 24 migrations and the fixture seed on stubbed Supabase `auth`/`storage` schemas, with the database clock at 2026-09-16 so the fixture offerings are open: 406 of 408 integration tests pass; the two failures are environmental (no publishable/service keys in the environment; the test runner's clock differs from the database's) and fail identically without M29. The player and editor were exercised in Chromium against a scripted stand-in for the IFrame Player API, because YouTube is not reachable from the build environment. **Not yet done:** playback of a real YouTube video in the deployed app, and the e2e suite, which needs Supabase Auth.
