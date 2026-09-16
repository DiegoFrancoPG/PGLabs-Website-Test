-- T07 — cohorts, cohort membership and catalog grants.

CREATE FUNCTION app.cohort_json(c app.cohorts)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', c.id, 'organization_id', c.organization_id,
                            'name', c.name, 'archived_at', c.archived_at);
$$;

CREATE FUNCTION app.grant_json(g app.program_grants)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', g.id, 'program_id', g.program_id,
                            'organization_id', g.organization_id, 'user_id', g.user_id,
                            'starts_at', g.starts_at, 'ends_at', g.ends_at,
                            'status', g.status, 'source', g.source);
$$;

/* Shared scope check: a manager acts only inside an organization they manage. */
CREATE FUNCTION app.assert_can_manage(actor uuid, org uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF org IS NULL THEN
    RAISE EXCEPTION 'organization_id is required' USING ERRCODE = '22023';
  END IF;
  IF NOT (app.platform_admin(actor) OR app.org_manager(actor, org)) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Cohorts
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.handle_list_cohorts(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid;
BEGIN
  org := NULLIF(payload ->> 'organization_id', '')::uuid;
  IF org IS NOT NULL THEN PERFORM app.assert_can_manage(actor, org); END IF;

  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(app.cohort_json(c) ORDER BY c.name)
      FROM app.cohorts c
      WHERE (org IS NULL OR c.organization_id = org)
        -- Scope comes from the database, so omitting the filter cannot widen it.
        AND (app.platform_admin(actor) OR app.org_manager(actor, c.organization_id))
    ), '[]'::jsonb),
    'next_cursor', NULL);
END $$;

