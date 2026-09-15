# 01 — Decisions and scope

## Confirmed product requirements

PGLearn serves client organizations and individuals. The first client pilot has about 40 staff and one program. Each client has managers, cohorts and negotiated catalog access. No payments now; future payments must be able to create/revoke the same access grants. Programs contain ordered modules and classes supporting video/audio/text. Nine English videos, about ten minutes each, are being prepared with transcripts/captions and must be uploadable. Learners resume, download handouts, submit short exercise responses and self-confirm completion without grading, earn certificates and receive reminders. Managers/admins see scoped metrics and CSV reports. Platform admins author programs. The tutor explains course material and generates practical examples; it takes no actions. The demo build is targeted for 15 September 2026. Keep running costs low.

## Binding implementation defaults

These are engineering/product defaults chosen to make implementation deterministic, not additional claims of user confirmation. Change them centrally if the user steers the product.

| ID | Decision |
|---|---|
| ADR-01 | One Next.js App Router + TypeScript application on Vercel. Node 22 runtime, npm, React and framework-compatible dependencies. At T01 resolve currently supported patched versions, install and commit exact package-lock.json; all subsequent agents reuse it. Do not assume this specification’s date freezes safe patch versions. |
| ADR-02 | Supabase managed PostgreSQL, Auth, private Storage. Supabase Pro is the planned direct-video-upload tier; configuration/purchases are separate from this spec task. No Railway service in the demo. |
| ADR-03 | Application-owned tables in private schema `app`; RLS enabled and no direct anon/authenticated table privileges. User-scoped requests invoke one explicitly whitelisted `public.pglearn_rpc(action text, payload jsonb)` dispatcher with server-derived `auth.uid()`. Each internal handler enforces row ownership/role. Jobs use a separate service-only dispatcher. See security contract; browser-supplied role/user IDs never grant authority. |
| ADR-04 | REST route handlers under `/api/v1`; pages/server rendering call the same feature services. HTTP shapes in OpenAPI are authoritative. No second business implementation in server actions. |
| ADR-05 | Invite-only email/password. Public sign-up disabled. Login session is verified server-side using Supabase `getUser()` for protected requests. Organization membership and grant state are read from current DB state. |
| ADR-06 | Roles: platform admin, organization manager, organization learner. Manager can also enroll. Multi-organization users select a context. Personal enrollment has no organization and is invisible to organization managers. |
| ADR-07 | One program is a catalog item. Draft versions are mutable; published versions are immutable. Enrollments pin versions. Demo editor locks on publish. New-version creation/cloning is pilot work. |
| ADR-08 | Exactly one primary content type per class. Up to one practical exercise per class in v1; if present it is required for that class. Required exercise implies class is required. Course author decides which classes have exercises; development fixtures do not invent the final curriculum. |
| ADR-09 | Media completion requires 90% of unique played timeline coverage. Text completion is explicit. Exercise response is trimmed NFC-normalized text, 1–2,000 Unicode code points, plus confirmation=true. Certificate requires every required class complete. |
| ADR-10 | Due date is soft. Start is inclusive; hard access-end is exclusive. Due is inclusive for on-time completion. Cohort cancellation, inactive membership, revoked/expired grant or hard access-end stops new course requests. Records/certificates remain accessible to their owner. |
| ADR-11 | English UI/content. Working program title “AI Foundations” until supplied. Default issuer “PGLearn”; no accreditation claim. Default organization timezone UTC, explicitly shown/editable rather than inferred from user location. |
| ADR-12 | Email provider Resend for reminders and custom SMTP for account reset. Daily learning reminder per learner, hourly scheduler. Provider idempotency is bounded; uncertain sends older than 23 hours require reconciliation, not blind resend. |
| ADR-13 | OpenAI Responses API adapter is the tutor implementation default; model identifier required via OPENAI_MODEL, default `gpt-5-mini` alias. No pinned deprecated snapshot. Validate access and actual course quality during integration; change the configured model without changing application contracts. Coding-agent model choices are independent. |
| ADR-14 | Tutor generates one structured, validated answer before displaying it. UI shows a pending indicator; token-by-token streaming is deferred to reduce citation/partial-output complexity. This supersedes earlier streaming proposals without removing explanation/example capability. |
| ADR-15 | PostgreSQL English full-text retrieval plus current class context. No embeddings, external web retrieval, autonomous tools, arbitrary file fetch or code execution. |
| ADR-16 | UI: Tailwind CSS, accessible semantic controls, shared form/table primitives; neutral slate with indigo actions and PGLearn text branding. No external design system service. PDF certificates via pdf-lib; validation via Zod; tests via Vitest, Playwright and SQL checks. |
| ADR-17 | No external service is required to validate the specification or run pure unit tests. Real integrations remain explicit test gates. Never default a deployed app to mock data or bypass login because a secret is absent. |

## Repository map

`src/app/` routes/pages; `src/features/{identity,organizations,content,enrollment,learning,certificates,reports,notifications,tutor}/` services and UI; `src/lib/{auth,db,validation,clock,providers}/`; `supabase/migrations/`; `tests/{unit,integration,e2e}/`; `spec/`, `contracts/`, `tasks.json`, `HANDOFF.md` retained from this kit. Do not put app secrets in files shipped to the browser.

## Release scope

**Demo:** T01–T25, every requested feature family, controlled test users, real provider/media checks where assets/credentials are available. A feature with only a mock is explicitly incomplete at the demo gate.

**Pilot:** T26–T30 adds bulk invitations, version cloning, operational recovery/retention, 40-user checks and real manager onboarding. Security/authorization, correct progress, persisted responses and duplicate prevention already belong to the demo.

**Deferred:** payments, public individual signup, SSO, seat limits, grading/assignments, discussion forums, live classes, adaptive video/transcoding, public certificate lookup, multi-language UI, mobile app and agent actions. Billing later owns grant creation; progress and certificates do not depend on billing provider IDs.

## Inputs still needed, without reopening settled decisions

Service credentials/sender domain, actual video/transcript/caption files, final program/class names/exercises/handouts, real organization identity. Build forms/adapters using clearly labeled fixtures while these arrive. Before real staff onboarding, set actual cohort dates/timezone and verify provider data handling and retention with the client. Do not ask again for platform name, video language, exercise grading policy or demo time.
