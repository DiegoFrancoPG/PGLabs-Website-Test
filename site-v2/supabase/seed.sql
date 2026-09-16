-- GENERATED FILE — do not edit.
-- Produced by scripts/generate-seed.mjs from tests/fixtures.json.
-- Regenerate with: npm run db:seed:generate
--
-- Fixture version 1.0; frozen clock 2026-09-15T12:00:00Z.
-- Loaded automatically by `supabase db reset`, which npm run db:reset:test
-- guards so it can only ever target a designated development database.
--
-- Contains no passwords and no real people: every address is @example.invalid,
-- a reserved TLD that cannot receive mail.

BEGIN;

-- Auth identities. Email and id only; passwords are created at T05.
INSERT INTO auth.users(id, email) VALUES ('b35dfc4c-ebcb-5c9c-b6cb-63039f06d974', 'admin@example.invalid')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id, email) VALUES ('263e5cfb-2724-5b43-a675-d36759b67d1d', 'manager_a@example.invalid')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id, email) VALUES ('a1288183-f0cf-5b98-9fce-e445e4978786', 'manager_b@example.invalid')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id, email) VALUES ('6dbad48c-f06b-5321-84d6-0b42d923296d', 'amber@example.invalid')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id, email) VALUES ('c3fff508-6114-5ff3-986e-d75fe599c2bd', 'ben@example.invalid')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id, email) VALUES ('699ddb9e-51d8-5f85-8512-9a5cb3f136ba', 'cora@example.invalid')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id, email) VALUES ('2e24b9ee-5756-5e53-a3e6-cab38a00f1c8', 'dana@example.invalid')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id, email) VALUES ('d132f5f4-a23c-51c2-81e3-3d81ea102b2b', 'personal@example.invalid')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id, email) VALUES ('86aedbc4-2d82-5920-89d0-3a758d7794ff', 'multi@example.invalid')
  ON CONFLICT (id) DO NOTHING;

-- Profiles. Dana is the only learner left un-onboarded, so the report can
-- show an invited person counted as assigned while still at 0%.
INSERT INTO app.profiles(id, email, display_name, timezone, onboarded_at)
  VALUES ('b35dfc4c-ebcb-5c9c-b6cb-63039f06d974', 'admin@example.invalid', 'Admin', 'UTC', '2026-09-15T12:00:00Z');
INSERT INTO app.profiles(id, email, display_name, timezone, onboarded_at)
  VALUES ('263e5cfb-2724-5b43-a675-d36759b67d1d', 'manager_a@example.invalid', 'Manager A', 'UTC', '2026-09-15T12:00:00Z');
INSERT INTO app.profiles(id, email, display_name, timezone, onboarded_at)
  VALUES ('a1288183-f0cf-5b98-9fce-e445e4978786', 'manager_b@example.invalid', 'Manager B', 'UTC', '2026-09-15T12:00:00Z');
INSERT INTO app.profiles(id, email, display_name, timezone, onboarded_at)
  VALUES ('6dbad48c-f06b-5321-84d6-0b42d923296d', 'amber@example.invalid', 'Amber', 'UTC', '2026-09-15T12:00:00Z');
INSERT INTO app.profiles(id, email, display_name, timezone, onboarded_at)
  VALUES ('c3fff508-6114-5ff3-986e-d75fe599c2bd', 'ben@example.invalid', 'Ben', 'UTC', '2026-09-15T12:00:00Z');
INSERT INTO app.profiles(id, email, display_name, timezone, onboarded_at)
  VALUES ('699ddb9e-51d8-5f85-8512-9a5cb3f136ba', 'cora@example.invalid', 'Cora', 'UTC', '2026-09-15T12:00:00Z');
INSERT INTO app.profiles(id, email, display_name, timezone, onboarded_at)
  VALUES ('2e24b9ee-5756-5e53-a3e6-cab38a00f1c8', 'dana@example.invalid', 'Dana', 'UTC', NULL);
