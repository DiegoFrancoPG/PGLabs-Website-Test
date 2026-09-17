-- T16 — scoped manager and admin reporting.
--
-- spec/03: "Report rows are enrollments plus invited/onboarded profile state.
-- Manager scope is forcibly organization-bound. Filters: organization (admin
-- only), offering, derived learning status, overdue, completed_from inclusive,
-- completed_to exclusive. Completion timestamp filters exclude incomplete
-- rows; current-progress filters do not imply a historical snapshot.
--
-- Summary for matching non-cancelled rows: assigned count;
-- not_started/in_progress/completed disjoint counts;
-- completion_rate=completed/assigned; mean progress includes zeros. Empty
-- denominator yields null in JSON and '—' in UI. Cancelled rows may be
-- requested separately, never silently enter active summary denominators.
-- Overdue requires incomplete and now>due, even if access expired;
-- availability separately tells manager whether action is possible. No
-- inferred competence/time-spent metric."

/*
 * The scope a caller may report on, as a set of organization ids — or NULL for
 * a platform admin, who is not organization-bound at all.
 *
 * "Manager scope is forcibly organization-bound" is enforced here rather than
 * by trusting a filter: a manager's rows are intersected with this set
 * whatever they ask for, so a foreign organization_id yields nothing to see.
 */
CREATE FUNCTION app.report_scope(actor uuid, requested uuid)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE managed uuid[];
BEGIN
  IF app.platform_admin(actor) THEN
    -- An admin may narrow to one organization, or see everything.
    IF requested IS NOT NULL THEN RETURN ARRAY[requested]; END IF;
    RETURN NULL;
  END IF;

  SELECT COALESCE(array_agg(m.organization_id), ARRAY[]::uuid[]) INTO managed
    FROM app.memberships m
    JOIN app.organizations o ON o.id = m.organization_id
   WHERE m.user_id = actor AND m.role = 'manager' AND m.status = 'active'
     AND o.status = 'active';

  IF requested IS NOT NULL THEN
    -- spec/05 uses 403 for "an authenticated user lacking a broad action role";
    -- asking about an organization you do not manage is exactly that, and
    -- saying so is safe because the id was supplied by the caller.
    IF NOT (requested = ANY(managed)) THEN
      RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
    END IF;
    RETURN ARRAY[requested];
  END IF;

  IF array_length(managed, 1) IS NULL THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN managed;
END $$;

/*
 * One row per enrollment. Personal enrollments have no organization_id, so a
 * manager's scope can never reach them — AC-021's privacy is structural.
 *
 * Deliberately absent: anything about exercise responses, tutor conversations
 * or time spent. spec/03: "Report retrieves enrollment rows, not raw
 * exercise/chat text" and "No inferred competence/time-spent metric."
 */
CREATE FUNCTION app.report_rows(actor uuid, scope uuid[], payload jsonb, t timestamptz)
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
      (SELECT count(*) FROM app.classes cl WHERE cl.version_id = e.version_id AND cl.required)
        AS required_total,
      (SELECT count(*) FROM app.classes cl
         JOIN app.class_progress cp ON cp.class_id = cl.id AND cp.enrollment_id = e.id
        WHERE cl.version_id = e.version_id AND cl.required AND cp.completed_at IS NOT NULL)
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

/*
 * The summary, over EVERY matching row rather than the page being returned.
 * AC-037's last clause; a summary computed from one page would describe the
 * page, not the cohort.
 */
