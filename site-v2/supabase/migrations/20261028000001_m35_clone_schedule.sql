-- M35 — a new version keeps its modules' release dates and hidden state.
--
-- D-16 in HANDOFF.md. Cloning a published version into a draft copied the
-- content and, since M34, the shown titles, but not the release dates (M31)
-- or the hidden flags (M32), so the next version opened every module at
-- once. They are now copied too, module by module, by position. Otherwise
-- the function is exactly as M34 left it.

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
