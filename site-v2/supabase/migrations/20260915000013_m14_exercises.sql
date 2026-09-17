-- T14 — short-response exercise completion.
--
-- spec/03: "Normalize exercise text to NFC and trim Unicode whitespace in
-- application and handler-equivalent validation. Count Unicode code points
-- consistently with PostgreSQL char_length, not JavaScript UTF-16 string
-- length. Allow 1–2,000, confirmation=true. First successful response is
-- final/read-only in v1. Retry with same request ID/body returns it; another
-- different response after completion is 409 EXERCISE_ALREADY_COMPLETED.
-- Failure rolls back response/completion together. No grades and no managers
-- reading responses."

/*
 * The same normalisation lib/exercise.ts performs, so the two cannot disagree
 * about whether a response is 2,000 characters. normalize(…, NFC) composes;
 * btrim with an explicit class removes the Unicode whitespace that a plain
 * btrim (spaces only) would leave behind.
 */
CREATE FUNCTION app.unicode_whitespace()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- Every character Unicode calls whitespace, which is what lib/exercise.ts
  -- matches with \p{White_Space}. Written as chr() codes rather than escapes
  -- so the list is readable and the literal carries no escaping rules:
  -- tab, LF, VT, FF, CR, space, NEL, NBSP, Ogham space, en/em quad through
  -- hair space, line and paragraph separator, narrow NBSP, medium
  -- mathematical space, ideographic space, and the zero-width no-break space.
  SELECT string_agg(chr(code), '')
    FROM unnest(ARRAY[9,10,11,12,13,32,133,160,5760,8192,8193,8194,8195,8196,
                      8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279]) AS code;
$$;

CREATE FUNCTION app.normalize_response(raw text)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT btrim(normalize(raw, NFC), app.unicode_whitespace());
$$;

CREATE FUNCTION app.exercise_saved_json(ec app.exercise_completions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'exercise_id', ec.exercise_id,
    'response', ec.response,
    'confirmed_at', ec.confirmed_at);
$$;

/*
 * complete_exercise.
 *
 * The response and the completion are the same row, so "failure rolls back
 * response/completion together" is structural rather than something this has
 * to coordinate: either the INSERT lands or nothing does, and the settle call
 * that follows is in the same transaction.
 */
CREATE FUNCTION app.handle_complete_exercise(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; ex app.exercises; c app.classes; existing app.exercise_completions;
        response text; availability text; replay jsonb; t timestamptz;
BEGIN
  t := now();

  SELECT * INTO e FROM app.enrollments
   WHERE id = (payload ->> 'enrollment_id')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT app.owns_enrollment(actor, e.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  -- The exercise must belong to a class of the version this enrollment is
  -- pinned to. AC-032's "cross-context request denied": an exercise from
  -- another program, or another version, is simply not there.
  -- Aliased x, not ex: the record variable is already called ex and Postgres
  -- resolves the name to the variable, making every column reference ambiguous.
  SELECT x.* INTO ex FROM app.exercises x
    JOIN app.classes cl ON cl.id = x.class_id
   WHERE x.id = (payload ->> 'exercise_id')::uuid AND cl.version_id = e.version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM app.classes WHERE id = ex.class_id;

  replay := app.idempotency_lookup(actor, 'complete_exercise', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  availability := app.enrollment_availability(actor, e.id, t);
  IF availability <> 'available' THEN
    RAISE EXCEPTION 'access unavailable: %', availability USING ERRCODE = 'PGL22', DETAIL = availability;
  END IF;

  IF (payload ->> 'confirmed') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'confirmation is required' USING ERRCODE = '22023';
  END IF;
  response := app.normalize_response(payload ->> 'response');
  IF response IS NULL OR char_length(response) < 1 OR char_length(response) > 2000 THEN
    RAISE EXCEPTION 'a response must be 1 to 2000 characters' USING ERRCODE = '22023';
  END IF;

  /*
   * "First successful response is final/read-only in v1." A second, different
   * response is refused; an identical one is treated as the retry it almost
   * certainly is, and answers with what was already saved.
   */
  SELECT * INTO existing FROM app.exercise_completions
   WHERE enrollment_id = e.id AND exercise_id = ex.id;
  IF FOUND THEN
    IF existing.response <> response THEN
      RAISE EXCEPTION 'this exercise is already completed' USING ERRCODE = 'PGL40';
    END IF;
    RETURN app.idempotency_store(actor, 'complete_exercise', payload, jsonb_build_object(
      'accepted', true, 'reason', NULL, 'progress', app.progress_json(e, c)));
  END IF;

  INSERT INTO app.exercise_completions(enrollment_id, exercise_id, response, confirmed_at)
  VALUES (e.id, ex.id, response, t);

  UPDATE app.enrollments
     SET started_at = COALESCE(started_at, t), last_activity_at = t, last_class_id = c.id
   WHERE id = e.id;

  /*
   * "Exercise completion can precede media/text completion: save response and
   * confirmation, but keep class incomplete until both parts pass." The helper
   * decides that, and is the same one the heartbeat calls — so whichever half
   * arrives second completes the class, and neither has its own opinion.
   */
  PERFORM app.settle_completion(e.id, c.id, t);

  SELECT * INTO e FROM app.enrollments WHERE id = e.id;
  RETURN app.idempotency_store(actor, 'complete_exercise', payload, jsonb_build_object(
    'accepted', true, 'reason', NULL, 'progress', app.progress_json(e, c)));
END $$;

/*
 * get_exercise_completion. The learner's own saved response, read-only.
 * "No grades and no managers reading responses" — owns_enrollment is the only
 * way in, so a manager asking for this gets the same 404 a stranger does.
 */
CREATE FUNCTION app.handle_get_exercise_completion(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; ec app.exercise_completions;
BEGIN
  SELECT * INTO e FROM app.enrollments WHERE id = (payload ->> 'enrollment_id')::uuid;
  IF NOT FOUND OR NOT app.owns_enrollment(actor, e.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.* INTO ec FROM app.exercise_completions c
    JOIN app.exercises x ON x.id = c.exercise_id
    JOIN app.classes cl ON cl.id = x.class_id
   WHERE c.enrollment_id = e.id AND c.exercise_id = (payload ->> 'exercise_id')::uuid
     AND cl.version_id = e.version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  RETURN app.exercise_saved_json(ec);
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
    WHEN 'complete_exercise' THEN RETURN app.handle_complete_exercise(actor, payload);
    WHEN 'get_exercise_completion' THEN RETURN app.handle_get_exercise_completion(actor, payload);
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
