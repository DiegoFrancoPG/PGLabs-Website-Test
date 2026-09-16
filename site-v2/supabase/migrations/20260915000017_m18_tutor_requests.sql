-- T18 — tutor requests, budget reservation and history.
--
-- spec/05: "Use Idempotency-Key as tutor request ID. In authenticated
-- reservation transaction: validate body/session ownership/class version and
-- quotas; create session if null; take a per-user lock and a monthly budget
-- lock, create pending tutor request and usage reservation. Same key/body
-- completed returns stored answer; pending returns 409 and GET request URL;
-- failed returns recorded failure until user explicitly starts a new request.
-- Different body same key=409. No duplicate provider call on refresh/retry.
--
-- Limits: 3 new questions/minute, 30/day per user (UTC), one in-flight request
-- per user, and configured project monthly budget. … Reserve under DB lock
-- against actual costs + unresolved reservations in UTC month. On successful
-- response settle actual usage; timeout/unknown usage retains reservation.
-- Never release unknown usage simply because frontend disconnected."

CREATE FUNCTION app.tutor_answer_json(r app.tutor_requests, enrollment uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'request_id', r.id,
    'session_id', r.session_id,
    'status', r.status,
    'answer', r.answer,
    'mode', r.mode,
    'error_code', r.error_code,
    'question', r.question,
    'class_id', r.class_id,
    -- Citations are rebuilt from OUR ids every time they are read. The href is
    -- composed here from the enrollment and the chunk's class, so a link can
    -- only ever point at a class this learner is enrolled in (spec/05).
    'citations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'source_id', ch.id,
               'class_id', ch.class_id,
               'title', cl.title,
               'href', '/learn/' || enrollment::text || '/classes/' || ch.class_id::text)
             ORDER BY cl.position, ch.ordinal)
        FROM jsonb_array_elements_text(r.citations) AS cited(id)
        JOIN app.content_chunks ch ON ch.id = cited.id::uuid
        JOIN app.classes cl ON cl.id = ch.class_id), '[]'::jsonb));
$$;

/*
 * Rate limiting over app.rate_windows: a fixed window per scope, keyed by user.
 * Returns false when the window is full. Polling never calls this — spec/05:
 * "Polling reads never consume question quota."
 */
-- p_scope / p_window, not scope / window_start: a parameter named after a
-- column makes every reference to that column ambiguous inside the statement.
CREATE FUNCTION app.tutor_take_slot(actor uuid, p_scope text, p_window timestamptz, allowed integer)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE used integer;
BEGIN
  INSERT INTO app.rate_windows AS rw (scope, key, window_start, count)
  VALUES (p_scope, actor::text, p_window, 1)
  ON CONFLICT (scope, key, window_start) DO UPDATE
    SET count = rw.count + 1
  RETURNING rw.count INTO used;
  RETURN used <= allowed;
END $$;

/*
 * ask_tutor — the reservation transaction.
 *
 * It does NOT call the model: a database transaction must not wait on a
 * network round trip, and the whole point of reserving first is that the spend
 * is recorded before the call rather than after it. The application performs
 * the call and then settles through pglearn_job('tutor.finish').
 *
 * Returns either a finished request (a replay) or a reservation carrying the
 * retrieval context the application needs to build the prompt.
 */
