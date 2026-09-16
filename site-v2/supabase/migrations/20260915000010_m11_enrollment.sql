-- T11 — dated offerings and enrollment.

CREATE FUNCTION app.offering_json(o app.cohort_offerings)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', o.id, 'organization_id', o.organization_id,
    'program_id', o.program_id, 'cohort_id', o.cohort_id, 'version_id', o.version_id,
    'grant_id', o.grant_id, 'starts_at', o.starts_at, 'due_at', o.due_at,
    'access_ends_at', o.access_ends_at, 'status', o.status);
$$;

/*
 * contracts/api.json's Enrollment, including the derived fields the learner
 * dashboard needs. Progress counts REQUIRED classes only — the denominator the
 * published freeze exists to keep stable.
 */
CREATE FUNCTION app.enrollment_json(e app.enrollments, viewer uuid, t timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE required_total integer; required_done integer; title text; next_class uuid; cert uuid;
BEGIN
  SELECT p.title INTO title FROM app.programs p WHERE p.id = e.program_id;

  SELECT count(*) FILTER (WHERE c.required),
         count(*) FILTER (WHERE c.required AND cp.completed_at IS NOT NULL)
    INTO required_total, required_done
    FROM app.classes c
    LEFT JOIN app.class_progress cp ON cp.enrollment_id = e.id AND cp.class_id = c.id
   WHERE c.version_id = e.version_id;

  -- The next incomplete class in order, which is what "Continue" opens.
  SELECT c.id INTO next_class
    FROM app.classes c
    JOIN app.modules m ON m.id = c.module_id
    LEFT JOIN app.class_progress cp ON cp.enrollment_id = e.id AND cp.class_id = c.id
   WHERE c.version_id = e.version_id AND cp.completed_at IS NULL
   ORDER BY m.position, c.position LIMIT 1;

  SELECT cr.id INTO cert FROM app.certificates cr WHERE cr.enrollment_id = e.id;

  RETURN jsonb_build_object(
    'id', e.id, 'user_id', e.user_id, 'program_id', e.program_id, 'program_title', title,
    'version_id', e.version_id, 'organization_id', e.organization_id, 'offering_id', e.offering_id,
    'starts_at', e.starts_at, 'due_at', e.due_at, 'access_ends_at', e.access_ends_at,
    'state', CASE WHEN e.status = 'cancelled' THEN 'cancelled'
                  WHEN e.completed_at IS NOT NULL THEN 'completed'
                  WHEN e.started_at IS NOT NULL THEN 'in_progress'
                  ELSE 'not_started' END,
    'availability', app.enrollment_availability(viewer, e.id, t),
    'required_completed', required_done,
    'required_total', GREATEST(required_total, 1),
    'progress_percent', CASE WHEN required_total > 0
                             THEN round(required_done::numeric * 100 / required_total, 1)
                             ELSE 0 END,
    'started_at', e.started_at, 'last_activity_at', e.last_activity_at,
    'completed_at', e.completed_at, 'continue_class_id', next_class, 'certificate_id', cert);
END $$;

-- ---------------------------------------------------------------------------
-- Offerings
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.handle_list_offerings(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid;
BEGIN
  org := NULLIF(payload ->> 'organization_id', '')::uuid;
  IF org IS NOT NULL THEN PERFORM app.assert_can_manage(actor, org); END IF;

  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(app.offering_json(o) ORDER BY o.starts_at DESC)
      FROM app.cohort_offerings o
      WHERE (org IS NULL OR o.organization_id = org)
        AND (app.platform_admin(actor) OR app.org_manager(actor, o.organization_id))
    ), '[]'::jsonb),
    'next_cursor', NULL);
END $$;

/*
 * spec/03: "Org manager chooses existing grant and published version, creates
 * an offering and explicitly enrolls selected cohort members."
 *
 * The relationship rules — grant subject matching the organization, a published
 * version, dates inside the grant window — are enforced by the M02 trigger, so
 * they hold no matter which path reaches the table.
 */
