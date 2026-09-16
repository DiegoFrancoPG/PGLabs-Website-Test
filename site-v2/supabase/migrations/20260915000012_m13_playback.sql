-- T13 — durable playback, text progress and resume.
--
-- spec/03 §4 is implemented here step for step. The comments quote it so a
-- reader can check each rule against the sentence that requires it.

-- ---------------------------------------------------------------------------
-- The Progress DTO from contracts/api.json, computed from current state.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.progress_json(e app.enrollments, c app.classes)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cp app.class_progress; ex app.exercises; coverage bigint; response_exists boolean;
        required_total integer; required_done integer; cert uuid;
BEGIN
  SELECT * INTO cp FROM app.class_progress WHERE enrollment_id = e.id AND class_id = c.id;
  SELECT * INTO ex FROM app.exercises WHERE class_id = c.id;

  SELECT COALESCE(sum(upper(x) - lower(x)), 0) INTO coverage
    FROM unnest(COALESCE(cp.played_ranges, '{}'::int8multirange)) AS x;
  -- Capped by the media length, per spec/03 step 4.
  coverage := LEAST(coverage, COALESCE(c.duration_ms, coverage));

  response_exists := ex.id IS NOT NULL AND EXISTS (
    SELECT 1 FROM app.exercise_completions ec
    WHERE ec.enrollment_id = e.id AND ec.exercise_id = ex.id);

  SELECT count(*) FILTER (WHERE cl.required),
         count(*) FILTER (WHERE cl.required AND p.completed_at IS NOT NULL)
    INTO required_total, required_done
    FROM app.classes cl
    LEFT JOIN app.class_progress p ON p.enrollment_id = e.id AND p.class_id = cl.id
   WHERE cl.version_id = e.version_id;

  SELECT cr.id INTO cert FROM app.certificates cr WHERE cr.enrollment_id = e.id;

  RETURN jsonb_build_object(
    'class_id', c.id,
    'position_ms', COALESCE(cp.position_ms, 0),
    'coverage_ms', coverage,
    'content_complete', cp.content_completed_at IS NOT NULL,
    'exercise_complete', response_exists,
    'class_complete', cp.completed_at IS NOT NULL,
    'required_completed', required_done,
    'required_total', GREATEST(required_total, 1),
    'certificate_id', cert);
END $$;

-- ---------------------------------------------------------------------------
-- Steps 6 and 7: completion, run inside whichever transaction earned it.
--
-- "When content criterion first passes, set content_completed_at. If no
-- exercise or a saved exercise completion exists, set class completed_at.
-- Preserve existing timestamps. Recompute completed required classes on the
-- pinned version. If all required classes complete, set enrollment
-- completed_at once and insert certificate snapshot ON CONFLICT enrollment DO
-- NOTHING. Include certificate notification outbox record in the transaction."
--
-- Also the "Atomic class/program completion helper" T13's ledger entry names,
-- reused by T14's exercise completion so both paths cannot disagree.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.settle_completion(enrollment uuid, class uuid, t timestamptz)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; cp app.class_progress; has_exercise boolean; exercise_done boolean;
        all_required_done boolean; p app.programs; v app.program_versions; prof app.profiles;
        cert app.certificates;
