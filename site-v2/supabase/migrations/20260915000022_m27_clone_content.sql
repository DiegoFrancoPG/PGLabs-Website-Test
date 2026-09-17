-- T27 — cloning a published version into a new draft, content and all.
--
-- AC-056: "Published version with existing enrollments … Existing learners
-- keep original IDs/requirements/media; new assignment can select new version."
--
-- T23 created an EMPTY draft and recorded the omission: spec/04 listed version
-- cloning under "Deferred to later releases", and an asset's storage_key is
-- UNIQUE so a copied class could not share its media. T27 is that later
-- release, and the answer to the storage_key problem is the one the task's own
-- target names — "independent asset identity": the new version gets its own
-- asset rows at its own keys, and the bytes are copied.
--
-- The copy itself cannot happen here. Storage is a different system, and a
-- database transaction must not wait on it. So this clones everything it can
-- hold, creates the new asset rows as PENDING with the keys their objects must
-- land at, and returns the list of copies the application then performs — the
-- same shape as an upload, which is also a reservation here and a transfer
-- outside.

CREATE FUNCTION app.clone_version_content(source uuid, target uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE copies jsonb := '[]'::jsonb; m record; c record; a record;
        new_module uuid; new_class uuid; new_asset uuid;
BEGIN
  /*
   * Modules and classes, each with a NEW id. That is the whole point of
   * AC-056: a learner on the old version keeps the ids they are enrolled
   * against, and nothing the author does to the draft can reach them.
   */
  FOR m IN SELECT * FROM app.modules WHERE version_id = source ORDER BY position LOOP
    INSERT INTO app.modules(version_id, title, position)
    VALUES (target, m.title, m.position)
    RETURNING id INTO new_module;

    FOR c IN SELECT * FROM app.classes WHERE module_id = m.id ORDER BY position LOOP
      INSERT INTO app.classes(module_id, version_id, title, position, kind, required,
                              body_md, source_text, duration_ms)
      VALUES (new_module, target, c.title, c.position, c.kind, c.required,
              c.body_md, c.source_text,
              -- The duration describes the media, and the media is the same
              -- media: copying the bytes cannot change how long they run. It
              -- travels with the class rather than waiting for the copy, so a
              -- class keeps its length even where the original has no asset
              -- row to copy at all.
              c.duration_ms)
      RETURNING id INTO new_class;

      -- The exercise travels with its class, and is a new row of its own.
      INSERT INTO app.exercises(class_id, instructions_md)
      SELECT new_class, e.instructions_md FROM app.exercises e WHERE e.class_id = c.id;

      /*
       * The indexed text travels too. It is derived from source_text, which
       * has been copied, so re-deriving it here keeps the tutor working on the
       * draft without waiting for publication.
       */
      INSERT INTO app.content_chunks(class_id, version_id, ordinal, text_content)
      SELECT new_class, target, ch.ordinal, ch.text_content
        FROM app.content_chunks ch WHERE ch.class_id = c.id
       ORDER BY ch.ordinal;

      /*
       * An asset row per source asset, at a NEW id and therefore a new key.
       * Created pending: the bytes are not there yet, and publication refuses
       * a class whose primary asset is not ready — so a half-copied clone
       * cannot be published, which is the correct failure.
       */
      FOR a IN SELECT * FROM app.assets WHERE class_id = c.id ORDER BY role, created_at LOOP
        INSERT INTO app.assets(class_id, role, original_name, mime_type, bytes,
                               storage_key, state)
        VALUES (new_class, a.role, a.original_name, a.mime_type, a.bytes,
                'versions/' || target::text || '/classes/' || new_class::text || '/'
                  || gen_random_uuid()::text || '/' || regexp_replace(a.original_name, '[^A-Za-z0-9._-]', '_', 'g'),
                'pending')
        RETURNING id INTO new_asset;

        -- Re-key the row so the id in the path is its own, which is what
        -- storagePathFor composes and what finalization will look for.
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
          -- A caption carries a DERIVED object too (the .vtt the player reads).
          -- It is copied alongside, or the cloned class would have a caption
          -- row pointing at the previous version's file.
          'from_playback', a.playback_key,
          'duration_ms', c.duration_ms);
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN copies;
END $$;

/*
 * clone_version, now with content.
 *
 * Unchanged: an existing draft is RETURNED rather than a second one created,
 * because `Program` carries only latest_published_version_id and nothing lists
 * a program's versions — so this is still the way back to work in progress.
 */