CREATE FUNCTION app.handle_ask_tutor(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  request_id uuid; existing app.tutor_requests; e app.enrollments; c app.classes;
  session uuid; question text; intent text; t timestamptz; period date;
  reserved numeric(10,6); spent numeric(10,6); budget numeric(10,6);
  context jsonb; input_bound integer; in_flight integer;
BEGIN
  t := now();
  period := date_trunc('month', t AT TIME ZONE 'UTC')::date;

  -- "Use Idempotency-Key as tutor request ID."
  request_id := (payload ->> 'request_id')::uuid;
  IF request_id IS NULL THEN
    RAISE EXCEPTION 'a request id is required' USING ERRCODE = '22023';
  END IF;

  question := btrim(payload ->> 'question');
  intent := payload ->> 'intent';
  IF question IS NULL OR char_length(question) < 1 OR char_length(question) > 2000 THEN
    RAISE EXCEPTION 'a question must be 1 to 2000 characters' USING ERRCODE = '22023';
  END IF;
  IF intent IS NULL OR intent NOT IN ('explanation', 'example') THEN
    RAISE EXCEPTION 'intent must be explanation or example' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO e FROM app.enrollments WHERE id = (payload ->> 'enrollment_id')::uuid;
  IF NOT FOUND OR NOT app.owns_enrollment(actor, e.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  /*
   * The replay rules, before any quota is consumed. A refresh or a retry must
   * never call the provider twice, and must never spend a question.
   */
  SELECT * INTO existing FROM app.tutor_requests WHERE id = request_id;
  IF FOUND THEN
    -- "Different body same key=409."
    IF existing.question <> question OR existing.class_id <> (payload ->> 'class_id')::uuid
       OR existing.intent <> intent THEN
      RAISE EXCEPTION 'that request id was used for a different question' USING ERRCODE = '23505';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM app.tutor_sessions s WHERE s.id = existing.session_id AND s.enrollment_id = e.id
    ) THEN
      RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
    END IF;
    -- "pending returns 409 and GET request URL". Completed and failed are both
    -- returned as they stand; a failed one stays failed until the learner
    -- explicitly asks again with a new key.
    IF existing.status = 'pending' THEN
      RAISE EXCEPTION 'that request is still being answered' USING ERRCODE = 'PGL43';
    END IF;
    RETURN jsonb_build_object('replay', true, 'answer', app.tutor_answer_json(existing, e.id));
  END IF;

  IF NOT app.can_learn(actor, e.id, t) THEN
    RAISE EXCEPTION 'access unavailable' USING ERRCODE = 'PGL22',
      DETAIL = app.enrollment_availability(actor, e.id, t);
  END IF;

  SELECT * INTO c FROM app.classes
   WHERE id = (payload ->> 'class_id')::uuid AND version_id = e.version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  -- The per-user lock. Everything below — the in-flight check, the rate
  -- windows, the budget — is decided under it, so two tabs asking at once
  -- cannot both pass.
  PERFORM pg_advisory_xact_lock(hashtext('pglearn.tutor.user'), hashtext(actor::text));

  -- "one in-flight request per user"
  SELECT count(*) INTO in_flight
    FROM app.tutor_requests r
    JOIN app.tutor_sessions s ON s.id = r.session_id
    JOIN app.enrollments en ON en.id = s.enrollment_id
   WHERE en.user_id = actor AND r.status = 'pending';
  IF in_flight > 0 THEN
    RAISE EXCEPTION 'a question is already being answered' USING ERRCODE = 'PGL43';
  END IF;

  -- "3 new questions/minute, 30/day per user (UTC)"
  IF NOT app.tutor_take_slot(actor, 'tutor.minute', date_trunc('minute', t), 3) THEN
    RAISE EXCEPTION 'too many questions in the last minute' USING ERRCODE = 'PGL44';
  END IF;
  IF NOT app.tutor_take_slot(actor, 'tutor.day', date_trunc('day', t AT TIME ZONE 'UTC'), 30) THEN
    RAISE EXCEPTION 'too many questions today' USING ERRCODE = 'PGL44';
  END IF;

  session := app.tutor_session_for(actor, e.id, (payload ->> 'session_id')::uuid);
  context := app.tutor_context(actor, e.id, c.id, question);

  /*
   * The cost bound. spec/05: "conservative input token upper bound equal to
   * assembled UTF-8 byte count and max output tokens, multiplied by configured
   * rates per million tokens."
   *
   * A byte is not a token — a token is three or four bytes of English — so
   * this deliberately over-estimates. That is the point of a reservation: it
   * must never be smaller than what the call turns out to cost.
   */
  input_bound := COALESCE((payload ->> 'input_bytes')::integer, 24000);
  reserved := round(
    (input_bound::numeric / 1000000) * COALESCE((payload ->> 'input_rate')::numeric, 0.25)
    + (2048::numeric / 1000000) * COALESCE((payload ->> 'output_rate')::numeric, 2.00), 6);

  -- The monthly budget lock, held for the rest of the transaction, so two
  -- requests cannot each see room for the last dollar.
  PERFORM pg_advisory_xact_lock(hashtext('pglearn.tutor.budget'), hashtext(period::text));
  budget := COALESCE((payload ->> 'budget')::numeric, 10);

  -- "against actual costs + unresolved reservations": a settled request counts
  -- what it really cost, an unsettled one counts what it might.
  SELECT COALESCE(sum(COALESCE(u.actual_usd, u.reserved_usd)), 0) INTO spent
    FROM app.tutor_usage u
   WHERE u.period_start = period AND u.outcome <> 'not_invoked';

  IF spent + reserved > budget THEN
    RAISE EXCEPTION 'the tutor budget for this month is exhausted' USING ERRCODE = 'PGL45';
  END IF;

  INSERT INTO app.tutor_requests(id, session_id, class_id, question, intent, status, reserved_usd)
  VALUES (request_id, session, c.id, question, intent, 'pending', reserved);

  INSERT INTO app.tutor_usage(request_id, user_id, period_start, reserved_usd, outcome)
  VALUES (request_id, actor, period, reserved, 'reserved');

  RETURN jsonb_build_object(
    'replay', false,
    'request_id', request_id,
    'session_id', session,
    'reserved_usd', reserved,
    'context', context);
END $$;

/*
 * get_tutor_request. A read: polling it must never send anything or spend
 * anything, which is why the quota is taken in ask_tutor and not here.
 */
CREATE FUNCTION app.handle_get_tutor_request(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
-- A record and a scalar cannot share one INTO, so the enrollment is read
-- separately. The ownership join is what matters and it is on the first query.
DECLARE r app.tutor_requests; enrollment uuid;
BEGIN
  SELECT r2.* INTO r
    FROM app.tutor_requests r2
    JOIN app.tutor_sessions s ON s.id = r2.session_id
    JOIN app.enrollments e ON e.id = s.enrollment_id
   WHERE r2.id = (payload ->> 'request_id')::uuid AND e.user_id = actor;
  IF FOUND THEN
    SELECT s.enrollment_id INTO enrollment
      FROM app.tutor_sessions s WHERE s.id = r.session_id;
  END IF;
  -- A manager asking for a learner's question gets the same answer as a
  -- stranger: spec/05 gives managers no raw chat at all.
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN app.tutor_answer_json(r, enrollment);
END $$;

CREATE FUNCTION app.handle_list_tutor_history(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s app.tutor_sessions; enrollment uuid; page_limit integer;
BEGIN
  SELECT s2.* INTO s
    FROM app.tutor_sessions s2
    JOIN app.enrollments e ON e.id = s2.enrollment_id
   WHERE s2.id = (payload ->> 'session_id')::uuid AND e.user_id = actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  enrollment := s.enrollment_id;

  page_limit := LEAST(GREATEST(COALESCE((payload ->> 'limit')::integer, 20), 1), 100);

  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(app.tutor_answer_json(r, enrollment) ORDER BY r.created_at)
        FROM (SELECT * FROM app.tutor_requests r2
               WHERE r2.session_id = s.id ORDER BY r2.created_at DESC LIMIT page_limit) r), '[]'::jsonb),
    'next_cursor', NULL);
