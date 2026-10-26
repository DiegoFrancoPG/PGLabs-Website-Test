-- M42 — the invitation email is sent.
--
-- D-27 in HANDOFF.md. Creating or resending an invitation set up the Auth
-- identity and the invitation, and the email template existed, but nothing
-- ever sent it: an invited person heard nothing. The application now sends it
-- at once, with a fresh one-time sign-in link, through the configured provider
-- (D-23). These two service jobs are the database's part.
--
-- The link is never stored. It lives in the request that sends it, so the
-- outbox records the message only after the send, with its outcome:
-- 'accepted' (with the provider's id, so delivery callbacks apply as for any
-- other message), 'failed', or 'uncertain'. It is never 'pending' or
-- 'sending', so the reminder scheduler, which claims those, can never send an
-- invitation again without its link. Resending the invitation is how a failed
-- or uncertain one is retried, with a new link.

/* What the email needs about an invitation, read with the service role. */
CREATE OR REPLACE FUNCTION app.job_invitation_context(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE inv app.invitations; prof app.profiles; org_name text;
BEGIN
  SELECT * INTO inv FROM app.invitations WHERE id = (p_payload ->> 'invitation_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO prof FROM app.profiles WHERE id = inv.user_id;
  SELECT name INTO org_name FROM app.organizations WHERE id = inv.organization_id;
  RETURN jsonb_build_object(
    'invitation_id', inv.id, 'status', inv.status, 'expires_at', inv.expires_at,
    'user_id', inv.user_id, 'email', prof.email, 'display_name', prof.display_name,
    'onboarded', prof.onboarded_at IS NOT NULL, 'role', inv.role,
    'organization_id', inv.organization_id, 'organization_name', org_name,
    -- Already on its way: a retried request must not send a second email.
    'sent', EXISTS (SELECT 1 FROM app.notification_outbox o
                     WHERE o.event_key = 'invitation:' || inv.id::text
                       AND o.status IN ('accepted', 'delivered')));
END $$;

/* Records a sent invitation email, already finished. */
CREATE OR REPLACE FUNCTION app.job_invitation_sent(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE inv app.invitations; prof app.profiles; outcome text; row_status text; o app.notification_outbox;
BEGIN
  SELECT * INTO inv FROM app.invitations WHERE id = (p_payload ->> 'invitation_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO prof FROM app.profiles WHERE id = inv.user_id;
  outcome := p_payload ->> 'outcome';
  row_status := CASE outcome WHEN 'accepted' THEN 'accepted' WHEN 'rejected' THEN 'failed'
                             WHEN 'suppressed' THEN 'suppressed' ELSE 'uncertain' END;

  -- One row per invitation; a second send of the same one (a retry of the
  -- request) updates it rather than failing on the unique event key.
  INSERT INTO app.notification_outbox(user_id, kind, event_key, recipient_email, payload, status,
                                      scheduled_at, first_attempt_at, attempts, provider_id,
                                      last_error, accepted_at)
  VALUES (inv.user_id, 'invitation', 'invitation:' || inv.id::text, prof.email,
          jsonb_build_object('invitation_id', inv.id, 'organization_id', inv.organization_id,
                             'role', inv.role),
          row_status, now(), now(), 1,
          CASE WHEN row_status = 'accepted' THEN NULLIF(p_payload ->> 'provider_id', '') END,
          CASE WHEN row_status <> 'accepted' THEN left(p_payload ->> 'error', 500) END,
          CASE WHEN row_status = 'accepted' THEN now() END)
  ON CONFLICT (event_key) DO UPDATE
     SET status = excluded.status, attempts = app.notification_outbox.attempts + 1,
         provider_id = COALESCE(excluded.provider_id, app.notification_outbox.provider_id),
         last_error = excluded.last_error,
         accepted_at = COALESCE(excluded.accepted_at, app.notification_outbox.accepted_at)
  RETURNING * INTO o;

  RETURN jsonb_build_object('id', o.id, 'status', o.status);
END $$;

CREATE OR REPLACE FUNCTION app.job_allowed(job text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT job IN ('reminders.plan', 'reminders.claim', 'reminders.finish',
                 'reminders.recover', 'email.event', 'email.reconcile',
                 'retention.run', 'tutor.reserve', 'tutor.finish', 'tutor.reap',
                 'clone.finish', 'jobs.record', 'invitation.context', 'invitation.sent');
$$;

-- The job dispatcher, recreated with the two new jobs; otherwise exactly as
-- M28 left it.
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
