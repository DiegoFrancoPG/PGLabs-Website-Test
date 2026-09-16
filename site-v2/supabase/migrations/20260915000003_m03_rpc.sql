-- M03 — the single user-facing entrypoint.
--
-- spec/02 (ADR-03): user-scoped requests invoke one explicitly whitelisted
-- public.pglearn_rpc(action text, payload jsonb) dispatcher with server-derived
-- auth.uid(). Each internal handler enforces row ownership and role.
--
-- Three properties this file is responsible for:
--
--   1. Identity comes from auth.uid() alone. No payload field can supply or
--      override the actor. spec/02: "browser-supplied role/user IDs never grant
--      authority."
--   2. The action is matched against a LITERAL allowlist. Nothing is ever
--      concatenated into SQL, so no action name can reach the parser.
--   3. An action that is not on the list is denied with exactly the same error
--      as an action the caller is not allowed to use, so the dispatcher cannot
--      be used to enumerate which operations exist.
--
-- Handlers are added by the task that owns their feature. get_me is here
-- because the dispatcher needs one real action to be provably working.

-- ---------------------------------------------------------------------------
-- Actions exempt from the onboarding requirement (spec/02): a user who has not
-- finished setting up their account still has to be able to see who they are
-- and accept the invitation that gets them onboarded.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.action_allows_pending_onboarding(action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT action IN ('get_me', 'get_invitation', 'accept_invitation');
$$;

-- ---------------------------------------------------------------------------
-- Handlers. Each receives the VERIFIED actor id, never a payload-supplied one.
-- ---------------------------------------------------------------------------

-- get_me returns exactly contracts/api.json's Me schema: a Profile, the
-- platform_admin flag, and the organization contexts. The shape is the
-- contract's, not a convenience shape, because spec/01 makes api.json
-- authoritative for it.
CREATE FUNCTION app.handle_get_me(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id,
      'email', p.email,
      'display_name', p.display_name,
      'timezone', p.timezone,
      'reminders_enabled', p.reminders_enabled,
      'onboarded_at', p.onboarded_at
    ),
    'platform_admin', EXISTS (SELECT 1 FROM app.platform_admins a WHERE a.user_id = p.id),
    -- Removed memberships are history, not a context the user can act in.
    'contexts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'organization_id', o.id,
               'organization_name', o.name,
               'role', m.role,
               'status', m.status) ORDER BY o.name)
      FROM app.memberships m
      JOIN app.organizations o ON o.id = m.organization_id
      WHERE m.user_id = p.id AND m.status IN ('invited', 'active') AND o.status = 'active'
    ), '[]'::jsonb)
  )
  FROM app.profiles p WHERE p.id = actor;
$$;

-- update_me is the whole of what a user may change about themselves.
--
-- spec/02: "Public profile edit allows display_name/timezone/reminders_enabled
-- only." spec/05: "The API strips unknown fields; RPC validates again and
-- rejects extra fields for mutations." So this rejects rather than ignores an
-- unknown key: silently dropping an attempt to set platform_admin would let a
-- caller believe it had worked.
CREATE FUNCTION app.handle_update_me(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE allowed constant text[] := ARRAY['display_name', 'timezone', 'reminders_enabled'];
        extra text[]; new_name text; new_tz text; new_reminders boolean;
BEGIN
  SELECT array_agg(k) INTO extra
    FROM jsonb_object_keys(payload) AS k WHERE k <> ALL (allowed);
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION 'unknown field(s): %', array_to_string(extra, ', ') USING ERRCODE = '22023';
  END IF;
  IF payload = '{}'::jsonb THEN
    RAISE EXCEPTION 'at least one field is required' USING ERRCODE = '22023';
  END IF;

  IF payload ? 'display_name' THEN
    new_name := btrim(payload ->> 'display_name');
    IF new_name IS NULL OR char_length(new_name) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'display_name must be 1 to 120 characters' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF payload ? 'timezone' THEN
    new_tz := payload ->> 'timezone';
  END IF;
  IF payload ? 'reminders_enabled' THEN
    IF jsonb_typeof(payload -> 'reminders_enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'reminders_enabled must be a boolean' USING ERRCODE = '22023';
    END IF;
    new_reminders := (payload ->> 'reminders_enabled')::boolean;
  END IF;

  -- The row is addressed by the verified actor. Email, status, onboarded_at and
  -- admin membership are not reachable from here at all.
  UPDATE app.profiles SET
    display_name = COALESCE(new_name, display_name),
    timezone = COALESCE(new_tz, timezone),
    reminders_enabled = COALESCE(new_reminders, reminders_enabled)
  WHERE id = actor;

  RETURN app.handle_get_me(actor, '{}'::jsonb);
END $$;

-- ---------------------------------------------------------------------------
-- The dispatcher
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.pglearn_rpc(action text, payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; allow_pending boolean;
BEGIN
  -- 1. Identity is derived server-side. Never from the payload.
  actor := auth.uid();
  IF actor IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- 2. The account must be usable before any action is considered.
  allow_pending := app.action_allows_pending_onboarding(action);
  IF NOT app.actor_active(actor, allow_pending) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  -- 3. Literal allowlist. An unknown action falls through to the same denial
  --    as an unauthorized one, so this cannot be used to enumerate operations.
  CASE action
    WHEN 'get_me' THEN RETURN app.handle_get_me(actor, payload);
    WHEN 'update_me' THEN RETURN app.handle_update_me(actor, payload);
    ELSE RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END CASE;
END $$;

-- ---------------------------------------------------------------------------
-- Privileges: authenticated only. Never anon, never PUBLIC.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.pglearn_rpc(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pglearn_rpc(text, jsonb) TO authenticated;

-- Handlers stay private: they are reachable only through the dispatcher, which
-- is the only thing that has established who the actor is.
REVOKE ALL ON FUNCTION app.handle_get_me(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.handle_update_me(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.action_allows_pending_onboarding(text) FROM PUBLIC, anon, authenticated;