END $$;

-- ---------------------------------------------------------------------------
-- Settlement, through the service-role job dispatcher.
--
-- M04 reserved 'tutor.reserve' and 'tutor.finish' for exactly this. The
-- reservation itself happens in ask_tutor, under the caller's own identity;
-- tutor.finish records what the provider did, and acts only on a request id
-- pglearn_rpc has already authorized.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.job_tutor_finish(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
-- in_tokens / out_tokens, not input_tokens / output_tokens: a variable named
-- after a column makes `SET input_tokens = input_tokens` assign the column to
-- itself, and PL/pgSQL resolves the name to the variable without complaint.
DECLARE r app.tutor_requests; outcome text; actual numeric(10,6); t timestamptz;
        in_tokens integer; out_tokens integer;
BEGIN
  t := now();
  SELECT * INTO r FROM app.tutor_requests
   WHERE id = (payload ->> 'request_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  -- Settling twice must not double-count, and must not overwrite an answer.
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('settled', false); END IF;

  outcome := payload ->> 'outcome';
  in_tokens := (payload ->> 'input_tokens')::integer;
  out_tokens := (payload ->> 'output_tokens')::integer;

  IF outcome = 'completed' THEN
    UPDATE app.tutor_requests
       SET status = 'completed',
           answer = payload ->> 'answer',
           mode = payload ->> 'mode',
           citations = COALESCE(payload -> 'citations', '[]'::jsonb),
           input_tokens = in_tokens,
           output_tokens = out_tokens,
           actual_usd = (payload ->> 'actual_usd')::numeric,
           finished_at = t
     WHERE id = r.id;

    -- "On successful response settle actual usage."
    actual := (payload ->> 'actual_usd')::numeric;
    UPDATE app.tutor_usage
       SET actual_usd = actual, input_tokens = in_tokens,
           output_tokens = out_tokens, outcome = 'settled'
     WHERE request_id = r.id;

  ELSIF outcome = 'not_invoked' THEN
    /*
     * Nothing was sent — an empty corpus, or a refusal to start. The
     * reservation is released because there is no uncertainty about it: the
     * provider was never called.
     */
    UPDATE app.tutor_requests
       SET status = 'completed', answer = payload ->> 'answer', mode = 'unsupported',
           citations = '[]'::jsonb, actual_usd = 0, finished_at = t
     WHERE id = r.id;
    UPDATE app.tutor_usage
       SET actual_usd = 0, outcome = 'not_invoked' WHERE request_id = r.id;

  ELSE
    UPDATE app.tutor_requests
       SET status = 'failed', error_code = COALESCE(payload ->> 'error_code', 'TUTOR_OUTPUT_INVALID'),
           input_tokens = in_tokens, output_tokens = out_tokens, finished_at = t
     WHERE id = r.id;

    /*
     * spec/05: "timeout/unknown usage retains reservation. Never release
     * unknown usage simply because frontend disconnected."
     *
     * A failure after the call was made may still have cost money — the model
     * may have produced tokens we refused to show. Only a failure with KNOWN
     * usage settles; everything else stays reserved as 'uncertain', and the
     * month's budget keeps counting it.
     */
    IF in_tokens IS NOT NULL AND out_tokens IS NOT NULL THEN
      UPDATE app.tutor_usage
         SET actual_usd = (payload ->> 'actual_usd')::numeric, input_tokens = in_tokens,
             output_tokens = out_tokens, outcome = 'settled'
       WHERE request_id = r.id;
    ELSE
      UPDATE app.tutor_usage SET outcome = 'uncertain' WHERE request_id = r.id;
    END IF;
  END IF;

  UPDATE app.tutor_sessions SET updated_at = t WHERE id = r.session_id;
  RETURN jsonb_build_object('settled', true);
END $$;

/*
 * The abandoned-request sweep. spec/05: "At 60 seconds mark abandoned pending
 * request failed/uncertain; do not automatically invoke provider again."
 *
 * A request whose serverless invocation died leaves a pending row that would
 * otherwise block the learner's next question for ever.
 */
CREATE FUNCTION app.job_tutor_reap(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE reaped integer;
BEGIN
  WITH abandoned AS (
    UPDATE app.tutor_requests
       SET status = 'failed', error_code = 'TUTOR_ABANDONED', finished_at = now()
     WHERE status = 'pending'
       AND created_at < now() - COALESCE((payload ->> 'older_than')::interval, interval '60 seconds')
    RETURNING id
  ), kept AS (
    -- The reservation is kept, not released: we do not know whether the
    -- provider was reached.
    UPDATE app.tutor_usage SET outcome = 'uncertain'
     WHERE request_id IN (SELECT id FROM abandoned) AND outcome = 'reserved'
    RETURNING request_id
  )
  SELECT count(*) INTO reaped FROM kept;
  RETURN jsonb_build_object('reaped', reaped);
END $$;

-- M04's allowlist gains the sweep. 'tutor.reserve' stays declared because the
-- reservation is part of ask_tutor rather than a job, and removing a name from
-- a literal allowlist is a wider change than adding one.
CREATE OR REPLACE FUNCTION app.job_allowed(job text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT job IN ('reminders.claim', 'reminders.finish', 'email.event',
                 'retention.run', 'tutor.reserve', 'tutor.finish', 'tutor.reap',
                 'jobs.record');
$$;

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
    ELSE
      -- Reminders at T20, email events at T21, retention at T28.
      RAISE EXCEPTION 'job handler not implemented: %', job USING ERRCODE = '0A000';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.pglearn_job(text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------

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
