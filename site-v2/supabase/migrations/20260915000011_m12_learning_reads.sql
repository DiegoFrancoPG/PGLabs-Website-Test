-- T12 — learner dashboard and class reads.
--
-- Every handler here is STABLE, which is not decoration: AC-066 requires that
-- no completion is caused by a GET, and a function Postgres will not let write
-- cannot cause one however it is called. spec/05 says the same of the HTTP
-- layer: "GET reads are side-effect free."

/*
 * spec/02: owners keep access to their own summaries after cancellation,
 * expiry or removal from the organization. So the dashboard lists every
 * enrollment the learner owns and reports WHY each one is unavailable, rather
 * than hiding the ones they can no longer open.
 */
CREATE FUNCTION app.handle_list_my_enrollments(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t timestamptz;
BEGIN
  t := COALESCE(NULLIF(payload ->> 'at', '')::timestamptz, now());
  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(app.enrollment_json(e, actor, t) ORDER BY e.due_at, e.created_at)
      FROM app.enrollments e WHERE e.user_id = actor), '[]'::jsonb),
    'next_cursor', NULL);
END $$;

/*
 * The outline. spec/04: "Outline visible to owner after expiry, with learning
 * actions disabled; unknown/other user gets unavailable."
 *
 * Ownership is the gate, not availability — an expired learner still sees what
 * they did. The availability value travels with it so the interface can disable
 * the actions rather than pretend the course is gone.
 */
CREATE FUNCTION app.handle_get_enrollment(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; t timestamptz;
BEGIN
  t := COALESCE(NULLIF(payload ->> 'at', '')::timestamptz, now());

  SELECT * INTO e FROM app.enrollments WHERE id = (payload ->> 'enrollment_id')::uuid;
  -- Another learner's enrollment is reported as missing, never as forbidden.
  IF NOT FOUND OR NOT app.owns_enrollment(actor, e.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'enrollment', app.enrollment_json(e, actor, t),
    'modules', COALESCE((
      SELECT jsonb_agg(app.module_json(m) ORDER BY m.position)
      FROM app.modules m WHERE m.version_id = e.version_id), '[]'::jsonb),
    'classes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'module_id', c.module_id, 'title', c.title, 'kind', c.kind,
               'position', c.position, 'required', c.required,
               'completed', cp.completed_at IS NOT NULL)
             ORDER BY m.position, c.position)
      FROM app.classes c
      JOIN app.modules m ON m.id = c.module_id
      LEFT JOIN app.class_progress cp ON cp.enrollment_id = e.id AND cp.class_id = c.id
      WHERE c.version_id = e.version_id), '[]'::jsonb));
END $$;

/*
 * A single class, with everything needed to render it.
 *
 * Unlike the outline, this one requires can_learn: the outline is a record of
 * what the learner did, while the class body, its source text and its file
 * references are the content itself. spec/02: "Class body, source text and file
 * URLs require can_learn or admin preview."
 */
CREATE FUNCTION app.handle_get_learning_class(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; c app.classes; cp app.class_progress; ex app.exercises;
        t timestamptz; availability text; required_total integer; required_done integer;
        coverage bigint; response text; cert uuid;
BEGIN
  t := COALESCE(NULLIF(payload ->> 'at', '')::timestamptz, now());

  SELECT * INTO e FROM app.enrollments WHERE id = (payload ->> 'enrollment_id')::uuid;
  IF NOT FOUND OR NOT app.owns_enrollment(actor, e.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  -- The class must belong to the version this enrollment is pinned to.
  SELECT * INTO c FROM app.classes
   WHERE id = (payload ->> 'class_id')::uuid AND version_id = e.version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  availability := app.enrollment_availability(actor, e.id, t);
  IF availability <> 'available' THEN
    -- spec/05: after ownership is established, blocked learning returns
    -- ACCESS_UNAVAILABLE carrying the reason.
    RAISE EXCEPTION 'access unavailable: %', availability USING ERRCODE = 'PGL22', DETAIL = availability;
  END IF;

  SELECT * INTO cp FROM app.class_progress WHERE enrollment_id = e.id AND class_id = c.id;
  SELECT * INTO ex FROM app.exercises WHERE class_id = c.id;

  SELECT COALESCE(sum(upper(x) - lower(x)), 0) INTO coverage
    FROM unnest(COALESCE(cp.played_ranges, '{}'::int8multirange)) AS x;

  IF ex.id IS NOT NULL THEN
    SELECT ec.response INTO response FROM app.exercise_completions ec
     WHERE ec.enrollment_id = e.id AND ec.exercise_id = ex.id;
  END IF;

  SELECT count(*) FILTER (WHERE cl.required),
         count(*) FILTER (WHERE cl.required AND p.completed_at IS NOT NULL)
    INTO required_total, required_done
    FROM app.classes cl
    LEFT JOIN app.class_progress p ON p.enrollment_id = e.id AND p.class_id = cl.id
   WHERE cl.version_id = e.version_id;

  SELECT cr.id INTO cert FROM app.certificates cr WHERE cr.enrollment_id = e.id;

  RETURN jsonb_build_object(
    'class', app.class_json(c),
    /*
     * Ready assets only. A pending or failed upload is not something a learner
     * can be offered, and spec/04 keeps the primary media out of the handout
     * list — it is played, not downloaded.
     */
    'assets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id, 'class_id', a.class_id, 'role', a.role,
               'original_name', a.original_name, 'mime_type', a.mime_type,
               'bytes', a.bytes, 'state', a.state, 'error_code', a.error_code))
      FROM app.assets a WHERE a.class_id = c.id AND a.state = 'ready'), '[]'::jsonb),
    'exercise', CASE WHEN ex.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', ex.id, 'class_id', ex.class_id, 'instructions_md', ex.instructions_md) END,
    'saved_response', response,
    'progress', jsonb_build_object(
      'class_id', c.id,
      'position_ms', COALESCE(cp.position_ms, 0),
      'coverage_ms', coverage,
      'content_complete', cp.content_completed_at IS NOT NULL,
      'exercise_complete', response IS NOT NULL,
      'class_complete', cp.completed_at IS NOT NULL,
      'required_completed', required_done,
      'required_total', GREATEST(required_total, 1),
      'certificate_id', cert));
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
