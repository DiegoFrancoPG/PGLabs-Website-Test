-- M01 — application schema.
--
-- Adapted from contracts/schema.sql, which spec/01 makes authoritative for
-- persisted column types and constraints. The body below is that file verbatim
-- except for its BEGIN/COMMIT wrapper: the Supabase CLI already runs each
-- migration inside a transaction, and a nested BEGIN only warns.
--
-- tests/unit/migration-fidelity.test.ts asserts that equivalence, so this file
-- cannot drift from the contract unnoticed.
--
-- spec/02 M01: "Adapt reference schema.sql to migration; existing Auth schema
-- untouched." Nothing here creates, alters or drops anything in auth; profiles
-- only carries a foreign key to auth.users.
--
-- This is the schema only. The authorization functions and behavioural triggers
-- in M02-M04 are required before the application serves any request.

-- PGLearn v1.0 reference DDL. Run as migration owner against Supabase PostgreSQL.
-- Requires auth.users and roles anon/authenticated/service_role supplied by Supabase.
-- Deliberately grants no user table access and defines no application RPC implementation.
-- Implement migrations M02-M05 from spec/02 before serving any application requests.
CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;

CREATE TABLE app.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 email text NOT NULL UNIQUE CHECK (email=lower(btrim(email))),
 display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
 timezone text NOT NULL DEFAULT 'UTC', reminders_enabled boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
 onboarded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.platform_admins (
 user_id uuid PRIMARY KEY REFERENCES app.profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
 timezone text NOT NULL DEFAULT 'UTC', status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.memberships (
 organization_id uuid NOT NULL REFERENCES app.organizations(id), user_id uuid NOT NULL REFERENCES app.profiles(id),
 role text NOT NULL CHECK (role IN ('manager','learner')),
 status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','removed')),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (organization_id,user_id)
);
CREATE TABLE app.invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.profiles(id),
 organization_id uuid REFERENCES app.organizations(id), role text NOT NULL CHECK (role IN ('manager','learner')),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','cancelled')),
 expires_at timestamptz NOT NULL, accepted_at timestamptz, created_by uuid NOT NULL REFERENCES app.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK (expires_at>created_at),
 CHECK (organization_id IS NOT NULL OR role='learner'), CHECK ((status='accepted')=(accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX invitations_pending_context ON app.invitations(user_id,organization_id) NULLS NOT DISTINCT WHERE status='pending';
CREATE TABLE app.cohorts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES app.organizations(id),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120), archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id)
);
CREATE TABLE app.cohort_members (
 cohort_id uuid NOT NULL, organization_id uuid NOT NULL, user_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cohort_id,user_id), FOREIGN KEY(cohort_id,organization_id) REFERENCES app.cohorts(id,organization_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES app.memberships(organization_id,user_id)
);
CREATE TABLE app.programs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 160),
 summary text NOT NULL DEFAULT '' CHECK(char_length(summary)<=2000), archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.program_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), program_id uuid NOT NULL REFERENCES app.programs(id),
 version_number integer NOT NULL CHECK(version_number>0), title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 160),
 description_md text NOT NULL DEFAULT '' CHECK(char_length(description_md)<=20000),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published')),
 published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(program_id,version_number), UNIQUE(id,program_id), CHECK((state='published')=(published_at IS NOT NULL))
);
CREATE TABLE app.modules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version_id uuid NOT NULL REFERENCES app.program_versions(id),
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 160), position integer NOT NULL CHECK(position>=0),
 UNIQUE(id,version_id), UNIQUE(version_id,position) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE TABLE app.classes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module_id uuid NOT NULL, version_id uuid NOT NULL,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 160), position integer NOT NULL CHECK(position>=0),
 kind text NOT NULL CHECK(kind IN ('video','audio','text')), required boolean NOT NULL DEFAULT true,
 body_md text NOT NULL DEFAULT '' CHECK(char_length(body_md)<=100000),
 source_text text NOT NULL DEFAULT '' CHECK(char_length(source_text)<=200000),
 duration_ms bigint, primary_asset_id uuid,
 FOREIGN KEY(module_id,version_id) REFERENCES app.modules(id,version_id), UNIQUE(id,version_id),
 UNIQUE(module_id,position) DEFERRABLE INITIALLY IMMEDIATE,
 CHECK(duration_ms IS NULL OR duration_ms BETWEEN 1000 AND 14400000),
 CHECK(kind!='text' OR (duration_ms IS NULL AND primary_asset_id IS NULL))
);
CREATE TABLE app.assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL REFERENCES app.classes(id),
 role text NOT NULL CHECK(role IN ('primary','handout','caption','transcript')),
 original_name text NOT NULL CHECK(char_length(original_name) BETWEEN 1 AND 255),
 mime_type text NOT NULL, bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 1073741824),
 storage_key text NOT NULL UNIQUE, playback_key text UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','failed')),
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,class_id)
);
ALTER TABLE app.classes ADD CONSTRAINT classes_primary_same_class_fk
 FOREIGN KEY(primary_asset_id,id) REFERENCES app.assets(id,class_id) DEFERRABLE INITIALLY IMMEDIATE;