BEGIN
  SELECT * INTO e FROM app.enrollments WHERE id = enrollment FOR UPDATE;
  SELECT * INTO cp FROM app.class_progress WHERE enrollment_id = enrollment AND class_id = class;

  -- Class completion needs BOTH parts where an exercise exists (ADR-08).
  SELECT EXISTS (SELECT 1 FROM app.exercises WHERE class_id = class) INTO has_exercise;
  exercise_done := NOT has_exercise OR EXISTS (
    SELECT 1 FROM app.exercise_completions ec
    JOIN app.exercises ex ON ex.id = ec.exercise_id
    WHERE ec.enrollment_id = enrollment AND ex.class_id = class);

  IF cp.content_completed_at IS NOT NULL AND exercise_done AND cp.completed_at IS NULL THEN
    -- Timestamps only ever move null -> value; the M02 trigger enforces it too.
    UPDATE app.class_progress SET completed_at = t
     WHERE enrollment_id = enrollment AND class_id = class;
  END IF;

  -- Step 7. Over REQUIRED classes only.
  SELECT bool_and(pr.completed_at IS NOT NULL) INTO all_required_done
    FROM app.classes cl
    LEFT JOIN app.class_progress pr ON pr.enrollment_id = enrollment AND pr.class_id = cl.id
   WHERE cl.version_id = e.version_id AND cl.required;

  IF COALESCE(all_required_done, false) AND e.completed_at IS NULL THEN
    UPDATE app.enrollments SET completed_at = t, last_activity_at = t WHERE id = enrollment;

    SELECT * INTO p FROM app.programs WHERE id = e.program_id;
    SELECT * INTO v FROM app.program_versions WHERE id = e.version_id;
    SELECT * INTO prof FROM app.profiles WHERE id = e.user_id;

    -- A snapshot: the learner's name and the program title AS THEY WERE, so a
    -- later rename cannot alter what was earned. ON CONFLICT keeps it to one.
    INSERT INTO app.certificates(enrollment_id, learner_name, program_title, version_number,
                                 issuer, completed_at)
    VALUES (enrollment, prof.display_name, p.title, v.version_number,
            COALESCE(NULLIF(current_setting('app.certificate_issuer', true), ''), 'PGLearn'), t)
    ON CONFLICT (enrollment_id) DO NOTHING
    RETURNING * INTO cert;

    -- The certificate email, queued in the same transaction (spec/03 step 7).
    -- Sending it is T21; a crash after this point loses nothing.
    IF cert.id IS NOT NULL THEN
      INSERT INTO app.notification_outbox(user_id, enrollment_id, kind, event_key,
                                          recipient_email, payload, scheduled_at)
      VALUES (e.user_id, enrollment, 'certificate', 'certificate:' || cert.id::text,
              prof.email, jsonb_build_object('certificate_id', cert.id), t)
      ON CONFLICT (event_key) DO NOTHING;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- start_playback
