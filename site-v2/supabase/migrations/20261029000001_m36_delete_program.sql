-- M36 — deleting a program completely.
--
-- D-18 in HANDOFF.md, at the product owner's request. Archiving (spec/04)
-- only hides a program from new assignments; this removes it and everything
-- that hangs off it: every version and its content, the organizations'
-- access to it (grants), the assignments (offerings) and every enrollment in
-- it with its progress, exercise answers, tutor conversations, reminders and
-- certificates. It cannot be undone. Two things are kept on purpose: the
-- audit log, which gains a "program.deleted" entry, and app.tutor_usage,
-- the spending record that M01 keeps without a foreign key so it outlives
-- the conversations.
--
-- The M02 triggers that freeze published content (spec/02) stay in force.
-- They let a row go only while this function is deleting the program it
-- belongs to: the function marks the program in a transaction-local setting,
-- which nothing outside it can set (callers reach the database only through
-- pglearn_rpc).
--
-- The files in storage are not reachable from SQL. The function returns
-- their keys and the application removes them after the commit.

CREATE OR REPLACE FUNCTION app.purging_program(v_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(current_setting('app.purging_program', true), '') <> ''
     AND EXISTS (SELECT 1 FROM app.program_versions pv
                  WHERE pv.id = v_id
                    AND pv.program_id::text = current_setting('app.purging_program', true));
$$;

CREATE OR REPLACE FUNCTION app.reject_published_version_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.state = 'published'
     AND OLD.program_id::text IS DISTINCT FROM current_setting('app.purging_program', true) THEN
    RAISE EXCEPTION 'a published version cannot be deleted' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION app.reject_when_version_published() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_data record; v_id uuid; state text;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO v_id USING row_data;
  SELECT pv.state INTO state FROM app.program_versions pv WHERE pv.id = v_id;
  IF state = 'published' AND NOT (TG_OP = 'DELETE' AND app.purging_program(v_id)) THEN
    RAISE EXCEPTION 'content of a published version is read-only (%, %)', TG_TABLE_NAME, TG_OP
      USING ERRCODE = '23514';
  END IF;
  RETURN row_data;
END $$;

CREATE OR REPLACE FUNCTION app.reject_when_class_version_published() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_data record; state text; v_id uuid;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT pv.state, pv.id INTO state, v_id
    FROM app.classes c JOIN app.program_versions pv ON pv.id = c.version_id
    WHERE c.id = row_data.class_id;
  IF state = 'published' AND NOT (TG_OP = 'DELETE' AND app.purging_program(v_id)) THEN
    RAISE EXCEPTION 'content of a published version is read-only (%, %)', TG_TABLE_NAME, TG_OP
      USING ERRCODE = '23514';
  END IF;
  RETURN row_data;
END $$;

/*
 * delete_program: { program_id, confirm_title }. The title must be typed
 * back exactly (ignoring surrounding spaces), so a wrong click or a stale
 * id cannot delete the wrong program.
 */
CREATE OR REPLACE FUNCTION app.handle_delete_program(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p app.programs; enr uuid[]; ver uuid[]; cls uuid[]; keys text[];
        n_versions integer; n_enrollments integer; n_certificates integer; n_grants integer;
BEGIN
  PERFORM app.assert_admin(actor);
  SELECT * INTO p FROM app.programs WHERE id = (payload ->> 'program_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF btrim(COALESCE(payload ->> 'confirm_title', '')) <> btrim(p.title) THEN
    RAISE EXCEPTION 'type the program title exactly to delete it' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.purging_program', p.id::text, true);

  SELECT COALESCE(array_agg(id), '{}') INTO ver FROM app.program_versions WHERE program_id = p.id;
  SELECT COALESCE(array_agg(id), '{}') INTO cls FROM app.classes WHERE version_id = ANY (ver);
  SELECT COALESCE(array_agg(id), '{}') INTO enr FROM app.enrollments WHERE program_id = p.id;
  SELECT COALESCE(array_agg(k), '{}') INTO keys FROM (
    SELECT storage_key AS k FROM app.assets WHERE class_id = ANY (cls)
    UNION SELECT playback_key FROM app.assets WHERE class_id = ANY (cls) AND playback_key IS NOT NULL
  ) s;
  n_versions := cardinality(ver);
  n_enrollments := cardinality(enr);
  SELECT count(*) INTO n_certificates FROM app.certificates WHERE enrollment_id = ANY (enr);
  SELECT count(*) INTO n_grants FROM app.program_grants WHERE program_id = p.id;

  -- What learners did.
  DELETE FROM app.reminder_days WHERE outbox_id IN
    (SELECT id FROM app.notification_outbox WHERE enrollment_id = ANY (enr));
  DELETE FROM app.notification_outbox WHERE enrollment_id = ANY (enr);
  DELETE FROM app.tutor_requests WHERE class_id = ANY (cls)
     OR session_id IN (SELECT id FROM app.tutor_sessions WHERE enrollment_id = ANY (enr));
  DELETE FROM app.tutor_sessions WHERE enrollment_id = ANY (enr);
  DELETE FROM app.learning_events WHERE enrollment_id = ANY (enr) OR class_id = ANY (cls);
  DELETE FROM app.playback_sessions WHERE enrollment_id = ANY (enr) OR class_id = ANY (cls);
  DELETE FROM app.class_progress WHERE enrollment_id = ANY (enr) OR class_id = ANY (cls);
  DELETE FROM app.exercise_completions WHERE enrollment_id = ANY (enr)
     OR exercise_id IN (SELECT id FROM app.exercises WHERE class_id = ANY (cls));
  DELETE FROM app.certificates WHERE enrollment_id = ANY (enr);
  DELETE FROM app.enrollments WHERE id = ANY (enr);

  -- Who had it.
  DELETE FROM app.cohort_offerings WHERE program_id = p.id;
  DELETE FROM app.program_grants WHERE program_id = p.id;

  -- The content. A class and its primary asset point at each other.
  SET CONSTRAINTS app.classes_primary_same_class_fk DEFERRED;
  DELETE FROM app.content_chunks WHERE class_id = ANY (cls);
  DELETE FROM app.exercises WHERE class_id = ANY (cls);
  DELETE FROM app.assets WHERE class_id = ANY (cls);
  DELETE FROM app.classes WHERE id = ANY (cls);
  DELETE FROM app.modules WHERE version_id = ANY (ver);
  DELETE FROM app.program_versions WHERE id = ANY (ver);
  DELETE FROM app.programs WHERE id = p.id;
  SET CONSTRAINTS app.classes_primary_same_class_fk IMMEDIATE;

  PERFORM set_config('app.purging_program', '', true);

  INSERT INTO app.audit_events(actor_id, action, entity_id, metadata)
  VALUES (actor, 'program.deleted', p.id,
          jsonb_build_object('title', p.title, 'versions', n_versions,
                             'enrollments', n_enrollments, 'certificates', n_certificates,
                             'grants', n_grants));

  RETURN jsonb_build_object('program_id', p.id, 'title', p.title, 'versions', n_versions,
                            'enrollments', n_enrollments, 'certificates', n_certificates,
                            'grants', n_grants, 'storage_keys', to_jsonb(keys));
END $$;

-- ---------------------------------------------------------------------------
-- The dispatcher, recreated with the new action; everything else is exactly
-- as M33 left it.
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

  -- M31: a lesson in a module that has not been released yet cannot be
  -- opened, played, completed or downloaded, whichever action is used.
  PERFORM app.assert_class_released(actor, action, payload);

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
    WHEN 'clone_version' THEN RETURN app.handle_clone_version(actor, payload);
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
    WHEN 'list_organization_members' THEN RETURN app.handle_list_organization_members(actor, payload);
    WHEN 'update_member_profile' THEN RETURN app.handle_update_member_profile(actor, payload);
    WHEN 'set_module_release' THEN RETURN app.handle_set_module_release(actor, payload);
    WHEN 'delete_module' THEN RETURN app.handle_delete_module(actor, payload);
    WHEN 'set_module_hidden' THEN RETURN app.handle_set_module_hidden(actor, payload);
    WHEN 'set_organization_test' THEN RETURN app.handle_set_organization_test(actor, payload);
    WHEN 'move_to_latest_version' THEN RETURN app.handle_move_to_latest_version(actor, payload);
    WHEN 'delete_program' THEN RETURN app.handle_delete_program(actor, payload);
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
