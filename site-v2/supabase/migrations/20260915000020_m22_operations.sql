-- T22 — operations status, redacted.
--
-- spec/04 /admin/operations: "Notification status/recipient/attempts/error, job
-- last success/counts/errors. No raw message body/auth links; unknown/uncertain
-- send gives reconciliation instruction; missing model/email configuration
-- clearly shown."
--
-- AC-051 is the test that matters here: "Failed invitation with action link in
-- private outbox payload. Admin opens operations, inspect logs/browser bundle.
-- Status available; signed link/cookie/key/prompt/response body absent."
--
-- The outbox's payload column may hold a new-user Auth action link. The
-- OperationStatus DTO has no payload field at all, and these handlers select
-- columns explicitly rather than returning the row — so the link cannot reach
-- a screen, a log line or a browser bundle by being forgotten about.

-- p_payload in the handlers below: app.notification_outbox has a `payload`
-- column, and a parameter of that name makes every reference to it ambiguous.
CREATE FUNCTION app.operation_status_json(o app.notification_outbox)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', o.id,
    'kind', o.kind,
    'status', o.status,
    'recipient_email', o.recipient_email,
    'attempts', o.attempts,
    'created_at', o.created_at,
    -- last_error is our own short description, never the provider's body.
    'last_error', o.last_error);
$$;

CREATE FUNCTION app.handle_list_notifications(actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE page_limit integer;
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  page_limit := LEAST(GREATEST(COALESCE((p_payload ->> 'limit')::integer, 20), 1), 100);

  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(app.operation_status_json(o) ORDER BY o.created_at DESC)
        FROM (SELECT * FROM app.notification_outbox ORDER BY created_at DESC LIMIT page_limit) o
    ), '[]'::jsonb),
    'next_cursor', NULL);
END $$;

/*
 * Retrying a send.
 *
 * spec/03 is careful here: "Verified definitive rejection can be failed; a
 * deliberate fresh resend creates a linked audited new event only after outcome
 * review." So a retry of a FAILED message is allowed — somebody has looked at
 * it — and a retry of an UNCERTAIN one is not, because nobody yet knows
 * whether it arrived, and sending again could be the second copy.
 */
CREATE FUNCTION app.handle_retry_notification(actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.notification_outbox; replay jsonb; t timestamptz;
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  t := now();

  SELECT * INTO o FROM app.notification_outbox
   WHERE id = (p_payload ->> 'notification_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  replay := app.idempotency_lookup(actor, 'retry_notification', p_payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  IF o.status = 'uncertain' THEN
    -- The reconciliation instruction, as an error rather than a silent resend.
    RAISE EXCEPTION 'this message has no confirmed outcome and must be reconciled with the provider first'
      USING ERRCODE = 'PGL46';
  END IF;
  IF o.status NOT IN ('failed', 'suppressed') THEN
    RAISE EXCEPTION 'only a failed or suppressed message can be retried' USING ERRCODE = '23514';
  END IF;

  UPDATE app.notification_outbox
     SET status = 'pending', scheduled_at = t, attempts = 0,
         first_attempt_at = NULL, claimed_until = NULL, last_error = NULL
   WHERE id = o.id RETURNING * INTO o;

  INSERT INTO app.audit_events(actor_id, action, entity_id, metadata)
  VALUES (actor, 'retry_notification', o.id,
          jsonb_build_object('kind', o.kind, 'previous_status', 'failed'));

  RETURN app.idempotency_store(actor, 'retry_notification', p_payload,
                               app.operation_status_json(o));
END $$;

/*
 * Job runs, in the same shape. The DTO is shared, so `recipient_email` is null
 * for a job and `last_error` carries its error code.
 */
CREATE FUNCTION app.handle_list_jobs(actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE page_limit integer;
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  page_limit := LEAST(GREATEST(COALESCE((p_payload ->> 'limit')::integer, 20), 1), 100);

  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', j.id, 'kind', j.kind, 'status', j.status,
               'recipient_email', NULL, 'attempts', 0,
               'created_at', j.started_at, 'last_error', j.error_code)
             ORDER BY j.started_at DESC)
        FROM (SELECT * FROM app.job_runs ORDER BY started_at DESC LIMIT page_limit) j
    ), '[]'::jsonb),
    'next_cursor', NULL);
END $$;

