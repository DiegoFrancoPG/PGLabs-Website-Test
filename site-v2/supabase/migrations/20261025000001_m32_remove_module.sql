-- M32 — removing a module from a program.
--
-- D-11 in HANDOFF.md, at the product owner's request, two ways:
--   * In a DRAFT version a module is deleted outright, with its lessons
--     (delete_module), exactly as delete_class removes one lesson.
--   * In a PUBLISHED version nothing can be deleted — the M02 freeze triggers
--     keep what people learned from intact — so a module is HIDDEN instead
--     (set_module_hidden). For every enrollment on that version it then
--     behaves as if it were not there: it leaves the outline, its lessons
--     cannot be opened, and its required lessons stop counting towards the
--     program, in the totals, the reports and completion. Recorded progress
--     on it is kept, and unhiding brings it all back.
--
-- Hiding can finish a program for someone who had done everything else, so
-- it settles completion — and issues the certificate — for each active,
-- incomplete enrollment on the version, in the same transaction. Unhiding
-- never takes a completion or a certificate back: completion only moves
-- forward (spec/03).
--
-- The functions that count required lessons are recreated from their latest
-- definitions with one change each: the module must be listed.

CREATE TABLE app.hidden_modules (
  module_id uuid PRIMARY KEY REFERENCES app.modules(id) ON DELETE CASCADE,
  hidden_by uuid NOT NULL REFERENCES app.profiles(id),
  hidden_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.hidden_modules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.hidden_modules FROM PUBLIC, anon, authenticated;

/* Whether a module is shown to learners and counts towards its program. */
CREATE FUNCTION app.module_listed(module uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM app.hidden_modules h WHERE h.module_id = module);
$$;

/* The Module DTO also says whether the module is hidden (admin editor). */
CREATE OR REPLACE FUNCTION app.module_json(m app.modules)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', m.id, 'version_id', m.version_id,
                            'title', m.title, 'position', m.position,
                            'release_at', (SELECT r.release_at FROM app.module_releases r
                                            WHERE r.module_id = m.id),
                            'hidden', EXISTS (SELECT 1 FROM app.hidden_modules h
                                               WHERE h.module_id = m.id));
$$;

