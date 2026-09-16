-- T20 — reminder eligibility, the daily claim, and the outbox state machine.
--
-- spec/03 §6 in full. The rules themselves are also written in
-- lib/reminders.ts, where they can be evaluated against a fixed clock at 08:59
-- and 09:00 on a day the offset changes; the database is the authority and
-- decides them again here, because only it can do so inside the transaction
-- that claims the slot.
--
-- No operation_ids: T20 declares none. Everything here is reached through
-- pglearn_job, which is service_role only.

/*
 * A learner's local wall clock. Postgres carries the same IANA database Intl
 * does, so `AT TIME ZONE` follows a DST change rather than assuming an offset
 * — the property AC-046 turns on.
 */
CREATE FUNCTION app.local_moment(t timestamptz, tz text)
RETURNS timestamp LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT t AT TIME ZONE tz;
$$;

/*
 * Every enrollment that could be reminded about, with the rule it is due.
 *
 * Eligibility first, exactly as spec/03 lists it: "active accessible enrollment
 * and profile, onboarded, reminders_enabled, not completed, not cancelled."
 * Accessibility is asked of app.enrollment_availability, so a revoked grant or
 * a suspended organization silently stops reminders without a second copy of
 * those rules living here.
 */
CREATE FUNCTION app.reminder_candidates(t timestamptz)
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
       AND app.enrollment_availability(e.user_id, e.id, t) = 'available'
  ), ruled AS (
    SELECT el.*,
      CASE
        -- "Overdue once when now>due" — due is inclusive (ADR-10).
        WHEN t > el.due_at THEN 'overdue'
        -- "Due_today when same date and now<=due".
        WHEN el.local_date = el.due_local_date THEN 'due_today'
        -- "Due_soon when local due date minus current local date=3".
        WHEN el.due_local_date - el.local_date = 3 THEN 'due_soon'
        -- "Inactivity when now-max(last_activity_at,starts_at)>=72 hours",
        -- and not within 7 days of the last accepted inactivity send.
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
        -- The campaign key carries the 7-day interval number, so the second
        -- nudge is a new campaign rather than a duplicate of the first.
        THEN to_char(r.idle_since + interval '72 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             || '#' || floor(extract(epoch FROM (t - r.idle_since - interval '72 hours')) / 604800)::text
      -- "Due-date campaign key includes due_at; changing due starts a new campaign."
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
  -- "Eligible sending hours are 09:00 through 17:59 local."
  WHERE r.rule IS NOT NULL AND r.local_hour BETWEEN 9 AND 17;
$$;

/*
 * p_payload throughout these handlers, not payload: app.notification_outbox
 * has a `payload` column of its own, and a parameter of that name makes every
 * reference to the column ambiguous.
 *
 * The scheduler. One transaction per learner: choose the highest-priority
 * reminder, insert the outbox row ON CONFLICT DO NOTHING, and claim the day.
 *
 * spec/03: "Per user/local date claim is unique in reminder_days. … In one
 * transaction: calculate priority, insert outbox ON CONFLICT DO NOTHING, claim
 * daily slot if unclaimed. Invitations/certificates do not consume that
 * learning slot."
 *
 * The claim is what makes a second run of the same hour — or of the same local
 * day after the clocks go back — send nothing more.
 */
CREATE FUNCTION app.job_reminders_plan(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t timestamptz; chosen record; outbox_id uuid; planned integer := 0;
BEGIN
  t := COALESCE((p_payload ->> 'now')::timestamptz, now());

  FOR chosen IN
    -- One row per learner: the fixed priority, then earliest due, then the
    -- enrollment uuid, so the choice is the same on every run.
    SELECT DISTINCT ON (c.user_id) c.*
      FROM app.reminder_candidates(t) c
      LEFT JOIN app.reminder_days d ON d.user_id = c.user_id AND d.local_date = c.local_date
     WHERE d.user_id IS NULL
     ORDER BY c.user_id,
              CASE c.rule WHEN 'overdue' THEN 0 WHEN 'due_today' THEN 1
                          WHEN 'due_soon' THEN 2 ELSE 3 END,
              c.due_at, c.enrollment_id
  LOOP
    INSERT INTO app.notification_outbox(user_id, enrollment_id, kind, event_key,
                                        recipient_email, payload, scheduled_at)
    VALUES (chosen.user_id, chosen.enrollment_id, chosen.rule, chosen.event_key,
            chosen.recipient_email,
            jsonb_build_object('rule', chosen.rule, 'due_at', chosen.due_at,
                               'local_date', chosen.local_date),
            t)
    ON CONFLICT (event_key) DO NOTHING
    RETURNING id INTO outbox_id;

    -- Nothing inserted means this campaign has already been sent; the day is
    -- not claimed for it, so a different rule may still be chosen tomorrow.
    CONTINUE WHEN outbox_id IS NULL;

    INSERT INTO app.reminder_days(user_id, local_date, outbox_id)
    VALUES (chosen.user_id, chosen.local_date, outbox_id)
    ON CONFLICT (user_id, local_date) DO NOTHING;

    IF NOT FOUND THEN
      -- Somebody else claimed the day between the candidate query and here.
      -- The outbox row must go with it, or it would be sent uncapped.
      DELETE FROM app.notification_outbox WHERE id = outbox_id;
      CONTINUE;
    END IF;

    planned := planned + 1;
  END LOOP;

  RETURN jsonb_build_object('planned', planned);
END $$;

/*
 * Claiming work to send.
 *
 * spec/03: "Claim up to 20 due messages, lock with SKIP LOCKED and 5-minute
 * lease; provider concurrency max 3. Set first_attempt_at before the network
 * request. Freeze recipient/template/rendered payload across retry."
 *
 * The recheck is here rather than in the sender: "Recheck completion/access/
 * preferences immediately before sending; suppressed slot may be released only
 * before provider invocation."
 */
CREATE FUNCTION app.job_reminders_claim(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t timestamptz; batch integer; claimed jsonb; suppressed integer := 0; row record;
BEGIN
  t := COALESCE((p_payload ->> 'now')::timestamptz, now());
  batch := LEAST(GREATEST(COALESCE((p_payload ->> 'limit')::integer, 20), 1), 20);

  /*
   * Suppression first, and only for messages nobody has tried to send. A row
   * with first_attempt_at set may already be in flight: spec/03 is explicit
   * that "emails already dispatched before a concurrent completion cannot be
   * recalled", so the slot stays claimed and the row is left alone.
   */
  FOR row IN
    SELECT o.id, o.user_id, o.enrollment_id
      FROM app.notification_outbox o
     WHERE o.status = 'pending' AND o.first_attempt_at IS NULL
       AND o.kind IN ('inactivity','due_soon','due_today','overdue')
       AND o.scheduled_at <= t
  LOOP
    IF EXISTS (
      SELECT 1 FROM app.enrollments e
        JOIN app.profiles p ON p.id = e.user_id
       WHERE e.id = row.enrollment_id
         AND e.status = 'active' AND e.completed_at IS NULL
         AND p.status = 'active' AND p.reminders_enabled
         AND app.enrollment_availability(e.user_id, e.id, t) = 'available'
    ) THEN
      CONTINUE;
    END IF;

    UPDATE app.notification_outbox SET status = 'suppressed' WHERE id = row.id;
    -- The day is released with it: nothing was sent, so the learner may still
    -- receive the reminder they are actually due.
    DELETE FROM app.reminder_days WHERE outbox_id = row.id;
    suppressed := suppressed + 1;
  END LOOP;

  WITH due AS (
    SELECT o.id
      FROM app.notification_outbox o
     WHERE o.status IN ('pending', 'sending')
       AND o.scheduled_at <= t
       AND (o.claimed_until IS NULL OR o.claimed_until < t)
       AND o.attempts < 5
       -- Anything past 23 hours from its first attempt is no longer sendable;
       -- it is reconciled, not retried.
       AND (o.first_attempt_at IS NULL OR o.first_attempt_at > t - interval '23 hours')
     ORDER BY o.scheduled_at
     LIMIT batch
     FOR UPDATE SKIP LOCKED
  ), taken AS (
    UPDATE app.notification_outbox o
       SET status = 'sending',
           claimed_until = t + interval '5 minutes',
           -- Set BEFORE the network request, so a crash mid-send is visible
           -- as an attempt rather than as a message never tried.
           first_attempt_at = COALESCE(o.first_attempt_at, t),
           attempts = o.attempts + 1
      FROM due
     WHERE o.id = due.id
    RETURNING o.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', taken.id, 'kind', taken.kind, 'event_key', taken.event_key,
           'recipient_email', taken.recipient_email, 'payload', taken.payload,
           'attempts', taken.attempts, 'first_attempt_at', taken.first_attempt_at,
           'enrollment_id', taken.enrollment_id, 'user_id', taken.user_id)), '[]'::jsonb)
    INTO claimed FROM taken;

  RETURN jsonb_build_object('claimed', claimed, 'suppressed', suppressed);
END $$;

/*
 * Recording what the provider did.
 *
 * spec/03: "A timeout is not proof of failure. Recover lease with same
 * identity; after 23 hours from first attempt, move unknown outcome to
 * uncertain and require provider reconciliation. Never assume indefinite
 * provider deduplication. Verified definitive rejection can be failed."
 */
CREATE FUNCTION app.job_reminders_finish(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o app.notification_outbox; outcome text; t timestamptz; delay interval;
BEGIN
  t := COALESCE((p_payload ->> 'now')::timestamptz, now());
  SELECT * INTO o FROM app.notification_outbox
   WHERE id = (p_payload ->> 'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  outcome := p_payload ->> 'outcome';

  IF outcome = 'accepted' THEN
    UPDATE app.notification_outbox
       SET status = 'accepted', provider_id = p_payload ->> 'provider_id',
           accepted_at = t, claimed_until = NULL, last_error = NULL
     WHERE id = o.id;

  ELSIF outcome = 'rejected' THEN
    -- A definitive rejection: the provider says it will never send this.
    UPDATE app.notification_outbox
       SET status = 'failed', last_error = left(COALESCE(p_payload ->> 'error', 'rejected'), 500),
           claimed_until = NULL
     WHERE id = o.id;

  ELSE
    /*
     * Unknown. A timeout, a dropped connection, a 5xx — none of them prove the
     * message was not sent, so it is never simply failed.
     */
    IF o.first_attempt_at IS NOT NULL AND t - o.first_attempt_at >= interval '23 hours' THEN
      -- Past the cutoff: a human reconciles this against the provider.
      UPDATE app.notification_outbox
         SET status = 'uncertain', claimed_until = NULL,
             last_error = left(COALESCE(p_payload ->> 'error', 'no confirmed outcome'), 500)
       WHERE id = o.id;
    ELSIF o.attempts >= 5 THEN
      UPDATE app.notification_outbox
         SET status = 'uncertain', claimed_until = NULL,
             last_error = left(COALESCE(p_payload ->> 'error', 'attempts exhausted'), 500)
       WHERE id = o.id;
    ELSE
      -- 1, 5, 15 then 60 minutes.
      delay := (ARRAY[interval '1 minute', interval '5 minutes',
                      interval '15 minutes', interval '1 hour'])[LEAST(o.attempts, 4)];
      UPDATE app.notification_outbox
         SET status = 'pending', claimed_until = NULL,
             scheduled_at = t + delay,
             last_error = left(COALESCE(p_payload ->> 'error', 'no confirmed outcome'), 500)
       WHERE id = o.id;
    END IF;
  END IF;

  SELECT * INTO o FROM app.notification_outbox WHERE id = o.id;
  RETURN jsonb_build_object('status', o.status, 'attempts', o.attempts);
END $$;

/*
 * Reclaiming an expired lease. A sender that died mid-flight leaves a row in
 * 'sending' with a lease that runs out; it comes back as pending with its
 * attempt count intact, so the retry schedule is not restarted.
 */
CREATE FUNCTION app.job_reminders_recover(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t timestamptz; recovered integer; abandoned integer;
BEGIN
  t := COALESCE((p_payload ->> 'now')::timestamptz, now());

  WITH expired AS (
    UPDATE app.notification_outbox
       SET status = 'pending', claimed_until = NULL
     WHERE status = 'sending' AND claimed_until IS NOT NULL AND claimed_until < t
       AND first_attempt_at > t - interval '23 hours'
       AND attempts < 5
    RETURNING id
  )
  SELECT count(*) INTO recovered FROM expired;

  WITH stale AS (
    UPDATE app.notification_outbox
       SET status = 'uncertain', claimed_until = NULL,
           last_error = COALESCE(last_error, 'no confirmed outcome within 23 hours')
     WHERE status IN ('sending', 'pending')
       AND first_attempt_at IS NOT NULL
       AND first_attempt_at <= t - interval '23 hours'
    RETURNING id
  )
  SELECT count(*) INTO abandoned FROM stale;

  RETURN jsonb_build_object('recovered', recovered, 'uncertain', abandoned);
END $$;

CREATE OR REPLACE FUNCTION app.job_allowed(job text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT job IN ('reminders.plan', 'reminders.claim', 'reminders.finish',
                 'reminders.recover', 'email.event', 'retention.run',
                 'tutor.reserve', 'tutor.finish', 'tutor.reap', 'jobs.record');
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
    ELSE
      -- Email webhook events at T21, retention at T28.
      RAISE EXCEPTION 'job handler not implemented: %', job USING ERRCODE = '0A000';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.pglearn_job(text, jsonb) FROM PUBLIC, anon, authenticated;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig); END LOOP;
END $$;