CREATE TABLE app.exercises (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL UNIQUE REFERENCES app.classes(id),
 instructions_md text NOT NULL CHECK(char_length(btrim(instructions_md)) BETWEEN 1 AND 10000)
);
CREATE TABLE app.program_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), program_id uuid NOT NULL REFERENCES app.programs(id),
 organization_id uuid REFERENCES app.organizations(id), user_id uuid REFERENCES app.profiles(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','billing')),
 external_reference text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(organization_id,user_id)=1), CHECK(ends_at IS NULL OR ends_at>starts_at), UNIQUE(id,program_id)
);
CREATE UNIQUE INDEX grants_active_org ON app.program_grants(organization_id,program_id) WHERE organization_id IS NOT NULL AND status='active';
CREATE UNIQUE INDEX grants_active_user ON app.program_grants(user_id,program_id) WHERE user_id IS NOT NULL AND status='active';
CREATE UNIQUE INDEX grants_external_ref ON app.program_grants(source,external_reference) WHERE external_reference IS NOT NULL;
CREATE TABLE app.cohort_offerings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cohort_id uuid NOT NULL, organization_id uuid NOT NULL,
 program_id uuid NOT NULL, version_id uuid NOT NULL, grant_id uuid NOT NULL,
 starts_at timestamptz NOT NULL, due_at timestamptz NOT NULL, access_ends_at timestamptz,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id,program_id,version_id,grant_id),
 FOREIGN KEY(cohort_id,organization_id) REFERENCES app.cohorts(id,organization_id),
 FOREIGN KEY(version_id,program_id) REFERENCES app.program_versions(id,program_id),
 FOREIGN KEY(grant_id,program_id) REFERENCES app.program_grants(id,program_id),
 CHECK(due_at>starts_at), CHECK(access_ends_at IS NULL OR access_ends_at>=due_at)
);
CREATE TABLE app.enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.profiles(id),
 program_id uuid NOT NULL, version_id uuid NOT NULL, grant_id uuid NOT NULL,
 organization_id uuid, offering_id uuid, attempt integer NOT NULL DEFAULT 1 CHECK(attempt>0),
 starts_at timestamptz NOT NULL, due_at timestamptz NOT NULL, access_ends_at timestamptz,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
 started_at timestamptz, last_activity_at timestamptz, completed_at timestamptz, last_class_id uuid,
 resume_generation integer NOT NULL DEFAULT 0 CHECK(resume_generation>=0), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(version_id,program_id) REFERENCES app.program_versions(id,program_id),
 FOREIGN KEY(grant_id,program_id) REFERENCES app.program_grants(id,program_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES app.memberships(organization_id,user_id),
 FOREIGN KEY(offering_id,organization_id,program_id,version_id,grant_id)
 REFERENCES app.cohort_offerings(id,organization_id,program_id,version_id,grant_id),
 FOREIGN KEY(last_class_id,version_id) REFERENCES app.classes(id,version_id),
 CHECK((organization_id IS NULL)=(offering_id IS NULL)), CHECK(due_at>starts_at),
 CHECK(access_ends_at IS NULL OR access_ends_at>=due_at),
 CHECK(completed_at IS NULL OR started_at IS NOT NULL), UNIQUE(id,version_id)
);
CREATE UNIQUE INDEX enrollment_offering_unique ON app.enrollments(user_id,offering_id) WHERE offering_id IS NOT NULL;
CREATE UNIQUE INDEX enrollment_personal_unique ON app.enrollments(user_id,grant_id,version_id,attempt) WHERE offering_id IS NULL;
CREATE TABLE app.playback_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrollment_id uuid NOT NULL, class_id uuid NOT NULL, version_id uuid NOT NULL,
 generation integer NOT NULL, last_sequence integer NOT NULL DEFAULT 0 CHECK(last_sequence>=0),
 last_received_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 FOREIGN KEY(enrollment_id,version_id) REFERENCES app.enrollments(id,version_id),
 FOREIGN KEY(class_id,version_id) REFERENCES app.classes(id,version_id)
);
CREATE UNIQUE INDEX one_open_playback ON app.playback_sessions(enrollment_id) WHERE closed_at IS NULL;
CREATE TABLE app.learning_events (
 id uuid PRIMARY KEY, enrollment_id uuid NOT NULL, class_id uuid NOT NULL, version_id uuid NOT NULL,
 session_id uuid REFERENCES app.playback_sessions(id), sequence integer,
 kind text NOT NULL CHECK(kind IN ('heartbeat','text_complete','exercise_complete')),
 received_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 FOREIGN KEY(enrollment_id,version_id) REFERENCES app.enrollments(id,version_id),
 FOREIGN KEY(class_id,version_id) REFERENCES app.classes(id,version_id)
);
CREATE TABLE app.class_progress (
 enrollment_id uuid NOT NULL, class_id uuid NOT NULL, version_id uuid NOT NULL,
 played_ranges int8multirange NOT NULL DEFAULT '{}'::int8multirange,
 position_ms bigint NOT NULL DEFAULT 0 CHECK(position_ms>=0), content_completed_at timestamptz, completed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(enrollment_id,class_id),
 FOREIGN KEY(enrollment_id,version_id) REFERENCES app.enrollments(id,version_id),
 FOREIGN KEY(class_id,version_id) REFERENCES app.classes(id,version_id),
 CHECK(completed_at IS NULL OR content_completed_at IS NOT NULL)
);
CREATE TABLE app.exercise_completions (
 enrollment_id uuid NOT NULL REFERENCES app.enrollments(id), exercise_id uuid NOT NULL REFERENCES app.exercises(id),
 response text NOT NULL CHECK(char_length(btrim(response)) BETWEEN 1 AND 2000),
 confirmed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(enrollment_id,exercise_id)
);
CREATE TABLE app.certificates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrollment_id uuid NOT NULL UNIQUE REFERENCES app.enrollments(id),
 learner_name text NOT NULL, program_title text NOT NULL, version_number integer NOT NULL, issuer text NOT NULL DEFAULT 'PGLearn',
 completed_at timestamptz NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, revocation_reason text,
 CHECK((revoked_at IS NULL)=(revocation_reason IS NULL)), CHECK(revocation_reason IS NULL OR char_length(btrim(revocation_reason)) BETWEEN 1 AND 500)
);
CREATE TABLE app.content_chunks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid NOT NULL, version_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>=0), text_content text NOT NULL CHECK(char_length(text_content) BETWEEN 1 AND 2000),
 search_vector tsvector GENERATED ALWAYS AS(to_tsvector('english',text_content)) STORED,
 FOREIGN KEY(class_id,version_id) REFERENCES app.classes(id,version_id), UNIQUE(class_id,ordinal)
);
CREATE INDEX chunks_search ON app.content_chunks USING gin(search_vector);
CREATE TABLE app.tutor_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrollment_id uuid NOT NULL REFERENCES app.enrollments(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.tutor_requests (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES app.tutor_sessions(id), class_id uuid NOT NULL REFERENCES app.classes(id),
 question text NOT NULL CHECK(char_length(btrim(question)) BETWEEN 1 AND 2000),
 intent text NOT NULL CHECK(intent IN ('explanation','example')),
 status text NOT NULL CHECK(status IN ('pending','completed','failed')),
 answer text, citations jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(citations)='array'), mode text CHECK(mode IN ('explanation','example','unsupported')),
 input_tokens integer CHECK(input_tokens>=0), output_tokens integer CHECK(output_tokens>=0),
 reserved_usd numeric(10,6) NOT NULL CHECK(reserved_usd>=0), actual_usd numeric(10,6) CHECK(actual_usd>=0), error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 CHECK(status!='completed' OR (answer IS NOT NULL AND mode IS NOT NULL AND finished_at IS NOT NULL))
);
-- Intentionally no request FK: financial usage must outlive 30-day chat deletion.
CREATE TABLE app.tutor_usage (
 request_id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app.profiles(id),
 period_start date NOT NULL, reserved_usd numeric(10,6) NOT NULL CHECK(reserved_usd>=0),
 actual_usd numeric(10,6) CHECK(actual_usd>=0), input_tokens integer CHECK(input_tokens>=0),
 output_tokens integer CHECK(output_tokens>=0), outcome text NOT NULL CHECK(outcome IN ('reserved','settled','uncertain','not_invoked')),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(extract(day FROM period_start)=1)
);
CREATE INDEX tutor_usage_period ON app.tutor_usage(period_start);
CREATE TABLE app.notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app.profiles(id),
 enrollment_id uuid REFERENCES app.enrollments(id),
 kind text NOT NULL CHECK(kind IN ('invitation','inactivity','due_soon','due_today','overdue','certificate')),
 event_key text NOT NULL UNIQUE, recipient_email text NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','delivered','failed','suppressed','uncertain')),
 scheduled_at timestamptz NOT NULL, claimed_until timestamptz, first_attempt_at timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), provider_id text UNIQUE, last_error text,
 accepted_at timestamptz, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.email_webhook_events (
 provider_event_id text PRIMARY KEY, provider_email_id text NOT NULL, event_type text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.reminder_days (
 user_id uuid NOT NULL REFERENCES app.profiles(id), local_date date NOT NULL,
 outbox_id uuid NOT NULL UNIQUE REFERENCES app.notification_outbox(id), PRIMARY KEY(user_id,local_date)
);
CREATE TABLE app.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES app.profiles(id),
 organization_id uuid REFERENCES app.organizations(id), action text NOT NULL, entity_id uuid,
 metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.idempotency_records (
 actor_id uuid NOT NULL REFERENCES app.profiles(id), action text NOT NULL, request_id uuid NOT NULL,
 request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,action,request_id)
);
CREATE TABLE app.job_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('reminders','retention')),
 started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 status text NOT NULL CHECK(status IN ('running','completed','failed')), counts jsonb NOT NULL DEFAULT '{}', error_code text
);
CREATE TABLE app.rate_windows (
 scope text NOT NULL, key text NOT NULL, window_start timestamptz NOT NULL,
 count integer NOT NULL DEFAULT 0 CHECK(count>=0), PRIMARY KEY(scope,key,window_start)
);
CREATE INDEX memberships_user_status ON app.memberships(user_id,status);
CREATE INDEX enrollments_org_offering ON app.enrollments(organization_id,offering_id);
CREATE INDEX enrollments_user ON app.enrollments(user_id,created_at DESC);
CREATE INDEX enrollments_due ON app.enrollments(due_at) WHERE status='active' AND completed_at IS NULL;
CREATE INDEX events_enrollment_time ON app.learning_events(enrollment_id,received_at);
CREATE INDEX outbox_pending ON app.notification_outbox(scheduled_at) WHERE status IN ('pending','sending');
CREATE INDEX tutor_session_time ON app.tutor_requests(session_id,created_at);
CREATE INDEX audit_org_time ON app.audit_events(organization_id,created_at DESC);

-- Every current and future app table is private. SECURITY DEFINER handlers implement
-- business-scoped access; no permissive table policy is intentionally installed.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='app' LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC, anon, authenticated',t.tablename);
 END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
