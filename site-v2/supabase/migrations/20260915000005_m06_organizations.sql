-- T06 — organization and invitation administration.
--
-- Added as its own migration rather than folded into M03: M03 is applied to a
-- database that now holds seeded data, and keeping each task's handlers
-- separate makes the history readable.

-- ---------------------------------------------------------------------------
-- Idempotency
--
-- spec/05: "Idempotency records are scoped actor/action/key and hash canonical
-- normalized JSON. Same key/different body=409 ... Each transaction
-- reauthorizes before replay; cached success is not an access bypass."
--
-- The last sentence is the important one: a replay returns the stored response
-- only AFTER the handler has re-checked that the caller is still allowed to do
-- it. Authorization happens before this is consulted, never after.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.canonical_hash(payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  -- Keys sorted and the request id excluded, so the same intent sent twice
  -- hashes identically regardless of key order.
  -- sha256() is built in; pgcrypto's digest() would be an extra dependency.
  SELECT encode(
    sha256(convert_to(
      (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
         FROM jsonb_each(payload) AS e(k, v) WHERE k <> 'request_id')::text,
      'UTF8')), 'hex');
$$;

/* Returns a stored response for an identical replay, or NULL to proceed. */
-- The parameter is prefixed because `action` is also a column on
-- app.idempotency_records, and an unprefixed reference is ambiguous.
CREATE FUNCTION app.idempotency_lookup(actor uuid, p_action text, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE key uuid; existing app.idempotency_records;
BEGIN
  IF NOT (payload ? 'request_id') THEN RETURN NULL; END IF;
  key := (payload ->> 'request_id')::uuid;

  SELECT * INTO existing FROM app.idempotency_records r
    WHERE r.actor_id = actor AND r.action = p_action AND r.request_id = key;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF existing.request_hash <> app.canonical_hash(payload) THEN
    -- spec/05: same key, different body is a conflict, never a silent replay.
    RAISE EXCEPTION 'idempotency key reused with a different request'
      USING ERRCODE = '23505';
  END IF;
  RETURN existing.response;
END $$;

CREATE FUNCTION app.idempotency_store(actor uuid, p_action text, payload jsonb, response jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF payload ? 'request_id' THEN
    INSERT INTO app.idempotency_records(actor_id, action, request_id, request_hash, response)
    VALUES (actor, p_action, (payload ->> 'request_id')::uuid, app.canonical_hash(payload), response)
    ON CONFLICT (actor_id, action, request_id) DO NOTHING;
  END IF;
  RETURN response;
END $$;

-- ---------------------------------------------------------------------------
-- Organizations
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.organization_json(o app.organizations)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', o.id, 'name', o.name, 'timezone', o.timezone, 'status', o.status);
$$;

/*
 * A platform admin sees every organization; a manager sees only the ones they
 * manage. The scope is derived from the database, never from the request.
 */
CREATE FUNCTION app.handle_list_organizations(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE limit_n integer; items jsonb;
BEGIN
  limit_n := LEAST(GREATEST(COALESCE((payload ->> 'limit')::integer, 20), 1), 100);

  SELECT COALESCE(jsonb_agg(app.organization_json(o) ORDER BY o.name), '[]'::jsonb)
    INTO items
  FROM app.organizations o
  WHERE app.platform_admin(actor) OR app.org_manager(actor, o.id);

  RETURN jsonb_build_object(
    'items', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
                FROM (SELECT x FROM jsonb_array_elements(items) AS x LIMIT limit_n) s),
    'next_cursor', NULL
  );
END $$;

/*
 * Creating an organization also provisions its first manager's membership.
 * spec/02: "Initial organization creation includes manager provisioning and
 * does not make organization usable until a manager membership exists."
 *
 * The Auth identity for that manager is created by the application before this
 * runs, because Auth and Postgres cannot share one transaction (spec/03). The
 * manager's user id arrives as a selector; authority is the admin check.
 */
CREATE FUNCTION app.handle_create_organization(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; org app.organizations; manager uuid; result jsonb;
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  replay := app.idempotency_lookup(actor, 'create_organization', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  manager := (payload ->> 'manager_user_id')::uuid;
  IF manager IS NULL THEN
    RAISE EXCEPTION 'manager_user_id is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO app.organizations(name, timezone)
  VALUES (btrim(payload ->> 'name'), COALESCE(NULLIF(payload ->> 'timezone', ''), 'UTC'))
  RETURNING * INTO org;

  -- Invited, not active: the manager becomes active when they accept.
  INSERT INTO app.memberships(organization_id, user_id, role, status)
  VALUES (org.id, manager, 'manager', 'invited');

  result := app.organization_json(org);
  RETURN app.idempotency_store(actor, 'create_organization', payload, result);
END $$;

CREATE FUNCTION app.handle_update_organization(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org app.organizations; target uuid;
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  target := (payload ->> 'organization_id')::uuid;

  UPDATE app.organizations SET
    name = COALESCE(NULLIF(btrim(payload ->> 'name'), ''), name),
    timezone = COALESCE(NULLIF(payload ->> 'timezone', ''), timezone),
    status = COALESCE(NULLIF(payload ->> 'status', ''), status)
  WHERE id = target
  RETURNING * INTO org;

  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN app.organization_json(org);
END $$;

/*
 * Membership changes are platform-admin only (contracts/api.json x-access
 * admin), so a manager cannot promote anyone — including themselves — and
 * cannot touch another organization at all.
 *
 * The last-manager rule is NOT enforced here. It lives in the M02 constraint
 * trigger, so it holds no matter which path reaches the table.
 */
CREATE FUNCTION app.handle_update_membership(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org_id uuid; target uuid; updated app.memberships;
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  org_id := (payload ->> 'organization_id')::uuid;
  target := (payload ->> 'user_id')::uuid;

  UPDATE app.memberships SET
    role = COALESCE(NULLIF(payload ->> 'role', ''), role),
    status = COALESCE(NULLIF(payload ->> 'status', ''), status)
  WHERE organization_id = org_id AND user_id = target
  RETURNING * INTO updated;

  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  RETURN jsonb_build_object(
    'organization_id', updated.organization_id,
    'user_id', updated.user_id,
    'role', updated.role,
    'status', updated.status
  );
END $$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

/*
 * spec/03: "Managers may invite only learners into their own organization;
 * admin can invite managers or personal learners."
 *
 * So a manager inviting a manager is refused here, which is half of AC-011.
 * The Auth identity and the profile already exist by the time this runs; the
 * application creates them first, because Auth and Postgres cannot be one
 * transaction.
 */
CREATE FUNCTION app.handle_create_invitation(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; org_id uuid; target uuid; want_role text;
        existing app.memberships; inv app.invitations; result jsonb;
BEGIN
  replay := app.idempotency_lookup(actor, 'create_invitation', payload);

  org_id := NULLIF(payload ->> 'organization_id', '')::uuid;
  target := (payload ->> 'user_id')::uuid;
  want_role := COALESCE(payload ->> 'role', 'learner');

  IF target IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22023';
  END IF;

  -- Authorization runs BEFORE any replay is returned: spec/05 is explicit that
  -- a cached success is not an access bypass.
  IF org_id IS NULL THEN
    -- A personal invitation has no organization, so only an admin may issue it.
    IF NOT app.platform_admin(actor) THEN
      RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF app.platform_admin(actor) THEN
    NULL;  -- admin may invite either role into any organization
  ELSIF app.org_manager(actor, org_id) THEN
    IF want_role <> 'learner' THEN
      RAISE EXCEPTION 'a manager may invite learners only' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  IF replay IS NOT NULL THEN RETURN replay; END IF;

  -- spec/03: "Existing active membership returns existing status without
  -- another invitation."
  IF org_id IS NOT NULL THEN
    SELECT * INTO existing FROM app.memberships
      WHERE organization_id = org_id AND user_id = target;
    IF FOUND AND existing.status = 'active' THEN
      RETURN app.idempotency_store(actor, 'create_invitation', payload,
        jsonb_build_object('id', NULL, 'user_id', target, 'organization_id', org_id,
                           'role', existing.role, 'status', 'accepted',
                           'expires_at', now(), 'delivery_status', 'pending'));
    END IF;
  END IF;

  -- One pending invitation per (user, organization): the partial unique index
  -- in M01 enforces it, so a second attempt reuses the existing row.
  SELECT * INTO inv FROM app.invitations
    WHERE user_id = target AND organization_id IS NOT DISTINCT FROM org_id
      AND status = 'pending';

  IF NOT FOUND THEN
    INSERT INTO app.invitations(user_id, organization_id, role, expires_at, created_by)
    VALUES (target, org_id, want_role, now() + interval '24 hours', actor)
    RETURNING * INTO inv;
  END IF;

  IF org_id IS NOT NULL THEN
    INSERT INTO app.memberships(organization_id, user_id, role, status)
    VALUES (org_id, target, want_role, 'invited')
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END IF;

  result := app.invitation_json(inv);
  RETURN app.idempotency_store(actor, 'create_invitation', payload, result);
END $$;

/*
 * spec/03: "resend expires the old pending invitation and creates a new one,
 * preserving user/cohort assignments. Repeated resend request ID reuses its
 * result."
 */
CREATE FUNCTION app.handle_resend_invitation(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; old app.invitations; fresh app.invitations; result jsonb;
BEGIN
  SELECT * INTO old FROM app.invitations
    WHERE id = (payload ->> 'invitation_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  -- Reauthorized before any replay, for the same reason as create.
  IF old.organization_id IS NULL THEN
    IF NOT app.platform_admin(actor) THEN
      RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT (app.platform_admin(actor) OR app.org_manager(actor, old.organization_id)) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  replay := app.idempotency_lookup(actor, 'resend_invitation', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  IF old.status = 'accepted' THEN
    RAISE EXCEPTION 'invitation has already been accepted' USING ERRCODE = '23514';
  END IF;

  -- The old one is expired rather than deleted, so the audit trail survives.
  UPDATE app.invitations SET status = 'expired' WHERE id = old.id;

  INSERT INTO app.invitations(user_id, organization_id, role, expires_at, created_by)
  VALUES (old.user_id, old.organization_id, old.role, now() + interval '24 hours', actor)
  RETURNING * INTO fresh;

  result := app.invitation_json(fresh);
  RETURN app.idempotency_store(actor, 'resend_invitation', payload, result);
END $$;

REVOKE ALL ON FUNCTION app.canonical_hash(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.idempotency_lookup(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.idempotency_store(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.organization_json(app.organizations) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.handle_list_organizations(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.handle_create_organization(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.handle_update_organization(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.handle_update_membership(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.handle_create_invitation(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.handle_resend_invitation(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dispatcher allowlist. Deny-by-default, so each task adds only what it ships.
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
    ELSE RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.pglearn_rpc(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pglearn_rpc(text, jsonb) TO authenticated;
