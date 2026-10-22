-- M31 — a module can be held back until a release date.
--
-- D-08 in HANDOFF.md, at the product owner's request: an admin sets a date on
-- a module; until then the learner sees the module and its lessons, tagged
-- with the date, but cannot open them. The date is a schedule, not content,
-- so it lives in its own table rather than on app.modules: the M02 freeze
-- triggers keep a published version's modules read-only, and the first cohort
-- is already learning on a published version.
--
-- The date applies to every enrollment on that version. Enforcement is in the
-- dispatcher, before the handler runs, so no action reaches a held-back
-- lesson's content, playback, completion or files — not only the page.

CREATE TABLE app.module_releases (
  module_id uuid PRIMARY KEY REFERENCES app.modules(id) ON DELETE CASCADE,
  release_at timestamptz NOT NULL,
  updated_by uuid NOT NULL REFERENCES app.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.module_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.module_releases FROM PUBLIC, anon, authenticated;

/* The Module DTO carries its release date (null: released with the version). */
CREATE OR REPLACE FUNCTION app.module_json(m app.modules)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', m.id, 'version_id', m.version_id,
                            'title', m.title, 'position', m.position,
                            'release_at', (SELECT r.release_at FROM app.module_releases r
                                            WHERE r.module_id = m.id));
$$;

/*
 * Whether a learning action may touch its lesson yet. It speaks only when the
 * caller owns the enrollment and the lesson belongs to its version; anything
 * else falls through to the handler, which answers "not found" exactly as
 * before, so this cannot be used to probe other people's content.
 *
 * An admin's draft preview (preview = true) is exempt: it creates no progress
 * and the author needs to see what they are scheduling.
 */
CREATE FUNCTION app.assert_class_released(actor uuid, action text, payload jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE enrollment uuid; target uuid; opens timestamptz;
BEGIN
  IF action NOT IN ('get_learning_class', 'start_playback', 'record_progress', 'complete_text',
                    'complete_exercise', 'authorize_download', 'ask_tutor') THEN
    RETURN;
  END IF;
  IF COALESCE((payload ->> 'preview')::boolean, false) THEN RETURN; END IF;

  enrollment := NULLIF(payload ->> 'enrollment_id', '')::uuid;
  IF enrollment IS NULL OR NOT app.owns_enrollment(actor, enrollment) THEN RETURN; END IF;

  target := CASE action
    WHEN 'authorize_download' THEN
      (SELECT a.class_id FROM app.assets a WHERE a.id = NULLIF(payload ->> 'asset_id', '')::uuid)
    WHEN 'complete_exercise' THEN
      (SELECT x.class_id FROM app.exercises x WHERE x.id = NULLIF(payload ->> 'exercise_id', '')::uuid)
    ELSE NULLIF(payload ->> 'class_id', '')::uuid
  END;
  IF target IS NULL THEN RETURN; END IF;

  SELECT r.release_at INTO opens
    FROM app.classes c
    JOIN app.enrollments e ON e.id = enrollment AND e.version_id = c.version_id
    JOIN app.module_releases r ON r.module_id = c.module_id
   WHERE c.id = target;

  IF opens IS NOT NULL AND opens > now() THEN
    RAISE EXCEPTION 'access unavailable: module_locked' USING ERRCODE = 'PGL22',
      DETAIL = 'module_locked', HINT = to_char(opens AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  END IF;
END $$;

/*
 * Setting or clearing a module's release date. Admin only, and allowed on a
 * published version: the date is a schedule, not part of the frozen content.
 */
CREATE FUNCTION app.handle_set_module_release(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m app.modules; opens timestamptz;
BEGIN
  PERFORM app.assert_admin(actor);
  SELECT * INTO m FROM app.modules WHERE id = (payload ->> 'module_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT payload ? 'release_at' THEN
    RAISE EXCEPTION 'release_at is required (null clears it)' USING ERRCODE = '22023';
  END IF;
  opens := NULLIF(payload ->> 'release_at', '')::timestamptz;

  IF opens IS NULL THEN
    DELETE FROM app.module_releases WHERE module_id = m.id;
  ELSE
    INSERT INTO app.module_releases(module_id, release_at, updated_by)
    VALUES (m.id, opens, actor)
    ON CONFLICT (module_id) DO UPDATE
      SET release_at = excluded.release_at, updated_by = excluded.updated_by, updated_at = now();
  END IF;

  RETURN app.module_json(m);
END $$;

-- ---------------------------------------------------------------------------
-- The dispatcher, recreated with the release check and the new action
-- (ADR-03's literal allowlist); everything else is exactly as M30 left it.
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