INSERT INTO app.profiles(id, email, display_name, timezone, onboarded_at)
  VALUES ('d132f5f4-a23c-51c2-81e3-3d81ea102b2b', 'personal@example.invalid', 'Personal', 'UTC', '2026-09-15T12:00:00Z');
INSERT INTO app.profiles(id, email, display_name, timezone, onboarded_at)
  VALUES ('86aedbc4-2d82-5920-89d0-3a758d7794ff', 'multi@example.invalid', 'Multi', 'UTC', '2026-09-15T12:00:00Z');

INSERT INTO app.platform_admins(user_id) VALUES ('b35dfc4c-ebcb-5c9c-b6cb-63039f06d974');

INSERT INTO app.organizations(id, name, timezone)
  VALUES ('e803e98e-7e2b-5663-be8d-b90a533b408a', 'Demo Organization A', 'UTC');
INSERT INTO app.organizations(id, name, timezone)
  VALUES ('16f88a87-6764-53cf-abde-3778f2ea1355', 'Demo Organization B', 'UTC');

INSERT INTO app.memberships(organization_id, user_id, role, status)
  VALUES ('e803e98e-7e2b-5663-be8d-b90a533b408a', '263e5cfb-2724-5b43-a675-d36759b67d1d', 'manager', 'active');
INSERT INTO app.memberships(organization_id, user_id, role, status)
  VALUES ('16f88a87-6764-53cf-abde-3778f2ea1355', 'a1288183-f0cf-5b98-9fce-e445e4978786', 'manager', 'active');
INSERT INTO app.memberships(organization_id, user_id, role, status)
  VALUES ('e803e98e-7e2b-5663-be8d-b90a533b408a', '6dbad48c-f06b-5321-84d6-0b42d923296d', 'learner', 'active');
INSERT INTO app.memberships(organization_id, user_id, role, status)
  VALUES ('e803e98e-7e2b-5663-be8d-b90a533b408a', 'c3fff508-6114-5ff3-986e-d75fe599c2bd', 'learner', 'active');
INSERT INTO app.memberships(organization_id, user_id, role, status)
  VALUES ('e803e98e-7e2b-5663-be8d-b90a533b408a', '699ddb9e-51d8-5f85-8512-9a5cb3f136ba', 'learner', 'active');
INSERT INTO app.memberships(organization_id, user_id, role, status)
  VALUES ('e803e98e-7e2b-5663-be8d-b90a533b408a', '2e24b9ee-5756-5e53-a3e6-cab38a00f1c8', 'learner', 'invited');
INSERT INTO app.memberships(organization_id, user_id, role, status)
  VALUES ('e803e98e-7e2b-5663-be8d-b90a533b408a', '86aedbc4-2d82-5920-89d0-3a758d7794ff', 'learner', 'active');
INSERT INTO app.memberships(organization_id, user_id, role, status)
  VALUES ('16f88a87-6764-53cf-abde-3778f2ea1355', '86aedbc4-2d82-5920-89d0-3a758d7794ff', 'learner', 'active');

INSERT INTO app.cohorts(id, organization_id, name) VALUES
  ('8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3', 'e803e98e-7e2b-5663-be8d-b90a533b408a', 'Cohort A'),
  ('4c376975-2853-5b3d-92c4-d3ad68ad104e', '16f88a87-6764-53cf-abde-3778f2ea1355', 'Cohort B');

INSERT INTO app.cohort_members(cohort_id, organization_id, user_id)
  VALUES ('8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3', 'e803e98e-7e2b-5663-be8d-b90a533b408a', '6dbad48c-f06b-5321-84d6-0b42d923296d');
INSERT INTO app.cohort_members(cohort_id, organization_id, user_id)
  VALUES ('8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3', 'e803e98e-7e2b-5663-be8d-b90a533b408a', 'c3fff508-6114-5ff3-986e-d75fe599c2bd');
INSERT INTO app.cohort_members(cohort_id, organization_id, user_id)
  VALUES ('8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3', 'e803e98e-7e2b-5663-be8d-b90a533b408a', '699ddb9e-51d8-5f85-8512-9a5cb3f136ba');