CREATE FUNCTION app.handle_create_offering(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; c app.cohorts; v app.program_versions; o app.cohort_offerings;
BEGIN
  SELECT * INTO c FROM app.cohorts WHERE id = (payload ->> 'cohort_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_can_manage(actor, c.organization_id);

  replay := app.idempotency_lookup(actor, 'create_offering', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  SELECT * INTO v FROM app.program_versions WHERE id = (payload ->> 'version_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO app.cohort_offerings(cohort_id, organization_id, program_id, version_id, grant_id,
                                   starts_at, due_at, access_ends_at)
  VALUES (c.id, c.organization_id, v.program_id, v.id, (payload ->> 'grant_id')::uuid,
          (payload ->> 'starts_at')::timestamptz, (payload ->> 'due_at')::timestamptz,
          NULLIF(payload ->> 'access_ends_at', '')::timestamptz)
  RETURNING * INTO o;

  RETURN app.idempotency_store(actor, 'create_offering', payload, app.offering_json(o));
END $$;

/*
 * AC-063. spec/03: "Subsequent offering date changes apply only to selected
 * active incomplete enrollment IDs; validate all before changing any."
 *
 * So this is all-or-nothing twice over: every selected enrollment is checked
 * before any is written, and an enrollment that was not named keeps the dates
 * it was created with.
 */
CREATE FUNCTION app.handle_update_offering(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.cohort_offerings; ids uuid[]; bad uuid[];
        new_start timestamptz; new_due timestamptz; new_end timestamptz; changing_dates boolean;
BEGIN
  SELECT * INTO o FROM app.cohort_offerings
   WHERE id = (payload ->> 'offering_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_can_manage(actor, o.organization_id);

  new_start := COALESCE(NULLIF(payload ->> 'starts_at', '')::timestamptz, o.starts_at);
  new_due := COALESCE(NULLIF(payload ->> 'due_at', '')::timestamptz, o.due_at);
  new_end := CASE WHEN payload ? 'access_ends_at'
                  THEN NULLIF(payload ->> 'access_ends_at', '')::timestamptz
                  ELSE o.access_ends_at END;
  changing_dates := payload ? 'starts_at' OR payload ? 'due_at' OR payload ? 'access_ends_at';

  SELECT COALESCE(array_agg((value #>> '{}')::uuid), ARRAY[]::uuid[]) INTO ids
    FROM jsonb_array_elements(COALESCE(payload -> 'apply_to_enrollment_ids', '[]'::jsonb));

  IF changing_dates AND array_length(ids, 1) IS NOT NULL THEN
    /*
     * Validated before anything is written. An enrollment that belongs to
     * another offering, is cancelled, or is already completed cannot take new
     * dates — spec/02: "Completed enrollment schedules cannot be edited in v1."
     */
    SELECT array_agg(u) INTO bad FROM unnest(ids) AS u
     WHERE NOT EXISTS (
       SELECT 1 FROM app.enrollments e
       WHERE e.id = u AND e.offering_id = o.id
         AND e.status = 'active' AND e.completed_at IS NULL);
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION 'these enrollments cannot take new dates: %', array_to_string(bad, ', ')
        USING ERRCODE = '23514';
    END IF;

    -- The trigger would catch a start moved past an existing started_at, but
    -- naming them here lets the whole selection be rejected as one.
    SELECT array_agg(e.id) INTO bad FROM app.enrollments e
     WHERE e.id = ANY (ids) AND e.started_at IS NOT NULL AND new_start > e.started_at;
    IF bad IS NOT NULL THEN
      RAISE EXCEPTION 'start cannot move after learners already started: %',
        array_to_string(bad, ', ') USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE app.cohort_offerings SET
    starts_at = new_start, due_at = new_due, access_ends_at = new_end,
    status = COALESCE(NULLIF(payload ->> 'status', ''), status)
  WHERE id = o.id RETURNING * INTO o;

  IF changing_dates AND array_length(ids, 1) IS NOT NULL THEN
    UPDATE app.enrollments SET starts_at = new_start, due_at = new_due, access_ends_at = new_end
     WHERE id = ANY (ids);
  END IF;

  RETURN app.offering_json(o);
END $$;

-- ---------------------------------------------------------------------------
-- Enrollment
-- ---------------------------------------------------------------------------

/*
 * AC-020. spec/03: "Duplicate member/offering enroll returns existing row."
 *
 * ON CONFLICT DO NOTHING plus a returning SELECT, so a second assignment of the
 * same people returns the same enrollment ids and creates nothing.
 */
CREATE FUNCTION app.handle_enroll_cohort(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; o app.cohort_offerings; ids uuid[]; bad uuid[]; created integer;
BEGIN
  SELECT * INTO o FROM app.cohort_offerings WHERE id = (payload ->> 'offering_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_can_manage(actor, o.organization_id);

  replay := app.idempotency_lookup(actor, 'enroll_cohort', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  SELECT COALESCE(array_agg((value #>> '{}')::uuid), ARRAY[]::uuid[]) INTO ids
    FROM jsonb_array_elements(COALESCE(payload -> 'user_ids', '[]'::jsonb));
  IF array_length(ids, 1) IS NULL THEN
    RAISE EXCEPTION 'user_ids must be a non-empty array' USING ERRCODE = '22023';
  END IF;

  -- All-or-nothing: everyone must be an active member of this cohort.
  SELECT array_agg(u) INTO bad FROM unnest(ids) AS u
   WHERE NOT EXISTS (
     SELECT 1 FROM app.cohort_members cm
     WHERE cm.cohort_id = o.cohort_id AND cm.user_id = u AND cm.status = 'active');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'not active members of this cohort: %', array_to_string(bad, ', ')
      USING ERRCODE = '23514';
  END IF;

  WITH inserted AS (
    INSERT INTO app.enrollments(user_id, program_id, version_id, grant_id, organization_id,
                                offering_id, starts_at, due_at, access_ends_at)
    SELECT u, o.program_id, o.version_id, o.grant_id, o.organization_id, o.id,
           o.starts_at, o.due_at, o.access_ends_at
      FROM unnest(ids) AS u
    ON CONFLICT (user_id, offering_id) WHERE offering_id IS NOT NULL DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO created FROM inserted;

  RETURN app.idempotency_store(actor, 'enroll_cohort', payload, jsonb_build_object(
    'offering_id', o.id,
    'created', created,
    'enrollment_ids', COALESCE((
      SELECT jsonb_agg(e.id ORDER BY e.id) FROM app.enrollments e
      WHERE e.offering_id = o.id AND e.user_id = ANY (ids)), '[]'::jsonb)));
END $$;

/* spec/03: personal enrollment is admin-created from an individual grant. */
CREATE FUNCTION app.handle_enroll_personal(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; g app.program_grants; v app.program_versions; e app.enrollments;
        next_attempt integer;
BEGIN
  PERFORM app.assert_admin(actor);
  replay := app.idempotency_lookup(actor, 'enroll_personal', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  SELECT * INTO g FROM app.program_grants WHERE id = (payload ->> 'grant_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v FROM app.program_versions WHERE id = (payload ->> 'version_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  -- spec/03: "personal retake uses next attempt number."
  SELECT COALESCE(max(attempt) + 1, 1) INTO next_attempt
    FROM app.enrollments
   WHERE user_id = g.user_id AND grant_id = g.id AND version_id = v.id AND offering_id IS NULL;

  INSERT INTO app.enrollments(user_id, program_id, version_id, grant_id, attempt,
                              starts_at, due_at, access_ends_at)
  VALUES (g.user_id, v.program_id, v.id, g.id, next_attempt,
          (payload ->> 'starts_at')::timestamptz, (payload ->> 'due_at')::timestamptz,
          NULLIF(payload ->> 'access_ends_at', '')::timestamptz)
  RETURNING * INTO e;

  RETURN app.idempotency_store(actor, 'enroll_personal', payload,
    app.enrollment_json(e, g.user_id, now()));
END $$;

/*
 * AC-012's final clause. spec/03: "Admin can explicitly reactivate cancelled
 * enrollment if all predicates pass; this preserves progress."
 *
 * The predicates are not re-implemented here: setting status back to 'active'
 * re-runs the M02 relationship trigger, which requires an active cohort
 * membership. A learner still removed from the cohort cannot be reactivated,
 * and that holds for any path that writes the row.
 */
CREATE FUNCTION app.handle_update_enrollment(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; want text;
BEGIN
  SELECT * INTO e FROM app.enrollments WHERE id = (payload ->> 'enrollment_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  IF e.organization_id IS NULL THEN
    -- A personal enrollment has no organization, so only an admin can touch it.
    PERFORM app.assert_admin(actor);
  ELSIF NOT (app.platform_admin(actor) OR app.org_manager(actor, e.organization_id)) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  want := payload ->> 'status';
  IF want NOT IN ('active', 'cancelled') THEN
    RAISE EXCEPTION 'status must be active or cancelled' USING ERRCODE = '22023';
  END IF;

  UPDATE app.enrollments SET status = want WHERE id = e.id RETURNING * INTO e;
  RETURN app.enrollment_json(e, e.user_id, now());
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
