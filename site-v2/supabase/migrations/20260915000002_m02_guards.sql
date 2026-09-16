-- M02 — private predicates and relationship/immutability triggers.
--
-- spec/02 M02: "Relationship/immutability/timezone triggers, profile sync
-- provisioning, private predicate helpers."
--
-- Everything here lives in the private `app` schema with EXECUTE revoked from
-- the browser roles. These are the rules that must hold even when a service
-- layer is wrong: spec/02 is explicit that "RLS alone does not secure a buggy
-- privileged function", so the invariants live in the database.
--
-- Every function sets an empty search_path and fully qualifies its references,
-- so none of them can be hijacked by a caller-controlled search_path.

-- ---------------------------------------------------------------------------
-- 1. Authorization predicates (spec/02, "Exact authorization predicates")
-- ---------------------------------------------------------------------------

-- actor_active(u): profile exists and is active. Onboarding is required except
-- for the own-account operations spec/02 exempts (get_me, get_invitation,
-- accept_invitation), which pass allow_pending_onboarding => true.
CREATE FUNCTION app.actor_active(u uuid, allow_pending_onboarding boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.profiles p
    WHERE p.id = u
      AND p.status = 'active'
      AND (allow_pending_onboarding OR p.onboarded_at IS NOT NULL)
  );
$$;

