-- M40 — managing a test organization's accounts.
--
-- D-25 in HANDOFF.md, at the product owner's request. M38 creates test
-- accounts with a password; this action manages them afterwards, in a TEST
-- organization only (M33) and by an administrator only:
--
--   * role: learner or manager. A learner is kept in the staff cohort, the
--     way create_test_account puts them there; a manager is taken out of the
--     organization's cohorts, since managers are not on the staff list;
--   * status: 'removed' takes the person out of the organization and its
--     cohorts, which stops their learning there (M02: membership_inactive)
--     while keeping their records; 'active' brings them back, a learner into
--     the staff cohort again;
--   * password_reset: records that the application is about to set a new
--     password, and answers whether it may (the M38 rule: only an account
--     that belongs to test organizations alone). With no change at all the
--     action is read-only and only answers that question.
--
-- The account itself is never deleted: its profile, enrollments and audit
-- history stay, and its Auth identity is left to Auth.

CREATE OR REPLACE FUNCTION app.handle_update_test_account(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid; target uuid; want_role text; want_status text; mem app.memberships;
        prof app.profiles; staff uuid; allowed boolean; changed boolean;
BEGIN
  PERFORM app.assert_admin(actor);
  org := (payload ->> 'organization_id')::uuid;
  target := (payload ->> 'user_id')::uuid;
  want_role := NULLIF(payload ->> 'role', '');
  want_status := NULLIF(payload ->> 'status', '');
  IF want_role IS NOT NULL AND want_role NOT IN ('learner', 'manager') THEN
    RAISE EXCEPTION 'role must be learner or manager' USING ERRCODE = '22023';
  END IF;
  IF want_status IS NOT NULL AND want_status NOT IN ('active', 'removed') THEN
    RAISE EXCEPTION 'status must be active or removed' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.organizations WHERE id = org) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.test_organizations WHERE organization_id = org) THEN
    RAISE EXCEPTION 'test accounts can only be managed in a test organization' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO mem FROM app.memberships WHERE organization_id = org AND user_id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO prof FROM app.profiles WHERE id = target;

  -- M38's rule, unchanged: memberships in test organizations do not count.
  allowed := NOT EXISTS (SELECT 1 FROM app.platform_admins WHERE user_id = target)
         AND NOT EXISTS (SELECT 1 FROM app.memberships m
                          WHERE m.user_id = target AND m.status <> 'removed'
                            AND NOT EXISTS (SELECT 1 FROM app.test_organizations t
                                             WHERE t.organization_id = m.organization_id));

  changed := (want_role IS NOT NULL AND want_role <> mem.role)
          OR (want_status IS NOT NULL AND want_status <> mem.status);

  IF changed THEN
    UPDATE app.memberships
       SET role = COALESCE(want_role, role), status = COALESCE(want_status, status)
     WHERE organization_id = org AND user_id = target
    RETURNING * INTO mem;

    IF mem.status = 'active' AND mem.role = 'learner' THEN
      -- The staff cohort, chosen as create_test_account chooses it.
      SELECT c.id INTO staff FROM app.cohorts c
       WHERE c.organization_id = org AND c.archived_at IS NULL
       ORDER BY (lower(c.name) = 'staff') DESC, c.created_at LIMIT 1;
      IF staff IS NULL THEN
        INSERT INTO app.cohorts(organization_id, name) VALUES (org, 'Staff') RETURNING id INTO staff;
      END IF;
      INSERT INTO app.cohort_members(cohort_id, organization_id, user_id)
      VALUES (staff, org, target)
      ON CONFLICT (cohort_id, user_id) DO UPDATE SET status = 'active';
    ELSE
      UPDATE app.cohort_members SET status = 'removed'
       WHERE organization_id = org AND user_id = target AND status <> 'removed';
    END IF;

    INSERT INTO app.audit_events(actor_id, organization_id, action, entity_id, metadata)
    VALUES (actor, org, 'test_account.updated', target,
            jsonb_build_object('role', mem.role, 'status', mem.status));
  END IF;

  IF COALESCE((payload ->> 'password_reset')::boolean, false) THEN
    INSERT INTO app.audit_events(actor_id, organization_id, action, entity_id, metadata)
    VALUES (actor, org, 'test_account.password_reset', target,
            jsonb_build_object('password_allowed', allowed));
  END IF;

  RETURN jsonb_build_object('user_id', target, 'email', prof.email, 'display_name', prof.display_name,
                            'role', mem.role, 'status', mem.status, 'password_allowed', allowed);
END $$;

-- ---------------------------------------------------------------------------
-- The dispatcher, recreated with the new action; everything else is exactly
-- as M38 left it.
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
