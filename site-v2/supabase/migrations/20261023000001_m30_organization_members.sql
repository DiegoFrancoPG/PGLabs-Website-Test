-- M30 — a platform admin can see and correct an organization's people.
--
-- D-07 in HANDOFF.md, at the product owner's request for the launch: the admin
-- edits an organization's name and timezone (update_organization, unchanged)
-- and its manager's details. Until now nothing listed who belongs to an
-- organization, and only a person could change their own name.
--
-- Two admin-only operations:
--   * list_organization_members — everyone with a membership, with their name,
--     email, role, membership status and whether they have finished setting up
--     their account. Managers do not get this: their staff list is built from
--     cohorts and the report, which they already see.
--   * update_member_profile — a member's display name. The email is not set
--     here: it belongs to Auth, so the application changes it there and then
--     re-syncs the profile through pglearn_provision, which reads the address
--     from auth.users and never from the caller (spec/02).

/*
 * The member's organization is the selector that scopes the read; authority
 * is the admin check, before anything is looked up.
 */
CREATE FUNCTION app.handle_list_organization_members(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid; items jsonb;
BEGIN
  PERFORM app.assert_admin(actor);
  org := (payload ->> 'organization_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM app.organizations o WHERE o.id = org) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id', p.id,
           'display_name', p.display_name,
           'email', p.email,
           'role', m.role,
           'status', m.status,
           'onboarded', p.onboarded_at IS NOT NULL)
         -- Managers first, then by name, so the people an admin edits most
         -- often are at the top.
         ORDER BY (m.role = 'manager') DESC, lower(p.display_name), p.id), '[]'::jsonb)
    INTO items
  FROM app.memberships m
  JOIN app.profiles p ON p.id = m.user_id
  WHERE m.organization_id = org;

  RETURN jsonb_build_object('items', items, 'next_cursor', NULL);
END $$;

/*
 * The same 1–120 character rule the profiles table enforces, applied after
 * trimming so a name of spaces is refused rather than stored.
 */
CREATE FUNCTION app.handle_update_member_profile(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid; name text; updated app.profiles;
BEGIN
  PERFORM app.assert_admin(actor);
  target := (payload ->> 'user_id')::uuid;
  name := NULLIF(btrim(payload ->> 'display_name'), '');

  IF payload ? 'display_name' AND (name IS NULL OR char_length(name) > 120) THEN
    RAISE EXCEPTION 'display_name must be 1 to 120 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE app.profiles SET display_name = COALESCE(name, display_name)
   WHERE id = target
  RETURNING * INTO updated;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  RETURN jsonb_build_object('user_id', updated.id, 'display_name', updated.display_name,
                            'email', updated.email);
END $$;

-- ---------------------------------------------------------------------------
-- The dispatcher, recreated with the two new actions (ADR-03's literal
-- allowlist); everything else is exactly as M23 left it.
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