INSERT INTO app.cohort_members(cohort_id, organization_id, user_id)
  VALUES ('8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3', 'e803e98e-7e2b-5663-be8d-b90a533b408a', '2e24b9ee-5756-5e53-a3e6-cab38a00f1c8');
INSERT INTO app.cohort_members(cohort_id, organization_id, user_id)
  VALUES ('4c376975-2853-5b3d-92c4-d3ad68ad104e', '16f88a87-6764-53cf-abde-3778f2ea1355', '86aedbc4-2d82-5920-89d0-3a758d7794ff');

INSERT INTO app.programs(id, title) VALUES
  ('6f0169d8-f0c3-5c98-a1d1-2567de5cc1df', 'AI Foundations'),
  ('ca077cbc-8c50-51ed-ba8b-f26d4f2f7528', 'Organization B Only');

INSERT INTO app.program_versions(id, program_id, version_number, title) VALUES
  ('fabecfce-b09c-541e-acf3-575147e78603', '6f0169d8-f0c3-5c98-a1d1-2567de5cc1df', 1, 'AI Foundations v1'),
  ('1e4985f2-8eec-5418-998a-484f5561c049', 'ca077cbc-8c50-51ed-ba8b-f26d4f2f7528', 1, 'Organization B Only v1');

INSERT INTO app.modules(id, version_id, title, position)
  VALUES ('1690cd9c-eca0-5455-944c-94bf4537dd5d', 'fabecfce-b09c-541e-acf3-575147e78603', 'Module 1', 0);

-- Three classes, all required, so a learner's percentage is thirds.
INSERT INTO app.classes(id, module_id, version_id, title, position, kind, required, body_md, source_text, duration_ms)
  VALUES ('d95caac8-b580-5147-bc93-bd483f308611', '1690cd9c-eca0-5455-944c-94bf4537dd5d', 'fabecfce-b09c-541e-acf3-575147e78603',
          'Class: video', 0, 'video', true,
          '', 'Prompt specificity helps define the task, audience, constraints and desired output.', 600000);