CREATE FUNCTION app.report_summary(rows jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH r AS (
    SELECT value ->> 'state' AS state,
           (value ->> 'overdue')::boolean AS overdue,
           (value ->> 'progress')::numeric AS progress
      FROM jsonb_array_elements(rows) AS value
     WHERE value ->> 'state' <> 'cancelled'
  ), counted AS (
    SELECT count(*) AS assigned,
           count(*) FILTER (WHERE state = 'not_started') AS not_started,
           count(*) FILTER (WHERE state = 'in_progress') AS in_progress,
           count(*) FILTER (WHERE state = 'completed') AS completed,
           count(*) FILTER (WHERE overdue) AS overdue,
           avg(progress) AS mean
      FROM r
  )
  SELECT jsonb_build_object(
    'assigned', assigned,
    'not_started', not_started,
    'in_progress', in_progress,
    'completed', completed,
    'overdue', overdue,
    -- "Empty denominator yields null in JSON": no rows means no rate, which is
    -- not the same as a rate of zero.
    'completion_rate', CASE WHEN assigned = 0 THEN NULL
                            ELSE round(completed * 100.0 / assigned, 1) END,
    'average_progress', CASE WHEN assigned = 0 THEN NULL ELSE round(mean, 1) END)
  FROM counted;
$$;

CREATE FUNCTION app.handle_report_enrollments(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope uuid[]; t timestamptz; page_limit integer; cursor_name text; cursor_id uuid;
        all_rows jsonb; items jsonb; next_cursor text; raw_cursor text;
BEGIN
  t := now();
  scope := app.report_scope(actor, (payload ->> 'organization_id')::uuid);
  page_limit := LEAST(GREATEST(COALESCE((payload ->> 'limit')::integer, 20), 1), 100);

  /*
   * The cursor is the sort key of the last row returned, not an offset: rows
   * do not shift under a manager who is paging while somebody finishes a
   * class.
   *
   * It is the 36-character uuid followed by the name, base64-encoded so it
   * survives a query string. The uuid goes FIRST because it has a fixed width
   * and a name does not, and because Postgres text cannot hold a NUL, so there
   * is no separator available that a display name could not also contain.
   */
  raw_cursor := payload ->> 'cursor';
  IF raw_cursor IS NOT NULL THEN
    BEGIN
      cursor_id := left(convert_from(decode(raw_cursor, 'base64'), 'UTF8'), 36)::uuid;
      cursor_name := substr(convert_from(decode(raw_cursor, 'base64'), 'UTF8'), 37);
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'the cursor is not valid' USING ERRCODE = '22023';
    END;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'state', r.state, 'overdue', r.is_overdue, 'progress', r.progress)), '[]'::jsonb)
    INTO all_rows
    FROM app.report_rows(actor, scope, payload, t) r;

  SELECT COALESCE(jsonb_agg(r.row_json ORDER BY r.sort_name, r.sort_id), '[]'::jsonb)
    INTO items
    FROM (
      SELECT * FROM app.report_rows(actor, scope, payload, t) rr
       WHERE cursor_id IS NULL OR (rr.sort_name, rr.sort_id) > (cursor_name, cursor_id)
       ORDER BY rr.sort_name, rr.sort_id
       LIMIT page_limit
    ) r;

  -- A next cursor only when a further page exists, so a caller can stop.
  IF jsonb_array_length(items) = page_limit THEN
    SELECT encode(convert_to(
             (items -> (page_limit - 1) ->> 'enrollment_id') ||
             (items -> (page_limit - 1) ->> 'learner_name'), 'UTF8'), 'base64')
      INTO next_cursor;
    -- Nothing after the last row of this page means there is no next page.
    IF NOT EXISTS (
      SELECT 1 FROM app.report_rows(actor, scope, payload, t) rr
       WHERE (rr.sort_name, rr.sort_id) >
             ((items -> (page_limit - 1) ->> 'learner_name'),
              (items -> (page_limit - 1) ->> 'enrollment_id')::uuid)
    ) THEN next_cursor := NULL; END IF;
  END IF;

  RETURN jsonb_build_object(
    'summary', app.report_summary(all_rows),
    'items', items,
    'next_cursor', next_cursor);
END $$;

/*
 * The export's rows. Rendering the CSV is the application's job (lib/csv.ts);
 * deciding who may see which rows, and refusing an export too large to serve
 * synchronously, is not.
 */
CREATE FUNCTION app.handle_export_enrollments(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope uuid[]; t timestamptz; total integer; items jsonb;
BEGIN
  t := now();
  scope := app.report_scope(actor, (payload ->> 'organization_id')::uuid);

  SELECT count(*) INTO total FROM app.report_rows(actor, scope, payload, t);
  -- "At most 10,000 rows synchronously; larger request returns 422
  -- EXPORT_LIMIT instead of truncating invisibly." Half an export looks like a
  -- whole one, which is the failure worth preventing.
  IF total > 10000 THEN
    RAISE EXCEPTION 'this export would contain % rows; narrow the filters', total
      USING ERRCODE = 'PGL42';
  END IF;

  SELECT COALESCE(jsonb_agg(r.row_json ORDER BY r.sort_name, r.sort_id), '[]'::jsonb)
    INTO items FROM app.report_rows(actor, scope, payload, t) r;

  RETURN jsonb_build_object('items', items, 'total', total);
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
    WHEN 'list_programs' THEN RETURN app.handle_list_programs(actor, payload);
    WHEN 'create_program' THEN RETURN app.handle_create_program(actor, payload);
    WHEN 'update_program' THEN RETURN app.handle_update_program(actor, payload);
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
