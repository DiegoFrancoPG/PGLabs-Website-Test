# Validation evidence — specification v1.0

Completed 15 September 2026. **These results validate the specification and its reference DDL, not a running PGLearn application.** All 30 application tasks remain `todo`; all 67 application acceptance scenarios remain `not_run`.

## Checks performed

| Check | Result |
|---|---|
| OpenAPI 3.1 validation with openapi-spec-validator 0.9.0 | PASS: 66 operations |
| JSON Schema validation with jsonschema 4.26.0 | PASS: 70 component schemas |
| Positive/negative request examples | PASS: 18 cases, including grant subject XOR, unknown fields, Unicode response length and invalid update shape |
| Reference resolution and path parameters | PASS: no broken API schema references; path placeholders match declarations |
| Task graph and traceability | PASS: 30 tasks, no dependency cycles; all 66 operations and 67 acceptance scenarios assigned |
| Fixture calculations | PASS: assigned=4, completion rate=25%, average progress=41.7%; row percentages reconciled |
| Local documentation links and fenced blocks | PASS |
| Reference DDL execution | PASS on a disposable PostgreSQL 15 UTF-8 database with minimal Auth table/role stubs |
| Reference SQL constraints/privileges | PASS: 32 checks in tests/schema-smoke.sql; 32 application tables created |
| Direct reads under anon and authenticated | PASS: both denied schema access to app.enrollments |

The SQL checks cover grant subject/date validity, duplicate grants/enrollment/exercises/certificates, cross-context foreign keys, class order, media bounds, interval union, response character limits including Unicode, completion timestamp prerequisites, revocation fields, RLS flags and table/schema privileges. The test transaction rolls back fixture writes.

A first reference run used SQL_ASCII; a second disposable UTF-8 database was then created and the full schema plus added Unicode checks passed there. Final evidence above uses the UTF-8 run.

## Reproduce package checks

From this folder:

```sh
python3 verify_spec.py
```

The standard-library checker verifies references, task/scenario mappings, cycles, fixture arithmetic and document links. To also run the same OpenAPI/JSON Schema validators, install [requirements-validation.txt](requirements-validation.txt) in an isolated environment and run verify_spec.py with that environment’s Python.

For SQL, use a fresh disposable PostgreSQL/Supabase test database with Supabase Auth’s users table and roles available, then apply contracts/schema.sql and run tests/schema-smoke.sql with psql `ON_ERROR_STOP=1`. The smoke fixture assumes a fresh reference schema, not an already-seeded application. Never run this against the real pilot database.

## Explicitly unverified

- Application UI, routes, feature handlers and SQL RPC implementations: not built in this task.
- M02–M04 relationship/immutability triggers, authorization RPCs and service handlers: specified, not implemented. Private tables alone do not establish correctness of future privileged functions.
- Supabase-hosted Auth, signed uploads, actual videos/captions, live email/cron and model calls: not exercised.
- End-to-end user journeys, real-course tutor quality, 40-user performance and backup restore: remain implementation acceptance gates.

No API credentials, external accounts or real learner records were used. The disposable PostgreSQL instance was stopped after validation.
