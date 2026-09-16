-- T10 — publication.
--
-- spec/03: "Draft to published is one transaction after validation and chunk
-- indexing." So validation, chunking and the state change all happen here: a
-- version can never be published with content that was not indexed, and a
-- failed validation leaves nothing behind.

-- ---------------------------------------------------------------------------
-- Retrieval chunking
--
-- spec/05: "normalize source text whitespace and split into <=1,500-character
-- chunks with 150-character overlap, preferring paragraph boundaries; dedupe
-- identical chunks within class. Keep UTF-8 boundaries intact."
--
-- Done in SQL rather than in the application so the chunks derive from the
-- STORED source text inside the publishing transaction. Sending them in the
-- request would mean indexing whatever the caller chose to send.
--
-- substring() counts characters, not bytes, so UTF-8 boundaries are intact by
-- construction — a byte-oriented split is what would break them.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.chunk_source_text(source text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  max_chars constant integer := 1500;
  overlap constant integer := 150;
  normalized text;
  total integer;
  pos integer := 1;
  take integer;
  window_text text;
  boundary integer;
  chunks text[] := ARRAY[]::text[];
  piece text;
BEGIN
  -- Paragraph breaks survive normalization; every other run of whitespace
  -- collapses, so the same prose always chunks the same way.
  normalized := btrim(regexp_replace(
                  regexp_replace(source, '\r\n?', E'\n', 'g'),
                  '[ \t]+', ' ', 'g'));
  normalized := regexp_replace(normalized, E'\n{3,}', E'\n\n', 'g');
  total := char_length(normalized);
  IF total = 0 THEN RETURN chunks; END IF;

  WHILE pos <= total LOOP
    take := LEAST(max_chars, total - pos + 1);
    window_text := substring(normalized FROM pos FOR take);

    -- Cut at a paragraph break when there is one, otherwise at a space, so a
    -- chunk does not end mid-word. Only when more text follows.
    IF pos + take - 1 < total THEN
      boundary := length(window_text) - position(E'\n\n' IN reverse(window_text)) + 1;
      IF position(E'\n\n' IN reverse(window_text)) = 0 OR boundary < max_chars / 2 THEN
        boundary := length(window_text) - position(' ' IN reverse(window_text)) + 1;
      END IF;
      IF boundary > 0 AND boundary > max_chars / 2 THEN
        window_text := substring(window_text FROM 1 FOR boundary);
        take := boundary;
      END IF;
    END IF;

    piece := btrim(window_text);
    IF piece <> '' AND NOT (chunks @> ARRAY[piece]) THEN
      -- Deduped within the class, per spec/05.
      chunks := chunks || piece;
    END IF;

    EXIT WHEN pos + take - 1 >= total;
    pos := pos + take - overlap;
  END LOOP;

  RETURN chunks;
END $$;

-- ---------------------------------------------------------------------------
-- Publication validation
--
-- Returns every problem it finds rather than the first, because spec/04 has the
-- editor list "missing fields per class" — one error at a time would make
-- preparing a nine-video course a guessing game.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.publication_issues(version uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE issues jsonb := '[]'::jsonb; v app.program_versions; p app.programs; r record;
BEGIN
  SELECT * INTO v FROM app.program_versions WHERE id = version;
  SELECT * INTO p FROM app.programs WHERE id = v.program_id;

  IF btrim(COALESCE(p.title, '')) = '' THEN
    issues := issues || jsonb_build_object('path', 'program.title', 'message', 'The program needs a title.');
  END IF;
  IF btrim(COALESCE(v.title, '')) = '' THEN
    issues := issues || jsonb_build_object('path', 'version.title', 'message', 'The version needs a title.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM app.modules WHERE version_id = version) THEN
    issues := issues || jsonb_build_object('path', 'version.modules',
      'message', 'Add at least one module before publishing.');
  END IF;

  -- Positions contiguous from zero, for modules within the version.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT position, row_number() OVER (ORDER BY position) - 1 AS expected
      FROM app.modules WHERE version_id = version) s
    WHERE s.position <> s.expected
  ) THEN
    issues := issues || jsonb_build_object('path', 'version.modules',
      'message', 'Module positions must run from zero without gaps.');
  END IF;

  FOR r IN SELECT * FROM app.modules WHERE version_id = version ORDER BY position LOOP
    IF btrim(COALESCE(r.title, '')) = '' THEN
      issues := issues || jsonb_build_object('path', format('module[%s].title', r.id),
        'message', 'This module needs a title.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.classes WHERE module_id = r.id) THEN
      issues := issues || jsonb_build_object('path', format('module[%s].classes', r.id),
        'message', 'Every module needs at least one class.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM (
        SELECT position, row_number() OVER (ORDER BY position) - 1 AS expected
        FROM app.classes WHERE module_id = r.id) s
      WHERE s.position <> s.expected
    ) THEN
      issues := issues || jsonb_build_object('path', format('module[%s].classes', r.id),
        'message', 'Class positions must run from zero without gaps.');
    END IF;
  END LOOP;

  -- spec/03: at least one REQUIRED class per version. A version where
  -- everything is optional can be "completed" without doing anything.
  IF NOT EXISTS (SELECT 1 FROM app.classes WHERE version_id = version AND required) THEN
    issues := issues || jsonb_build_object('path', 'version.classes',
      'message', 'At least one class must be required.');
  END IF;

  FOR r IN SELECT * FROM app.classes WHERE version_id = version ORDER BY position LOOP
    IF btrim(COALESCE(r.title, '')) = '' THEN
      issues := issues || jsonb_build_object('path', format('class[%s].title', r.id),
        'message', 'This class needs a title.');
    END IF;

    IF r.kind = 'text' THEN
      IF btrim(COALESCE(r.body_md, '')) = '' THEN
        issues := issues || jsonb_build_object('path', format('class[%s].body_md', r.id),
          'message', 'A text class needs a body.');
      END IF;
    ELSE
      -- Media classes need a ready primary asset AND a duration.
      IF r.primary_asset_id IS NULL THEN
        issues := issues || jsonb_build_object('path', format('class[%s].primary_asset_id', r.id),
          'message', 'Upload the audio or video for this class.');
      ELSIF NOT EXISTS (
        SELECT 1 FROM app.assets a WHERE a.id = r.primary_asset_id AND a.state = 'ready'
      ) THEN
        issues := issues || jsonb_build_object('path', format('class[%s].primary_asset_id', r.id),
          'message', 'The uploaded media is not ready.');
      END IF;
      IF r.duration_ms IS NULL THEN
        issues := issues || jsonb_build_object('path', format('class[%s].duration_ms', r.id),
          'message', 'This class needs a media duration.');
      END IF;
    END IF;

    -- spec/03: "every class has source text from body/transcript".
    IF btrim(COALESCE(r.source_text, '')) = '' THEN
      issues := issues || jsonb_build_object('path', format('class[%s].source_text', r.id),
        'message', 'This class has no source text for the tutor to read.');
    END IF;

    -- spec/03: "each video has a valid caption track".
    IF r.kind = 'video' AND NOT EXISTS (
      SELECT 1 FROM app.assets a
      WHERE a.class_id = r.id AND a.role = 'caption' AND a.state = 'ready'
    ) THEN
      issues := issues || jsonb_build_object('path', format('class[%s].captions', r.id),
        'message', 'Every video needs a caption track.');
    END IF;

    -- spec/03: "any exercise has instructions and belongs to required class."
    IF EXISTS (SELECT 1 FROM app.exercises e WHERE e.class_id = r.id) THEN
      IF NOT r.required THEN
        issues := issues || jsonb_build_object('path', format('class[%s].required', r.id),
          'message', 'A class with an exercise must be required.');
      END IF;
      IF EXISTS (
        SELECT 1 FROM app.exercises e
        WHERE e.class_id = r.id AND btrim(COALESCE(e.instructions_md, '')) = ''
      ) THEN
        issues := issues || jsonb_build_object('path', format('class[%s].exercise', r.id),
          'message', 'The exercise needs instructions.');
      END IF;
    END IF;

    -- spec/03: "Optional handouts must be ready if attached."
    IF EXISTS (
      SELECT 1 FROM app.assets a
      WHERE a.class_id = r.id AND a.role = 'handout' AND a.state <> 'ready'
    ) THEN
      issues := issues || jsonb_build_object('path', format('class[%s].handouts', r.id),
        'message', 'A handout on this class has not finished uploading.');
    END IF;
  END LOOP;

  RETURN issues;
END $$;

/*
 * spec/04: publication is "an explicit action with a brief confirmation
 * explaining that version content becomes read-only", and "publication errors
 * preserve the draft and show field-specific issues".
 *
 * A failed validation returns issues rather than raising, so the caller gets
 * the whole list in one response and the draft is untouched.
 */
CREATE FUNCTION app.handle_publish_version(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v app.program_versions; issues jsonb; r record; pieces text[]; i integer;
BEGIN
  PERFORM app.assert_admin(actor);

  SELECT * INTO v FROM app.program_versions
    WHERE id = (payload ->> 'version_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  IF v.state = 'published' THEN
    -- Idempotent rather than an error: the version is already in the state the
    -- caller asked for, and re-publishing must not re-index or move published_at.
    RETURN jsonb_build_object('version', app.version_json(v), 'issues', '[]'::jsonb);
  END IF;

  issues := app.publication_issues(v.id);
  IF jsonb_array_length(issues) > 0 THEN
    RETURN jsonb_build_object('version', app.version_json(v), 'issues', issues);
  END IF;

  /*
   * Chunk indexing happens BEFORE the state flips, inside this transaction.
   * content_chunks keeps INSERT allowed on a published version precisely so
   * this ordering is possible either way (see M02).
   */
  DELETE FROM app.content_chunks WHERE version_id = v.id;

  FOR r IN SELECT * FROM app.classes WHERE version_id = v.id ORDER BY position LOOP
    pieces := app.chunk_source_text(r.source_text);
    FOR i IN 1 .. COALESCE(array_length(pieces, 1), 0) LOOP
      INSERT INTO app.content_chunks(class_id, version_id, ordinal, text_content)
      VALUES (r.id, v.id, i - 1, pieces[i]);
    END LOOP;
  END LOOP;

  UPDATE app.program_versions SET state = 'published', published_at = now()
   WHERE id = v.id RETURNING * INTO v;

  RETURN jsonb_build_object('version', app.version_json(v), 'issues', '[]'::jsonb);
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