INSERT INTO app.classes(id, module_id, version_id, title, position, kind, required, body_md, source_text, duration_ms)
  VALUES ('85553726-1d5b-5d3c-98ae-beb5a2b5f132', '1690cd9c-eca0-5455-944c-94bf4537dd5d', 'fabecfce-b09c-541e-acf3-575147e78603',
          'Class: text', 1, 'text', true,
          '# Verify outputs
Check factual claims against reliable sources.', 'AI-generated factual claims should be verified against reliable sources.', NULL);
INSERT INTO app.classes(id, module_id, version_id, title, position, kind, required, body_md, source_text, duration_ms)
  VALUES ('ef874b1a-bdc6-5750-b384-a30f3199bd44', '1690cd9c-eca0-5455-944c-94bf4537dd5d', 'fabecfce-b09c-541e-acf3-575147e78603',
          'Class: audio', 2, 'audio', true,
          '', 'Use synthetic information in workplace examples and avoid entering confidential customer information.', 600000);
INSERT INTO app.exercises(id, class_id, instructions_md)
  VALUES ('083cddbe-279d-5ea2-8289-7fb9ece21de6', 'ef874b1a-bdc6-5750-b384-a30f3199bd44', 'Write one example of a workplace task you could practice with synthetic information.');

-- Retrieval chunks. spec/05 creates these during publication, which is why
-- M02 leaves content_chunks insertable on a published version.
INSERT INTO app.content_chunks(id, class_id, version_id, ordinal, text_content)
  VALUES ('54e0450b-1a84-558f-b419-359082c44f53', 'd95caac8-b580-5147-bc93-bd483f308611', 'fabecfce-b09c-541e-acf3-575147e78603', 0, 'Prompt specificity helps define the task, audience, constraints and desired output.');
INSERT INTO app.content_chunks(id, class_id, version_id, ordinal, text_content)
  VALUES ('3126c909-33fb-535e-8661-549bfea4cec5', '85553726-1d5b-5d3c-98ae-beb5a2b5f132', 'fabecfce-b09c-541e-acf3-575147e78603', 0, 'AI-generated factual claims should be verified against reliable sources.');
INSERT INTO app.content_chunks(id, class_id, version_id, ordinal, text_content)
  VALUES ('8117df35-7ef7-555a-9d54-70c5e355a0ce', 'ef874b1a-bdc6-5750-b384-a30f3199bd44', 'fabecfce-b09c-541e-acf3-575147e78603', 0, 'Use synthetic information in workplace examples and avoid entering confidential customer information.');

-- Publication. Written directly, so it does NOT exercise T10's content
-- validation: these classes carry no media assets. See HANDOFF.
UPDATE app.program_versions SET state = 'published', published_at = '2026-09-15T12:00:00Z'
  WHERE id IN ('fabecfce-b09c-541e-acf3-575147e78603', '1e4985f2-8eec-5418-998a-484f5561c049');

-- Grant window 2026-08-01T00:00:00Z .. 2026-12-31T00:00:00Z, chosen to contain the offering.
INSERT INTO app.program_grants(id, program_id, organization_id, starts_at, ends_at) VALUES
  ('0459023a-6a55-56cf-b516-1476b9054b8b', '6f0169d8-f0c3-5c98-a1d1-2567de5cc1df', 'e803e98e-7e2b-5663-be8d-b90a533b408a', '2026-08-01T00:00:00Z', '2026-12-31T00:00:00Z'),
  ('8a84ced4-af81-5d2f-be68-4ce5168daf59', 'ca077cbc-8c50-51ed-ba8b-f26d4f2f7528', '16f88a87-6764-53cf-abde-3778f2ea1355', '2026-08-01T00:00:00Z', '2026-12-31T00:00:00Z');

-- Personal grant: subject is the learner, never an organization.
INSERT INTO app.program_grants(id, program_id, user_id, starts_at, ends_at)
  VALUES ('88b02634-0869-5a61-aaa5-cf9b925b238c', '6f0169d8-f0c3-5c98-a1d1-2567de5cc1df', 'd132f5f4-a23c-51c2-81e3-3d81ea102b2b', '2026-08-01T00:00:00Z', '2026-12-31T00:00:00Z');

INSERT INTO app.cohort_offerings(id, cohort_id, organization_id, program_id, version_id, grant_id, starts_at, due_at, access_ends_at)
  VALUES ('65999d80-6d61-5239-8300-529875cbc1e6', '8d660e2e-a9fb-5b6a-9ec3-d5d6b06f64a3', 'e803e98e-7e2b-5663-be8d-b90a533b408a', '6f0169d8-f0c3-5c98-a1d1-2567de5cc1df',
          'fabecfce-b09c-541e-acf3-575147e78603', '0459023a-6a55-56cf-b516-1476b9054b8b', '2026-09-01T09:00:00Z', '2026-09-13T17:00:00Z', '2026-10-01T00:00:00Z');
INSERT INTO app.cohort_offerings(id, cohort_id, organization_id, program_id, version_id, grant_id, starts_at, due_at, access_ends_at)
  VALUES ('28d4d19d-d896-509f-9dc3-93bfaf80450d', '4c376975-2853-5b3d-92c4-d3ad68ad104e', '16f88a87-6764-53cf-abde-3778f2ea1355', 'ca077cbc-8c50-51ed-ba8b-f26d4f2f7528',
          '1e4985f2-8eec-5418-998a-484f5561c049', '8a84ced4-af81-5d2f-be68-4ce5168daf59', '2026-09-01T09:00:00Z', '2026-09-13T17:00:00Z', '2026-10-01T00:00:00Z');

-- Enrollments. started_at/completed_at follow directly from progress.
INSERT INTO app.enrollments(id, user_id, program_id, version_id, grant_id, organization_id, offering_id,
                            starts_at, due_at, access_ends_at, started_at, last_activity_at, completed_at)
  VALUES ('f1961d6a-d742-5300-bd9a-a9fa80d6ae07', '6dbad48c-f06b-5321-84d6-0b42d923296d', '6f0169d8-f0c3-5c98-a1d1-2567de5cc1df', 'fabecfce-b09c-541e-acf3-575147e78603',
          '0459023a-6a55-56cf-b516-1476b9054b8b', 'e803e98e-7e2b-5663-be8d-b90a533b408a', '65999d80-6d61-5239-8300-529875cbc1e6',
          '2026-09-01T09:00:00Z', '2026-09-13T17:00:00Z', '2026-10-01T00:00:00Z', NULL, NULL, NULL);
INSERT INTO app.enrollments(id, user_id, program_id, version_id, grant_id, organization_id, offering_id,
                            starts_at, due_at, access_ends_at, started_at, last_activity_at, completed_at)
  VALUES ('c12faa8a-c9e6-50bf-b8ee-4bc5cef608c3', 'c3fff508-6114-5ff3-986e-d75fe599c2bd', '6f0169d8-f0c3-5c98-a1d1-2567de5cc1df', 'fabecfce-b09c-541e-acf3-575147e78603',
          '0459023a-6a55-56cf-b516-1476b9054b8b', 'e803e98e-7e2b-5663-be8d-b90a533b408a', '65999d80-6d61-5239-8300-529875cbc1e6',
          '2026-09-01T09:00:00Z', '2026-09-13T17:00:00Z', '2026-10-01T00:00:00Z', '2026-09-08T09:00:00Z', '2026-09-14T12:00:00Z', NULL);
INSERT INTO app.enrollments(id, user_id, program_id, version_id, grant_id, organization_id, offering_id,
                            starts_at, due_at, access_ends_at, started_at, last_activity_at, completed_at)
  VALUES ('6029de49-7fd6-5401-89c5-c0bbc2d91552', '699ddb9e-51d8-5f85-8512-9a5cb3f136ba', '6f0169d8-f0c3-5c98-a1d1-2567de5cc1df', 'fabecfce-b09c-541e-acf3-575147e78603',
          '0459023a-6a55-56cf-b516-1476b9054b8b', 'e803e98e-7e2b-5663-be8d-b90a533b408a', '65999d80-6d61-5239-8300-529875cbc1e6',
          '2026-09-01T09:00:00Z', '2026-09-13T17:00:00Z', '2026-10-01T00:00:00Z', '2026-09-08T09:00:00Z', '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z');
INSERT INTO app.enrollments(id, user_id, program_id, version_id, grant_id, organization_id, offering_id,
                            starts_at, due_at, access_ends_at, started_at, last_activity_at, completed_at)
  VALUES ('3e8eaf57-1d94-5e0c-b942-bc033cc29a9f', '2e24b9ee-5756-5e53-a3e6-cab38a00f1c8', '6f0169d8-f0c3-5c98-a1d1-2567de5cc1df', 'fabecfce-b09c-541e-acf3-575147e78603',
          '0459023a-6a55-56cf-b516-1476b9054b8b', 'e803e98e-7e2b-5663-be8d-b90a533b408a', '65999d80-6d61-5239-8300-529875cbc1e6',
          '2026-09-01T09:00:00Z', '2026-09-13T17:00:00Z', '2026-10-01T00:00:00Z', NULL, NULL, NULL);

-- Personal enrollment: no organization, no offering (additional_contexts).
INSERT INTO app.enrollments(id, user_id, program_id, version_id, grant_id, starts_at, due_at, access_ends_at)
  VALUES ('59abe2b6-25fb-5383-851e-6098b6574c5f', 'd132f5f4-a23c-51c2-81e3-3d81ea102b2b', '6f0169d8-f0c3-5c98-a1d1-2567de5cc1df', 'fabecfce-b09c-541e-acf3-575147e78603',
          '88b02634-0869-5a61-aaa5-cf9b925b238c', '2026-09-01T09:00:00Z', '2026-09-13T17:00:00Z', '2026-10-01T00:00:00Z');

-- multi sits in organization B's offering, deliberately outside offering_a's report.
INSERT INTO app.enrollments(id, user_id, program_id, version_id, grant_id, organization_id, offering_id,
                            starts_at, due_at, access_ends_at)
  VALUES ('31d3c60d-01cb-585e-bd19-c97ba634b560', '86aedbc4-2d82-5920-89d0-3a758d7794ff', 'ca077cbc-8c50-51ed-ba8b-f26d4f2f7528', '1e4985f2-8eec-5418-998a-484f5561c049',
          '8a84ced4-af81-5d2f-be68-4ce5168daf59', '16f88a87-6764-53cf-abde-3778f2ea1355', '28d4d19d-d896-509f-9dc3-93bfaf80450d',
          '2026-09-01T09:00:00Z', '2026-09-13T17:00:00Z', '2026-10-01T00:00:00Z');

-- Class progress. A completed media class is fully covered, well past the
-- 90% of unique timeline ADR-09 requires.
INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges, position_ms, content_completed_at, completed_at, updated_at)
  VALUES ('c12faa8a-c9e6-50bf-b8ee-4bc5cef608c3', 'd95caac8-b580-5147-bc93-bd483f308611', 'fabecfce-b09c-541e-acf3-575147e78603', '{[0,600000)}'::int8multirange, 600000, '2026-09-14T12:00:00Z', '2026-09-14T12:00:00Z', '2026-09-14T12:00:00Z');
INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges, position_ms, content_completed_at, completed_at, updated_at)
  VALUES ('c12faa8a-c9e6-50bf-b8ee-4bc5cef608c3', '85553726-1d5b-5d3c-98ae-beb5a2b5f132', 'fabecfce-b09c-541e-acf3-575147e78603', '{}'::int8multirange, 0, '2026-09-14T12:00:00Z', '2026-09-14T12:00:00Z', '2026-09-14T12:00:00Z');
INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges, position_ms, content_completed_at, completed_at, updated_at)
  VALUES ('6029de49-7fd6-5401-89c5-c0bbc2d91552', 'd95caac8-b580-5147-bc93-bd483f308611', 'fabecfce-b09c-541e-acf3-575147e78603', '{[0,600000)}'::int8multirange, 600000, '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z');
INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges, position_ms, content_completed_at, completed_at, updated_at)
  VALUES ('6029de49-7fd6-5401-89c5-c0bbc2d91552', '85553726-1d5b-5d3c-98ae-beb5a2b5f132', 'fabecfce-b09c-541e-acf3-575147e78603', '{}'::int8multirange, 0, '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z');
INSERT INTO app.class_progress(enrollment_id, class_id, version_id, played_ranges, position_ms, content_completed_at, completed_at, updated_at)
  VALUES ('6029de49-7fd6-5401-89c5-c0bbc2d91552', 'ef874b1a-bdc6-5750-b384-a30f3199bd44', 'fabecfce-b09c-541e-acf3-575147e78603', '{[0,600000)}'::int8multirange, 600000, '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z');
INSERT INTO app.exercise_completions(enrollment_id, exercise_id, response, confirmed_at)
  VALUES ('6029de49-7fd6-5401-89c5-c0bbc2d91552', '083cddbe-279d-5ea2-8289-7fb9ece21de6', 'Draft a sample sales follow-up using fictional customer details.', '2026-09-12T12:00:00Z');

-- Certificate for the one learner who finished every required class.
INSERT INTO app.certificates(id, enrollment_id, learner_name, program_title, version_number, issuer, completed_at, issued_at)
  VALUES ('17faeee8-f113-5036-a712-0d56f2b25a00', '6029de49-7fd6-5401-89c5-c0bbc2d91552', 'Cora', 'AI Foundations', 1, 'PGLearn', '2026-09-12T12:00:00Z', '2026-09-12T12:00:00Z');

COMMIT;