CREATE FUNCTION app.platform_admin(u uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.actor_active(u) AND EXISTS (SELECT 1 FROM app.platform_admins a WHERE a.user_id = u);
$$;

CREATE FUNCTION app.org_manager(u uuid, o uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.actor_active(u) AND EXISTS (
    SELECT 1 FROM app.memberships m
    JOIN app.organizations org ON org.id = m.organization_id
    WHERE m.user_id = u AND m.organization_id = o
      AND m.role = 'manager' AND m.status = 'active'
      AND org.status = 'active'
  );
$$;

-- Owners keep access to their own records after cancellation, expiry or removal
-- from the organization, subject only to the account still being active.
CREATE FUNCTION app.owns_enrollment(u uuid, e uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM app.enrollments en WHERE en.id = e AND en.user_id = u);
$$;

-- A personal enrollment has no organization, so it can never match an
-- organization manager. Reporting still covers historical rows whose learner
-- has since been removed from the organization.
CREATE FUNCTION app.can_report(u uuid, e uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.platform_admin(u) OR EXISTS (
    SELECT 1 FROM app.enrollments en
    WHERE en.id = e AND en.organization_id IS NOT NULL
      AND app.org_manager(u, en.organization_id)
  );
$$;

-- Derived availability, in spec/02's exact priority order:
--   account inactive -> cancelled -> membership inactive -> revoked
--   -> not started -> expired -> available
CREATE FUNCTION app.enrollment_availability(u uuid, e uuid, t timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE en app.enrollments; g app.program_grants; off app.cohort_offerings;
        v app.program_versions; prof app.profiles; org app.organizations;
        mem app.memberships; coh app.cohorts; cm app.cohort_members;
BEGIN
  SELECT * INTO en FROM app.enrollments WHERE id = e;
  IF NOT FOUND OR en.user_id <> u THEN RETURN 'not_found'; END IF;

  SELECT * INTO prof FROM app.profiles WHERE id = u;
  IF prof.status <> 'active' OR prof.onboarded_at IS NULL THEN RETURN 'account_inactive'; END IF;

  IF en.status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF en.offering_id IS NOT NULL THEN
    SELECT * INTO off FROM app.cohort_offerings WHERE id = en.offering_id;
    IF off.status = 'cancelled' THEN RETURN 'cancelled'; END IF;

    SELECT * INTO org FROM app.organizations WHERE id = en.organization_id;
    SELECT * INTO mem FROM app.memberships WHERE organization_id = en.organization_id AND user_id = u;
    SELECT * INTO coh FROM app.cohorts WHERE id = off.cohort_id;
    SELECT * INTO cm FROM app.cohort_members WHERE cohort_id = off.cohort_id AND user_id = u;
    IF org.status <> 'active' OR mem.status <> 'active'
       OR coh.archived_at IS NOT NULL OR cm.status IS DISTINCT FROM 'active' THEN
      RETURN 'membership_inactive';
    END IF;
  END IF;

  SELECT * INTO g FROM app.program_grants WHERE id = en.grant_id;
  IF g.status = 'revoked' OR g.program_id <> en.program_id THEN RETURN 'revoked'; END IF;
  -- A personal grant must belong to the learner it is being used by.
  IF en.offering_id IS NULL AND g.user_id IS DISTINCT FROM u THEN RETURN 'revoked'; END IF;

  SELECT * INTO v FROM app.program_versions WHERE id = en.version_id;
  IF v.state <> 'published' THEN RETURN 'revoked'; END IF;

  -- Start is inclusive, hard end exclusive (ADR-10). The earliest applicable
  -- start and the earliest applicable end decide availability.
  IF t < en.starts_at OR t < g.starts_at
     OR (en.offering_id IS NOT NULL AND t < off.starts_at) THEN
    RETURN 'not_started';
  END IF;
  IF (en.access_ends_at IS NOT NULL AND t >= en.access_ends_at)
     OR (g.ends_at IS NOT NULL AND t >= g.ends_at)
     OR (en.offering_id IS NOT NULL AND off.access_ends_at IS NOT NULL AND t >= off.access_ends_at) THEN
    RETURN 'expired';
  END IF;

  RETURN 'available';
END $$;

CREATE FUNCTION app.can_learn(u uuid, e uuid, t timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.actor_active(u) AND app.owns_enrollment(u, e)
     AND app.enrollment_availability(u, e, t) = 'available';
$$;

-- Draft preview is platform admin only, and creates no enrollment or progress.
CREATE FUNCTION app.can_preview(u uuid, version uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app.platform_admin(u) AND EXISTS (SELECT 1 FROM app.program_versions v WHERE v.id = version);
$$;

-- ---------------------------------------------------------------------------
-- 2. Timezone validation (spec/02: "Timezones must be in pg_timezone_names")
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.assert_timezone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'unknown timezone %', NEW.timezone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER profiles_timezone BEFORE INSERT OR UPDATE OF timezone ON app.profiles
  FOR EACH ROW EXECUTE FUNCTION app.assert_timezone();
CREATE TRIGGER organizations_timezone BEFORE INSERT OR UPDATE OF timezone ON app.organizations
  FOR EACH ROW EXECUTE FUNCTION app.assert_timezone();

-- ---------------------------------------------------------------------------
-- 3. Grant immutability (spec/02: "A grant's subject is immutable; edits can
--    alter dates/status only")
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.grants_subject_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.program_id IS DISTINCT FROM OLD.program_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'grant subject is immutable; only dates and status may change'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER grants_immutable BEFORE UPDATE ON app.program_grants
  FOR EACH ROW EXECUTE FUNCTION app.grants_subject_immutable();

-- ---------------------------------------------------------------------------
-- 4. Offering relationships (AC-005)
--
-- spec/02: "An offering's grant subject must equal its organization; its
-- version must be published and match its program, and the program must not be
-- archived when creating a new offering/enrollment. Reject assignment if access
-- dates extend beyond grant validity; a soft due may equal hard end."
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.offering_relationships() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g app.program_grants; v app.program_versions; p app.programs;
BEGIN
  SELECT * INTO g FROM app.program_grants WHERE id = NEW.grant_id;
  IF g.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'offering grant belongs to a different organization'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v FROM app.program_versions WHERE id = NEW.version_id;
  IF v.state <> 'published' THEN
    RAISE EXCEPTION 'offering version must be published' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO p FROM app.programs WHERE id = NEW.program_id;
  IF TG_OP = 'INSERT' AND p.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'program is archived and cannot receive new offerings'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.starts_at < g.starts_at THEN
    RAISE EXCEPTION 'offering starts before its grant' USING ERRCODE = '23514';
  END IF;
  IF g.ends_at IS NOT NULL AND COALESCE(NEW.access_ends_at, NEW.due_at) > g.ends_at THEN
    RAISE EXCEPTION 'offering access extends beyond its grant' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER offering_relationships BEFORE INSERT OR UPDATE ON app.cohort_offerings
  FOR EACH ROW EXECUTE FUNCTION app.offering_relationships();

-- ---------------------------------------------------------------------------
-- 5. Enrollment immutability and relationships
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.enrollment_relationships() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g app.program_grants; v app.program_versions; p app.programs; m app.memberships;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.program_id IS DISTINCT FROM OLD.program_id
       OR NEW.version_id IS DISTINCT FROM OLD.version_id
       OR NEW.grant_id IS DISTINCT FROM OLD.grant_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.offering_id IS DISTINCT FROM OLD.offering_id
       OR NEW.attempt IS DISTINCT FROM OLD.attempt THEN
      RAISE EXCEPTION 'enrollment identity is immutable' USING ERRCODE = '23514';
    END IF;
    -- Completion timestamps only ever go from null to a value.
    IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'completed_at cannot be changed once set' USING ERRCODE = '23514';
    END IF;
    IF OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      RAISE EXCEPTION 'started_at cannot be changed once set' USING ERRCODE = '23514';
    END IF;
    -- spec/02: date changes cannot move the start after an existing started_at,
    -- and a completed enrollment's schedule cannot be edited in v1.
    IF OLD.completed_at IS NOT NULL
       AND (NEW.starts_at, NEW.due_at, NEW.access_ends_at)
           IS DISTINCT FROM (OLD.starts_at, OLD.due_at, OLD.access_ends_at) THEN
      RAISE EXCEPTION 'a completed enrollment schedule cannot be edited' USING ERRCODE = '23514';
    END IF;
    IF OLD.started_at IS NOT NULL AND NEW.starts_at > OLD.started_at THEN
      RAISE EXCEPTION 'start cannot move after the learner already started' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT * INTO g FROM app.program_grants WHERE id = NEW.grant_id;
  IF NEW.offering_id IS NULL THEN
    -- Personal: the grant must belong to this learner and carry no organization.
    IF g.user_id IS DISTINCT FROM NEW.user_id OR g.organization_id IS NOT NULL THEN
      RAISE EXCEPTION 'personal enrollment must use a grant belonging to that learner'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF g.organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'enrollment grant belongs to a different organization'
        USING ERRCODE = '23514';
    END IF;
    -- spec/02: organization enrollment must reference an existing active
    -- cohort_members row and an invited or active membership of the same org.
    IF NOT EXISTS (
      SELECT 1 FROM app.cohort_offerings o
      JOIN app.cohort_members cm ON cm.cohort_id = o.cohort_id AND cm.user_id = NEW.user_id
      WHERE o.id = NEW.offering_id AND cm.status = 'active'
    ) THEN
      RAISE EXCEPTION 'learner is not an active member of the offering cohort'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO m FROM app.memberships
      WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id;
    IF m.status NOT IN ('invited', 'active') THEN
      RAISE EXCEPTION 'learner has no invited or active membership of this organization'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v FROM app.program_versions WHERE id = NEW.version_id;
    IF v.state <> 'published' THEN
      RAISE EXCEPTION 'enrollment version must be published' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO p FROM app.programs WHERE id = NEW.program_id;
    IF p.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'program is archived and cannot receive new enrollments'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.starts_at < g.starts_at
       OR (g.ends_at IS NOT NULL AND COALESCE(NEW.access_ends_at, NEW.due_at) > g.ends_at) THEN
      RAISE EXCEPTION 'enrollment dates fall outside its grant' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enrollment_relationships BEFORE INSERT OR UPDATE ON app.enrollments
  FOR EACH ROW EXECUTE FUNCTION app.enrollment_relationships();

-- ---------------------------------------------------------------------------
-- 6. Published content is frozen
--
-- spec/02: "Any UPDATE/DELETE of published version content, its modules,
-- classes, exercises, assets or chunks is rejected. Publication permits only
-- draft->published after validation."
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.version_state_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.state = 'published' THEN
    IF NEW.state <> 'published' THEN
      RAISE EXCEPTION 'a published version cannot return to draft' USING ERRCODE = '23514';
    END IF;
    IF (NEW.title, NEW.description_md, NEW.program_id, NEW.version_number, NEW.published_at)
       IS DISTINCT FROM (OLD.title, OLD.description_md, OLD.program_id, OLD.version_number, OLD.published_at) THEN
      RAISE EXCEPTION 'published version content is read-only' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER version_state BEFORE UPDATE ON app.program_versions
  FOR EACH ROW EXECUTE FUNCTION app.version_state_transition();

CREATE FUNCTION app.reject_published_version_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.state = 'published' THEN
    RAISE EXCEPTION 'a published version cannot be deleted' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER version_no_delete BEFORE DELETE ON app.program_versions
  FOR EACH ROW EXECUTE FUNCTION app.reject_published_version_delete();

-- Child content: locked whenever its owning version is published. The version
-- is resolved per table because the column that reaches it differs.
--
-- spec/02 says "any UPDATE/DELETE of published version content" is rejected.
-- INSERT is blocked too for modules, classes, exercises and assets, which are
-- only ever written while the version is a draft — ADR-07 makes published
-- versions immutable, and adding a class to one would mutate it.
--
-- content_chunks is the deliberate exception: spec/05 creates chunks DURING
-- publication, in the same transaction that flips the state, so blocking their
-- INSERT would make publication impossible.
CREATE FUNCTION app.reject_when_version_published() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_data record; v_id uuid; state text;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO v_id USING row_data;
  SELECT pv.state INTO state FROM app.program_versions pv WHERE pv.id = v_id;
  IF state = 'published' THEN
    RAISE EXCEPTION 'content of a published version is read-only (%, %)', TG_TABLE_NAME, TG_OP
      USING ERRCODE = '23514';
  END IF;
  RETURN row_data;
END $$;

CREATE TRIGGER modules_frozen BEFORE INSERT OR UPDATE OR DELETE ON app.modules
  FOR EACH ROW EXECUTE FUNCTION app.reject_when_version_published('version_id');
CREATE TRIGGER classes_frozen BEFORE INSERT OR UPDATE OR DELETE ON app.classes
  FOR EACH ROW EXECUTE FUNCTION app.reject_when_version_published('version_id');
CREATE TRIGGER chunks_frozen BEFORE UPDATE OR DELETE ON app.content_chunks
  FOR EACH ROW EXECUTE FUNCTION app.reject_when_version_published('version_id');

-- Exercises and assets reach the version through their class.
CREATE FUNCTION app.reject_when_class_version_published() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_data record; state text;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT pv.state INTO state
    FROM app.classes c JOIN app.program_versions pv ON pv.id = c.version_id
    WHERE c.id = row_data.class_id;
  IF state = 'published' THEN
    RAISE EXCEPTION 'content of a published version is read-only (%, %)', TG_TABLE_NAME, TG_OP
      USING ERRCODE = '23514';
  END IF;
  RETURN row_data;
END $$;

CREATE TRIGGER exercises_frozen BEFORE INSERT OR UPDATE OR DELETE ON app.exercises
  FOR EACH ROW EXECUTE FUNCTION app.reject_when_class_version_published();
CREATE TRIGGER assets_frozen BEFORE INSERT OR UPDATE OR DELETE ON app.assets
  FOR EACH ROW EXECUTE FUNCTION app.reject_when_class_version_published();

-- ---------------------------------------------------------------------------
-- 7. Primary asset integrity
--
-- spec/02: "Primary asset must be role=primary, ready and same class with
-- matching supported MIME."
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.class_primary_asset() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a app.assets;
BEGIN
  IF NEW.primary_asset_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO a FROM app.assets WHERE id = NEW.primary_asset_id;
  IF a.class_id <> NEW.id THEN
    RAISE EXCEPTION 'primary asset belongs to another class' USING ERRCODE = '23514';
  END IF;
  IF a.role <> 'primary' THEN
    RAISE EXCEPTION 'primary asset must have role primary' USING ERRCODE = '23514';
  END IF;
  IF a.state <> 'ready' THEN
    RAISE EXCEPTION 'primary asset is not ready' USING ERRCODE = '23514';
  END IF;
  -- spec/03: MP4 video, MP3/M4A audio. MIME must agree with the class kind.
  IF NEW.kind = 'video' AND a.mime_type <> 'video/mp4' THEN
    RAISE EXCEPTION 'video class requires an MP4 primary asset' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'audio' AND a.mime_type NOT IN ('audio/mpeg', 'audio/mp4') THEN
    RAISE EXCEPTION 'audio class requires an MP3 or M4A primary asset' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER classes_primary_asset BEFORE INSERT OR UPDATE OF primary_asset_id, kind ON app.classes
  FOR EACH ROW EXECUTE FUNCTION app.class_primary_asset();

-- ---------------------------------------------------------------------------
-- 8. An active organization always keeps a manager
--
-- spec/02: "Active organization always has at least one invited or active
-- manager; once any manager has accepted, at least one active manager must
-- remain. Lock organization row for role removals."
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.organization_keeps_manager() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org_id uuid; org app.organizations; any_accepted boolean; remaining integer;
BEGIN
  org_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;

  -- Serialize concurrent role removals against each other.
  SELECT * INTO org FROM app.organizations WHERE id = org_id FOR UPDATE;
  IF NOT FOUND OR org.status <> 'active' THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT EXISTS (
    SELECT 1 FROM app.memberships
    WHERE organization_id = org_id AND role = 'manager' AND status = 'active'
  ) INTO any_accepted;

  IF any_accepted THEN
    SELECT count(*) INTO remaining FROM app.memberships
      WHERE organization_id = org_id AND role = 'manager' AND status = 'active';
    IF remaining = 0 THEN
      RAISE EXCEPTION 'an active organization must keep at least one active manager'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT count(*) INTO remaining FROM app.memberships
      WHERE organization_id = org_id AND role = 'manager' AND status IN ('invited', 'active');
    IF remaining = 0 THEN
      RAISE EXCEPTION 'an active organization must keep at least one invited or active manager'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- Deferred to statement end so a manager swap inside one transaction is legal.
CREATE CONSTRAINT TRIGGER memberships_keep_manager
  AFTER UPDATE OR DELETE ON app.memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.organization_keeps_manager();

-- ---------------------------------------------------------------------------
-- 9. Certificates are immutable snapshots; revocation is set once
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.certificate_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.enrollment_id, NEW.learner_name, NEW.program_title, NEW.version_number,
      NEW.issuer, NEW.completed_at, NEW.issued_at)
     IS DISTINCT FROM
     (OLD.enrollment_id, OLD.learner_name, OLD.program_title, OLD.version_number,
      OLD.issuer, OLD.completed_at, OLD.issued_at) THEN
    RAISE EXCEPTION 'a certificate is an immutable snapshot; only revocation may be set'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at, NEW.revocation_reason) IS DISTINCT FROM (OLD.revoked_at, OLD.revocation_reason) THEN
    RAISE EXCEPTION 'revocation can only be set once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER certificates_immutable BEFORE UPDATE ON app.certificates
  FOR EACH ROW EXECUTE FUNCTION app.certificate_immutable();

-- ---------------------------------------------------------------------------
-- 10. Progress completion is monotonic
-- ---------------------------------------------------------------------------

CREATE FUNCTION app.progress_monotonic() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RAISE EXCEPTION 'class completion cannot be changed once set' USING ERRCODE = '23514';
  END IF;
  IF OLD.content_completed_at IS NOT NULL
     AND NEW.content_completed_at IS DISTINCT FROM OLD.content_completed_at THEN
    RAISE EXCEPTION 'content completion cannot be changed once set' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER class_progress_monotonic BEFORE UPDATE ON app.class_progress
  FOR EACH ROW EXECUTE FUNCTION app.progress_monotonic();

-- ---------------------------------------------------------------------------
-- 11. Privileges: none of this is callable from a browser role
-- ---------------------------------------------------------------------------

DO $$ DECLARE f record; BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;