/* Recording a scheduler run, so /admin/operations can show its last success. */
CREATE FUNCTION app.job_record(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE run app.job_runs;
BEGIN
  INSERT INTO app.job_runs(kind, started_at, finished_at, status, counts, error_code)
  VALUES (COALESCE(p_payload ->> 'kind', 'reminders'),
          COALESCE((p_payload ->> 'started_at')::timestamptz, now()),
          COALESCE((p_payload ->> 'finished_at')::timestamptz, now()),
          COALESCE(p_payload ->> 'status', 'completed'),
          COALESCE(p_payload -> 'counts', '{}'::jsonb),
          p_payload ->> 'error_code')
  RETURNING * INTO run;
  RETURN jsonb_build_object('id', run.id);
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
    ELSE
      -- Retention at T28.
      RAISE EXCEPTION 'job handler not implemented: %', job USING ERRCODE = '0A000';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.pglearn_job(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pglearn_rpc(action text, payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; allow_pending boolean;
BEGIN
  actor := auth.uid();
  IF actor IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object' USING ERRCODE = '22023';
  END IF;
  allow_pending := app.action_allows_pending_onboarding(action);
  IF NOT app.actor_active(actor, allow_pending) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  CASE action
    WHEN 'get_me' THEN RETURN app.handle_get_me(actor, payload);
    WHEN 'update_me' THEN RETURN app.handle_update_me(actor, payload);
    WHEN 'get_invitation' THEN RETURN app.handle_get_invitation(actor, payload);
    WHEN 'accept_invitation' THEN RETURN app.handle_accept_invitation(actor, payload);
    WHEN 'list_organizations' THEN RETURN app.handle_list_organizations(actor, payload);
    WHEN 'create_organization' THEN RETURN app.handle_create_organization(actor, payload);
    WHEN 'update_organization' THEN RETURN app.handle_update_organization(actor, payload);
    WHEN 'update_membership' THEN RETURN app.handle_update_membership(actor, payload);
    WHEN 'create_invitation' THEN RETURN app.handle_create_invitation(actor, payload);
    WHEN 'resend_invitation' THEN RETURN app.handle_resend_invitation(actor, payload);
    WHEN 'list_cohorts' THEN RETURN app.handle_list_cohorts(actor, payload);
    WHEN 'create_cohort' THEN RETURN app.handle_create_cohort(actor, payload);
    WHEN 'update_cohort' THEN RETURN app.handle_update_cohort(actor, payload);
    WHEN 'list_cohort_members' THEN RETURN app.handle_list_cohort_members(actor, payload);
    WHEN 'add_cohort_members' THEN RETURN app.handle_add_cohort_members(actor, payload);
    WHEN 'remove_cohort_member' THEN RETURN app.handle_remove_cohort_member(actor, payload);
    WHEN 'list_grants' THEN RETURN app.handle_list_grants(actor, payload);
    WHEN 'create_grant' THEN RETURN app.handle_create_grant(actor, payload);
    WHEN 'update_grant' THEN RETURN app.handle_update_grant(actor, payload);
    WHEN 'list_programs' THEN RETURN app.handle_list_programs(actor, payload);
    WHEN 'create_program' THEN RETURN app.handle_create_program(actor, payload);
    WHEN 'update_program' THEN RETURN app.handle_update_program(actor, payload);
    WHEN 'get_version' THEN RETURN app.handle_get_version(actor, payload);
    WHEN 'update_version' THEN RETURN app.handle_update_version(actor, payload);
    WHEN 'create_module' THEN RETURN app.handle_create_module(actor, payload);
    WHEN 'update_module' THEN RETURN app.handle_update_module(actor, payload);
    WHEN 'create_class' THEN RETURN app.handle_create_class(actor, payload);
    WHEN 'update_class' THEN RETURN app.handle_update_class(actor, payload);
    WHEN 'delete_class' THEN RETURN app.handle_delete_class(actor, payload);
    WHEN 'put_exercise' THEN RETURN app.handle_put_exercise(actor, payload);
    WHEN 'delete_exercise' THEN RETURN app.handle_delete_exercise(actor, payload);
    WHEN 'reorder_content' THEN RETURN app.handle_reorder_content(actor, payload);
    WHEN 'authorize_upload' THEN RETURN app.handle_authorize_upload(actor, payload);
    WHEN 'finalize_upload' THEN RETURN app.handle_finalize_upload(actor, payload);
    WHEN 'authorize_download' THEN RETURN app.handle_authorize_download(actor, payload);
    WHEN 'publish_version' THEN RETURN app.handle_publish_version(actor, payload);
    WHEN 'list_offerings' THEN RETURN app.handle_list_offerings(actor, payload);
    WHEN 'create_offering' THEN RETURN app.handle_create_offering(actor, payload);
    WHEN 'update_offering' THEN RETURN app.handle_update_offering(actor, payload);
    WHEN 'enroll_cohort' THEN RETURN app.handle_enroll_cohort(actor, payload);
    WHEN 'enroll_personal' THEN RETURN app.handle_enroll_personal(actor, payload);
    WHEN 'update_enrollment' THEN RETURN app.handle_update_enrollment(actor, payload);
    WHEN 'list_my_enrollments' THEN RETURN app.handle_list_my_enrollments(actor, payload);
    WHEN 'get_enrollment' THEN RETURN app.handle_get_enrollment(actor, payload);
    WHEN 'get_learning_class' THEN RETURN app.handle_get_learning_class(actor, payload);
    WHEN 'start_playback' THEN RETURN app.handle_start_playback(actor, payload);
    WHEN 'record_progress' THEN RETURN app.handle_record_progress(actor, payload);
    WHEN 'complete_text' THEN RETURN app.handle_complete_text(actor, payload);
    WHEN 'complete_exercise' THEN RETURN app.handle_complete_exercise(actor, payload);
    WHEN 'get_exercise_completion' THEN RETURN app.handle_get_exercise_completion(actor, payload);
    WHEN 'get_certificate' THEN RETURN app.handle_get_certificate(actor, payload);
    WHEN 'get_certificate_pdf' THEN RETURN app.handle_get_certificate_pdf(actor, payload);
    WHEN 'revoke_certificate' THEN RETURN app.handle_revoke_certificate(actor, payload);
    WHEN 'report_enrollments' THEN RETURN app.handle_report_enrollments(actor, payload);
    WHEN 'export_enrollments' THEN RETURN app.handle_export_enrollments(actor, payload);
    WHEN 'ask_tutor' THEN RETURN app.handle_ask_tutor(actor, payload);
    WHEN 'get_tutor_request' THEN RETURN app.handle_get_tutor_request(actor, payload);
    WHEN 'list_tutor_history' THEN RETURN app.handle_list_tutor_history(actor, payload);
    WHEN 'list_notifications' THEN RETURN app.handle_list_notifications(actor, payload);
    WHEN 'retry_notification' THEN RETURN app.handle_retry_notification(actor, payload);
    WHEN 'list_jobs' THEN RETURN app.handle_list_jobs(actor, payload);
    ELSE RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.pglearn_rpc(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pglearn_rpc(text, jsonb) TO authenticated;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig); END LOOP;
END $$;