-- ---------------------------------------------------------------------------
-- Recreated with the listed-module filter (see the header).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.enrollment_json(e app.enrollments, viewer uuid, t timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE required_total integer; required_done integer; title text; next_class uuid; cert uuid;
BEGIN
  SELECT p.title INTO title FROM app.programs p WHERE p.id = e.program_id;

  SELECT count(*) FILTER (WHERE c.required),
         count(*) FILTER (WHERE c.required AND cp.completed_at IS NOT NULL)
    INTO required_total, required_done
    FROM app.classes c
    LEFT JOIN app.class_progress cp ON cp.enrollment_id = e.id AND cp.class_id = c.id
   WHERE c.version_id = e.version_id AND app.module_listed(c.module_id);

  -- The next incomplete class in order, which is what "Continue" opens.
  SELECT c.id INTO next_class
    FROM app.classes c
    JOIN app.modules m ON m.id = c.module_id
    LEFT JOIN app.class_progress cp ON cp.enrollment_id = e.id AND cp.class_id = c.id
   WHERE c.version_id = e.version_id AND app.module_listed(c.module_id) AND cp.completed_at IS NULL
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

CREATE OR REPLACE FUNCTION app.progress_json(e app.enrollments, c app.classes)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cp app.class_progress; ex app.exercises; coverage bigint; response_exists boolean;
        required_total integer; required_done integer; cert uuid;
BEGIN
  SELECT * INTO cp FROM app.class_progress WHERE enrollment_id = e.id AND class_id = c.id;
  SELECT * INTO ex FROM app.exercises WHERE class_id = c.id;

  SELECT COALESCE(sum(upper(x) - lower(x)), 0) INTO coverage
    FROM unnest(COALESCE(cp.played_ranges, '{}'::int8multirange)) AS x;
  -- Capped by the media length, per spec/03 step 4.
  coverage := LEAST(coverage, COALESCE(c.duration_ms, coverage));

  response_exists := ex.id IS NOT NULL AND EXISTS (
    SELECT 1 FROM app.exercise_completions ec
    WHERE ec.enrollment_id = e.id AND ec.exercise_id = ex.id);

  SELECT count(*) FILTER (WHERE cl.required),
         count(*) FILTER (WHERE cl.required AND p.completed_at IS NOT NULL)
    INTO required_total, required_done
    FROM app.classes cl
    LEFT JOIN app.class_progress p ON p.enrollment_id = e.id AND p.class_id = cl.id
   WHERE cl.version_id = e.version_id AND app.module_listed(cl.module_id);

  SELECT cr.id INTO cert FROM app.certificates cr WHERE cr.enrollment_id = e.id;

  RETURN jsonb_build_object(
    'class_id', c.id,
    'position_ms', COALESCE(cp.position_ms, 0),
    'coverage_ms', coverage,
    'content_complete', cp.content_completed_at IS NOT NULL,
    'exercise_complete', response_exists,
    'class_complete', cp.completed_at IS NOT NULL,
    'required_completed', required_done,
    'required_total', GREATEST(required_total, 1),
    'certificate_id', cert);
END $$;

CREATE OR REPLACE FUNCTION app.settle_completion(enrollment uuid, class uuid, t timestamptz)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; cp app.class_progress; has_exercise boolean; exercise_done boolean;
        all_required_done boolean; p app.programs; v app.program_versions; prof app.profiles;
        cert app.certificates;
BEGIN
  SELECT * INTO e FROM app.enrollments WHERE id = enrollment FOR UPDATE;
  SELECT * INTO cp FROM app.class_progress WHERE enrollment_id = enrollment AND class_id = class;

  -- Class completion needs BOTH parts where an exercise exists (ADR-08).
  SELECT EXISTS (SELECT 1 FROM app.exercises WHERE class_id = class) INTO has_exercise;
  exercise_done := NOT has_exercise OR EXISTS (
    SELECT 1 FROM app.exercise_completions ec
    JOIN app.exercises ex ON ex.id = ec.exercise_id
    WHERE ec.enrollment_id = enrollment AND ex.class_id = class);

  IF cp.content_completed_at IS NOT NULL AND exercise_done AND cp.completed_at IS NULL THEN
    -- Timestamps only ever move null -> value; the M02 trigger enforces it too.
    UPDATE app.class_progress SET completed_at = t
     WHERE enrollment_id = enrollment AND class_id = class;
  END IF;

  -- Step 7. Over REQUIRED classes only.
  SELECT bool_and(pr.completed_at IS NOT NULL) INTO all_required_done
    FROM app.classes cl
    LEFT JOIN app.class_progress pr ON pr.enrollment_id = enrollment AND pr.class_id = cl.id
   WHERE cl.version_id = e.version_id AND cl.required AND app.module_listed(cl.module_id);

  IF COALESCE(all_required_done, false) AND e.completed_at IS NULL THEN
    UPDATE app.enrollments SET completed_at = t, last_activity_at = t WHERE id = enrollment;

    SELECT * INTO p FROM app.programs WHERE id = e.program_id;
    SELECT * INTO v FROM app.program_versions WHERE id = e.version_id;
    SELECT * INTO prof FROM app.profiles WHERE id = e.user_id;

    -- A snapshot: the learner's name and the program title AS THEY WERE, so a
    -- later rename cannot alter what was earned. ON CONFLICT keeps it to one.
    INSERT INTO app.certificates(enrollment_id, learner_name, program_title, version_number,
                                 issuer, completed_at)
    VALUES (enrollment, prof.display_name, p.title, v.version_number,
            COALESCE(NULLIF(current_setting('app.certificate_issuer', true), ''), 'PGLearn'), t)
    ON CONFLICT (enrollment_id) DO NOTHING
    RETURNING * INTO cert;

    -- The certificate email, queued in the same transaction (spec/03 step 7).
    -- Sending it is T21; a crash after this point loses nothing.
    IF cert.id IS NOT NULL THEN
      INSERT INTO app.notification_outbox(user_id, enrollment_id, kind, event_key,
                                          recipient_email, payload, scheduled_at)
      VALUES (e.user_id, enrollment, 'certificate', 'certificate:' || cert.id::text,
              prof.email, jsonb_build_object('certificate_id', cert.id), t)
      ON CONFLICT (event_key) DO NOTHING;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.handle_get_enrollment(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; t timestamptz;
BEGIN
  t := COALESCE(NULLIF(payload ->> 'at', '')::timestamptz, now());

  SELECT * INTO e FROM app.enrollments WHERE id = (payload ->> 'enrollment_id')::uuid;
  -- Another learner's enrollment is reported as missing, never as forbidden.
  IF NOT FOUND OR NOT app.owns_enrollment(actor, e.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'enrollment', app.enrollment_json(e, actor, t),
    'modules', COALESCE((
      SELECT jsonb_agg(app.module_json(m) ORDER BY m.position)
      FROM app.modules m WHERE m.version_id = e.version_id AND app.module_listed(m.id)), '[]'::jsonb),
    'classes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'module_id', c.module_id, 'title', c.title, 'kind', c.kind,
               'position', c.position, 'required', c.required,
               'completed', cp.completed_at IS NOT NULL)
             ORDER BY m.position, c.position)
      FROM app.classes c
      JOIN app.modules m ON m.id = c.module_id
      LEFT JOIN app.class_progress cp ON cp.enrollment_id = e.id AND cp.class_id = c.id
      WHERE c.version_id = e.version_id AND app.module_listed(c.module_id)), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION app.handle_get_learning_class(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; c app.classes; cp app.class_progress; ex app.exercises;
        t timestamptz; availability text; required_total integer; required_done integer;
        coverage bigint; response text; cert uuid;
BEGIN
  t := COALESCE(NULLIF(payload ->> 'at', '')::timestamptz, now());

  SELECT * INTO e FROM app.enrollments WHERE id = (payload ->> 'enrollment_id')::uuid;
  IF NOT FOUND OR NOT app.owns_enrollment(actor, e.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  -- The class must belong to the version this enrollment is pinned to.
  SELECT * INTO c FROM app.classes
   WHERE id = (payload ->> 'class_id')::uuid AND version_id = e.version_id
     AND app.module_listed(module_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  availability := app.enrollment_availability(actor, e.id, t);
  IF availability <> 'available' THEN
    -- spec/05: after ownership is established, blocked learning returns
    -- ACCESS_UNAVAILABLE carrying the reason.
    RAISE EXCEPTION 'access unavailable: %', availability USING ERRCODE = 'PGL22', DETAIL = availability;
  END IF;

  SELECT * INTO cp FROM app.class_progress WHERE enrollment_id = e.id AND class_id = c.id;
  SELECT * INTO ex FROM app.exercises WHERE class_id = c.id;

  SELECT COALESCE(sum(upper(x) - lower(x)), 0) INTO coverage
    FROM unnest(COALESCE(cp.played_ranges, '{}'::int8multirange)) AS x;

  IF ex.id IS NOT NULL THEN
    SELECT ec.response INTO response FROM app.exercise_completions ec
     WHERE ec.enrollment_id = e.id AND ec.exercise_id = ex.id;
  END IF;

  SELECT count(*) FILTER (WHERE cl.required),
         count(*) FILTER (WHERE cl.required AND p.completed_at IS NOT NULL)
    INTO required_total, required_done
    FROM app.classes cl
    LEFT JOIN app.class_progress p ON p.enrollment_id = e.id AND p.class_id = cl.id
   WHERE cl.version_id = e.version_id AND app.module_listed(cl.module_id);

  SELECT cr.id INTO cert FROM app.certificates cr WHERE cr.enrollment_id = e.id;

  RETURN jsonb_build_object(
    'class', app.class_json(c),
    /*
     * Ready assets only. A pending or failed upload is not something a learner
     * can be offered, and spec/04 keeps the primary media out of the handout
     * list — it is played, not downloaded.
     */
    'assets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id, 'class_id', a.class_id, 'role', a.role,
               'original_name', a.original_name, 'mime_type', a.mime_type,
               'bytes', a.bytes, 'state', a.state, 'error_code', a.error_code))
      FROM app.assets a WHERE a.class_id = c.id AND a.state = 'ready'), '[]'::jsonb),
    'exercise', CASE WHEN ex.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', ex.id, 'class_id', ex.class_id, 'instructions_md', ex.instructions_md) END,
    'saved_response', response,
    'progress', jsonb_build_object(
      'class_id', c.id,
      'position_ms', COALESCE(cp.position_ms, 0),
      'coverage_ms', coverage,
      'content_complete', cp.content_completed_at IS NOT NULL,
      'exercise_complete', response IS NOT NULL,
      'class_complete', cp.completed_at IS NOT NULL,
      'required_completed', required_done,
      'required_total', GREATEST(required_total, 1),
      'certificate_id', cert));
