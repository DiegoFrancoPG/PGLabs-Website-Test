-- T15 — certificates.
--
-- The issuing transaction is already here: app.settle_completion (M13) inserts
-- the snapshot ON CONFLICT DO NOTHING and queues its notification, and the
-- certificates_immutable trigger (M02) has always refused to let a snapshot
-- change. What this migration adds is reading, revoking, and the authorization
-- around both.
--
-- spec/03: "Certificate UUID is the verification identity; no public endpoint
-- in v1. Owner/admin/authorized organization manager may read
-- metadata/download, including after course access expiry. … Revocation
-- requires admin reason 1–500 chars; revoked metadata remains visible, PDF
-- endpoint returns 409 CERTIFICATE_REVOKED. One revoke is idempotent; a
-- different reason does not overwrite it silently."

CREATE FUNCTION app.certificate_json(c app.certificates)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', c.id,
    'enrollment_id', c.enrollment_id,
    'learner_name', c.learner_name,
    'program_title', c.program_title,
    'version_number', c.version_number,
    'issuer', c.issuer,
    'completed_at', c.completed_at,
    'issued_at', c.issued_at,
    'revoked_at', c.revoked_at,
    'revocation_reason', c.revocation_reason);
$$;

/*
 * Who may see a certificate: its learner, a platform admin, or a manager of
 * the organization the enrollment belongs to.
 *
 * Deliberately NOT gated on availability. spec/03 says "including after course
 * access expiry" — what was earned stays readable when the course window has
 * closed, which is the whole point of a certificate.
 */
CREATE FUNCTION app.can_read_certificate(u uuid, c uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.certificates cr
    JOIN app.enrollments e ON e.id = cr.enrollment_id
    WHERE cr.id = c AND app.actor_active(u)
      AND (e.user_id = u OR app.can_report(u, e.id)));
$$;

CREATE FUNCTION app.handle_get_certificate(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app.certificates;
BEGIN
  SELECT * INTO c FROM app.certificates WHERE id = (payload ->> 'certificate_id')::uuid;
  -- Same answer for absent and not-yours: an unauthorized reader must not be
  -- able to tell a real certificate id from an invented one.
  IF NOT FOUND OR NOT app.can_read_certificate(actor, c.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN app.certificate_json(c);
END $$;

/*
 * The PDF's data, and the refusal that belongs with it. The rendering is the
 * application's job; deciding whether there is anything to render is not.
 */
CREATE FUNCTION app.handle_get_certificate_pdf(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app.certificates;
BEGIN
  SELECT * INTO c FROM app.certificates WHERE id = (payload ->> 'certificate_id')::uuid;
  IF NOT FOUND OR NOT app.can_read_certificate(actor, c.id) THEN
    RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002';
  END IF;
  IF c.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'this certificate has been revoked' USING ERRCODE = 'PGL41';
  END IF;
  RETURN app.certificate_json(c);
END $$;

/*
 * revoke_certificate. Platform admin only — spec/03 says "admin reason", and
 * an organization manager who may READ a certificate may not withdraw it.
 */
CREATE FUNCTION app.handle_revoke_certificate(actor uuid, payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app.certificates; reason text; replay jsonb;
BEGIN
  IF NOT app.platform_admin(actor) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c FROM app.certificates
   WHERE id = (payload ->> 'certificate_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE = 'P0002'; END IF;

  replay := app.idempotency_lookup(actor, 'revoke_certificate', payload);
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  reason := btrim(payload ->> 'reason');
  IF reason IS NULL OR char_length(reason) < 1 OR char_length(reason) > 500 THEN
    RAISE EXCEPTION 'a reason of 1 to 500 characters is required' USING ERRCODE = '22023';
  END IF;

  /*
   * "One revoke is idempotent; a different reason does not overwrite it
   * silently." Repeating the same reason answers with the certificate as it
   * stands; a different one is refused rather than quietly ignored, so the
   * caller learns their reason was not recorded.
   */
  IF c.revoked_at IS NOT NULL THEN
    IF c.revocation_reason <> reason THEN
      RAISE EXCEPTION 'this certificate is already revoked, with a different reason'
        USING ERRCODE = 'PGL41';
    END IF;
    RETURN app.idempotency_store(actor, 'revoke_certificate', payload, app.certificate_json(c));
  END IF;

  UPDATE app.certificates
     SET revoked_at = now(), revocation_reason = reason
   WHERE id = c.id RETURNING * INTO c;

  INSERT INTO app.audit_events(actor_id, organization_id, action, entity_id, metadata)
  SELECT actor, e.organization_id, 'revoke_certificate', c.id,
         jsonb_build_object('enrollment_id', c.enrollment_id, 'reason', reason)
    FROM app.enrollments e WHERE e.id = c.enrollment_id;

  RETURN app.idempotency_store(actor, 'revoke_certificate', payload, app.certificate_json(c));
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
