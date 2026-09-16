-- T21 — delivery callbacks and their reconciliation.
--
-- spec/05: "Verified webhooks dedupe by provider event ID; out-of-order
-- accepted/delivered cannot downgrade delivered, but bounce/failure is
-- recorded as final failed when appropriate. If webhook arrives before
-- provider ID is saved, retain event ID/type/email ID and reconcile after
-- finish. … Suppress learning mail to known bounced recipients until operator
-- clears the problem; do not retry bounced addresses automatically."
--
-- Verification happens in the application, against the raw body, before any of
-- this is reached: a forged callback is a 401 and writes nothing at all.

/*
 * The delivery state machine, as a rank. A callback may only ever move a
 * message forward.
 *
 * spec/05: "out-of-order accepted/delivered cannot downgrade delivered". The
 * provider does not promise order, so an 'accepted' arriving after a
 * 'delivered' is normal and must be ignored rather than believed.
 */
CREATE FUNCTION app.delivery_rank(status text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE status
    WHEN 'pending' THEN 0
    WHEN 'sending' THEN 1
    WHEN 'uncertain' THEN 2
    WHEN 'accepted' THEN 3
    WHEN 'delivered' THEN 4
    -- A bounce or a complaint is terminal whenever it arrives: it is news
    -- about the mailbox, not about the order of our own bookkeeping.
    WHEN 'failed' THEN 5
    WHEN 'suppressed' THEN 5
    ELSE 0
  END;
$$;

CREATE FUNCTION app.job_email_event(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  -- event_kind, not kind: app.notification_outbox has a `kind` column.
  event_id text; email_id text; event_kind text; t timestamptz;
  o app.notification_outbox; next_status text; already boolean;
BEGIN
  t := COALESCE((p_payload ->> 'now')::timestamptz, now());
  event_id := p_payload ->> 'provider_event_id';
  email_id := p_payload ->> 'provider_email_id';
  event_kind := p_payload ->> 'type';

  IF event_id IS NULL OR event_kind IS NULL THEN
    RAISE EXCEPTION 'a verified event carries an id and a type' USING ERRCODE = '22023';
  END IF;

  /*
   * Dedupe by the provider's event id. A webhook that is delivered twice —
   * which every provider does eventually — must leave exactly one record and
   * change nothing the second time.
   */
  INSERT INTO app.email_webhook_events(provider_event_id, provider_email_id, event_type, received_at)
  VALUES (event_id, COALESCE(email_id, ''), event_kind, t)
  ON CONFLICT (provider_event_id) DO NOTHING;
  already := NOT FOUND;
  IF already THEN
    RETURN jsonb_build_object('duplicate', true, 'applied', false);
  END IF;

  next_status := CASE event_kind
    WHEN 'delivered' THEN 'delivered'
    WHEN 'accepted' THEN 'accepted'
    WHEN 'bounced' THEN 'failed'
    WHEN 'complained' THEN 'failed'
    ELSE 'failed'
  END;

  /*
   * The message this is about — found by the provider's id, which is saved
   * when the send is acknowledged. If the callback overtook that save there is
   * no row yet; the event record above is kept, and reconciliation applies it
   * once the id lands ("If webhook arrives before provider ID is saved, retain
   * event ID/type/email ID and reconcile after finish").
   */
  SELECT * INTO o FROM app.notification_outbox
   WHERE provider_id = email_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('duplicate', false, 'applied', false, 'pending_reconciliation', true);
  END IF;

  IF app.delivery_rank(next_status) <= app.delivery_rank(o.status) THEN
    -- Already at or past this state: an out-of-order callback changes nothing.
    RETURN jsonb_build_object('duplicate', false, 'applied', false, 'status', o.status);
  END IF;

  UPDATE app.notification_outbox
     SET status = next_status,
         delivered_at = CASE WHEN next_status = 'delivered' THEN t ELSE o.delivered_at END,
         last_error = CASE WHEN next_status = 'failed' THEN event_kind ELSE o.last_error END,
         claimed_until = NULL
   WHERE id = o.id;

  RETURN jsonb_build_object('duplicate', false, 'applied', true, 'status', next_status);
END $$;

/*
 * Reconciliation for callbacks that arrived before the provider id was saved.
 * Run after every send finishes, and cheap when there is nothing to do.
 */
CREATE FUNCTION app.job_email_reconcile(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t timestamptz; applied integer := 0; e record; o app.notification_outbox; next_status text;
BEGIN
  t := COALESCE((p_payload ->> 'now')::timestamptz, now());

  FOR e IN
    SELECT w.* FROM app.email_webhook_events w
     JOIN app.notification_outbox n ON n.provider_id = w.provider_email_id
    ORDER BY w.received_at
  LOOP
    SELECT * INTO o FROM app.notification_outbox
     WHERE provider_id = e.provider_email_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    next_status := CASE e.event_type
      WHEN 'delivered' THEN 'delivered'
      WHEN 'accepted' THEN 'accepted'
      WHEN 'bounced' THEN 'failed'
      WHEN 'complained' THEN 'failed'
      ELSE 'failed'
    END;

    CONTINUE WHEN app.delivery_rank(next_status) <= app.delivery_rank(o.status);

    UPDATE app.notification_outbox
       SET status = next_status,
           delivered_at = CASE WHEN next_status = 'delivered' THEN e.received_at ELSE o.delivered_at END,
           last_error = CASE WHEN next_status = 'failed' THEN e.event_type ELSE o.last_error END
     WHERE id = o.id;
    applied := applied + 1;
  END LOOP;

  RETURN jsonb_build_object('applied', applied);
END $$;

/*
 * A bounced address stops receiving learning mail until somebody looks at it.
 * spec/05: "Suppress learning mail to known bounced recipients until operator
 * clears the problem; do not retry bounced addresses automatically."
 */
CREATE FUNCTION app.email_bounced(address text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.notification_outbox o
     WHERE lower(o.recipient_email) = lower(address)
       AND o.status = 'failed'
       AND o.last_error IN ('bounced', 'complained'));
$$;

CREATE OR REPLACE FUNCTION app.job_allowed(job text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT job IN ('reminders.plan', 'reminders.claim', 'reminders.finish',
                 'reminders.recover', 'email.event', 'email.reconcile',
                 'retention.run', 'tutor.reserve', 'tutor.finish', 'tutor.reap',
                 'jobs.record');
$$;

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
    ELSE
      -- Retention at T28.
      RAISE EXCEPTION 'job handler not implemented: %', job USING ERRCODE = '0A000';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.pglearn_job(text, jsonb) FROM PUBLIC, anon, authenticated;

/*
 * A learning reminder is never planned for an address that has bounced. The
 * scheduler's candidate query gains one condition; everything else about it is
 * unchanged.
 */
CREATE OR REPLACE FUNCTION app.reminder_candidates(t timestamptz)
RETURNS TABLE (
  user_id uuid, enrollment_id uuid, timezone text, local_date date,
  rule text, campaign_key text, event_key text, due_at timestamptz, recipient_email text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH eligible AS (
    SELECT e.id, e.user_id, e.due_at, e.starts_at, e.last_activity_at,
           p.timezone, p.email,
           (t AT TIME ZONE p.timezone)::date AS local_date,
           extract(hour FROM (t AT TIME ZONE p.timezone))::int AS local_hour,
           (e.due_at AT TIME ZONE p.timezone)::date AS due_local_date,
           GREATEST(e.starts_at, COALESCE(e.last_activity_at, e.starts_at)) AS idle_since,
           (SELECT max(o.scheduled_at) FROM app.notification_outbox o
             WHERE o.user_id = e.user_id AND o.kind = 'inactivity'
               AND o.status IN ('sending','accepted','delivered','uncertain')) AS last_inactivity
      FROM app.enrollments e
      JOIN app.profiles p ON p.id = e.user_id
     WHERE e.status = 'active'
       AND e.completed_at IS NULL
       AND p.status = 'active'
       AND p.onboarded_at IS NOT NULL
       AND p.reminders_enabled
       AND NOT app.email_bounced(p.email)
       AND app.enrollment_availability(e.user_id, e.id, t) = 'available'
  ), ruled AS (
    SELECT el.*,
      CASE
        WHEN t > el.due_at THEN 'overdue'
        WHEN el.local_date = el.due_local_date THEN 'due_today'
        WHEN el.due_local_date - el.local_date = 3 THEN 'due_soon'
        WHEN t >= el.starts_at
             AND t - el.idle_since >= interval '72 hours'
             AND (el.last_inactivity IS NULL OR t - el.last_inactivity >= interval '7 days')
          THEN 'inactivity'
        ELSE NULL
      END AS rule
    FROM eligible el
  )
  SELECT
    r.user_id, r.id, r.timezone, r.local_date, r.rule,
    CASE
      WHEN r.rule = 'inactivity'
        THEN to_char(r.idle_since + interval '72 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             || '#' || floor(extract(epoch FROM (t - r.idle_since - interval '72 hours')) / 604800)::text
      ELSE to_char(r.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    END AS campaign_key,
    'learning/' || r.id::text || '/' || r.rule || '/' ||
    CASE
      WHEN r.rule = 'inactivity'
        THEN to_char(r.idle_since + interval '72 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             || '#' || floor(extract(epoch FROM (t - r.idle_since - interval '72 hours')) / 604800)::text
      ELSE to_char(r.due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    END AS event_key,
    r.due_at, r.email
  FROM ruled r
  WHERE r.rule IS NOT NULL AND r.local_hour BETWEEN 9 AND 17;
$$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig); END LOOP;
END $$;
