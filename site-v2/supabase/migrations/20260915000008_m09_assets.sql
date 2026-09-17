-- T09 — asset authorization, finalization and download authorization.
--
-- The application performs the storage work; these handlers decide WHETHER it
-- may happen and record the outcome. spec/02: "Before every signed URL, the
-- user RPC must authorize that exact asset and enrollment."

CREATE FUNCTION app.asset_json(a app.assets)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', a.id, 'class_id', a.class_id, 'role', a.role,
    'original_name', a.original_name, 'mime_type', a.mime_type, 'bytes', a.bytes,
    'state', a.state, 'error_code', a.error_code);
$$;

/*
 * Reserves an asset row for an upload and returns the identifiers the caller
 * needs to build a storage path. The path itself is composed in the
 * application, but the version id comes from here so it cannot be supplied.
 */
CREATE FUNCTION app.handle_authorize_upload(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; c app.classes; v app.program_versions; a app.assets;
BEGIN
  PERFORM app.assert_admin(actor);

  SELECT * INTO c FROM app.classes WHERE id = (payload ->> 'class_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v FROM app.program_versions WHERE id = c.version_id;
  IF v.state <> 'draft' THEN
    -- Published content is frozen, so there is nothing to upload into.
    RAISE EXCEPTION 'version is published and cannot receive uploads' USING ERRCODE = '23514';
  END IF;

  replay := app.idempotency_lookup(actor, 'authorize_upload', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  /*
   * Created pending. spec/03: "Complete upload then finalize; ready status only
   * after validation." Nothing may reference this asset until finalization has
   * checked what was actually stored.
   *
   * The storage key is composed HERE, from the layout spec/02 fixes:
   *   versions/{version_id}/classes/{class_id}/{asset_id}/{sanitized_filename}
   *
   * The version and class ids come from the database rather than the request,
   * and the filename has already been reduced to a safe basename by the caller,
   * so no part of the path is attacker-chosen. Composing it in the application
   * would have meant a second write to record it.
   */
  INSERT INTO app.assets(class_id, role, original_name, mime_type, bytes, storage_key, state)
  VALUES (c.id, payload ->> 'role', payload ->> 'original_name', payload ->> 'mime_type',
          (payload ->> 'bytes')::bigint, 'pending', 'pending')
  RETURNING * INTO a;

  UPDATE app.assets
     SET storage_key = format('versions/%s/classes/%s/%s/%s',
                              v.id, c.id, a.id, payload ->> 'original_name')
   WHERE id = a.id
  RETURNING * INTO a;

  RETURN app.idempotency_store(actor, 'authorize_upload', payload,
    jsonb_build_object('asset', app.asset_json(a), 'version_id', v.id, 'class_id', c.id,
                       'storage_key', a.storage_key));
END $$;

/*
 * Records the outcome of finalization. The application has already inspected
 * the stored object and parsed it where applicable; this writes the verdict.
 *
 * spec/02: "A primary upload selected for a class becomes its primary_asset_id
 * only after successful finalize."
 */
CREATE FUNCTION app.handle_finalize_upload(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a app.assets; c app.classes; ok boolean; source text; updated boolean := false;
BEGIN
  PERFORM app.assert_admin(actor);

  SELECT * INTO a FROM app.assets WHERE id = (payload ->> 'asset_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  /*
   * Inspect mode: returns what was RESERVED, changing nothing.
   *
   * The route needs the declared role, type, size and key before it can check
   * the stored object, and it must not take any of them from the request —
   * spec/03 has finalization compare the actual object against what was
   * reserved, so trusting the caller for either side would check nothing.
   *
   * Folded into this action rather than given its own, because spec/02 requires
   * the allowlist to correspond to OpenAPI operationId values, and there is no
   * operation for "read back a reservation".
   */
  IF COALESCE((payload ->> 'inspect')::boolean, false) THEN
    SELECT * INTO c FROM app.classes WHERE id = a.class_id;
    RETURN jsonb_build_object(
      'asset', app.asset_json(a),
      'storage_key', a.storage_key,
      'duration_ms', c.duration_ms);
  END IF;

  ok := COALESCE((payload ->> 'ok')::boolean, false);

  IF NOT ok THEN
    UPDATE app.assets SET state = 'failed', error_code = payload ->> 'error_code'
     WHERE id = a.id RETURNING * INTO a;
    RETURN jsonb_build_object('asset', app.asset_json(a), 'source_text_updated', false);
  END IF;

  UPDATE app.assets SET
    state = 'ready',
    error_code = NULL,
    bytes = COALESCE((payload ->> 'actual_bytes')::bigint, bytes),
    playback_key = COALESCE(NULLIF(payload ->> 'playback_key', ''), playback_key)
  WHERE id = a.id
  RETURNING * INTO a;

  SELECT * INTO c FROM app.classes WHERE id = a.class_id;

  -- A ready primary asset becomes the class's primary. The M02 trigger checks
  -- role, readiness, ownership and MIME agreement independently.
  IF a.role = 'primary' THEN
    UPDATE app.classes SET primary_asset_id = a.id,
      duration_ms = COALESCE(NULLIF(payload ->> 'duration_ms', '')::bigint, duration_ms)
     WHERE id = c.id;
  END IF;

  -- spec/03: captions and transcripts derive the class's searchable source text.
  source := NULLIF(btrim(COALESCE(payload ->> 'source_text', '')), '');
  IF source IS NOT NULL AND a.role IN ('caption', 'transcript') THEN
    UPDATE app.classes SET source_text = source WHERE id = c.id;
    updated := true;
  END IF;

  RETURN jsonb_build_object('asset', app.asset_json(a), 'source_text_updated', updated);
END $$;

/*
 * AC-062. The one handler that must NOT be idempotency-cached.
 *
 * spec/05: "Generated asset URLs are refreshed after reauthorization, not
 * treated as immutable cached signatures" and "Each transaction reauthorizes
 * before replay; cached success is not an access bypass."
 *
 * So access is evaluated on every call. Replaying a key that worked while a
 * grant was active must not hand back a usable URL once it is revoked — which
 * is exactly what returning a stored response would do.
 */
CREATE FUNCTION app.handle_authorize_download(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a app.assets; c app.classes; enrollment uuid; preview boolean; availability text;
BEGIN
  SELECT * INTO a FROM app.assets WHERE id = (payload ->> 'asset_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM app.classes WHERE id = a.class_id;

  IF a.state <> 'ready' THEN
    RAISE EXCEPTION 'asset is not ready' USING ERRCODE = '23514';
  END IF;

  preview := COALESCE((payload ->> 'preview')::boolean, false);
  enrollment := NULLIF(payload ->> 'enrollment_id', '')::uuid;

  IF preview THEN
    -- Draft preview is platform admin only, and creates no progress.
    IF NOT app.can_preview(actor, c.version_id) THEN
      RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    IF enrollment IS NULL THEN
      RAISE EXCEPTION 'enrollment_id is required' USING ERRCODE = '22023';
    END IF;
    IF NOT app.owns_enrollment(actor, enrollment) THEN
      -- Another learner's enrollment is reported as missing, not forbidden.
      RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
    END IF;

    -- The class must belong to the version this enrollment is pinned to.
    IF NOT EXISTS (
      SELECT 1 FROM app.enrollments e WHERE e.id = enrollment AND e.version_id = c.version_id
    ) THEN
      RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
    END IF;

    availability := app.enrollment_availability(actor, enrollment, now());
    IF availability <> 'available' THEN
      -- spec/05: after ownership is established, blocked learning returns
      -- ACCESS_UNAVAILABLE with the reason.
      RAISE EXCEPTION 'access unavailable: %', availability USING ERRCODE = 'PGL22', DETAIL = availability;
    END IF;
  END IF;

  /*
   * spec/03: "For caption assets sign playback_key (normalized VTT); for other
   * roles sign storage_key." The learner never receives the raw SRT.
   */
  RETURN jsonb_build_object(
    'asset_id', a.id,
    'storage_path', CASE WHEN a.role = 'caption' THEN COALESCE(a.playback_key, a.storage_key)
                         ELSE a.storage_key END,
    'role', a.role,
    'mime_type', a.mime_type);
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
