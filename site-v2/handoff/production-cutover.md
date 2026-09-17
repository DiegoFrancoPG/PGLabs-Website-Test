# PGLearn production cutover

The procedure for putting PGLearn on the internet for the first time. It assumes nothing exists yet
except the code in this repository and the development Supabase project, which is **not** what
production will run against.

> ## ⚠ TEMPORARY — revert before the pilot
>
> `vercel.json` currently schedules the reminder job **daily at `0 18 * * *`**, not hourly. This was
> done on 16 September 2026 so the demo could deploy on a Vercel **Hobby** team, where an hourly
> expression fails deployment outright.
>
> **The cost, which is not cosmetic.** `m20_reminders.sql` only sends between 09:00 and 17:59 *local*
> time (`local_hour BETWEEN 9 AND 17`). An hourly job sweeps every timezone as it crosses that
> window; one daily run only reaches learners whose local hour is 9–17 at that instant. 18:00 UTC is
> 11:00 Pacific, chosen for Vancouver-based demo learners. **Anyone outside roughly UTC-9 to UTC+0
> gets no reminders at all**, and on Hobby the run can land anywhere inside the named hour.
>
> **Revert to `0 * * * *` when the team moves to Pro.** Until then the reminder coverage in this
> deployment does not match what the specification describes.

Four decisions were taken on 16 September 2026 and everything below follows from them:

| Decision | Choice |
| --- | --- |
| Database | A **new** Supabase project on a plan with daily backups: **`ojekiwjlgyxwcqmgtltv`**, created empty on 16 September 2026. `kviqthksrpyyrduoiupg` stays the disposable development project. |
| Hosting | **Vercel** — `vercel.json` declares the two cron jobs and they need a platform scheduler. |
| Stage | **`APP_ENV=pilot`** for the first deployment. |
| Scope | site-v2 serves **both** the PG Labs marketing site and PGLearn, from one deployment. |

`APP_ENV=pilot` is not a softer mode. Fixtures are forbidden, providers are real, and
`db:reset:test` refuses the target outright. The only thing it changes is what the environment is
called and what an operator should expect of it.

---

## Part 0 — Inputs that must exist before anything is deployed

Six of these are outside this repository and nobody can proceed without them.

1. **A Supabase project on a paid plan.** Two reasons, both hard blockers rather than preferences:
   - *Backups.* AC-058 (restore rehearsal) cannot be performed on a plan with no daily backups.
   - *Upload size.* A bucket's file size limit cannot exceed the project's **global** upload limit,
     which the free plan caps at 50 MiB. spec/03 supports 1 GiB video. This was measured, not
     assumed: `npm run provision:storage` against the development project fails with
     `The object exceeded the maximum allowed size`, which is the plan refusing the bucket write.
     A nine-video series will not fit under 50 MiB per file.
2. **A Vercel account on a paid team plan** with the repository connected. This is not a
   preference. Vercel's Hobby plan restricts cron jobs to *once per day* and *"expressions that run
   more frequently will fail deployment"* — and `vercel.json` declares the reminder job at
   `0 * * * *`. On Hobby the deployment does not merely lose its reminders, it does not deploy.
   Hobby also fires a daily cron anywhere inside the named hour, so reminder send-time would be
   non-deterministic even if the schedule were reduced.
3. **The domain**, and the decision of which host serves the apex. Deploying site-v2 replaces
   whatever serves the marketing site today; that is Part 6.
4. **`RESEND_API_KEY`, `EMAIL_FROM` and a verified sender domain.** Without these no invitation and
   no reminder is delivered, so no learner can be onboarded. Everything around sending —
   scheduling, claiming, retries, webhook verification, reconciliation — is already implemented and
   tested; only the credential is missing.
5. **`OPENAI_API_KEY`** if the course tutor is part of the pilot. Without it the tutor reports
   `NOT_CONFIGURED` on `/admin/operations` and the rest of the platform is unaffected — this is the
   one input the pilot can genuinely open without.
6. **The certificate issuer string.** Defaults to `PGLearn`; the open question from T00 is whether
   it should read `PG Labs` or `PGLearn by PG Labs`. It is snapshotted onto every certificate at
   issue, so certificates issued before it is corrected keep the old string.

Also needed, and generated rather than obtained: **`CRON_SECRET`**, a high-entropy random string —
`openssl rand -hex 32`. The application now refuses to boot in `pilot` or `production` without it,
because a deployment missing it fails *silently*: both job routes reject the scheduler, reminders
stop being sent and retention stops deleting, while every screen keeps working normally.

---

