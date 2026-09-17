# Backup and restore runbook

AC-058: *"Given a disposable test target and database/asset backups, restore and
verify learner record and referenced media. Acknowledged progress/certificate
recover and asset bytes exist; documented RPO ≤ 24h and recovery steps
measured."*

spec/05: *"Backup target before pilot: database RPO ≤ 24h and restore within one
business day; separately back up source assets. Verify restore in a disposable
test project, not over the pilot."*

This document is the procedure. **AC-058 is not passed by this document** — it
is passed by performing the rehearsal below and recording the measured times in
`tests/acceptance.json`. What is missing to do that is named at the end.

## What has to be backed up, and why it is two things

**The database** holds enrollments, `class_progress`, `exercise_completions`,
certificates and the tutor ledger — everything a learner would have to redo.

**Storage** holds the class media: the objects under `versions/…` and the
derived caption tracks under `playback/…`. The database rows point at storage
keys; they do not contain the bytes.

Restoring one without the other produces a site that looks intact and cannot
play a class, or a bucket of files nothing references. They are backed up
separately because Supabase backs them up separately, and they must be restored
together.

## Recovery objectives

| | Target | Where it comes from |
|---|---|---|
| Database RPO | ≤ 24 hours | spec/05 |
| Database RTO | within one business day | spec/05 |
| Asset RPO | ≤ 24 hours | spec/05, "separately back up source assets" |

Supabase's daily physical backup satisfies a 24-hour RPO on a paid plan.
Point-in-time recovery, where the plan includes it, reduces the RPO to minutes
and is worth enabling for the pilot; the objective above is what must hold
without it.

## Before the pilot: taking the backups

1. **Database.** Confirm in the Supabase dashboard (Database → Backups) that
   daily backups are on and that at least one has completed. Note the retention
   window the plan gives.
2. **Assets.** Storage is not covered by the database backup. Copy the bucket
   to a second location on a daily schedule:

   ```bash
   # Requires the service role key in the environment; never in a shell history
   # file, never in a repository, never pasted into a chat.
   supabase storage cp -r "ss:///${SUPABASE_STORAGE_BUCKET}" \
     "./backup/$(date -u +%Y-%m-%d)" --experimental
   ```

   Anything with versioned, dated copies will do. What matters is that the copy
   is **not in the same project**: a project deleted by accident takes its
   buckets with it.
3. Record where both backups live, and who can reach them, in the operations
   notes the pilot hands over.

## The rehearsal (this is what AC-058 asks for)

Run it in a **disposable project**. spec/02 and spec/05 both forbid rehearsing
over the pilot, and `scripts/db-reset-test.mjs` refuses any target that is not
the designated development project for the same reason.

1. **Create the target.** A new Supabase project, named so nobody mistakes it
   for the pilot — `pglearn-restore-rehearsal-<date>`. Start the clock.
2. **Restore the database.** Restore the most recent daily backup into it
   (Supabase dashboard → Backups → Restore to new project, or `pg_restore` of a
   downloaded dump into the new project's connection string).
3. **Restore the assets.** Copy the asset backup into the new project's bucket,
   preserving keys exactly. A key that changes breaks every `assets.storage_key`
   in the database at once.
4. **Point a local application at it.** A `.env.local` with the rehearsal
   project's URL and keys. Nothing about the application changes.
5. **Verify a learner's record end to end**, as the scenario requires:
   - sign in as a learner who had progress before the backup;
   - the dashboard shows the same programme at the same percentage;
   - a class they completed still reads as complete, and their exercise
     response is still there, read-only;
   - a certificate they had earned still renders as a PDF;
   - a class with media **plays** — this is the step that proves the asset
     restore, and the one that fails if only the database was restored.
6. **Stop the clock.** Record the elapsed time from step 1. It must be inside
   one business day, and it is the number AC-058 asks to have measured rather
   than asserted.
7. **Delete the rehearsal project.** It holds a copy of real learner data.

## Recording the result

In `tests/acceptance.json`, AC-058 moves to `passed` with evidence naming: the
backup timestamp restored, the measured elapsed time, the learner and
certificate verified, and the class whose media played. A rehearsal that was not
measured is not evidence.

## What is missing to run it today

- A Supabase plan with daily backups on the pilot project. The development
  project used through T02–T28 is on the free plan, which has none.
- Authorisation to create and then delete a second project, and somewhere
  agreed to keep the asset copy.
- Real class media. The rehearsal's step 5 verifies that asset bytes survive,
  and the only media in the system today is synthetic (AC-017, AC-052).

Until those exist, AC-058 stays **blocked**, with this runbook as the procedure
it is blocked on performing rather than on writing.
