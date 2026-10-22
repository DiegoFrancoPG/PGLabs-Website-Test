-- M29 — a video class may play from YouTube instead of an uploaded file.
--
-- D-05 in HANDOFF.md, at the product owner's request for the first cohort:
-- the nine videos are hosted on YouTube and embedded, so the pilot does not
-- depend on a storage plan large enough for 1 GiB uploads.
--
-- What does NOT change is how progress is earned. The class keeps its
-- duration_ms, the learner's browser still reports intervals of media time,
-- and record_progress applies the same rules to them (spec/03 §4): the server
-- cannot tell, and does not need to know, which player produced an interval.
--
-- What does change, and is recorded as the cost of the decision:
--   * the media is as private as the YouTube video is, not as the bucket is —
--     an unlisted link keeps working after a grant is revoked;
--   * captions are YouTube's, so publication no longer demands a caption
--     asset for a YouTube class;
--   * duration_ms is supplied by the author's editor (read from the YouTube
--     player) rather than from an uploaded file.

ALTER TABLE app.classes ADD COLUMN youtube_video_id text;

-- An eleven-character YouTube id and nothing else. The editor parses whatever
-- link the author pastes; the database accepts only the id, so no URL — and no
-- host — chosen by a caller can ever be rendered into the learner's page.
ALTER TABLE app.classes ADD CONSTRAINT classes_youtube_video_id_format
  CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$');

-- One source per class. A YouTube id belongs to a video class with no uploaded
-- primary, so a learner is never offered two different recordings.
ALTER TABLE app.classes ADD CONSTRAINT classes_youtube_video_only
  CHECK (youtube_video_id IS NULL OR (kind = 'video' AND primary_asset_id IS NULL));

-- ---------------------------------------------------------------------------
-- The Class DTO carries the id, which is how the learner's page knows which
-- player to render.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.class_json(c app.classes)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', c.id, 'module_id', c.module_id, 'version_id', c.version_id,
    'title', c.title, 'kind', c.kind, 'required', c.required, 'position', c.position,
    'body_md', c.body_md, 'source_text', c.source_text,
    'duration_ms', c.duration_ms, 'primary_asset_id', c.primary_asset_id,
    'youtube_video_id', c.youtube_video_id);
$$;

