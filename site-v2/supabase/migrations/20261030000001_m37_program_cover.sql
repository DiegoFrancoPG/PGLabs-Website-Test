-- M37 — a cover image per program.
--
-- D-19 in HANDOFF.md, at the product owner's request. Until now a program's
-- picture was picked from its id out of a few site photographs
-- (components/pglearn/programCover.ts). An administrator can now choose one:
-- either a photograph from the design system's library, stored as its public
-- path ('/human-imagery/…'), or an uploaded image, stored as 'upload:<token>'.
-- The uploaded file itself lives in the private bucket at a fixed key per
-- program (programs/<id>/cover) and is served to signed-in users through
-- the application; the token changes on every upload so browsers fetch the
-- new one. NULL keeps the automatic choice.
--
-- The cover is returned in the Program DTO, accepted by update_program, and
-- carried in the Enrollment DTO as program_cover so the learner's screens
-- need no extra read.

ALTER TABLE app.programs ADD COLUMN cover_image text
  CHECK (cover_image IS NULL
         OR cover_image ~ '^upload:[0-9a-f-]{36}$'
         OR (cover_image ~ '^/human-imagery/[^?#\\]+\.(jpg|jpeg|png|webp)$'
             AND cover_image !~ '\.\.' AND char_length(cover_image) <= 300));

CREATE OR REPLACE FUNCTION app.program_json(p app.programs)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'title', p.title, 'summary', p.summary,
    'archived', p.archived_at IS NOT NULL,
    'cover_image', p.cover_image,
    'latest_published_version_id', (
      SELECT v.id FROM app.program_versions v
      WHERE v.program_id = p.id AND v.state = 'published'
      ORDER BY v.version_number DESC LIMIT 1));
$$;

/* update_program, as M08 left it, plus cover_image ("" or null clears it). */
CREATE OR REPLACE FUNCTION app.handle_update_program(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p app.programs;
BEGIN
  PERFORM app.assert_admin(actor);
  UPDATE app.programs SET
    title = COALESCE(NULLIF(btrim(payload ->> 'title'), ''), title),
    summary = COALESCE(payload ->> 'summary', summary),
    -- Archiving stops new assignment without invalidating existing enrollment.
    archived_at = CASE WHEN payload ? 'archived'
      THEN CASE WHEN (payload ->> 'archived')::boolean THEN COALESCE(archived_at, now()) ELSE NULL END
      ELSE archived_at END,
    cover_image = CASE WHEN payload ? 'cover_image'
      THEN NULLIF(payload ->> 'cover_image', '') ELSE cover_image END
  WHERE id = (payload ->> 'program_id')::uuid
  RETURNING * INTO p;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN app.program_json(p);
END $$;

-- The Enrollment DTO as M32 left it, plus program_cover.
CREATE OR REPLACE FUNCTION app.enrollment_json(e app.enrollments, viewer uuid, t timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE required_total integer; required_done integer; title text; cover text; next_class uuid; cert uuid;
BEGIN
  SELECT p.title, p.cover_image INTO title, cover FROM app.programs p WHERE p.id = e.program_id;

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
    'id', e.id, 'user_id', e.user_id, 'program_id', e.program_id, 'program_title', title, 'program_cover', cover,
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

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig); END LOOP;
END $$;
