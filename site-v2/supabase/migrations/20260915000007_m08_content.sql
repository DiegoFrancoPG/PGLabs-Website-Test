-- T08 — draft content authoring and ordering.
--
-- Every write here is admin-only and applies to DRAFT content. The published
-- freeze is not re-checked in these handlers: the M02 triggers reject any write
-- to a published version whatever path reaches the table, which is the point of
-- putting it there rather than here.

CREATE FUNCTION app.program_json(p app.programs)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'title', p.title, 'summary', p.summary,
    'archived', p.archived_at IS NOT NULL,
    'latest_published_version_id', (
      SELECT v.id FROM app.program_versions v
      WHERE v.program_id = p.id AND v.state = 'published'
      ORDER BY v.version_number DESC LIMIT 1));
$$;

CREATE FUNCTION app.version_json(v app.program_versions)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', v.id, 'program_id', v.program_id,
    'version_number', v.version_number, 'title', v.title,
    'description_md', v.description_md, 'state', v.state, 'published_at', v.published_at);
$$;

CREATE FUNCTION app.module_json(m app.modules)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', m.id, 'version_id', m.version_id,
                            'title', m.title, 'position', m.position);
$$;

CREATE FUNCTION app.class_json(c app.classes)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', c.id, 'module_id', c.module_id, 'version_id', c.version_id,
    'title', c.title, 'kind', c.kind, 'required', c.required, 'position', c.position,
    'body_md', c.body_md, 'source_text', c.source_text,
    'duration_ms', c.duration_ms, 'primary_asset_id', c.primary_asset_id);
$$;

CREATE FUNCTION app.assert_admin(actor uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
END $$;

/* The version a draft object belongs to, or an error if it does not exist. */
CREATE FUNCTION app.draft_version_of_module(module uuid)
RETURNS app.program_versions LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v app.program_versions;
BEGIN
  SELECT pv.* INTO v FROM app.modules m
    JOIN app.program_versions pv ON pv.id = m.version_id WHERE m.id = module;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN v;
END $$;

-- ---------------------------------------------------------------------------
-- Programs
-- ---------------------------------------------------------------------------

/*
 * x-access on list_programs is `authenticated`, not admin. A platform admin
 * sees the whole catalog; anyone else sees only programs they are entitled to
 * through an active grant — spec/02: "Manager can view entitled catalog
 * summaries without learning access."
 */
CREATE FUNCTION app.handle_list_programs(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(app.program_json(p) ORDER BY p.title)
      FROM app.programs p
      WHERE app.platform_admin(actor)
         OR EXISTS (
              SELECT 1 FROM app.program_grants g
              WHERE g.program_id = p.id AND g.status = 'active'
                AND (
                  (g.user_id = actor)
                  OR (g.organization_id IS NOT NULL AND app.org_manager(actor, g.organization_id))
                ))
    ), '[]'::jsonb),
    'next_cursor', NULL);
END $$;

/* spec/04: "New program creates version 1 draft." */
CREATE FUNCTION app.handle_create_program(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; p app.programs; v app.program_versions;
BEGIN
  PERFORM app.assert_admin(actor);
  replay := app.idempotency_lookup(actor, 'create_program', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  INSERT INTO app.programs(title, summary)
  VALUES (btrim(payload ->> 'title'), COALESCE(payload ->> 'summary', ''))
  RETURNING * INTO p;

  INSERT INTO app.program_versions(program_id, version_number, title)
  VALUES (p.id, 1, p.title)
  RETURNING * INTO v;

  RETURN app.idempotency_store(actor, 'create_program', payload,
    jsonb_build_object('program', app.program_json(p), 'version', app.version_json(v)));
END $$;

CREATE FUNCTION app.handle_update_program(actor uuid, payload jsonb)
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
      ELSE archived_at END
  WHERE id = (payload ->> 'program_id')::uuid
  RETURNING * INTO p;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN app.program_json(p);
END $$;

-- ---------------------------------------------------------------------------
-- Versions
-- ---------------------------------------------------------------------------

/* Returns contracts/api.json's VersionDetail: the whole editable tree at once. */
CREATE FUNCTION app.handle_get_version(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v app.program_versions;
BEGIN
  PERFORM app.assert_admin(actor);
  SELECT * INTO v FROM app.program_versions WHERE id = (payload ->> 'version_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  RETURN jsonb_build_object(
    'version', app.version_json(v),
    'modules', COALESCE((SELECT jsonb_agg(app.module_json(m) ORDER BY m.position)
                         FROM app.modules m WHERE m.version_id = v.id), '[]'::jsonb),
    'classes', COALESCE((SELECT jsonb_agg(app.class_json(c) ORDER BY c.position)
                         FROM app.classes c WHERE c.version_id = v.id), '[]'::jsonb),
    'exercises', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                             'id', e.id, 'class_id', e.class_id,
                             'instructions_md', e.instructions_md))
                           FROM app.exercises e JOIN app.classes c ON c.id = e.class_id
                           WHERE c.version_id = v.id), '[]'::jsonb),
    'assets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'id', a.id, 'class_id', a.class_id, 'role', a.role,
                          'original_name', a.original_name, 'mime_type', a.mime_type,
                          'bytes', a.bytes, 'state', a.state, 'error_code', a.error_code))
                        FROM app.assets a JOIN app.classes c ON c.id = a.class_id
                        WHERE c.version_id = v.id), '[]'::jsonb));
