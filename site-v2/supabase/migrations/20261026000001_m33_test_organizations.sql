-- M33 — test organizations can follow the latest published version.
--
-- D-13 in HANDOFF.md, at the product owner's request, for development: an
-- enrollment is pinned to the version it was created on (spec/03, enforced by
-- the M02 identity trigger), so test users never see a newly published
-- version and iterating on content is slow. An admin can now mark an
-- organization as a TEST organization, and only there move its people on a
-- program to the latest published version in one action.
--
-- The pinned enrollment is not edited — its identity stays immutable. For
-- each active, incomplete enrollment not already on the latest version, the
-- move creates the equivalent offering on the latest version (same cohort,
-- grant and dates), enrolls the person there with their start and activity
-- dates, copies their lesson progress by position (module n lesson m to
-- module n lesson m; anything without a counterpart is dropped), settles
-- completion on the new version, and then deletes the old enrollment and
-- everything that hangs off it. Completed enrollments are left alone, so no
-- certificate is ever touched. All of it is one transaction.
--
-- None of this is reachable for an organization that is not marked as a
-- test organization: real learners keep the version they started on.

CREATE TABLE app.test_organizations (
  organization_id uuid PRIMARY KEY REFERENCES app.organizations(id) ON DELETE CASCADE,
  marked_by uuid NOT NULL REFERENCES app.profiles(id),
  marked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.test_organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.test_organizations FROM PUBLIC, anon, authenticated;

/* The Organization DTO says whether it is a test organization. */
CREATE OR REPLACE FUNCTION app.organization_json(o app.organizations)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', o.id, 'name', o.name, 'timezone', o.timezone, 'status', o.status,
                            'is_test', EXISTS (SELECT 1 FROM app.test_organizations t
                                                WHERE t.organization_id = o.id));
$$;

CREATE FUNCTION app.handle_set_organization_test(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.organizations;
BEGIN
  PERFORM app.assert_admin(actor);
  SELECT * INTO o FROM app.organizations WHERE id = (payload ->> 'organization_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF jsonb_typeof(payload -> 'is_test') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'is_test must be true or false' USING ERRCODE = '22023';
  END IF;

  IF (payload ->> 'is_test')::boolean THEN
    INSERT INTO app.test_organizations(organization_id, marked_by) VALUES (o.id, actor)
    ON CONFLICT (organization_id) DO NOTHING;
  ELSE
    DELETE FROM app.test_organizations WHERE organization_id = o.id;
  END IF;
  RETURN app.organization_json(o);
END $$;

CREATE FUNCTION app.handle_move_to_latest_version(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid; prog uuid; latest app.program_versions; e app.enrollments;
        old_off app.cohort_offerings; new_off uuid; new_enr uuid; any_class uuid;
        moved integer := 0; skipped integer := 0; copied integer := 0; n integer;
BEGIN
  PERFORM app.assert_admin(actor);
  org := (payload ->> 'organization_id')::uuid;
  prog := (payload ->> 'program_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM app.organizations WHERE id = org)
     OR NOT EXISTS (SELECT 1 FROM app.programs WHERE id = prog) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.test_organizations WHERE organization_id = org) THEN
    RAISE EXCEPTION 'only a test organization can be moved to the latest version'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO latest FROM app.program_versions
   WHERE program_id = prog AND state = 'published'
   ORDER BY version_number DESC LIMIT 1;
  IF latest.id IS NULL THEN
    RAISE EXCEPTION 'the program has no published version' USING ERRCODE = '23514';
  END IF;
  SELECT c.id INTO any_class FROM app.classes c WHERE c.version_id = latest.id LIMIT 1;

  FOR e IN
    SELECT * FROM app.enrollments
     WHERE organization_id = org AND program_id = prog AND version_id <> latest.id
       AND status = 'active'
     FOR UPDATE
  LOOP
    IF e.completed_at IS NOT NULL THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    -- The same assignment on the latest version, made once and shared.
    SELECT * INTO old_off FROM app.cohort_offerings WHERE id = e.offering_id;
    new_off := NULL;
    SELECT o.id INTO new_off FROM app.cohort_offerings o
     WHERE o.cohort_id = old_off.cohort_id AND o.grant_id = old_off.grant_id
       AND o.version_id = latest.id AND o.starts_at = old_off.starts_at
       AND o.due_at = old_off.due_at AND o.status = 'active'
     LIMIT 1;
    IF new_off IS NULL THEN
      INSERT INTO app.cohort_offerings(cohort_id, organization_id, program_id, version_id,
                                       grant_id, starts_at, due_at, access_ends_at)
      VALUES (old_off.cohort_id, old_off.organization_id, old_off.program_id, latest.id,
              old_off.grant_id, old_off.starts_at, old_off.due_at, old_off.access_ends_at)
      RETURNING id INTO new_off;
    END IF;

    INSERT INTO app.enrollments(user_id, program_id, version_id, grant_id, organization_id,
                                offering_id, starts_at, due_at, access_ends_at,
                                started_at, last_activity_at)
    VALUES (e.user_id, e.program_id, latest.id, e.grant_id, e.organization_id, new_off,
            e.starts_at, e.due_at, e.access_ends_at, e.started_at, e.last_activity_at)
    RETURNING id INTO new_enr;

    -- Progress, by (module position, lesson position).
    INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges,
                                   position_ms, content_completed_at, completed_at, updated_at)
    SELECT new_enr, nc.id, latest.id, cp.played_ranges, cp.position_ms,
           cp.content_completed_at, cp.completed_at, cp.updated_at
      FROM app.class_progress cp
      JOIN app.classes oc ON oc.id = cp.class_id
      JOIN app.modules om ON om.id = oc.module_id
      JOIN app.modules nm ON nm.version_id = latest.id AND nm.position = om.position
      JOIN app.classes nc ON nc.module_id = nm.id AND nc.position = oc.position
     WHERE cp.enrollment_id = e.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    copied := copied + n;

    -- The old enrollment and everything that hangs off it.
    DELETE FROM app.learning_events WHERE enrollment_id = e.id;
    DELETE FROM app.playback_sessions WHERE enrollment_id = e.id;
    DELETE FROM app.class_progress WHERE enrollment_id = e.id;
    DELETE FROM app.exercise_completions WHERE enrollment_id = e.id;
    DELETE FROM app.tutor_requests WHERE session_id IN
      (SELECT id FROM app.tutor_sessions WHERE enrollment_id = e.id);
    DELETE FROM app.tutor_sessions WHERE enrollment_id = e.id;
    DELETE FROM app.reminder_days WHERE outbox_id IN
      (SELECT id FROM app.notification_outbox WHERE enrollment_id = e.id);
    DELETE FROM app.notification_outbox WHERE enrollment_id = e.id;
    DELETE FROM app.enrollments WHERE id = e.id;

    -- The latest version may ask less of them than the old one did.
    IF e.started_at IS NOT NULL AND any_class IS NOT NULL THEN
      PERFORM app.settle_completion(new_enr, any_class, now());
    END IF;

    moved := moved + 1;
  END LOOP;

  RETURN jsonb_build_object('version_number', latest.version_number, 'moved', moved,
                            'skipped_completed', skipped, 'progress_copied', copied);
END $$;

-- ---------------------------------------------------------------------------
-- The dispatcher, recreated with the two new actions; everything else is
-- exactly as M32 left it.
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
