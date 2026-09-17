-- T17 — tutor context retrieval and privacy.
--
-- spec/05: "At question time verify can_learn and class/version match; select
-- up to three current-class chunks, then up to three unique chunks ranked by
-- ts_rank_cd(search_vector, websearch_to_tsquery('english',question)) from that
-- exact authorized version. Tie break class order/chunk ordinal/UUID. If
-- current class has more chunks, prefer question-ranked chunks before ordinal
-- fallback. No broader tenant lookup or web fetch."
--
-- Nothing here is dispatched: T17 declares no operation_ids. These are the
-- functions T18's ask_tutor calls inside its reservation transaction, so the
-- retrieval cannot be reached except through a request that was authorized.

/*
 * The chunks a learner may be shown, for one question.
 *
 * The version is the one their enrollment is PINNED to, never the program's
 * current version: a learner part-way through version 1 is answered from
 * version 1 even after version 2 is published. That is the same freeze the
 * progress denominator relies on.
 */
CREATE FUNCTION app.tutor_sources(actor uuid, enrollment uuid, class uuid, question text)
RETURNS TABLE (
  chunk_id uuid, class_id uuid, class_title text, ordinal integer,
  text_content text, is_current boolean, rank real
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e app.enrollments; c app.classes; query tsquery;
BEGIN
  SELECT * INTO e FROM app.enrollments WHERE id = enrollment;
  IF NOT FOUND OR NOT app.can_learn(actor, enrollment, now()) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  -- "verify can_learn and class/version match".
  SELECT * INTO c FROM app.classes WHERE id = class AND version_id = e.version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  -- websearch_to_tsquery never raises on user input, which matters: the
  -- question is typed by a person and must not be able to break the query.
  query := websearch_to_tsquery('english', COALESCE(question, ''));

  RETURN QUERY
  WITH authorized AS (
    -- The one place the corpus is bounded. Everything below draws from here,
    -- so no ranking or fallback can reach another version or another program.
    SELECT ch.id, ch.class_id, cl.title AS class_title, ch.ordinal, ch.text_content,
           cl.position AS class_position, ch.search_vector
      FROM app.content_chunks ch
      JOIN app.classes cl ON cl.id = ch.class_id
     WHERE ch.version_id = e.version_id
  ), current_class AS (
    /*
     * Up to three from the class being asked about. Question-ranked first, as
     * spec/05 requires — "prefer question-ranked chunks before ordinal
     * fallback" — with ordinal deciding among chunks the question does not
     * distinguish.
     */
    SELECT a.*, ts_rank_cd(a.search_vector, query) AS rank, true AS is_current
      FROM authorized a
     WHERE a.class_id = class
     ORDER BY ts_rank_cd(a.search_vector, query) DESC, a.ordinal, a.id
     LIMIT 3
  ), elsewhere AS (
    -- Up to three more from the rest of the pinned version, ranked only.
    SELECT a.*, ts_rank_cd(a.search_vector, query) AS rank, false AS is_current
      FROM authorized a
     WHERE a.class_id <> class
       AND ts_rank_cd(a.search_vector, query) > 0
       AND a.id NOT IN (SELECT id FROM current_class)
     ORDER BY ts_rank_cd(a.search_vector, query) DESC, a.class_position, a.ordinal, a.id
     LIMIT 3
  )
  SELECT s.id, s.class_id, s.class_title, s.ordinal, s.text_content, s.is_current, s.rank
    FROM (SELECT * FROM current_class UNION ALL SELECT * FROM elsewhere) s
   ORDER BY s.is_current DESC, s.rank DESC, s.class_position, s.ordinal, s.id;
END $$;

/*
 * The conversation so far: "optional last six messages belonging to same
 * enrollment and user".
 *
 * Both halves of that are enforced by the join, not by a filter that could be
 * forgotten — a session belongs to an enrollment, and an enrollment to one
 * learner, so another person's conversation is unreachable rather than merely
 * excluded.
 *
 * Only COMPLETED requests are returned. A failed or pending one has no answer
 * to carry, and sending half an exchange back to the model would invent a
 * conversation that never happened.
 */
CREATE FUNCTION app.tutor_history(actor uuid, enrollment uuid, take integer DEFAULT 6)
RETURNS TABLE (question text, answer text, asked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.question, r.answer, r.created_at
    FROM app.tutor_requests r
    JOIN app.tutor_sessions s ON s.id = r.session_id
    JOIN app.enrollments e ON e.id = s.enrollment_id
   WHERE e.id = enrollment AND e.user_id = actor AND r.status = 'completed'
   ORDER BY r.created_at DESC
   LIMIT GREATEST(take, 0);
$$;

/*
 * The session for a conversation, created on first use.
 *
 * spec/05: "create session if null". A session is per enrollment, so a learner
 * with two programs has two conversations and neither can see the other.
 */
CREATE FUNCTION app.tutor_session_for(actor uuid, enrollment uuid, requested uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
-- Named `session`, not `found`: PL/pgSQL resolves identifiers case-insensitively,
-- so a variable called `found` silently becomes what `IF FOUND` tests.
DECLARE session uuid;
BEGIN
  IF NOT app.can_learn(actor, enrollment, now()) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;

  IF requested IS NOT NULL THEN
    SELECT s.id INTO session FROM app.tutor_sessions s
      JOIN app.enrollments e ON e.id = s.enrollment_id
     WHERE s.id = requested AND e.id = enrollment AND e.user_id = actor;
    -- A session id from another enrollment or another learner is not an error
    -- to be explained; it is simply not there.
    IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;
    RETURN session;
  END IF;

  SELECT s.id INTO session FROM app.tutor_sessions s
   WHERE s.enrollment_id = enrollment ORDER BY s.created_at LIMIT 1;
  IF session IS NOT NULL THEN RETURN session; END IF;

  INSERT INTO app.tutor_sessions(enrollment_id) VALUES (enrollment) RETURNING id INTO session;
  RETURN session;
END $$;

/*
 * Everything the prompt builder needs, in one call: the class being asked
 * about, the authorized sources, and the history. Assembling the prompt itself
 * is the application's job (lib/tutor/prompt.ts), because the 24,000-byte
 * budget is measured in UTF-8 bytes and is easier to reason about there.
 */
CREATE FUNCTION app.tutor_context(actor uuid, enrollment uuid, class uuid, question text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app.classes; e app.enrollments;
BEGIN
  SELECT * INTO e FROM app.enrollments WHERE id = enrollment;
  IF NOT FOUND OR NOT app.can_learn(actor, enrollment, now()) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO c FROM app.classes WHERE id = class AND version_id = e.version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  RETURN jsonb_build_object(
    'class', jsonb_build_object('id', c.id, 'title', c.title),
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.chunk_id, 'class_id', s.class_id, 'class_title', s.class_title,
               'ordinal', s.ordinal, 'text', s.text_content, 'is_current', s.is_current))
        FROM app.tutor_sources(actor, enrollment, class, question) s), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('question', h.question, 'answer', h.answer)
                       ORDER BY h.asked_at)
        FROM app.tutor_history(actor, enrollment, 6) h), '[]'::jsonb));
END $$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig); END LOOP;
END $$;
