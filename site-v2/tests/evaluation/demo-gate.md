# Demo gate — rehearsal record

T25. Rehearsed 16 September 2026 against the hosted development project, at
commit on `pglearn-integration`.

AC-054 requires the journey to work end to end **and** that "mocked-only
features [are] disclosed incomplete". This is that disclosure.

## What was rehearsed, and is real

`tests/e2e/demo-journey.spec.ts` runs the whole journey through the real
interface against the real database. Every step below is genuinely exercised —
no fixture shortcuts, no stubbed responses:

| Step | How | Result |
| --- | --- | --- |
| Author a programme | Created through `/admin/programs`, draft opened, module and class added, body typed | ✅ |
| Publish | Publish button; version becomes read-only | ✅ |
| Grant catalog access | Real grant to Demo Organization A | ✅ |
| Create a cohort | Through `/manage/{org}` | ✅ |
| Add to the roster | Real cohort membership | ✅ |
| Assign with dates | Real offering and enrolment | ✅ |
| Learner finds it | Real sign-in, real dashboard | ✅ |
| Learner completes it | "Mark as complete" on a required class | ✅ |
| Certificate issued | In the completing transaction | ✅ |
| Certificate PDF | Real bytes, `%PDF-`, >2 KB | ✅ |
| Certificate email queued | Row in `notification_outbox`, status `pending` | ✅ queued |
| Manager's report | Shows 100% for the learner | ✅ |
| CSV export | Contains the learner and the programme, and nothing they wrote | ✅ |
| Tutor drawer | Reservation, retrieval, validation, settlement, citations | ✅ path; ⚠️ stubbed model |

## What is NOT real, and what it needs

| Gap | Blocked on | Scenario |
| --- | --- | --- |
| **The tutor's answers** are produced by `lib/tutor/stub.ts` | `OPENAI_API_KEY` | AC-042, AC-061 |
| **No email is actually sent.** Messages are queued, claimed, retried and reconciled; the provider call is the only untested link | `RESEND_API_KEY`, `EMAIL_FROM`, a verified sender | part of AC-054 |
| **No real video or captions.** Every media check has run against synthetic files | the client's nine videos with transcripts and captions | AC-017, AC-052 |
| **The browser upload path** has not run against real storage from a real browser | the same media | AC-052 |
| **The scheduler has no deployed secret** | `CRON_SECRET` in the deployment | operational |

None of these is a defect. Each is a real integration that cannot be exercised
without a credential or an asset that does not exist yet, and each is recorded
as **blocked** rather than passed.

## Three defects the rehearsal found

The journey is worth more than the sum of its parts: each of these passed every
existing test and would have failed in front of the client.

1. **The class editor could not save.** Every mutation route requires an
   `Idempotency-Key`; `ClassEditor`, `ArchiveProgram` and three calls in
   `VersionEditor` sent none. The version editor's helper made the header
   optional, which is how it happened. It no longer can — the helper always
   sends one.

2. **A text class could never be published.** Publication requires source text
   on every class, and nothing set it for a text class, so the "Needs source
   text" badge was permanent and Publish always refused. Saving the body now
   sets both, which is what spec/02's "source text from body/transcript"
   means for a text class.

3. **Assignment was refused every time.** `AssignProgram` sent
   `organization_id` and `program_id`, which `OfferingCreate` does not have —
   the cohort and the grant carry them. The API rejects unknown keys rather
   than ignoring them, so the request failed with a validation error.

All three were in code written at T23 and covered by tests that passed. What
they had in common: the T23 tests exercised *navigation and rendering*, not the
writes. A journey test is what exercises the writes.

## To close the gate

1. Set `OPENAI_API_KEY`, then run the evaluation in
   `tests/evaluation/tutor-synthetic-course.md` and AC-061's twelve questions
   against the real course.
2. Set `RESEND_API_KEY`, `EMAIL_FROM` and `EMAIL_TEST_ALLOWLIST` (so a
   development database of `@example.invalid` addresses cannot become real
   mail), verify the sender, and run one controlled reminder end to end.
3. Upload one real video with its captions and transcript, then run AC-052 at
   390px and at desktop width: play, seek, let the URL expire, and reload to
   confirm the position survives.
4. Set `CRON_SECRET` in the deployment and confirm the hourly schedule fires.
