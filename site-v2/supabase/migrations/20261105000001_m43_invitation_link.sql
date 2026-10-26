-- M43 — invitations last 7 days, and their link is the application's own.
--
-- D-28 in HANDOFF.md, at the product owner's request (adapts spec/03's
-- 24-hour invite expiry). An invitation emailed on a Friday afternoon was
-- dead by Monday, and Supabase caps its own email links at 24 hours, so the
-- email can no longer carry an Auth link. Instead:
--
--   * an invitation is valid for 7 days (app.invitation_validity, used by
--     create_invitation and resend_invitation, otherwise as M06 left them);
--   * the email carries a random token of the application's own. Only its
--     SHA-256 is stored, on the invitation, so nobody who can read the
--     database (or see the invitation's id, as managers do) can rebuild the
--     link;
--   * redeeming the token (the person pressing Continue) finds a pending,
--     unexpired invitation. The application then signs a person who has
--     never set up their account straight in, and sends anybody else to the
--     invitation to sign in as usual (spec/03: accepting an invitation to an
--     existing identity requires their own login). The link dies when the
--     invitation is accepted, expires, or is resent.

ALTER TABLE app.invitations ADD COLUMN link_token_hash text;
CREATE UNIQUE INDEX invitations_link_token_hash ON app.invitations(link_token_hash)
  WHERE link_token_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION app.invitation_validity()
RETURNS interval LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT interval '7 days';
$$;

-- create_invitation and resend_invitation: M06's, with app.invitation_validity().

CREATE OR REPLACE FUNCTION app.handle_create_invitation(actor uuid, payload jsonb)
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
    VALUES (target, org_id, want_role, now() + app.invitation_validity(), actor)
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

CREATE OR REPLACE FUNCTION app.handle_resend_invitation(actor uuid, payload jsonb)
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
  VALUES (old.user_id, old.organization_id, old.role, now() + app.invitation_validity(), actor)
  RETURNING * INTO fresh;

  result := app.invitation_json(fresh);
  RETURN app.idempotency_store(actor, 'resend_invitation', payload, result);
END $$;

/* Stores the hash of a freshly generated link token on a pending invitation. */
CREATE OR REPLACE FUNCTION app.job_invitation_link(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE inv app.invitations; token_hash text;
BEGIN
  token_hash := p_payload ->> 'token_hash';
  IF token_hash IS NULL OR token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'token_hash must be a SHA-256 hex digest' USING ERRCODE = '22023';
  END IF;
  UPDATE app.invitations SET link_token_hash = token_hash
   WHERE id = (p_payload ->> 'invitation_id')::uuid AND status = 'pending' AND expires_at > now()
  RETURNING * INTO inv;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('invitation_id', inv.id, 'expires_at', inv.expires_at);
END $$;

/* The pending, unexpired invitation a link token belongs to. Changes nothing. */
CREATE OR REPLACE FUNCTION app.job_invitation_redeem(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE inv app.invitations; prof app.profiles;
BEGIN
  SELECT * INTO inv FROM app.invitations
   WHERE link_token_hash = p_payload ->> 'token_hash' AND status = 'pending' AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO prof FROM app.profiles WHERE id = inv.user_id;
  RETURN jsonb_build_object('invitation_id', inv.id, 'user_id', inv.user_id, 'email', prof.email,
                            'onboarded', prof.onboarded_at IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION app.job_allowed(job text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT job IN ('reminders.plan', 'reminders.claim', 'reminders.finish',
                 'reminders.recover', 'email.event', 'email.reconcile',
                 'retention.run', 'tutor.reserve', 'tutor.finish', 'tutor.reap',
                 'clone.finish', 'jobs.record', 'invitation.context', 'invitation.sent',
                 'invitation.link', 'invitation.redeem');
$$;

-- The job dispatcher, recreated with the two new jobs; otherwise exactly as
-- M42 left it.
CREATE OR REPLACE FUNCTION public.pglearn_job(job text, payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF NOT app.job_allowed(job) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  CASE job
    WHEN 'tutor.finish' THEN RETURN app.job_tutor_finish(payload);
    WHEN 'tutor.reap' THEN RETURN app.job_tutor_reap(payload);
    WHEN 'reminders.plan' THEN RETURN app.job_reminders_plan(payload);
    WHEN 'reminders.claim' THEN RETURN app.job_reminders_claim(payload);
    WHEN 'reminders.finish' THEN RETURN app.job_reminders_finish(payload);
    WHEN 'reminders.recover' THEN RETURN app.job_reminders_recover(payload);
    WHEN 'email.event' THEN RETURN app.job_email_event(payload);
    WHEN 'email.reconcile' THEN RETURN app.job_email_reconcile(payload);
    WHEN 'jobs.record' THEN RETURN app.job_record(payload);
    WHEN 'clone.finish' THEN
      RETURN app.job_clone_finish((payload ->> 'actor')::uuid, payload);
    WHEN 'retention.run' THEN RETURN app.job_retention_run(payload);
    WHEN 'invitation.context' THEN RETURN app.job_invitation_context(payload);
    WHEN 'invitation.sent' THEN RETURN app.job_invitation_sent(payload);
    WHEN 'invitation.link' THEN RETURN app.job_invitation_link(payload);
    WHEN 'invitation.redeem' THEN RETURN app.job_invitation_redeem(payload);
    ELSE
      RAISE EXCEPTION 'job handler not implemented: %', job USING ERRCODE = '0A000';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.pglearn_job(text, jsonb) FROM PUBLIC, anon, authenticated;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig); END LOOP;
END $$;
