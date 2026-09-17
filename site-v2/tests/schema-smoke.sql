-- Run after reference schema in a disposable PostgreSQL/Supabase test database.
-- These checks cover reference DDL only, not missing RPC/triggers/application behavior.
BEGIN;
CREATE TEMP TABLE spec_checks(name text PRIMARY KEY);
CREATE FUNCTION pg_temp.check_true(label text, value boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %',label; END IF;
INSERT INTO spec_checks VALUES(label); END $$;
CREATE FUNCTION pg_temp.rejects(label text, statement text, expected_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual_state text; BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual_state=RETURNED_SQLSTATE; END;
 IF actual_state IS DISTINCT FROM expected_state THEN RAISE EXCEPTION 'FAILED %: expected %, got %',label,expected_state,actual_state; END IF;
 INSERT INTO spec_checks VALUES(label);
END $$;

INSERT INTO auth.users(id) VALUES('6dbad48c-f06b-5321-84d6-0b42d923296d'),('d132f5f4-a23c-51c2-81e3-3d81ea102b2b');
INSERT INTO app.profiles(id,email,display_name) VALUES('6dbad48c-f06b-5321-84d6-0b42d923296d','amber@example.invalid','Amber'),('d132f5f4-a23c-51c2-81e3-3d81ea102b2b','personal@example.invalid','Personal');
INSERT INTO app.organizations(id,name) VALUES('e803e98e-7e2b-5663-be8d-b90a533b408a','A'),('16f88a87-6764-53cf-abde-3778f2ea1355','B');
INSERT INTO app.memberships(organization_id,user_id,role,status) VALUES('e803e98e-7e2b-5663-be8d-b90a533b408a','6dbad48c-f06b-5321-84d6-0b42d923296d','learner','active');
INSERT INTO app.cohorts(id,organization_id,name) VALUES('8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3','e803e98e-7e2b-5663-be8d-b90a533b408a','Alpha');
INSERT INTO app.cohort_members(cohort_id,organization_id,user_id) VALUES('8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3','e803e98e-7e2b-5663-be8d-b90a533b408a','6dbad48c-f06b-5321-84d6-0b42d923296d');
INSERT INTO app.programs(id,title) VALUES('6f0169d8-f0c3-5c98-a1d1-2567de5cc1df','Shared'),('ca077cbc-8c50-51ed-ba8b-f26d4f2f7528','B-only');
INSERT INTO app.program_versions(id,program_id,version_number,title) VALUES('fabecfce-b09c-541e-acf3-575147e78603','6f0169d8-f0c3-5c98-a1d1-2567de5cc1df',1,'Shared v1'),('1e4985f2-8eec-5418-998a-484f5561c049','ca077cbc-8c50-51ed-ba8b-f26d4f2f7528',1,'B v1');
INSERT INTO app.modules(id,version_id,title,position) VALUES('1690cd9c-eca0-5455-944c-94bf4537dd5d','fabecfce-b09c-541e-acf3-575147e78603','Module',0);
INSERT INTO app.classes(id,module_id,version_id,title,position,kind,duration_ms) VALUES('d95caac8-b580-5147-bc93-bd483f308611','1690cd9c-eca0-5455-944c-94bf4537dd5d','fabecfce-b09c-541e-acf3-575147e78603','Video',0,'video',600000);
INSERT INTO app.classes(id,module_id,version_id,title,position,kind,body_md) VALUES('85553726-1d5b-5d3c-98ae-beb5a2b5f132','1690cd9c-eca0-5455-944c-94bf4537dd5d','fabecfce-b09c-541e-acf3-575147e78603','Text',1,'text','Read this');
INSERT INTO app.exercises(id,class_id,instructions_md) VALUES('083cddbe-279d-5ea2-8289-7fb9ece21de6','d95caac8-b580-5147-bc93-bd483f308611','Practice');
INSERT INTO app.program_grants(id,program_id,organization_id,starts_at,ends_at) VALUES('0459023a-6a55-56cf-b516-1476b9054b8b','6f0169d8-f0c3-5c98-a1d1-2567de5cc1df','e803e98e-7e2b-5663-be8d-b90a533b408a','2026-09-01Z','2026-11-01Z');
INSERT INTO app.program_grants(id,program_id,user_id,starts_at) VALUES('88b02634-0869-5a61-aaa5-cf9b925b238c','6f0169d8-f0c3-5c98-a1d1-2567de5cc1df','d132f5f4-a23c-51c2-81e3-3d81ea102b2b','2026-09-01Z');
INSERT INTO app.cohort_offerings(id,cohort_id,organization_id,program_id,version_id,grant_id,starts_at,due_at) VALUES('65999d80-6d61-5239-8300-529875cbc1e6','8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3','e803e98e-7e2b-5663-be8d-b90a533b408a','6f0169d8-f0c3-5c98-a1d1-2567de5cc1df','fabecfce-b09c-541e-acf3-575147e78603','0459023a-6a55-56cf-b516-1476b9054b8b','2026-09-01Z','2026-09-20Z');
INSERT INTO app.enrollments(id,user_id,program_id,version_id,grant_id,organization_id,offering_id,starts_at,due_at) VALUES('f1961d6a-d742-5300-bd9a-a9fa80d6ae07','6dbad48c-f06b-5321-84d6-0b42d923296d','6f0169d8-f0c3-5c98-a1d1-2567de5cc1df','fabecfce-b09c-541e-acf3-575147e78603','0459023a-6a55-56cf-b516-1476b9054b8b','e803e98e-7e2b-5663-be8d-b90a533b408a','65999d80-6d61-5239-8300-529875cbc1e6','2026-09-01Z','2026-09-20Z');
SELECT pg_temp.rejects('grant both subjects', $case$INSERT INTO app.program_grants(program_id,organization_id,user_id,starts_at) VALUES('6f0169d8-f0c3-5c98-a1d1-2567de5cc1df','16f88a87-6764-53cf-abde-3778f2ea1355','d132f5f4-a23c-51c2-81e3-3d81ea102b2b',now())$case$, '23514');
SELECT pg_temp.rejects('grant no subject', $case$INSERT INTO app.program_grants(program_id,starts_at) VALUES('6f0169d8-f0c3-5c98-a1d1-2567de5cc1df',now())$case$, '23514');
SELECT pg_temp.rejects('grant backwards dates', $case$INSERT INTO app.program_grants(program_id,organization_id,starts_at,ends_at) VALUES('6f0169d8-f0c3-5c98-a1d1-2567de5cc1df','16f88a87-6764-53cf-abde-3778f2ea1355','2026-10-01Z','2026-09-01Z')$case$, '23514');
SELECT pg_temp.rejects('duplicate active grant', $case$INSERT INTO app.program_grants(program_id,organization_id,starts_at) VALUES('6f0169d8-f0c3-5c98-a1d1-2567de5cc1df','e803e98e-7e2b-5663-be8d-b90a533b408a',now())$case$, '23505');
SELECT pg_temp.rejects('cross organization cohort', $case$INSERT INTO app.cohort_members(cohort_id,organization_id,user_id) VALUES('8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3','16f88a87-6764-53cf-abde-3778f2ea1355','d132f5f4-a23c-51c2-81e3-3d81ea102b2b')$case$, '23503');
SELECT pg_temp.rejects('cross version class', $case$INSERT INTO app.classes(module_id,version_id,title,position,kind) VALUES('1690cd9c-eca0-5455-944c-94bf4537dd5d','1e4985f2-8eec-5418-998a-484f5561c049','Bad',2,'text')$case$, '23503');
SELECT pg_temp.rejects('duplicate class order', $case$INSERT INTO app.classes(module_id,version_id,title,position,kind) VALUES('1690cd9c-eca0-5455-944c-94bf4537dd5d','fabecfce-b09c-541e-acf3-575147e78603','Bad',0,'text')$case$, '23505');
SELECT pg_temp.rejects('invalid duration', $case$INSERT INTO app.classes(module_id,version_id,title,position,kind,duration_ms) VALUES('1690cd9c-eca0-5455-944c-94bf4537dd5d','fabecfce-b09c-541e-acf3-575147e78603','Bad',2,'video',-1)$case$, '23514');
SELECT pg_temp.rejects('text with media duration', $case$INSERT INTO app.classes(module_id,version_id,title,position,kind,duration_ms) VALUES('1690cd9c-eca0-5455-944c-94bf4537dd5d','fabecfce-b09c-541e-acf3-575147e78603','Bad',2,'text',1000)$case$, '23514');
SELECT pg_temp.rejects('duplicate offering enrollment', $case$INSERT INTO app.enrollments(user_id,program_id,version_id,grant_id,organization_id,offering_id,starts_at,due_at) VALUES('6dbad48c-f06b-5321-84d6-0b42d923296d','6f0169d8-f0c3-5c98-a1d1-2567de5cc1df','fabecfce-b09c-541e-acf3-575147e78603','0459023a-6a55-56cf-b516-1476b9054b8b','e803e98e-7e2b-5663-be8d-b90a533b408a','65999d80-6d61-5239-8300-529875cbc1e6','2026-09-01Z','2026-09-20Z')$case$, '23505');
SELECT pg_temp.rejects('invalid enrollment dates', $case$UPDATE app.enrollments SET due_at=starts_at WHERE id='f1961d6a-d742-5300-bd9a-a9fa80d6ae07'$case$, '23514');
SELECT pg_temp.rejects('offering without org', $case$UPDATE app.enrollments SET organization_id=NULL WHERE id='f1961d6a-d742-5300-bd9a-a9fa80d6ae07'$case$, '23514');
SELECT pg_temp.rejects('cross version progress', $case$INSERT INTO app.class_progress(enrollment_id,class_id,version_id) VALUES('f1961d6a-d742-5300-bd9a-a9fa80d6ae07','d95caac8-b580-5147-bc93-bd483f308611','1e4985f2-8eec-5418-998a-484f5561c049')$case$, '23503');
SELECT pg_temp.rejects('exercise empty', $case$INSERT INTO app.exercise_completions(enrollment_id,exercise_id,response) VALUES('f1961d6a-d742-5300-bd9a-a9fa80d6ae07','083cddbe-279d-5ea2-8289-7fb9ece21de6',' ')$case$, '23514');
SELECT pg_temp.rejects('exercise oversized', $case$INSERT INTO app.exercise_completions(enrollment_id,exercise_id,response) VALUES('f1961d6a-d742-5300-bd9a-a9fa80d6ae07','083cddbe-279d-5ea2-8289-7fb9ece21de6',repeat('a',2001))$case$, '23514');
INSERT INTO app.exercise_completions(enrollment_id,exercise_id,response) VALUES('f1961d6a-d742-5300-bd9a-a9fa80d6ae07','083cddbe-279d-5ea2-8289-7fb9ece21de6',repeat('a',2000));
SELECT pg_temp.check_true('exercise maximum accepted', (SELECT char_length(response)=2000 FROM app.exercise_completions WHERE enrollment_id='f1961d6a-d742-5300-bd9a-a9fa80d6ae07'));
SELECT pg_temp.rejects('duplicate exercise', $case$INSERT INTO app.exercise_completions(enrollment_id,exercise_id,response) VALUES('f1961d6a-d742-5300-bd9a-a9fa80d6ae07','083cddbe-279d-5ea2-8289-7fb9ece21de6','second')$case$, '23505');
INSERT INTO app.class_progress(enrollment_id,class_id,version_id,played_ranges) VALUES('f1961d6a-d742-5300-bd9a-a9fa80d6ae07','d95caac8-b580-5147-bc93-bd483f308611','fabecfce-b09c-541e-acf3-575147e78603','{[0,300000),[200000,540000)}'::int8multirange);
SELECT pg_temp.check_true('range union coverage', (SELECT sum(upper(x)-lower(x))=540000 FROM app.class_progress p, unnest(p.played_ranges) x WHERE enrollment_id='f1961d6a-d742-5300-bd9a-a9fa80d6ae07'));
SELECT pg_temp.rejects('negative resume position', $case$UPDATE app.class_progress SET position_ms=-1 WHERE enrollment_id='f1961d6a-d742-5300-bd9a-a9fa80d6ae07'$case$, '23514');
SELECT pg_temp.rejects('class complete before content', $case$UPDATE app.class_progress SET completed_at=now() WHERE enrollment_id='f1961d6a-d742-5300-bd9a-a9fa80d6ae07'$case$, '23514');
SELECT pg_temp.rejects('enrollment complete before start', $case$UPDATE app.enrollments SET completed_at=now() WHERE id='f1961d6a-d742-5300-bd9a-a9fa80d6ae07'$case$, '23514');
INSERT INTO app.certificates(enrollment_id,learner_name,program_title,version_number,completed_at) VALUES('f1961d6a-d742-5300-bd9a-a9fa80d6ae07','Amber','Shared',1,now());
SELECT pg_temp.rejects('duplicate certificate', $case$INSERT INTO app.certificates(enrollment_id,learner_name,program_title,version_number,completed_at) VALUES('f1961d6a-d742-5300-bd9a-a9fa80d6ae07','Amber','Shared',1,now())$case$, '23505');
SELECT pg_temp.rejects('revocation missing reason', $case$UPDATE app.certificates SET revoked_at=now() WHERE enrollment_id='f1961d6a-d742-5300-bd9a-a9fa80d6ae07'$case$, '23514');
SELECT pg_temp.check_true('all app tables have RLS', (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'));
SELECT pg_temp.check_true('anon schema denied', (NOT has_schema_privilege('anon','app','USAGE')));
SELECT pg_temp.check_true('authenticated schema denied', (NOT has_schema_privilege('authenticated','app','USAGE')));
SELECT pg_temp.check_true('authenticated enrollment select denied', (NOT has_table_privilege('authenticated','app.enrollments','SELECT')));
SELECT pg_temp.check_true('authenticated enrollment insert denied', (NOT has_table_privilege('authenticated','app.enrollments','INSERT')));
SELECT pg_temp.check_true('anon enrollment select denied', (NOT has_table_privilege('anon','app.enrollments','SELECT')));
UPDATE app.exercise_completions SET response=repeat(chr(128512),2000);
SELECT pg_temp.check_true('Unicode code-point count', (SELECT bool_and(char_length(response)=2000) FROM app.exercise_completions));
SELECT pg_temp.rejects('Unicode oversized response', $case$UPDATE app.exercise_completions SET response=repeat(chr(128512),2001)$case$, '23514');
SELECT pg_temp.check_true('database UTF8', current_setting('server_encoding')='UTF8');
SELECT count(*) AS passed_reference_schema_checks FROM spec_checks;
ROLLBACK;