--
-- "validates can_learn and media class version. Lock enrollment, close its old
-- open playback session, increment resume_generation, create new session and
-- record last_class_id. This supersedes an older browser tab/device. Return
-- current saved position and class status. Starting a session alone does not
-- count as learning activity."
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.handle_start_playback(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; c app.classes; s app.playback_sessions; availability text;
        position bigint; replay jsonb;
BEGIN
  SELECT * INTO e FROM app.enrollments
   WHERE id = (payload ->> 'enrollment_id')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT app.owns_enrollment(actor, e.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  -- A retried start (same Idempotency-Key) must hand back the SAME session,
  -- or the retry would supersede the session the first attempt just opened.
  replay := app.idempotency_lookup(actor, 'start_playback', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  SELECT * INTO c FROM app.classes
   WHERE id = (payload ->> 'class_id')::uuid AND version_id = e.version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF c.kind = 'text' THEN
    RAISE EXCEPTION 'a text class has no playback' USING ERRCODE = '22023';
  END IF;

  availability := app.enrollment_availability(actor, e.id, now());
  IF availability <> 'available' THEN
    RAISE EXCEPTION 'access unavailable: %', availability USING ERRCODE = 'PGL22', DETAIL = availability;
  END IF;

  -- One open session per enrollment: the partial unique index in M01 enforces
  -- it, and closing the old one first is what supersedes the other tab.
  UPDATE app.playback_sessions SET closed_at = now()
   WHERE enrollment_id = e.id AND closed_at IS NULL;

  UPDATE app.enrollments
     SET resume_generation = resume_generation + 1, last_class_id = c.id
   WHERE id = e.id RETURNING * INTO e;

  INSERT INTO app.playback_sessions(enrollment_id, class_id, version_id, generation)
  VALUES (e.id, c.id, e.version_id, e.resume_generation)
  RETURNING * INTO s;

  SELECT cp.position_ms INTO position FROM app.class_progress cp
   WHERE cp.enrollment_id = e.id AND cp.class_id = c.id;

  RETURN app.idempotency_store(actor, 'start_playback', payload, jsonb_build_object(
    'session_id', s.id,
    'generation', s.generation,
    'position_ms', COALESCE(position, 0),
    'next_sequence', 1));
END $$;

-- ---------------------------------------------------------------------------
-- record_progress: the heartbeat transaction, steps 1 to 7.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.handle_record_progress(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; c app.classes; s app.playback_sessions; known app.learning_events;
        event uuid; seq integer; position bigint; elapsed integer; rate numeric;
        istart bigint; iend bigint; ilen bigint; limit_ms bigint; since_ms bigint; t timestamptz;
        canonical jsonb; coverage bigint; availability text; accepted_interval boolean := false;
BEGIN
  t := now();
  event := (payload ->> 'event_id')::uuid;

  -- Step 1: identity, access, and exact associations.
  SELECT * INTO e FROM app.enrollments
   WHERE id = (payload ->> 'enrollment_id')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT app.owns_enrollment(actor, e.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO c FROM app.classes
   WHERE id = (payload ->> 'class_id')::uuid AND version_id = e.version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  -- "If known event_id belongs to another enrollment, return 404; same ID with
  -- changed payload returns 409. A known same event replay returns current
  -- canonical progress without new activity."
  SELECT * INTO known FROM app.learning_events WHERE id = event;
  IF FOUND THEN
    IF known.enrollment_id <> e.id THEN
      RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
    END IF;
    canonical := app.canonical_heartbeat(payload);
    IF known.payload <> canonical THEN
      RAISE EXCEPTION 'event reused with a different body' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('accepted', true, 'reason', NULL,
                              'progress', app.progress_json(e, c));
  END IF;

  -- AC-023: access is checked on every heartbeat, so a revoked grant stops
  -- writes at the next one while what was already recorded stays.
  availability := app.enrollment_availability(actor, e.id, t);
  IF availability <> 'available' THEN
    RAISE EXCEPTION 'access unavailable: %', availability USING ERRCODE = 'PGL22', DETAIL = availability;
  END IF;

  -- Step 2: lock the session. Closed or superseded is 409 SESSION_SUPERSEDED.
  SELECT * INTO s FROM app.playback_sessions
   WHERE id = (payload ->> 'session_id')::uuid AND enrollment_id = e.id AND class_id = c.id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF s.closed_at IS NOT NULL OR s.generation <> e.resume_generation THEN
    RAISE EXCEPTION 'session superseded' USING ERRCODE = 'PGL28';
  END IF;

  seq := (payload ->> 'sequence')::integer;
  IF seq IS NULL OR seq < 1 THEN
    RAISE EXCEPTION 'sequence must start at 1' USING ERRCODE = '22023';
  END IF;
  -- "Sequence <= last_sequence with new event ID returns accepted=false,
  -- reason=stale_sequence and current progress; makes no state change."
  IF seq <= s.last_sequence THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'stale_sequence',
                              'progress', app.progress_json(e, c));
  END IF;

  -- Field validation.
  position := (payload ->> 'position_ms')::bigint;
  elapsed := (payload ->> 'elapsed_ms')::integer;
  rate := (payload ->> 'rate')::numeric;
  IF position IS NULL OR position < 0 OR position > c.duration_ms THEN
    RAISE EXCEPTION 'position is outside the media' USING ERRCODE = 'PGL29';
  END IF;
  IF elapsed IS NULL OR elapsed < 0 OR elapsed > 30000 THEN
    RAISE EXCEPTION 'elapsed time is outside the allowed range' USING ERRCODE = 'PGL29';
  END IF;
  IF rate IS NULL OR rate < 0.5 OR rate > 2 THEN
    RAISE EXCEPTION 'rate must be between 0.5 and 2' USING ERRCODE = 'PGL29';
  END IF;

  IF payload -> 'interval' IS NOT NULL AND jsonb_typeof(payload -> 'interval') = 'object' THEN
    istart := (payload #>> '{interval,start_ms}')::bigint;
    iend := (payload #>> '{interval,end_ms}')::bigint;
    IF istart IS NULL OR iend IS NULL OR istart < 0 OR iend > c.duration_ms OR iend <= istart THEN
      RAISE EXCEPTION 'interval is outside the media or empty' USING ERRCODE = 'PGL29';
    END IF;
    ilen := iend - istart;
    IF ilen > 0 AND elapsed <= 0 THEN
      RAISE EXCEPTION 'a played interval needs elapsed time' USING ERRCODE = 'PGL29';
    END IF;

    -- Step 3: the plausibility bound. Same formula as lib/progress.ts.
    since_ms := GREATEST(0, (EXTRACT(EPOCH FROM (t - s.last_received_at)) * 1000)::bigint);
    limit_ms := LEAST(floor(LEAST(elapsed, since_ms + 2000) * rate)::bigint + 1000, 60000);
    IF ilen > limit_ms THEN
      RAISE EXCEPTION 'interval of %ms exceeds what %ms of playback could cover', ilen, elapsed
        USING ERRCODE = 'PGL29';
    END IF;

    -- Step 4: union into the multirange, which normalises overlaps itself.
    INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges, position_ms, updated_at)
    VALUES (e.id, c.id, e.version_id, int8multirange(int8range(istart, iend)), position, t)
    ON CONFLICT (enrollment_id, class_id) DO UPDATE
      SET played_ranges = app.class_progress.played_ranges + int8multirange(int8range(istart, iend)),
          position_ms = position, updated_at = t;
    accepted_interval := true;
  ELSE
    -- "If no interval, only save position."
    INSERT INTO app.class_progress(enrollment_id, class_id, version_id, position_ms, updated_at)
    VALUES (e.id, c.id, e.version_id, position, t)
    ON CONFLICT (enrollment_id, class_id) DO UPDATE SET position_ms = position, updated_at = t;
  END IF;

  -- Step 5: record the event; only this newer session advances the pointer.
  INSERT INTO app.learning_events(id, enrollment_id, class_id, version_id, session_id, sequence, kind, payload)
  VALUES (event, e.id, c.id, e.version_id, s.id, seq, 'heartbeat', app.canonical_heartbeat(payload));
  UPDATE app.playback_sessions SET last_sequence = seq, last_received_at = t WHERE id = s.id;

  -- "A positive accepted played interval sets started_at if absent and
  -- last_activity_at=server_now. Pure zero-interval position saves do not."
  IF accepted_interval THEN
    UPDATE app.enrollments
       SET started_at = COALESCE(started_at, t), last_activity_at = t, last_class_id = c.id
     WHERE id = e.id;

    -- Step 6: "coverage*100 >= duration_ms*90 using integer arithmetic".
    SELECT LEAST(COALESCE(sum(upper(x) - lower(x)), 0), c.duration_ms) INTO coverage
      FROM app.class_progress cp, unnest(cp.played_ranges) AS x
     WHERE cp.enrollment_id = e.id AND cp.class_id = c.id;
    IF coverage * 100 >= c.duration_ms * 90 THEN
      UPDATE app.class_progress SET content_completed_at = COALESCE(content_completed_at, t)
       WHERE enrollment_id = e.id AND class_id = c.id;
      PERFORM app.settle_completion(e.id, c.id, t);
    END IF;
  END IF;

  SELECT * INTO e FROM app.enrollments WHERE id = e.id;
  RETURN jsonb_build_object('accepted', true, 'reason', NULL,
                            'progress', app.progress_json(e, c));
END $$;

/* The stored form of a heartbeat, for replay comparison: fields only, no ids. */
CREATE FUNCTION app.canonical_heartbeat(payload jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'session_id', payload ->> 'session_id',
    'sequence', (payload ->> 'sequence')::integer,
    'position_ms', (payload ->> 'position_ms')::bigint,
    'elapsed_ms', (payload ->> 'elapsed_ms')::integer,
    'rate', (payload ->> 'rate')::numeric,
    'interval', payload -> 'interval');
$$;

-- ---------------------------------------------------------------------------
-- complete_text
--
-- "Text completion uses event_id, validates text class, sets
-- content_completed_at and follows steps 6-7. Class view/read alone never
-- completes text."
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.handle_complete_text(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; c app.classes; known app.learning_events; event uuid;
        t timestamptz; availability text;
BEGIN
  t := now();
  event := (payload ->> 'event_id')::uuid;
  IF event IS NULL THEN RAISE EXCEPTION 'event_id is required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO e FROM app.enrollments
   WHERE id = (payload ->> 'enrollment_id')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT app.owns_enrollment(actor, e.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO c FROM app.classes
   WHERE id = (payload ->> 'class_id')::uuid AND version_id = e.version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF c.kind <> 'text' THEN
    RAISE EXCEPTION 'only a text class is completed explicitly' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO known FROM app.learning_events WHERE id = event;
  IF FOUND THEN
    IF known.enrollment_id <> e.id THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
    RETURN jsonb_build_object('accepted', true, 'reason', NULL, 'progress', app.progress_json(e, c));
  END IF;

  availability := app.enrollment_availability(actor, e.id, t);
  IF availability <> 'available' THEN
    RAISE EXCEPTION 'access unavailable: %', availability USING ERRCODE = 'PGL22', DETAIL = availability;
  END IF;

  INSERT INTO app.class_progress(enrollment_id, class_id, version_id, content_completed_at, updated_at)
  VALUES (e.id, c.id, e.version_id, t, t)
  ON CONFLICT (enrollment_id, class_id) DO UPDATE
    SET content_completed_at = COALESCE(app.class_progress.content_completed_at, t), updated_at = t;

  INSERT INTO app.learning_events(id, enrollment_id, class_id, version_id, kind, payload)
  VALUES (event, e.id, c.id, e.version_id, 'text_complete', '{}'::jsonb);

  UPDATE app.enrollments
     SET started_at = COALESCE(started_at, t), last_activity_at = t, last_class_id = c.id
   WHERE id = e.id;

  PERFORM app.settle_completion(e.id, c.id, t);

  SELECT * INTO e FROM app.enrollments WHERE id = e.id;
  RETURN jsonb_build_object('accepted', true, 'reason', NULL, 'progress', app.progress_json(e, c));
END $$;

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