CREATE OR REPLACE FUNCTION app.handle_clone_version(actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p app.programs; draft app.program_versions; latest app.program_versions;
        replay jsonb; next_number integer; copies jsonb := '[]'::jsonb;
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO p FROM app.programs WHERE id = (p_payload ->> 'program_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO draft FROM app.program_versions
   WHERE program_id = p.id AND state = 'draft'
   ORDER BY version_number DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('version', app.version_json(draft), 'created', false,
                              'copies', '[]'::jsonb);
  END IF;

  replay := app.idempotency_lookup(actor, 'clone_version', p_payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  SELECT * INTO latest FROM app.program_versions
   WHERE program_id = p.id ORDER BY version_number DESC LIMIT 1;
  next_number := COALESCE(latest.version_number, 0) + 1;

  INSERT INTO app.program_versions(program_id, version_number, title, description_md, state)
  VALUES (p.id, next_number,
          COALESCE(p_payload ->> 'title', latest.title, p.title),
          COALESCE(p_payload ->> 'description_md', latest.description_md, ''),
          'draft')
  RETURNING * INTO draft;

  -- Cloned from the most recent PUBLISHED version, which is what an author
  -- means by "the next version" — not from another draft, and not from
  -- something nobody ever saw.
  IF latest.id IS NOT NULL AND latest.state = 'published' THEN
    copies := app.clone_version_content(latest.id, draft.id);
  END IF;

  INSERT INTO app.audit_events(actor_id, action, entity_id, metadata)
  VALUES (actor, 'clone_version', draft.id,
          jsonb_build_object('program_id', p.id, 'version_number', next_number,
                             'cloned_from', latest.id,
                             'assets_to_copy', jsonb_array_length(copies)));

  RETURN app.idempotency_store(actor, 'clone_version', p_payload,
    jsonb_build_object('version', app.version_json(draft), 'created', true, 'copies', copies));
END $$;

/*
 * Marking a copied object ready, once its bytes are in place.
 *
 * finalize_upload cannot be reused as it stands: it is written for an object
 * the caller just uploaded and compares against what was reserved. A copy has
 * the same declared facts as its source by construction, so what matters here
 * is only that the object arrived.
 */
/*
 * Named job_* and not handle_*: every app.handle_* function is required to be
 * reachable from pglearn_rpc, and tests/integration/dispatcher.test.ts checks
 * exactly that. This one is reached from pglearn_job, so it carries the job
 * handlers' name. (It was called handle_finish_clone for an hour, and that
 * test is what said so.)
 */
CREATE FUNCTION app.job_clone_finish(actor uuid, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a app.assets; c app.classes; v app.program_versions;
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO a FROM app.assets WHERE id = (p_payload ->> 'asset_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO c FROM app.classes WHERE id = a.class_id;
  SELECT * INTO v FROM app.program_versions WHERE id = c.version_id;
  IF v.state <> 'draft' THEN
    RAISE EXCEPTION 'content of a published version is read-only' USING ERRCODE = '23514';
  END IF;

  IF (p_payload ->> 'ok')::boolean IS NOT TRUE THEN
    -- The copy failed. The asset records why, publication stays blocked, and
    -- the author is told which file to upload again.
    UPDATE app.assets
       SET state = 'failed', error_code = COALESCE(p_payload ->> 'error_code', 'COPY_FAILED')
     WHERE id = a.id;
    RETURN jsonb_build_object('asset_id', a.id, 'state', 'failed');
  END IF;

  UPDATE app.assets
     SET state = 'ready', error_code = NULL,
         playback_key = COALESCE(p_payload ->> 'playback_key', playback_key)
   WHERE id = a.id;

  -- The primary asset makes its class playable again, with the duration the
  -- source carried: the bytes are identical, so the length is too.
  IF a.role = 'primary' THEN
    UPDATE app.classes
       SET primary_asset_id = a.id,
           duration_ms = COALESCE((p_payload ->> 'duration_ms')::bigint, duration_ms)
     WHERE id = c.id;
  END IF;

  RETURN jsonb_build_object('asset_id', a.id, 'state', 'ready');
END $$;

/*
 * finish_clone is NOT a contract operation — it is an internal step of
 * clone_version, the way finalize_upload is an internal step of an upload that
 * the contract does declare. It is reached through the service-role job
 * dispatcher rather than pglearn_rpc, so the user-facing allowlist keeps
 * matching contracts/api.json exactly.
 */
CREATE OR REPLACE FUNCTION app.job_allowed(job text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT job IN ('reminders.plan', 'reminders.claim', 'reminders.finish',
                 'reminders.recover', 'email.event', 'email.reconcile',
                 'retention.run', 'tutor.reserve', 'tutor.finish', 'tutor.reap',
                 'clone.finish', 'jobs.record');
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
    WHEN 'email.event' THEN RETURN app.job_email_event(payload);
    WHEN 'email.reconcile' THEN RETURN app.job_email_reconcile(payload);
    WHEN 'jobs.record' THEN RETURN app.job_record(payload);
    -- The actor is carried in the payload and checked by the handler: this
    -- runs as service_role, so it cannot read auth.uid().
    WHEN 'clone.finish' THEN
      RETURN app.job_clone_finish((payload ->> 'actor')::uuid, payload);
    ELSE
      -- Retention at T28.
      RAISE EXCEPTION 'job handler not implemented: %', job USING ERRCODE = '0A000';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.pglearn_job(text, jsonb) FROM PUBLIC, anon, authenticated;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig); END LOOP;
END $$;
