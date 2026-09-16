# Forty learners at once — what was measured

AC-059: *"Given realistic 40 synthetic learners with seeded program, exercise
concurrent dashboard/progress and report reads. No lost acknowledged
updates/isolation failures; measure p95 data operation < 1s and dashboard usable
< 3s on stated network; report failures instead of assuming pass."*

The measurement is `scripts/load-40.mjs`. This document says what it does, what
it does not do, and what the run produced. The numbers themselves are in
`tests/evaluation/load-40.json`, written by the script rather than typed here,
so they cannot drift from what was actually observed.

## What is real about it

**Forty real identities.** Each synthetic learner is an Auth account with a
profile, a membership, a cohort place and an enrollment on the seeded
programme — created before the run and deleted after it.

**Forty real sessions.** Each learner holds their own database connection with
their own JWT claim and the `authenticated` role, so every call is subject to
row-level security exactly as a browser's would be. A load test that ran as the
service role would be measuring a system nobody uses.

**Real operations, in the proportions learning has.** Per learner per round:
`get_me`, `list_my_enrollments`, `get_enrollment`, `get_learning_class`, and a
heartbeat once playback has started — reads outnumbering writes. Meanwhile a
manager runs `report_enrollments` and `list_cohort_members` on every round,
which is the contention AC-059 is actually about: the report reads what forty
people are writing.

**Honest heartbeats.** Each one claims exactly the wall-clock time since its
predecessor, at rate 1. The server's plausibility bound is real, and a script
that claimed fifteen seconds of media every half second would be measuring
rejections rather than throughput.

## What it does not claim

**The network is stated, not ideal.** This machine to the hosted Supabase
project over the public internet. The deployed application sits in the same
region as its database, so these numbers are conservative rather than
flattering — every one includes an internet round trip the real thing does not
pay.

**The dashboard number is a page, not a data operation**, and it has its own
target (3s). It is measured over HTTP in a real signed-in session, during the
load rather than after it. If there is no server running or no cached session,
the script reports the dashboard as **NOT MEASURED** — never as passing. A
number that was not taken is not a number.

**Forty is the number in the scenario, not a ceiling.** Nothing here establishes
what happens at four hundred.

## No lost acknowledged updates

This is the part that matters more than the timings, and it is checked rather
than assumed. Every heartbeat the server answered `accepted` is counted, and
after the run the database is asked directly — as a third party to both sides of
that conversation — whether the coverage it holds accounts for all of them. A
learner who was told their progress was saved and finds it missing is the defect
AC-059 exists to catch, and it would be reported as a failure of the run even if
every latency target were met.

## What the first measurement got wrong, and what it found

The first version gave every learner a **database backend of their own** — forty
direct connections — and fired five reads back to back with no pause. It failed
badly: p95 between 7 and 14 seconds, `report_enrollments` at 32s, and heartbeats
refused because a round had taken longer than the thirty seconds a single
heartbeat may claim.

Two of those three were the measurement's fault. Forty people learning do not
issue five queries each with no think time, and — more importantly — **the
application does not open a backend per user**. It speaks to PostgREST over
HTTPS, which multiplexes onto a small pool. Forty direct backends on a
free-tier instance is a connection-count experiment, not a load test.

The third was a real finding, and it is the one worth carrying forward: on this
instance, the connection model dominates everything else. The single-learner
baseline was 116–257ms p50 in both runs; only the direct-backend version
collapsed under concurrency. **Anything in the pilot that opens a connection per
user — a background worker, a migration tool, a reporting script left running —
will do to the platform what that run did.**

## The run

Measured 2026-09-16, 40 learners, 12 rounds, 984 calls, 61s wall, over HTTPS
from this machine to the hosted development project.

| Operation | Calls | p50 | **p95** | max |
| --- | --- | --- | --- | --- |
| get_enrollment | 128 | 163 | **359** | 651 |
| get_learning_class | 112 | 164 | **378** | 494 |
| get_me | 116 | 176 | **410** | 549 |
| list_cohort_members | 12 | 170 | **245** | 245 |
| list_my_enrollments | 124 | 200 | **465** | 661 |
| record_progress | 440 | 156 | **221** | 456 |
| report_enrollments | 12 | 186 | **302** | 302 |
| start_playback | 40 | 192 | **382** | 470 |

Baseline, one learner, nothing else running: 155–187ms p50, 194–254ms p95 (one
1350ms outlier on the first `get_me` of the process — a cold connection).

Dashboard `/learn`, signed in, measured **during** the load: p95 **1208ms**.

- Every data operation is inside the 1s p95 target, with the slowest at 465ms.
- The dashboard is inside its 3s target, at 1.2s.
- **No failed calls.**
- **No lost acknowledged updates**: every heartbeat the server acknowledged is
  accounted for in the coverage the database holds.

The load adds roughly 50–250ms at p95 over the single-learner baseline. That is
queuing, not saturation: the median barely moves.

Two things this does not say. It does not say the pilot instance will behave
this way — that is a different project on a different plan, and the run should
be repeated there before onboarding. And it does not say anything about four
hundred learners.

The raw numbers are in `tests/evaluation/load-40.json`, written by the script
rather than typed here. The script exits non-zero when a target is missed, so
"it passed" is not a matter of interpretation.

To repeat it:

```bash
npm run build && npm run start &        # the dashboard needs a server
npx playwright test tests/e2e/auth.spec.ts --project=desktop-1440  # refresh the cached session
node scripts/load-40.mjs              # through PostgREST, as the app connects
node scripts/load-40.mjs --pg         # a backend per learner, for comparison
node scripts/load-40.mjs --clean      # remove the synthetic learners
```

It refuses to run against anything but the designated development project, for
the same reason `db:reset:test` does: it creates and deletes accounts.
