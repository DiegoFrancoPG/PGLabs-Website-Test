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

CREATE FUNCTION app.handle_get_me(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'display_name', p.display_name,
    'timezone', p.timezone,
    'reminders_enabled', p.reminders_enabled,
    'onboarded', p.onboarded_at IS NOT NULL,
    'is_platform_admin', EXISTS (SELECT 1 FROM app.platform_admins a WHERE a.user_id = p.id),
    'organizations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'role', m.role)
                       ORDER BY o.name)
      FROM app.memberships m
      JOIN app.organizations o ON o.id = m.organization_id
      WHERE m.user_id = p.id AND m.status = 'active' AND o.status = 'active'
    ), '[]'::jsonb)
  )
  FROM app.profiles p WHERE p.id = actor;
$$;

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
REVOKE ALL ON FUNCTION app.action_allows_pending_onboarding(text) FROM PUBLIC, anon, authenticated;
