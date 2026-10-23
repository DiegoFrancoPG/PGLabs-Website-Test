-- M41 — deleting a test account for good.
--
-- D-26 in HANDOFF.md, at the product owner's request: removing a test account
-- from its organization (M40) keeps it, so an address used for a test could
-- not be reused cleanly. This action erases the account's data so the
-- application can then delete its Auth identity (app.profiles references
-- auth.users ON DELETE RESTRICT, so the database goes first).
--
-- Only a pure test account can be deleted: not a platform administrator, not
-- the caller, with every membership and every enrollment in a test
-- organization (M33), and no personal grant. Anybody who has ever been in a
-- real organization, or learned outside one, is refused: their records are
-- not test data.
--
-- What goes: learning records (events, playback sessions, progress, exercise
-- completions, certificates, tutor sessions and requests), notifications and
-- reminder days, tutor usage, idempotency records, invitations to them, cohort
-- places, memberships, and the profile. What stays: the audit trail. Their own
-- audit events keep their content with no actor; events about them keep the
-- id, which no longer names anybody. Invitations they sent to others pass to
-- the administrator deleting them, since an invitation needs a creator. An
-- active organization must keep a manager (M02), so deleting the last one is
-- refused by that rule.

CREATE OR REPLACE FUNCTION app.handle_delete_test_account(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid; prof app.profiles; orgs uuid[];
BEGIN
  PERFORM app.assert_admin(actor);
  target := (payload ->> 'user_id')::uuid;
  SELECT * INTO prof FROM app.profiles WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  IF target = actor OR EXISTS (SELECT 1 FROM app.platform_admins WHERE user_id = target) THEN
    RAISE EXCEPTION 'an administrator account cannot be deleted here' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.memberships WHERE user_id = target)
     OR EXISTS (SELECT 1 FROM app.memberships m WHERE m.user_id = target
                 AND NOT EXISTS (SELECT 1 FROM app.test_organizations t WHERE t.organization_id = m.organization_id))
     OR EXISTS (SELECT 1 FROM app.enrollments e WHERE e.user_id = target
                 AND (e.organization_id IS NULL
                      OR NOT EXISTS (SELECT 1 FROM app.test_organizations t WHERE t.organization_id = e.organization_id)))
     OR EXISTS (SELECT 1 FROM app.program_grants g WHERE g.user_id = target) THEN
    RAISE EXCEPTION 'only an account that belongs to test organizations alone can be deleted' USING ERRCODE = '23514';
  END IF;

  SELECT array_agg(DISTINCT organization_id) INTO orgs FROM app.memberships WHERE user_id = target;

  -- Learning records, children before parents.
  DELETE FROM app.learning_events WHERE enrollment_id IN (SELECT id FROM app.enrollments WHERE user_id = target);
  DELETE FROM app.playback_sessions WHERE enrollment_id IN (SELECT id FROM app.enrollments WHERE user_id = target);
  DELETE FROM app.class_progress WHERE enrollment_id IN (SELECT id FROM app.enrollments WHERE user_id = target);
  DELETE FROM app.exercise_completions WHERE enrollment_id IN (SELECT id FROM app.enrollments WHERE user_id = target);
  DELETE FROM app.certificates WHERE enrollment_id IN (SELECT id FROM app.enrollments WHERE user_id = target);
  DELETE FROM app.tutor_requests WHERE session_id IN (
    SELECT s.id FROM app.tutor_sessions s JOIN app.enrollments e ON e.id = s.enrollment_id WHERE e.user_id = target);
  DELETE FROM app.tutor_sessions WHERE enrollment_id IN (SELECT id FROM app.enrollments WHERE user_id = target);
  DELETE FROM app.reminder_days WHERE user_id = target;
  DELETE FROM app.notification_outbox
   WHERE user_id = target OR enrollment_id IN (SELECT id FROM app.enrollments WHERE user_id = target);
  DELETE FROM app.enrollments WHERE user_id = target;

  -- Their place in organizations.
  DELETE FROM app.cohort_members WHERE user_id = target;
  DELETE FROM app.invitations WHERE user_id = target;
  UPDATE app.invitations SET created_by = actor WHERE created_by = target;
  DELETE FROM app.memberships WHERE user_id = target;

  -- What remains attached to the person.
  DELETE FROM app.tutor_usage WHERE user_id = target;
  DELETE FROM app.idempotency_records WHERE actor_id = target;
  UPDATE app.audit_events SET actor_id = NULL WHERE actor_id = target;
  DELETE FROM app.profiles WHERE id = target;

  INSERT INTO app.audit_events(actor_id, organization_id, action, entity_id, metadata)
  SELECT actor, o, 'test_account.deleted', target, jsonb_build_object('email', prof.email)
    FROM unnest(orgs) AS o;

  RETURN jsonb_build_object('user_id', target, 'email', prof.email, 'organization_ids', to_jsonb(orgs));
END $$;

-- ---------------------------------------------------------------------------
-- The dispatcher, recreated with the new action; everything else is exactly
-- as M40 left it.
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
    WHEN 'create_test_account' THEN RETURN app.handle_create_test_account(actor, payload);
    WHEN 'update_test_account' THEN RETURN app.handle_update_test_account(actor, payload);
    WHEN 'delete_test_account' THEN RETURN app.handle_delete_test_account(actor, payload);
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
