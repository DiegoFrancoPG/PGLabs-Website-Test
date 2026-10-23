-- M39 — each lesson states its learning goal.
--
-- D-24 in HANDOFF.md, at the product owner's request: the card beside the
-- player showed a summary taken from the lesson's description or, failing
-- that, the opening of its transcript. The author now writes what the learner
-- should take away, as its own field, when creating or editing the lesson.
--
-- Optional, like the description: an empty goal leaves the card as it was,
-- so lessons written before M39 lose nothing, and publication does not demand
-- one. It is content, so it freezes with the version (M02) and travels with
-- a clone. 500 characters keeps it a goal rather than a second description.

ALTER TABLE app.classes ADD COLUMN learning_goal text NOT NULL DEFAULT '';

ALTER TABLE app.classes ADD CONSTRAINT classes_learning_goal_length
  CHECK (char_length(learning_goal) <= 500);

-- ---------------------------------------------------------------------------
-- The Class DTO carries the goal, and authoring writes it. Each function is
-- M29's with the one column added.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.class_json(c app.classes)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', c.id, 'module_id', c.module_id, 'version_id', c.version_id,
    'title', c.title, 'kind', c.kind, 'required', c.required, 'position', c.position,
    'body_md', c.body_md, 'source_text', c.source_text,
    'duration_ms', c.duration_ms, 'primary_asset_id', c.primary_asset_id,
    'youtube_video_id', c.youtube_video_id, 'learning_goal', c.learning_goal);
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
                          source_text, duration_ms, youtube_video_id, learning_goal)
  VALUES (module, v.id, btrim(payload ->> 'title'),
          COALESCE((payload ->> 'position')::integer, next_pos),
          COALESCE(payload ->> 'kind', 'video'),
          COALESCE((payload ->> 'required')::boolean, true),
          COALESCE(payload ->> 'body_md', ''),
          COALESCE(payload ->> 'source_text', ''),
          NULLIF(payload ->> 'duration_ms', '')::bigint,
          NULLIF(btrim(COALESCE(payload ->> 'youtube_video_id', '')), ''),
          btrim(COALESCE(payload ->> 'learning_goal', '')))
  RETURNING * INTO c;

  RETURN app.idempotency_store(actor, 'create_class', payload, app.class_json(c));
END $$;

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
    learning_goal = COALESCE(btrim(payload ->> 'learning_goal'), learning_goal),
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

-- ---------------------------------------------------------------------------
-- Cloning carries the goal with the rest of the class. Otherwise exactly as
-- M35 left it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.clone_version_content(source uuid, target uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE copies jsonb := '[]'::jsonb; m record; c record; a record;
        new_module uuid; new_class uuid; new_asset uuid;
BEGIN
  FOR m IN SELECT * FROM app.modules WHERE version_id = source ORDER BY position LOOP
    INSERT INTO app.modules(version_id, title, position)
    VALUES (target,
            COALESCE((SELECT t.title FROM app.module_titles t WHERE t.module_id = m.id), m.title),
            m.position)
    RETURNING id INTO new_module;

    FOR c IN SELECT * FROM app.classes WHERE module_id = m.id ORDER BY position LOOP
      INSERT INTO app.classes(module_id, version_id, title, position, kind, required,
                              body_md, source_text, duration_ms, youtube_video_id, learning_goal)
      VALUES (new_module, target, c.title, c.position, c.kind, c.required,
              c.body_md, c.source_text, c.duration_ms, c.youtube_video_id, c.learning_goal)
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

  -- M35: the schedule and visibility a module had travel with it, matched by
  -- position — a new version would otherwise open every module at once.
  INSERT INTO app.module_releases(module_id, release_at, updated_by)
  SELECT nm.id, r.release_at, r.updated_by
    FROM app.modules om
    JOIN app.module_releases r ON r.module_id = om.id
    JOIN app.modules nm ON nm.version_id = target AND nm.position = om.position
   WHERE om.version_id = source
  ON CONFLICT (module_id) DO NOTHING;

  INSERT INTO app.hidden_modules(module_id, hidden_by)
  SELECT nm.id, h.hidden_by
    FROM app.modules om
    JOIN app.hidden_modules h ON h.module_id = om.id
    JOIN app.modules nm ON nm.version_id = target AND nm.position = om.position
   WHERE om.version_id = source
  ON CONFLICT (module_id) DO NOTHING;

  RETURN copies;
END $$;
