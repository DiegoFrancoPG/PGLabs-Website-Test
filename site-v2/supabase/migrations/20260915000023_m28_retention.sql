-- T28 — retention.
--
-- spec/05: "Retention job: purge expired auth links, chats >30 days, raw
-- learning events/idempotency >30 days, rate windows >35 days, non-text tutor
-- usage >180 days. Preserve normalized class_progress, exercises, certificates
-- and training history. Delete tutor requests before sessions; preserve ledger
-- without request FK."
--
-- AC-057: "Chat >30 days, current month usage, raw progress events → run
-- retention job → expired text/links removed; progress/certificates remain;
-- durable no-text usage ledger preserves monthly accounting."
--
-- The job is written as one statement per rule, in an order the foreign keys
-- allow, and it counts what it deleted. Two things it is NOT allowed to be:
--
--   - clever. A retention job that computed which rows to keep would be a
--     second definition of what the product remembers, competing with the one
--     in spec/05. Each rule here is one DELETE with one condition.
--
--   - approximate. It deletes on the row's OWN timestamp, never on a parent's,
--     so a learner who was active yesterday does not lose last year's events
--     and a dormant one does not keep them.
--
-- What survives is the point of the whole thing: class_progress,
-- exercise_completions, certificates and enrollments are never touched by any
-- statement here. A learner's record of what they did is not raw data.

CREATE FUNCTION app.job_retention_run(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  -- A single clock for the whole run: a job that read now() per statement
  -- could keep a row in one rule and delete it in the next.
  as_of timestamptz := COALESCE((p_payload ->> 'now')::timestamptz, now());
  -- NOT named `counts`: app.job_runs has a column of that name, and the UPDATE
  -- at the end would be ambiguous. Six bugs in this codebase have been a
  -- variable named after a neighbouring column; see HANDOFF.
  tally jsonb := '{}'::jsonb;
  n bigint;
  run_id uuid;
BEGIN
  INSERT INTO app.job_runs(kind, started_at, status)
  VALUES ('retention', as_of, 'running') RETURNING id INTO run_id;

  /*
   * Chats older than 30 days. Requests before sessions, as spec/05 says: the
   * request holds the question and the answer — the text — and the session
   * holds nothing but a timestamp.
   */
  DELETE FROM app.tutor_requests WHERE created_at < as_of - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  tally := tally || jsonb_build_object('tutor_requests', n);

  /*
   * A session goes once it is empty AND old. Emptiness alone is not enough:
   * a session opened a minute ago has no requests yet, and deleting it would
   * lose the chat somebody is in the middle of.
   */
  DELETE FROM app.tutor_sessions s
   WHERE s.updated_at < as_of - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM app.tutor_requests r WHERE r.session_id = s.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  tally := tally || jsonb_build_object('tutor_sessions', n);

  /*
   * The ledger is NOT touched at thirty days. spec/05: "Ledger survives chat
   * deletion to preserve month-end spend accounting" — which is why
   * tutor_usage.request_id has no foreign key to tutor_requests, and why the
   * deletion above cannot cascade into the month's accounting. It carries ids,
   * a month and numbers; it never carried text.
   */
  DELETE FROM app.tutor_usage WHERE created_at < as_of - interval '180 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  tally := tally || jsonb_build_object('tutor_usage', n);

  /*
   * Raw progress events. spec/05 has already said what must remain true after
   * this: "If a progress event was purged after 30 days, closed/superseded
   * session and monotonic progress still prevent duplicate completion." The
   * normalized class_progress row is the record; the event was the evidence of
   * one delivery of it.
   */
  DELETE FROM app.learning_events WHERE received_at < as_of - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  tally := tally || jsonb_build_object('learning_events', n);

  DELETE FROM app.idempotency_records WHERE created_at < as_of - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  tally := tally || jsonb_build_object('idempotency_records', n);

  -- 35 days, not 30: a window is keyed by its start, and the limits that read
  -- it look back over a period of their own.
  DELETE FROM app.rate_windows WHERE window_start < as_of - interval '35 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  tally := tally || jsonb_build_object('rate_windows', n);

  /*
   * "Purge expired auth links."
   *
   * This implementation never puts one in the outbox — the invitation email
   * links to our own application and the Auth action link is created and sent
   * by Auth itself — so on this database the statement below has nothing to
   * find. It runs anyway, because spec/05 permits the outbox to hold such a
   * link "temporarily" and a retention job that only purges what today's code
   * writes would silently stop covering tomorrow's.
   *
   * The payload is stripped rather than the row deleted: the outbox row is the
   * delivery record, and AC-050 depends on it being there.
   */
  UPDATE app.notification_outbox
     SET payload = payload - 'action_link' - 'token' - 'hashed_token' - 'otp' - 'email_otp'
   WHERE (payload ?| ARRAY['action_link', 'token', 'hashed_token', 'otp', 'email_otp'])
     AND (status IN ('accepted', 'delivered', 'failed', 'suppressed')
          OR created_at < as_of - interval '24 hours');
  GET DIAGNOSTICS n = ROW_COUNT;
  tally := tally || jsonb_build_object('purged_links', n);

  /*
   * Webhook receipts are a deduplication ledger, not a record of anything a
   * person did. Thirty days is longer than any provider retries.
   */
  DELETE FROM app.email_webhook_events WHERE received_at < as_of - interval '30 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  tally := tally || jsonb_build_object('email_webhook_events', n);

  UPDATE app.job_runs
     SET finished_at = now(), status = 'completed', counts = tally
   WHERE id = run_id;

  RETURN jsonb_build_object('run_id', run_id, 'counts', tally);
END $$;

CREATE OR REPLACE FUNCTION public.pglearn_job(job text, payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF NOT app.job_allowed(job) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  CASE job
    WHEN 'tutor.finish' THEN RETURN app.job_tutor_finish(payload);
    WHEN 'tutor.reap' THEN RETURN app.job_tutor_reap(payload);
    WHEN 'reminders.plan' THEN RETURN app.job_reminders_plan(payload);
    WHEN 'reminders.claim' THEN RETURN app.job_reminders_claim(payload);
    WHEN 'reminders.finish' THEN RETURN app.job_reminders_finish(payload);
    WHEN 'reminders.recover' THEN RETURN app.job_reminders_recover(payload);
    WHEN 'email.event' THEN RETURN app.job_email_event(payload);
    WHEN 'email.reconcile' THEN RETURN app.job_email_reconcile(payload);
    WHEN 'jobs.record' THEN RETURN app.job_record(payload);
    WHEN 'clone.finish' THEN
      RETURN app.job_clone_finish((payload ->> 'actor')::uuid, payload);
    WHEN 'retention.run' THEN RETURN app.job_retention_run(payload);
    ELSE
      RAISE EXCEPTION 'job handler not implemented: %', job USING ERRCODE = '0A000';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.pglearn_job(text, jsonb) FROM PUBLIC, anon, authenticated;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig); END LOOP;
END $$;
