-- M04 — service-only entrypoints and the private storage bucket.
--
-- spec/02: pglearn_job and pglearn_provision are service_role execute only.
-- A browser role must not be able to reach either, whatever it sends.
--
-- spec/02 also warns that these "cannot accept arbitrary conversation bodies
-- from job/webhook endpoints": tutor.reserve and tutor.finish act only on a
-- request identity that pglearn_rpc has already authorized.

-- ---------------------------------------------------------------------------
-- Job dispatcher. Same literal-allowlist discipline as the user dispatcher.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.job_allowed(job text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT job IN ('reminders.claim', 'reminders.finish', 'email.event',
                 'retention.run', 'tutor.reserve', 'tutor.finish', 'jobs.record');
$$;

CREATE FUNCTION public.pglearn_job(job text, payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF NOT app.job_allowed(job) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  -- Job handlers are implemented by the tasks that own them: reminders at T20,
  -- email events at T21, retention at T28, tutor accounting at T18.
  RAISE EXCEPTION 'job handler not implemented: %', job USING ERRCODE = '0A000';
END $$;

-- ---------------------------------------------------------------------------
-- Profile provisioning. spec/02: "Must use Auth's authoritative ID/email, never
-- values copied blindly from an unauthenticated request."
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.pglearn_provision(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid; auth_email text; display text; tz text;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object' USING ERRCODE = '22023';
  END IF;
  target := (payload ->> 'user_id')::uuid;
  IF target IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22023';
  END IF;

  -- The email is read from auth.users, never taken from the payload. A caller
  -- that names a real user id cannot attach a different address to it.
  SELECT u.email INTO auth_email FROM auth.users u WHERE u.id = target;
  IF auth_email IS NULL THEN
    RAISE EXCEPTION 'no such auth user' USING ERRCODE = '42501';
  END IF;

  display := COALESCE(NULLIF(btrim(payload ->> 'display_name'), ''), split_part(auth_email, '@', 1));
  tz := COALESCE(NULLIF(payload ->> 'timezone', ''), 'UTC');

  INSERT INTO app.profiles(id, email, display_name, timezone)
  VALUES (target, lower(btrim(auth_email)), left(display, 120), tz)
  ON CONFLICT (id) DO UPDATE SET email = excluded.email;

  RETURN jsonb_build_object('user_id', target, 'provisioned', true);
END $$;

-- ---------------------------------------------------------------------------
-- Privileges. spec/02: "service_role execute only" and "Revoke PUBLIC execute
-- on every created function."
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.pglearn_job(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pglearn_job(text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.pglearn_provision(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pglearn_provision(jsonb) TO service_role;

REVOKE ALL ON FUNCTION app.job_allowed(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private storage bucket. spec/02: "Bucket pglearn-private, public=false. No
-- anon/authenticated object SELECT/INSERT/UPDATE/DELETE policies." The server
-- signs every upload and download after authorizing the exact asset.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('pglearn-private', 'pglearn-private', false)
ON CONFLICT (id) DO UPDATE SET public = false;