-- ---------------------------------------------------------------------------
-- Authoring
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.handle_create_class(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; c app.classes; v app.program_versions; module uuid; next_pos integer;
BEGIN
  PERFORM app.assert_admin(actor);
  replay := app.idempotency_lookup(actor, 'create_class', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  module := (payload ->> 'module_id')::uuid;
  v := app.draft_version_of_module(module);

  SELECT COALESCE(max(position) + 1, 0) INTO next_pos FROM app.classes WHERE module_id = module;

  INSERT INTO app.classes(module_id, version_id, title, position, kind, required, body_md,
                          source_text, duration_ms, youtube_video_id)
  VALUES (module, v.id, btrim(payload ->> 'title'),
          COALESCE((payload ->> 'position')::integer, next_pos),
          COALESCE(payload ->> 'kind', 'video'),
          COALESCE((payload ->> 'required')::boolean, true),
          COALESCE(payload ->> 'body_md', ''),
          COALESCE(payload ->> 'source_text', ''),
          NULLIF(payload ->> 'duration_ms', '')::bigint,
          NULLIF(btrim(COALESCE(payload ->> 'youtube_video_id', '')), ''))
  RETURNING * INTO c;

  RETURN app.idempotency_store(actor, 'create_class', payload, app.class_json(c));
END $$;

/*
 * Choosing a YouTube video replaces an uploaded primary, and leaving the video
 * format drops the YouTube id: the last choice the author made is the one the
 * class holds, rather than a constraint error for having changed their mind.
 * The uploaded asset row itself stays, as it does when a new primary replaces
 * an old one.
 */
CREATE OR REPLACE FUNCTION app.handle_update_class(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app.classes; youtube text;
BEGIN
  PERFORM app.assert_admin(actor);
  youtube := NULLIF(btrim(COALESCE(payload ->> 'youtube_video_id', '')), '');

  UPDATE app.classes SET
    title = COALESCE(NULLIF(btrim(payload ->> 'title'), ''), title),
    kind = COALESCE(NULLIF(payload ->> 'kind', ''), kind),
    required = COALESCE((payload ->> 'required')::boolean, required),
    position = COALESCE((payload ->> 'position')::integer, position),
    body_md = COALESCE(payload ->> 'body_md', body_md),
    source_text = COALESCE(payload ->> 'source_text', source_text),
    duration_ms = CASE WHEN payload ? 'duration_ms'
                       THEN NULLIF(payload ->> 'duration_ms', '')::bigint ELSE duration_ms END,
    youtube_video_id = CASE
                         WHEN COALESCE(NULLIF(payload ->> 'kind', ''), kind) <> 'video' THEN NULL
                         WHEN payload ? 'youtube_video_id' THEN youtube
                         ELSE youtube_video_id END,
    primary_asset_id = CASE
                         WHEN youtube IS NOT NULL
                          AND COALESCE(NULLIF(payload ->> 'kind', ''), kind) = 'video' THEN NULL
                         ELSE primary_asset_id END
  WHERE id = (payload ->> 'class_id')::uuid
  RETURNING * INTO c;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN app.class_json(c);
END $$;

/*
 * Unchanged from M09 except for one line: a finalized primary upload clears
 * the YouTube id, the mirror image of update_class above.
 */
CREATE OR REPLACE FUNCTION app.handle_finalize_upload(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a app.assets; c app.classes; ok boolean; source text; updated boolean := false;
BEGIN
  PERFORM app.assert_admin(actor);

  SELECT * INTO a FROM app.assets WHERE id = (payload ->> 'asset_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  -- Inspect mode: returns what was RESERVED, changing nothing (see M09).
  IF COALESCE((payload ->> 'inspect')::boolean, false) THEN
    SELECT * INTO c FROM app.classes WHERE id = a.class_id;
    RETURN jsonb_build_object(
      'asset', app.asset_json(a),
      'storage_key', a.storage_key,
      'duration_ms', c.duration_ms);
  END IF;

  ok := COALESCE((payload ->> 'ok')::boolean, false);

  IF NOT ok THEN
    UPDATE app.assets SET state = 'failed', error_code = payload ->> 'error_code'
     WHERE id = a.id RETURNING * INTO a;
    RETURN jsonb_build_object('asset', app.asset_json(a), 'source_text_updated', false);
  END IF;

  UPDATE app.assets SET
    state = 'ready',
    error_code = NULL,
    bytes = COALESCE((payload ->> 'actual_bytes')::bigint, bytes),
    playback_key = COALESCE(NULLIF(payload ->> 'playback_key', ''), playback_key)
  WHERE id = a.id
  RETURNING * INTO a;

  SELECT * INTO c FROM app.classes WHERE id = a.class_id;

  IF a.role = 'primary' THEN
    UPDATE app.classes SET primary_asset_id = a.id, youtube_video_id = NULL,
      duration_ms = COALESCE(NULLIF(payload ->> 'duration_ms', '')::bigint, duration_ms)
     WHERE id = c.id;
  END IF;

  source := NULLIF(btrim(COALESCE(payload ->> 'source_text', '')), '');
  IF source IS NOT NULL AND a.role IN ('caption', 'transcript') THEN
    UPDATE app.classes SET source_text = source WHERE id = c.id;
    updated := true;
  END IF;

  RETURN jsonb_build_object('asset', app.asset_json(a), 'source_text_updated', updated);
END $$;

-- ---------------------------------------------------------------------------
-- Publication: a YouTube class needs its id and a duration, not an uploaded
-- primary or caption asset. Every other rule is M10's, unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.publication_issues(version uuid)
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
      -- Media classes need their media AND a duration. For a YouTube class
      -- the media is the id, which the format constraint has already checked.
      IF r.youtube_video_id IS NULL THEN
        IF r.primary_asset_id IS NULL THEN
          issues := issues || jsonb_build_object('path', format('class[%s].primary_asset_id', r.id),
            'message', 'Upload the audio or video for this class.');
        ELSIF NOT EXISTS (
          SELECT 1 FROM app.assets a WHERE a.id = r.primary_asset_id AND a.state = 'ready'
        ) THEN
          issues := issues || jsonb_build_object('path', format('class[%s].primary_asset_id', r.id),
            'message', 'The uploaded media is not ready.');
        END IF;
      END IF;
      IF r.duration_ms IS NULL THEN
        issues := issues || jsonb_build_object('path', format('class[%s].duration_ms', r.id),
          'message', 'This class needs a media duration.');
      END IF;
    END IF;

    IF btrim(COALESCE(r.source_text, '')) = '' THEN
      issues := issues || jsonb_build_object('path', format('class[%s].source_text', r.id),
        'message', 'This class has no source text for the tutor to read.');
    END IF;

    -- spec/03: "each video has a valid caption track". A YouTube video's
    -- captions are YouTube's own (D-05).
    IF r.kind = 'video' AND r.youtube_video_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM app.assets a
      WHERE a.class_id = r.id AND a.role = 'caption' AND a.state = 'ready'
    ) THEN
      issues := issues || jsonb_build_object('path', format('class[%s].captions', r.id),
        'message', 'Every video needs a caption track.');
    END IF;

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

-- ---------------------------------------------------------------------------
-- Cloning: the YouTube id travels with its class, like the duration does. It
-- names the same recording, and there are no bytes to copy.
--
-- A YouTube class may still hold the row of a file uploaded before the author
-- switched to YouTube. That primary is not copied: finishing its copy would
-- make it the class's primary again, which the one-source constraint refuses,
-- and the clone would fail on a file nobody plays.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.clone_version_content(source uuid, target uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE copies jsonb := '[]'::jsonb; m record; c record; a record;
        new_module uuid; new_class uuid; new_asset uuid;
BEGIN
  FOR m IN SELECT * FROM app.modules WHERE version_id = source ORDER BY position LOOP
    INSERT INTO app.modules(version_id, title, position)
    VALUES (target, m.title, m.position)
    RETURNING id INTO new_module;

    FOR c IN SELECT * FROM app.classes WHERE module_id = m.id ORDER BY position LOOP
      INSERT INTO app.classes(module_id, version_id, title, position, kind, required,
                              body_md, source_text, duration_ms, youtube_video_id)
      VALUES (new_module, target, c.title, c.position, c.kind, c.required,
              c.body_md, c.source_text, c.duration_ms, c.youtube_video_id)
      RETURNING id INTO new_class;

      INSERT INTO app.exercises(class_id, instructions_md)
      SELECT new_class, e.instructions_md FROM app.exercises e WHERE e.class_id = c.id;

      INSERT INTO app.content_chunks(class_id, version_id, ordinal, text_content)
      SELECT new_class, target, ch.ordinal, ch.text_content
        FROM app.content_chunks ch WHERE ch.class_id = c.id
       ORDER BY ch.ordinal;

      FOR a IN SELECT * FROM app.assets
                WHERE class_id = c.id
                  AND NOT (c.youtube_video_id IS NOT NULL AND role = 'primary')
                ORDER BY role, created_at LOOP
        INSERT INTO app.assets(class_id, role, original_name, mime_type, bytes,
                               storage_key, state)
        VALUES (new_class, a.role, a.original_name, a.mime_type, a.bytes,
                'versions/' || target::text || '/classes/' || new_class::text || '/'
                  || gen_random_uuid()::text || '/' || regexp_replace(a.original_name, '[^A-Za-z0-9._-]', '_', 'g'),
                'pending')
        RETURNING id INTO new_asset;

        UPDATE app.assets
           SET storage_key = 'versions/' || target::text || '/classes/' || new_class::text
                             || '/' || new_asset::text || '/'
                             || regexp_replace(a.original_name, '[^A-Za-z0-9._-]', '_', 'g')
         WHERE id = new_asset;

        copies := copies || jsonb_build_object(
          'asset_id', new_asset,
          'from', a.storage_key,
          'to', (SELECT storage_key FROM app.assets WHERE id = new_asset),
          'role', a.role,
          'mime_type', a.mime_type,
          'bytes', a.bytes,
          'from_playback', a.playback_key,
          'duration_ms', c.duration_ms);
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN copies;
END $$;
