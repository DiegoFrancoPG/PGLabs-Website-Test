-- M34 — renaming a module, including on a published version.
--
-- D-14 in HANDOFF.md, at the product owner's request. In a draft the title is
-- simply updated, as before. A published version's modules are frozen by the
-- M02 triggers (spec/02), and that stays true: the new name is kept beside
-- the frozen row in app.module_titles and shown in its place everywhere the
-- Module DTO is read — the editor, the learner's outline and lesson pages.
-- Nothing stored about a learner refers to a module's title (certificates
-- snapshot the program title), so a rename changes what is shown and nothing
-- that was earned. Cloning a version copies the title as shown.

CREATE TABLE app.module_titles (
  module_id uuid PRIMARY KEY REFERENCES app.modules(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  updated_by uuid NOT NULL REFERENCES app.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.module_titles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.module_titles FROM PUBLIC, anon, authenticated;

/* The Module DTO shows the renamed title when there is one. */
CREATE OR REPLACE FUNCTION app.module_json(m app.modules)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', m.id, 'version_id', m.version_id,
                            'title', COALESCE((SELECT t.title FROM app.module_titles t
                                                WHERE t.module_id = m.id), m.title),
                            'position', m.position,
                            'release_at', (SELECT r.release_at FROM app.module_releases r
                                            WHERE r.module_id = m.id),
                            'hidden', EXISTS (SELECT 1 FROM app.hidden_modules h
                                               WHERE h.module_id = m.id));
$$;

/*
 * update_module: a draft's title is updated in place; a published module's
 * new title is stored beside it, since the row itself is frozen.
 */
CREATE OR REPLACE FUNCTION app.handle_update_module(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m app.modules; new_title text; state text;
BEGIN
  PERFORM app.assert_admin(actor);
  SELECT * INTO m FROM app.modules WHERE id = (payload ->> 'module_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  new_title := NULLIF(btrim(payload ->> 'title'), '');
  IF new_title IS NULL THEN RETURN app.module_json(m); END IF;
  IF char_length(new_title) > 160 THEN
    RAISE EXCEPTION 'title must be 1 to 160 characters' USING ERRCODE = '22023';
  END IF;

  SELECT v.state INTO state FROM app.program_versions v WHERE v.id = m.version_id;
  IF state = 'published' THEN
    INSERT INTO app.module_titles(module_id, title, updated_by) VALUES (m.id, new_title, actor)
    ON CONFLICT (module_id) DO UPDATE
      SET title = excluded.title, updated_by = excluded.updated_by, updated_at = now();
  ELSE
    UPDATE app.modules SET title = new_title WHERE id = m.id RETURNING * INTO m;
  END IF;
  RETURN app.module_json(m);
END $$;

/* Cloning copies each module's title as shown. Otherwise as its latest definition. */
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

  RETURN copies;
END $$;