## Part 1 — Create and migrate the production database

### Production credentials never go in .env.local

`.env.local` is the **development** file, and `scripts/db-reset-test.mjs` reads its
`PGLEARN_DEV_PROJECT_REF` to decide which database it is allowed to destroy. Pointing it at
production would put the production URL in the one file a destructive command consults. Keep them
apart: put them in `.env.production.local` (already covered by `.gitignore`'s `.env.*.local`) and
run operator commands with Node's env-file flag, which takes precedence over `.env.local`:

```bash
node --env-file=.env.production.local scripts/provision-storage.mjs
node --env-file=.env.production.local scripts/bootstrap-admin.mjs <email>
```

That file needs `APP_ENV=pilot`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_PASSWORD`.
It must never contain `PGLEARN_DEV_PROJECT_REF`.

```bash
# 1. The project is ojekiwjlgyxwcqmgtltv, created empty. Confirm its plan
#    allows daily backups and a 1 GiB global upload limit before going further.

# 2. Raise the global upload limit:
#    Dashboard -> Settings -> Storage -> Upload file size limit -> 1 GiB.
#    Do this BEFORE Part 2 or the bucket write is refused.

# 3. Apply every migration. This is `db push`, NOT `db:reset:test` — the reset
#    script refuses a pilot or production target by design, and must keep doing so.
cd site-v2
supabase link --project-ref ojekiwjlgyxwcqmgtltv
supabase db push
```

`supabase db push` applies M01–M28 in order and is additive; it never drops. Confirm afterwards that
schema `app` holds 32 tables and that it is **not** in the Data API's exposed schemas — that second
property is what AC-003 protects, and a new project may need it checked rather than assumed
(Dashboard → Settings → API → Exposed schemas must list `public` only).

Do **not** run `db:seed:generate`, `db:seed:auth` or any fixture command against this project. Those
scripts refuse anything but `development`/`test`, and that refusal is the guard, not an obstacle.

## Part 2 — Provision storage

```bash
node --env-file=.env.production.local scripts/provision-storage.mjs
```

It creates `pglearn-private` as a **private** bucket with a 1 GiB limit, and is idempotent — run it
again any time to confirm the settings are still right. It applies privacy and the size limit as two
separate writes, so a plan that refuses the limit can never leave the bucket public. If it reports
the size limit was refused, Part 0 item 1 has not been done.

## Part 3 — Configure Supabase Auth

Auth sends its own action links for password setup and recovery, and they are rejected unless the
destination is allow-listed.

- **Site URL**: the production origin, e.g. `https://learn.example.org`.
- **Redirect URLs**: at minimum `https://<origin>/auth/callback` — `forgot-password` sends
  `/auth/callback?next=/set-password`, so the callback path must be permitted.
- **Disable public sign-up.** ADR-05 requires it, and nothing in the UI offers it. An open sign-up
  endpoint on the Auth side would let someone create an account the application never intended to
  exist.

## Part 4 — Configure Vercel

Link the repository, set the root to `site-v2`, and set these environment variables on the
**Production** environment. Every one of them is server-side except the two `NEXT_PUBLIC_` values.

| Variable | Value |
| --- | --- |
| `APP_ENV` | `pilot` |
| `NEXT_PUBLIC_APP_URL` | the production origin, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | the new project's URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the new project's publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | the new project's secret key — **never** `NEXT_PUBLIC_` |
| `CRON_SECRET` | the generated random string |
| `RESEND_API_KEY`, `EMAIL_FROM` | from the verified sender |
| `RESEND_WEBHOOK_SECRET` | from the Resend webhook, once Part 5 creates it |
| `OPENAI_API_KEY` | if the tutor is in scope |
| `CERTIFICATE_ISSUER` | the confirmed string |

`NEXT_PUBLIC_APP_URL` is not cosmetic. Mutations check the request's `Origin` against it (AC-064),
and invitation emails build their links from it, so a wrong value produces rejected writes and dead
links in real mail.

Do **not** set `PGLEARN_USE_FIXTURES` or `EMAIL_TEST_ALLOWLIST`. The first is refused at boot in
pilot; the second exists so a development database full of `example.invalid` addresses cannot
become real mail, and on a pilot the recipients are meant to be real.

Deploy. `instrumentation.ts` validates the environment at boot, so a missing or malformed variable
fails the deployment rather than a learner's first request.

## Part 5 — Wire the webhook and the schedule

- **Resend webhook** → `https://<origin>/api/v1/webhooks/email`. Take the signing secret it issues
  and set it as `RESEND_WEBHOOK_SECRET`, then redeploy. Delivery events are Svix-signed and an
  unverified payload is rejected.
- **Crons** are declared in `vercel.json` and register themselves on deploy:
  `/api/v1/jobs/reminders` hourly, `/api/v1/jobs/retention` at 03:15 daily.

  There is no separate place to configure the scheduler's secret. Vercel recognises an environment
  variable named exactly `CRON_SECRET` and *"the value of the variable will be automatically sent as
  an `Authorization` header when Vercel invokes your cron job"*. Setting it in Part 4 is the whole
  of it.

  Vercel's own guidance is that cron delivery is best-effort — an invocation can be missed, and the
  same scheduled run can fire twice. Both jobs are already built for that: reminders claim their
  rows and hold a daily cap, and retention deletes on each row's own timestamp under one clock, so a
  second run finds nothing left to do rather than doing it twice.

## Part 6 — DNS and the marketing site

Point the domain at the Vercel deployment. This is the step that makes the change public, and it
replaces whatever serves the PG Labs marketing site today — the seven marketing routes and
`/learning` go live with the platform in the same deployment.

Before the DNS change, open the Vercel preview URL and read the marketing pages as a visitor would.
`/learning`'s copy was written by Claude against the specification and **has never been reviewed by
anyone at PG Labs**. It is accurate but it is your marketing voice, not ours; T01's handoff flagged
it and it is still outstanding.

## Part 7 — Create the first administrator

There is no HTTP path to becoming an administrator, deliberately. The account must already exist and
have completed password setup.

```bash
# 1. Invite the account through the Supabase Auth dashboard and complete password setup in the app.
# 2. Then, with the production environment configured:
node scripts/bootstrap-admin.mjs <email>
```

It creates no account, sets no password, prints only the user id, and is idempotent. It needs a
direct database connection (`SUPABASE_DB_URL` or `SUPABASE_DB_PASSWORD`) because schema `app` is not
reachable over the Data API even with the service key — that is the boundary working correctly.

---

## Verification, in the order that catches the most

1. `GET /api/v1/health` → 200. It reports status and version only; it deliberately does not probe
   the database, so a 200 here proves the deployment booted, nothing more.
2. Sign in as the administrator. `/admin/operations` should show email and tutor as **configured**;
   whatever it reports there is what the deployment actually has.
3. `curl -i https://<origin>/api/v1/jobs/reminders` with no header → **401**. Then wait for the hour
   and confirm the run appears in `/admin/operations`. An unauthenticated 200 here would be a
   critical defect; a 401 that never becomes a scheduled run means `CRON_SECRET` differs between
   Vercel's cron configuration and the environment.
4. Invite one real person at PG Labs and have them accept. This is the first real outbound email the
   system has ever sent and it exercises Resend, the sender verification, the Auth link, the
   callback allow-list and `NEXT_PUBLIC_APP_URL` in one action. Confirm the delivery event arrives
   through the webhook.
5. Upload one real video with its captions, publish it, and play it to completion as a learner.
   This is the check that closes AC-017, AC-052 and part of AC-054 — all three are blocked today
   only because no real media has ever been through the system.

## Rollback

DNS is the switch. Repointing the domain restores the previous site; the Vercel deployment can also
be rolled back to the prior build from the dashboard. Neither undoes a database migration, and
nothing here needs one to be undone — `db push` is additive.

The asymmetry to respect: the deployment is disposable and the database is not. Once a real person
has accepted an invitation, the production project holds data that exists nowhere else, and it stays
that way until the first backup has been taken **and** restored somewhere (AC-058). Until that
rehearsal has actually been performed, treat the window between the first real learner and the first
verified restore as the riskiest period of the pilot.

---

## What is still open after all of this

The pilot gate is **OPEN on the software** — no critical scenario is outstanding and every passing
scenario carries evidence. Seven conditions remain, and none is a defect; each is an input the
software cannot supply itself. Cutting over does not settle them:

| Scenario | Settled by |
| --- | --- |
| AC-017, AC-052, AC-061 | The nine real videos with transcripts and captions, through the real upload path |
| AC-042 | `OPENAI_API_KEY`, then re-running the tutor injection evaluation |
| AC-054 | The demo rehearsed end to end with email and tutor live |
| AC-053 | An assistive-technology pass over the UI states |
| AC-058 | A backup restored into a disposable project, ending with a class that actually plays |
| AC-060 | A manager following `handoff/manager-runbook.md` end to end on pilot data |

**A real cohort is not onboarded until they are settled.** Deploying is not the same as opening, and
the gate exists precisely to keep those two events from being confused.