CREATE FUNCTION app.handle_create_cohort(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; org uuid; c app.cohorts;
BEGIN
  org := NULLIF(payload ->> 'organization_id', '')::uuid;
  PERFORM app.assert_can_manage(actor, org);

  replay := app.idempotency_lookup(actor, 'create_cohort', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  INSERT INTO app.cohorts(organization_id, name)
  VALUES (org, btrim(payload ->> 'name'))
  RETURNING * INTO c;

  RETURN app.idempotency_store(actor, 'create_cohort', payload, app.cohort_json(c));
END $$;

CREATE FUNCTION app.handle_update_cohort(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app.cohorts;
BEGIN
  SELECT * INTO c FROM app.cohorts WHERE id = (payload ->> 'cohort_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_can_manage(actor, c.organization_id);

  UPDATE app.cohorts SET
    name = COALESCE(NULLIF(btrim(payload ->> 'name'), ''), name),
    archived_at = CASE
      WHEN payload ? 'archived' THEN
        CASE WHEN (payload ->> 'archived')::boolean THEN COALESCE(archived_at, now()) ELSE NULL END
      ELSE archived_at END
  WHERE id = c.id
  RETURNING * INTO c;

  RETURN app.cohort_json(c);
END $$;

CREATE FUNCTION app.handle_list_cohort_members(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app.cohorts;
BEGIN
  SELECT * INTO c FROM app.cohorts WHERE id = (payload ->> 'cohort_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_can_manage(actor, c.organization_id);

  RETURN jsonb_build_object(
    'items', COALESCE((
      -- spec/02's disclosure matrix: a manager sees roster name, email and
      -- status. Nothing else about the person is exposed here.
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', p.id, 'display_name', p.display_name, 'email', p.email,
               'status', cm.status, 'membership_status', m.status) ORDER BY p.display_name)
      FROM app.cohort_members cm
      JOIN app.profiles p ON p.id = cm.user_id
      JOIN app.memberships m ON m.user_id = cm.user_id AND m.organization_id = cm.organization_id
      WHERE cm.cohort_id = c.id
    ), '[]'::jsonb),
    'next_cursor', NULL);
END $$;

/*
 * spec/03: "Adding a new cohort member does not auto-enroll them; UI provides
 * the assignment action."
 *
 * All-or-nothing: every user id is validated before any row is written, so a
 * partly-valid list changes nothing (spec/04 for the cohort screen).
 */
CREATE FUNCTION app.handle_add_cohort_members(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; c app.cohorts; ids uuid[]; bad uuid[];
BEGIN
  SELECT * INTO c FROM app.cohorts WHERE id = (payload ->> 'cohort_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_can_manage(actor, c.organization_id);

  replay := app.idempotency_lookup(actor, 'add_cohort_members', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  IF c.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cohort is archived' USING ERRCODE = '23514';
  END IF;

  SELECT array_agg((value #>> '{}')::uuid) INTO ids
    FROM jsonb_array_elements(payload -> 'user_ids');
  IF ids IS NULL OR array_length(ids, 1) IS NULL THEN
    RAISE EXCEPTION 'user_ids must be a non-empty array' USING ERRCODE = '22023';
  END IF;

  -- Anyone not already an invited or active member of THIS organization is
  -- invalid; the response names them without revealing other organizations'
  -- records (spec/04).
  SELECT array_agg(u) INTO bad FROM unnest(ids) AS u
   WHERE NOT EXISTS (
     SELECT 1 FROM app.memberships m
     WHERE m.user_id = u AND m.organization_id = c.organization_id
       AND m.status IN ('invited', 'active'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'not members of this organization: %', array_to_string(bad, ', ')
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.cohort_members(cohort_id, organization_id, user_id)
  SELECT c.id, c.organization_id, u FROM unnest(ids) AS u
  ON CONFLICT (cohort_id, user_id) DO UPDATE SET status = 'active';

  RETURN app.idempotency_store(actor, 'add_cohort_members', payload,
    jsonb_build_object('cohort_id', c.id, 'added', array_length(ids, 1)));
END $$;

/*
 * spec/03: "Removing cohort member changes its status=removed and cancels
 * active enrollments for that offering context; re-adding does not silently
 * restore prior enrollment."
 *
 * Progress is never touched. spec/02: "Cancellation never deletes progress."
 */
CREATE FUNCTION app.handle_remove_cohort_member(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app.cohorts; target uuid; cancelled integer;
BEGIN
  SELECT * INTO c FROM app.cohorts WHERE id = (payload ->> 'cohort_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM app.assert_can_manage(actor, c.organization_id);

  target := (payload ->> 'user_id')::uuid;
  UPDATE app.cohort_members SET status = 'removed'
   WHERE cohort_id = c.id AND user_id = target;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  -- Only enrollments reached through THIS cohort's offerings. An enrollment in
  -- another cohort, or a personal one, is untouched.
  WITH affected AS (
    UPDATE app.enrollments e SET status = 'cancelled'
     WHERE e.user_id = target AND e.status = 'active'
       AND e.offering_id IN (SELECT o.id FROM app.cohort_offerings o WHERE o.cohort_id = c.id)
    RETURNING 1)
  SELECT count(*) INTO cancelled FROM affected;

  RETURN jsonb_build_object('cohort_id', c.id, 'user_id', target,
                            'status', 'removed', 'cancelled_enrollments', cancelled);
END $$;

-- ---------------------------------------------------------------------------
-- Catalog grants
-- ---------------------------------------------------------------------------

/*
 * AC-013. A manager sees the grants of organizations they manage and nothing
 * else — in particular never a personal grant, whose subject is a user rather
 * than an organization, and never another organization's catalog.
 */
CREATE FUNCTION app.handle_list_grants(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid;
BEGIN
  org := NULLIF(payload ->> 'organization_id', '')::uuid;
  IF org IS NOT NULL THEN PERFORM app.assert_can_manage(actor, org); END IF;

  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(app.grant_json(g) ORDER BY g.created_at DESC)
      FROM app.program_grants g
      WHERE (org IS NULL OR g.organization_id = org)
        AND (
          app.platform_admin(actor)
          -- A personal grant has no organization, so this can never match one.
          OR (g.organization_id IS NOT NULL AND app.org_manager(actor, g.organization_id))
        )
    ), '[]'::jsonb),
    'next_cursor', NULL);
END $$;

CREATE FUNCTION app.handle_create_grant(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; g app.program_grants; org uuid; usr uuid;
BEGIN
  -- Grants are the catalog itself, so only a platform admin may issue one.
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  replay := app.idempotency_lookup(actor, 'create_grant', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  org := NULLIF(payload ->> 'organization_id', '')::uuid;
  usr := NULLIF(payload ->> 'user_id', '')::uuid;
  IF (org IS NULL) = (usr IS NULL) THEN
    RAISE EXCEPTION 'exactly one of organization_id or user_id is required'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO app.program_grants(program_id, organization_id, user_id, starts_at, ends_at)
  VALUES ((payload ->> 'program_id')::uuid, org, usr,
          (payload ->> 'starts_at')::timestamptz,
          NULLIF(payload ->> 'ends_at', '')::timestamptz)
  RETURNING * INTO g;

  RETURN app.idempotency_store(actor, 'create_grant', payload, app.grant_json(g));
END $$;

/*
 * Dates and status only. The subject is immutable, enforced by the M02 trigger
 * rather than here, so it holds whatever path reaches the table.
 *
 * spec/03: "Backend checks actual current grant each request, so
 * revoking/shortening it takes effect without rewriting enrollment history."
 */
CREATE FUNCTION app.handle_update_grant(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE g app.program_grants;
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  UPDATE app.program_grants SET
    starts_at = COALESCE(NULLIF(payload ->> 'starts_at', '')::timestamptz, starts_at),
    ends_at = CASE WHEN payload ? 'ends_at'
                   THEN NULLIF(payload ->> 'ends_at', '')::timestamptz ELSE ends_at END,
    status = COALESCE(NULLIF(payload ->> 'status', ''), status)
  WHERE id = (payload ->> 'grant_id')::uuid
  RETURNING * INTO g;

  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN app.grant_json(g);
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