END $$;

CREATE OR REPLACE FUNCTION app.report_rows(actor uuid, scope uuid[], payload jsonb, t timestamptz)
RETURNS TABLE (
  sort_name text, sort_id uuid, row_json jsonb,
  state text, is_overdue boolean, progress numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH base AS (
    SELECT
      e.id, e.user_id, e.organization_id, e.offering_id, e.starts_at, e.due_at,
      e.access_ends_at, e.status, e.started_at, e.last_activity_at, e.completed_at,
      p.title AS program, v.version_number,
      prof.display_name AS learner_name, prof.email AS learner_email, prof.timezone,
      org.name AS organization, coh.name AS cohort,
      (SELECT count(*) FROM app.classes cl WHERE cl.version_id = e.version_id AND cl.required AND app.module_listed(cl.module_id))
        AS required_total,
      (SELECT count(*) FROM app.classes cl
         JOIN app.class_progress cp ON cp.class_id = cl.id AND cp.enrollment_id = e.id
        WHERE cl.version_id = e.version_id AND cl.required AND app.module_listed(cl.module_id) AND cp.completed_at IS NOT NULL)
        AS required_completed,
      (SELECT cr.id FROM app.certificates cr WHERE cr.enrollment_id = e.id) AS certificate_id,
      -- The profile's invitation state, which is about the ACCOUNT rather than
      -- this enrollment: "report rows are enrollments plus invited/onboarded
      -- profile state".
      CASE
        WHEN prof.onboarded_at IS NOT NULL THEN 'accepted'
        ELSE COALESCE((
          SELECT i.status FROM app.invitations i
           WHERE i.user_id = e.user_id
             AND (e.organization_id IS NULL OR i.organization_id = e.organization_id)
           ORDER BY i.created_at DESC LIMIT 1), 'none')
      END AS invitation_state
    FROM app.enrollments e
    JOIN app.profiles prof ON prof.id = e.user_id
    JOIN app.programs p ON p.id = e.program_id
    JOIN app.program_versions v ON v.id = e.version_id
    LEFT JOIN app.organizations org ON org.id = e.organization_id
    LEFT JOIN app.cohort_offerings off ON off.id = e.offering_id
    LEFT JOIN app.cohorts coh ON coh.id = off.cohort_id
    WHERE (scope IS NULL OR e.organization_id = ANY(scope))
      AND (payload ->> 'offering_id' IS NULL OR e.offering_id = (payload ->> 'offering_id')::uuid)
  ), derived AS (
    SELECT b.*,
      CASE
        WHEN b.status = 'cancelled' THEN 'cancelled'
        WHEN b.completed_at IS NOT NULL THEN 'completed'
        WHEN b.started_at IS NOT NULL THEN 'in_progress'
        ELSE 'not_started'
      END AS derived_state,
      -- "Overdue requires incomplete and now>due, even if access expired."
      (b.status <> 'cancelled' AND b.completed_at IS NULL AND t > b.due_at) AS overdue,
      CASE WHEN b.required_total = 0 THEN 0
           ELSE round(b.required_completed * 100.0 / b.required_total, 1) END AS progress_percent,
      -- On time is decided against the due date, which is inclusive (ADR-10).
      CASE WHEN b.completed_at IS NULL THEN NULL ELSE b.completed_at <= b.due_at END AS on_time
    FROM base b
  )
  SELECT
    d.learner_name, d.id,
    jsonb_build_object(
      'enrollment_id', d.id,
      'organization', d.organization,
      'cohort', d.cohort,
      'program', d.program,
      'version_number', d.version_number,
      'learner_name', d.learner_name,
      'learner_email', d.learner_email,
      'invitation_state', d.invitation_state,
      'state', d.derived_state,
      'availability', app.enrollment_availability(d.user_id, d.id, t),
      'starts_at', d.starts_at,
      'due_at', d.due_at,
      'access_ends_at', d.access_ends_at,
      'required_completed', d.required_completed,
      'required_total', GREATEST(d.required_total, 1),
      'progress_percent', d.progress_percent,
      'last_activity_at', d.last_activity_at,
      'completed_at', d.completed_at,
      'on_time', d.on_time,
      'certificate_id', d.certificate_id,
      'timezone', d.timezone),
    d.derived_state, d.overdue, d.progress_percent
  FROM derived d
  WHERE
    -- A state filter is exact; without one, cancelled rows are excluded, so
    -- they can never "silently enter active summary denominators".
    (CASE WHEN payload ->> 'state' IS NOT NULL THEN d.derived_state = payload ->> 'state'
          ELSE d.derived_state <> 'cancelled' END)
    AND (payload ->> 'overdue' IS NULL OR d.overdue = (payload ->> 'overdue')::boolean)
    -- "Completion timestamp filters exclude incomplete rows": a row with no
    -- completed_at cannot satisfy a range over completed_at.
    AND (payload ->> 'completed_from' IS NULL
         OR (d.completed_at IS NOT NULL AND d.completed_at >= (payload ->> 'completed_from')::timestamptz))
    AND (payload ->> 'completed_to' IS NULL
         OR (d.completed_at IS NOT NULL AND d.completed_at < (payload ->> 'completed_to')::timestamptz));
$$;

CREATE OR REPLACE FUNCTION app.assert_class_released(actor uuid, action text, payload jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE enrollment uuid; target uuid; opens timestamptz; module uuid;
BEGIN
  IF action NOT IN ('get_learning_class', 'start_playback', 'record_progress', 'complete_text',
                    'complete_exercise', 'authorize_download', 'ask_tutor') THEN
    RETURN;
  END IF;
  IF COALESCE((payload ->> 'preview')::boolean, false) THEN RETURN; END IF;

  enrollment := NULLIF(payload ->> 'enrollment_id', '')::uuid;
  IF enrollment IS NULL OR NOT app.owns_enrollment(actor, enrollment) THEN RETURN; END IF;

  target := CASE action
    WHEN 'authorize_download' THEN
      (SELECT a.class_id FROM app.assets a WHERE a.id = NULLIF(payload ->> 'asset_id', '')::uuid)
    WHEN 'complete_exercise' THEN
      (SELECT x.class_id FROM app.exercises x WHERE x.id = NULLIF(payload ->> 'exercise_id', '')::uuid)
    ELSE NULLIF(payload ->> 'class_id', '')::uuid
  END;
  IF target IS NULL THEN RETURN; END IF;

  -- M32: a hidden module's lessons are gone for the learner, as if deleted.
  SELECT c.module_id INTO module
    FROM app.classes c
    JOIN app.enrollments e ON e.id = enrollment AND e.version_id = c.version_id
   WHERE c.id = target;
  IF module IS NOT NULL AND NOT app.module_listed(module) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT r.release_at INTO opens
    FROM app.classes c
    JOIN app.enrollments e ON e.id = enrollment AND e.version_id = c.version_id
    JOIN app.module_releases r ON r.module_id = c.module_id
   WHERE c.id = target;

  IF opens IS NOT NULL AND opens > now() THEN
    RAISE EXCEPTION 'access unavailable: module_locked' USING ERRCODE = 'PGL22',
      DETAIL = 'module_locked', HINT = to_char(opens AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  END IF;
END $$;

/*
 * Deleting a module from a DRAFT, with its lessons and their files, exercises
 * and source chunks — the same steps delete_class takes for one lesson. The
 * modules after it move up, so positions stay contiguous.
 */
CREATE FUNCTION app.handle_delete_module(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m app.modules; state text;
BEGIN
  PERFORM app.assert_admin(actor);
  SELECT * INTO m FROM app.modules WHERE id = (payload ->> 'module_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  SELECT v.state INTO state FROM app.program_versions v WHERE v.id = m.version_id;
  IF state <> 'draft' THEN
    RAISE EXCEPTION 'a published module cannot be deleted; hide it instead'
      USING ERRCODE = '23514';
  END IF;

  UPDATE app.classes SET primary_asset_id = NULL WHERE module_id = m.id;
  DELETE FROM app.content_chunks WHERE class_id IN (SELECT id FROM app.classes WHERE module_id = m.id);
  DELETE FROM app.exercises WHERE class_id IN (SELECT id FROM app.classes WHERE module_id = m.id);
  DELETE FROM app.assets WHERE class_id IN (SELECT id FROM app.classes WHERE module_id = m.id);
  DELETE FROM app.classes WHERE module_id = m.id;
  DELETE FROM app.modules WHERE id = m.id;

  UPDATE app.modules SET position = position - 1
   WHERE version_id = m.version_id AND position > m.position;

  RETURN jsonb_build_object('module_id', m.id, 'deleted', true);
END $$;

/*
 * Hiding or showing a module of any version (see the header). Hiding settles
 * completion for every active, incomplete enrollment on that version, which
 * may now have nothing left to do.
 */
CREATE FUNCTION app.handle_set_module_hidden(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m app.modules; any_class uuid; e record;
BEGIN
  PERFORM app.assert_admin(actor);
  SELECT * INTO m FROM app.modules WHERE id = (payload ->> 'module_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  IF jsonb_typeof(payload -> 'hidden') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'hidden must be true or false' USING ERRCODE = '22023';
  END IF;

  IF (payload ->> 'hidden')::boolean THEN
    INSERT INTO app.hidden_modules(module_id, hidden_by) VALUES (m.id, actor)
    ON CONFLICT (module_id) DO NOTHING;

    -- settle_completion's class step only acts on a class whose content is
    -- complete; with any class of the version it does nothing there, and its
    -- program step runs over the required lessons still listed.
    SELECT c.id INTO any_class FROM app.classes c WHERE c.version_id = m.version_id LIMIT 1;
    FOR e IN SELECT en.id FROM app.enrollments en
              WHERE en.version_id = m.version_id AND en.status = 'active'
                AND en.completed_at IS NULL
                -- Only someone who has started can have finished (schema CHECK).
                AND en.started_at IS NOT NULL
    LOOP
      PERFORM app.settle_completion(e.id, any_class, now());
    END LOOP;
  ELSE
    DELETE FROM app.hidden_modules WHERE module_id = m.id;
  END IF;

  RETURN app.module_json(m);
END $$;

-- ---------------------------------------------------------------------------
-- The dispatcher, recreated with the two new actions; everything else is
-- exactly as M31 left it.
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

  -- M31: a lesson in a module that has not been released yet cannot be
  -- opened, played, completed or downloaded, whichever action is used.
  PERFORM app.assert_class_released(actor, action, payload);

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
    WHEN 'clone_version' THEN RETURN app.handle_clone_version(actor, payload);
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
    WHEN 'list_my_enrollments' THEN RETURN app.handle_list_my_enrollments(actor, payload);
    WHEN 'get_enrollment' THEN RETURN app.handle_get_enrollment(actor, payload);
    WHEN 'get_learning_class' THEN RETURN app.handle_get_learning_class(actor, payload);
    WHEN 'start_playback' THEN RETURN app.handle_start_playback(actor, payload);
    WHEN 'record_progress' THEN RETURN app.handle_record_progress(actor, payload);
    WHEN 'complete_text' THEN RETURN app.handle_complete_text(actor, payload);
    WHEN 'complete_exercise' THEN RETURN app.handle_complete_exercise(actor, payload);
    WHEN 'get_exercise_completion' THEN RETURN app.handle_get_exercise_completion(actor, payload);
    WHEN 'get_certificate' THEN RETURN app.handle_get_certificate(actor, payload);
    WHEN 'get_certificate_pdf' THEN RETURN app.handle_get_certificate_pdf(actor, payload);
    WHEN 'revoke_certificate' THEN RETURN app.handle_revoke_certificate(actor, payload);
    WHEN 'report_enrollments' THEN RETURN app.handle_report_enrollments(actor, payload);
    WHEN 'export_enrollments' THEN RETURN app.handle_export_enrollments(actor, payload);
    WHEN 'ask_tutor' THEN RETURN app.handle_ask_tutor(actor, payload);
    WHEN 'get_tutor_request' THEN RETURN app.handle_get_tutor_request(actor, payload);
    WHEN 'list_tutor_history' THEN RETURN app.handle_list_tutor_history(actor, payload);
    WHEN 'list_notifications' THEN RETURN app.handle_list_notifications(actor, payload);
    WHEN 'retry_notification' THEN RETURN app.handle_retry_notification(actor, payload);
    WHEN 'list_jobs' THEN RETURN app.handle_list_jobs(actor, payload);
    WHEN 'list_organization_members' THEN RETURN app.handle_list_organization_members(actor, payload);
    WHEN 'update_member_profile' THEN RETURN app.handle_update_member_profile(actor, payload);
    WHEN 'set_module_release' THEN RETURN app.handle_set_module_release(actor, payload);
    WHEN 'delete_module' THEN RETURN app.handle_delete_module(actor, payload);
    WHEN 'set_module_hidden' THEN RETURN app.handle_set_module_hidden(actor, payload);
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