END $$;

CREATE FUNCTION app.handle_update_version(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v app.program_versions;
BEGIN
  PERFORM app.assert_admin(actor);
  UPDATE app.program_versions SET
    title = COALESCE(NULLIF(btrim(payload ->> 'title'), ''), title),
    description_md = COALESCE(payload ->> 'description_md', description_md)
  WHERE id = (payload ->> 'version_id')::uuid
  RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN app.version_json(v);
END $$;

-- ---------------------------------------------------------------------------
-- Modules and classes
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.handle_create_module(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; m app.modules; version uuid; next_pos integer;
BEGIN
  PERFORM app.assert_admin(actor);
  replay := app.idempotency_lookup(actor, 'create_module', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  version := (payload ->> 'version_id')::uuid;
  -- Appended at the end when no position is given, so positions stay
  -- contiguous from zero without the caller having to count.
  SELECT COALESCE(max(position) + 1, 0) INTO next_pos FROM app.modules WHERE version_id = version;

  INSERT INTO app.modules(version_id, title, position)
  VALUES (version, btrim(payload ->> 'title'),
          COALESCE((payload ->> 'position')::integer, next_pos))
  RETURNING * INTO m;

  RETURN app.idempotency_store(actor, 'create_module', payload, app.module_json(m));
END $$;

CREATE FUNCTION app.handle_update_module(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m app.modules;
BEGIN
  PERFORM app.assert_admin(actor);
  UPDATE app.modules SET title = COALESCE(NULLIF(btrim(payload ->> 'title'), ''), title)
   WHERE id = (payload ->> 'module_id')::uuid
  RETURNING * INTO m;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN app.module_json(m);
END $$;

/* spec/04: "class required=true, kind=video" are the defaults for a new class. */
CREATE FUNCTION app.handle_create_class(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE replay jsonb; c app.classes; v app.program_versions; module uuid; next_pos integer;
BEGIN
  PERFORM app.assert_admin(actor);
  replay := app.idempotency_lookup(actor, 'create_class', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  module := (payload ->> 'module_id')::uuid;
  v := app.draft_version_of_module(module);

  SELECT COALESCE(max(position) + 1, 0) INTO next_pos FROM app.classes WHERE module_id = module;

  INSERT INTO app.classes(module_id, version_id, title, position, kind, required, body_md, source_text, duration_ms)
  VALUES (module, v.id, btrim(payload ->> 'title'),
          COALESCE((payload ->> 'position')::integer, next_pos),
          COALESCE(payload ->> 'kind', 'video'),
          COALESCE((payload ->> 'required')::boolean, true),
          COALESCE(payload ->> 'body_md', ''),
          COALESCE(payload ->> 'source_text', ''),
          NULLIF(payload ->> 'duration_ms', '')::bigint)
  RETURNING * INTO c;

  RETURN app.idempotency_store(actor, 'create_class', payload, app.class_json(c));
END $$;

CREATE FUNCTION app.handle_update_class(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app.classes;
BEGIN
  PERFORM app.assert_admin(actor);
  UPDATE app.classes SET
    title = COALESCE(NULLIF(btrim(payload ->> 'title'), ''), title),
    kind = COALESCE(NULLIF(payload ->> 'kind', ''), kind),
    required = COALESCE((payload ->> 'required')::boolean, required),
    position = COALESCE((payload ->> 'position')::integer, position),
    body_md = COALESCE(payload ->> 'body_md', body_md),
    source_text = COALESCE(payload ->> 'source_text', source_text),
    duration_ms = CASE WHEN payload ? 'duration_ms'
                       THEN NULLIF(payload ->> 'duration_ms', '')::bigint ELSE duration_ms END
  WHERE id = (payload ->> 'class_id')::uuid
  RETURNING * INTO c;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN app.class_json(c);
END $$;

/*
 * spec/02: "Draft child deletion is allowed only after checking its parent is
 * draft and removing references in a transaction."
 *
 * The primary asset reference is cleared first, because classes and assets
 * point at each other; leaving it would block the delete on its own FK.
 */
CREATE FUNCTION app.handle_delete_class(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid;
BEGIN
  PERFORM app.assert_admin(actor);
  target := (payload ->> 'class_id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM app.classes WHERE id = target) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE app.classes SET primary_asset_id = NULL WHERE id = target;
  DELETE FROM app.content_chunks WHERE class_id = target;
  DELETE FROM app.exercises WHERE class_id = target;
  DELETE FROM app.assets WHERE class_id = target;
  DELETE FROM app.classes WHERE id = target;

  RETURN jsonb_build_object('class_id', target, 'deleted', true);
END $$;

-- ---------------------------------------------------------------------------
-- Exercises. ADR-08: at most one per class, and it makes the class required.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.handle_put_exercise(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid; e app.exercises;
BEGIN
  PERFORM app.assert_admin(actor);
  target := (payload ->> 'class_id')::uuid;

  INSERT INTO app.exercises(class_id, instructions_md)
  VALUES (target, btrim(payload ->> 'instructions_md'))
  ON CONFLICT (class_id) DO UPDATE SET instructions_md = excluded.instructions_md
  RETURNING * INTO e;

  -- ADR-08: "Required exercise implies class is required."
  UPDATE app.classes SET required = true WHERE id = target AND required = false;

  RETURN jsonb_build_object('id', e.id, 'class_id', e.class_id,
                            'instructions_md', e.instructions_md);
END $$;

CREATE FUNCTION app.handle_delete_exercise(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid;
BEGIN
  PERFORM app.assert_admin(actor);
  target := (payload ->> 'class_id')::uuid;
  DELETE FROM app.exercises WHERE class_id = target;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('class_id', target, 'deleted', true);
END $$;

-- ---------------------------------------------------------------------------
-- Reordering (AC-014)
--
-- spec/03: "reorder operation accepts the exact complete sibling ID list
-- without duplicates. The transaction defers position uniqueness checks,
-- rewrites positions and restores constraints. Cross-parent IDs reject the
-- entire operation."
--
-- The deferral is what makes a rewrite possible at all: moving the first item
-- to the end would otherwise collide with an existing position part-way
-- through, even though the final arrangement is valid.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.handle_reorder_content(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE kind text; parent uuid; ids uuid[]; current_ids uuid[]; i integer;
BEGIN
  PERFORM app.assert_admin(actor);

  kind := payload ->> 'parent_kind';
  parent := (payload ->> 'parent_id')::uuid;
  IF kind NOT IN ('version', 'module') THEN
    RAISE EXCEPTION 'parent_kind must be version or module' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg((value #>> '{}')::uuid) INTO ids
    FROM jsonb_array_elements(payload -> 'ordered_ids');
  IF ids IS NULL OR array_length(ids, 1) IS NULL THEN
    RAISE EXCEPTION 'ordered_ids must be a non-empty array' USING ERRCODE = '22023';
  END IF;

  -- Duplicates are rejected outright; a list containing the same child twice
  -- cannot describe an order.
  IF array_length(ids, 1) <> (SELECT count(DISTINCT u) FROM unnest(ids) AS u) THEN
    RAISE EXCEPTION 'ordered_ids contains duplicates' USING ERRCODE = '22023';
  END IF;

  IF kind = 'version' THEN
    SELECT array_agg(id ORDER BY id) INTO current_ids FROM app.modules WHERE version_id = parent;
  ELSE
    SELECT array_agg(id ORDER BY id) INTO current_ids FROM app.classes WHERE module_id = parent;
  END IF;
  IF current_ids IS NULL THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  /*
   * The list must be EXACTLY the current siblings. This one comparison rejects
   * a foreign id, a missing sibling and a partial list alike — a set that does
   * not match cannot be a reordering of it.
   */
  IF NOT (ids @> current_ids AND current_ids @> ids) THEN
    RAISE EXCEPTION 'ordered_ids must be exactly the current sibling list'
      USING ERRCODE = '22023';
  END IF;

  -- Deferred for the rewrite, then checked before this statement returns.
  SET CONSTRAINTS ALL DEFERRED;

  FOR i IN 1 .. array_length(ids, 1) LOOP
    IF kind = 'version' THEN
      UPDATE app.modules SET position = i - 1 WHERE id = ids[i];
    ELSE
      UPDATE app.classes SET position = i - 1 WHERE id = ids[i];
    END IF;
  END LOOP;

  -- Restores immediate checking, so a violation surfaces here rather than at
  -- COMMIT, and the caller sees it as the result of this operation.
  SET CONSTRAINTS ALL IMMEDIATE;

  RETURN jsonb_build_object('parent_kind', kind, 'parent_id', parent,
                            'ordered_ids', to_jsonb(ids));
END $$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig); END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Dispatcher allowlist.
--
-- Recreated in full by every migration that adds actions. That repetition is
-- the price of ADR-03's literal allowlist: nothing may be concatenated, so the
-- list cannot be built from a table. tests/integration/dispatcher.test.ts
-- asserts that every app.handle_* function is reachable from here, which is
-- what catches a handler that was written but never registered.
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
    ELSE RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.pglearn_rpc(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pglearn_rpc(text, jsonb) TO authenticated;
