# 02 — Database, access control and migration contract

## Persisted schema

[Reference DDL](../contracts/schema.sql) defines exact columns, types, nullability, defaults, primary/foreign keys, uniqueness, basic checks and indexes. Use a UTF-8 database encoding. UUIDs identify entities, UTC `timestamptz` stores instants, and integer milliseconds represent media positions. All application-owned tables are in `app`. Do not create a competing public-table model. The SQL is a reference first migration; the remaining migrations below are necessary for a functioning secure application.

Deletion is restricted by default. Draft child deletion is allowed only after checking its parent is draft and removing references in a transaction. Published learning data and certificates are never physically deleted from the UI. Retention deletes chat/request data and old raw learning events only; it preserves aggregate progress and certificate identity.

## Database access boundary

Application tables have RLS enabled, no permissive policy and no schema/table privileges for `anon` or `authenticated`. Thus direct REST/SQL reads/writes are denied, including guessing a private table name. Keep `app` out of Supabase Data API exposed schemas. This is deliberate defense in depth; authorized access goes through audited database functions.

Create exactly these public entrypoints:

```sql
public.pglearn_rpc(action text, payload jsonb) RETURNS jsonb
public.pglearn_job(job text, payload jsonb) RETURNS jsonb
public.pglearn_provision(payload jsonb) RETURNS jsonb
```

- `pglearn_rpc`: SECURITY DEFINER, `SET search_path = ''`, owner is migration/table owner; revoke execute from PUBLIC/anon, grant only authenticated. Start by requiring non-null `auth.uid()`, active profile and onboarded profile except the own-account onboarding actions `get_me`, `get_invitation` and `accept_invitation`. Dispatch against a literal allowlist corresponding to OpenAPI `operationId` values excluding public health, jobs/webhooks/Auth SDK operations. Fully qualify every schema/object. Unknown action is denied; never dynamically concatenate SQL action/table names. Internal `app.handle_*` handlers receive the verified actor UUID, never a payload-provided actor. No database handler trusts a supplied organization role.
- `pglearn_job`: same fixed search path, service_role execute only. Whitelist `reminders.claim`, `reminders.finish`, `email.event`, `retention.run`, `tutor.reserve`, `tutor.finish`, `jobs.record`. Each validates its payload and related row identities. `tutor.reserve/finish` are invoked only after the authenticated request handler gets an authorized request identity from `pglearn_rpc`; they cannot accept arbitrary conversation bodies from job/webhook endpoints.
- `pglearn_provision`: service_role only; synchronizes a verified Auth user into `profiles` during controlled invitation flow. Must use Auth’s authoritative ID/email, never values copied blindly from an unauthenticated request. Only app server code invokes it after an already-authorized invitation intent.
- Revoke PUBLIC execute on every created function. Internal `app.*` functions have no execute privileges for browser roles. Do not expose a generic service-role SQL proxy.
- Table-owning SECURITY DEFINER functions bypass their tables’ RLS. **The scoped authorization inside each handler is mandatory.** RLS alone does not secure a buggy privileged function. Tests must call RPC directly using user JWTs as well as through application routes.
- Normal application queries use the user-scoped Supabase client to call `pglearn_rpc`. The service key is confined to server-only modules for Auth admin, signed storage URLs, jobs and provider-result persistence. Before every signed URL, the user RPC must authorize that exact asset and enrollment.
- No `auth.uid()` RPC accepts an override such as `acting_user_id`, `is_admin`, or `role` for authority. The API strips unknown fields; RPC validates again and rejects extra fields for mutations.

This completes the earlier RLS proposal with an explicit private-table/function approach. Supabase’s function documentation describes fixed search paths and explicit execute privileges: [database functions](https://supabase.com/docs/guides/database/functions).

## Exact authorization predicates

Evaluate predicates in the database transaction, not from cached UI role state.

`actor_active(u)`: profile u exists, status=active; onboarded_at non-null except allowed onboarding operations.

`platform_admin(u)`: actor_active(u) and row in platform_admins.

`org_manager(u,o)`: actor_active(u), organization o active, membership(u,o) active with role=manager.

`owns_enrollment(u,e)`: enrollment.user_id=u. Owners retain summary/progress/certificate access even after cancellation, expired access, or organization removal, subject to active account.

`can_report(u,e)`: platform_admin(u), or org_manager(u,e.organization_id). Null-organization enrollment never matches an organization manager. Reporting remains available for historical rows even if target learner membership has been removed.

`can_learn(u,e,t)` requires ALL:

1. actor_active(u), profile onboarded and owns_enrollment(u,e).
2. enrollment active; pinned version published.
3. t >= enrollment.starts_at and t < enrollment.access_ends_at when the end exists.
4. referenced grant active, same program; t >= grant.starts_at and t < grant.ends_at when present.
5. Personal: grant.user_id=u and no organization/offering. Organization: grant.organization_id=e.organization_id, organization active, membership active, offering active, cohort not archived and cohort membership active.
6. For org offering: t >= offering.starts_at and before optional offering access end. Earliest applicable start/end determines availability; due date is not an access gate.

Use statuses `available`, `not_started`, `expired`, `revoked`, `membership_inactive`, `cancelled`, `account_inactive` as derived availability values. Priority: account inactive → cancelled (enrollment or offering) → membership inactive → revoked → not started → expired → available. Grant expiry maps expired; revoked status maps revoked. Organization/cohort suspension/archive maps membership_inactive. Client receives this reason only for its own identifiable enrollment; other users receive 404.

`can_preview(u,version)`: platform_admin only; preview reads drafts without creating enrollment/progress. Manager can view entitled catalog summaries without learning access. Class body, source text and file URLs require can_learn or admin preview.

## Row/field disclosure matrix

| Data | Learner | Manager | Platform admin |
|---|---|---|---|
| Profile | Own email/name/preferences | Roster learner name/email/status only | Account administration fields |
| Grants | Own effective catalog summaries | Own organization grants, read-only | Read/write |
| Enrollments/progress | Own summaries; mutate only through learning rule | Own-org summaries only | Scoped summary/report |
| Exercise response | Own, including after course expiry | Never | No response-reading UI/RPC |
| Tutor questions/answers | Own; reads require owns_enrollment and active profile | Never | Operational status/token counts only |
| Content/assets | Authorized published class | Summary unless enrolled | Draft/published preview and draft editing |
| Outbox | No access | No access | Status, recipient, template, attempts; no signed auth links |
| Audit | No access | No access | Minimal admin listing |

The database operator necessarily has privileged access to stored data; the matrix defines product access. Do not claim cryptographic secrecy from database operators.

## Mandatory transactional constraints beyond reference CHECKs

Implement these in migration M02 triggers and command handlers, so service-level mistakes cannot silently corrupt relationships:

- A grant’s subject is immutable; edits can alter dates/status only. An offering’s grant subject must equal its organization; its version must be published and match its program, and the program must not be archived when creating a new offering/enrollment. Reject assignment if access dates extend beyond grant validity; a soft due may equal hard end.
- Enrollment’s organization/program/version/grant/offering/user are immutable. Organization enrollment must reference an existing active cohort_members row and invited/active membership of the same organization. Personal grant must belong to its user. Date creation validates against grant/offering; later updates target explicit selected enrollments.
- Cross-program/version progress/events/session/chunk constraints use composite FKs in DDL. Exercise completion must join exercise → class → version equal to enrollment.version_id.
- Any UPDATE/DELETE of published version content, its modules/classes/exercises/assets/chunks is rejected. Publication permits only draft→published after validation. Programs can be archived to prevent new assignment without invalidating existing enrollment.
- Primary asset must be role=primary, ready and same class with matching supported MIME. Source/caption roles and exercise required-class rule validated at publish. Every module has a class; at least one required class across the version; every class has usable content/source text. Validate video captions at publish.
- Profile email comes from Auth synchronization. Public profile edit allows display_name/timezone/reminders_enabled only. Timezones must be in `pg_timezone_names`.
- Active organization always has at least one invited or active manager; once any manager has accepted, at least one active manager must remain. Lock organization row for role removals. Initial organization creation includes manager provisioning and does not make organization usable until a manager membership exists.
- Lock enrollment for progress/exercise/complete operations. Completion timestamps can only transition null→value. Certificates are unique per enrollment; immutable snapshots cannot be edited, only revocation fields set once by admin.
- Last activity/start derive from accepted meaningful activity, not login, read requests or rejected events. Only playback session generation can advance the resume pointer; old tabs cannot overwrite it.
- Date changes require start < due <= optional hard end, cannot move start after existing started_at, and preserve completed_at. Completed enrollment schedules cannot be edited in v1. Cancellation never deletes progress.

## Migration sequence

| ID | Migration output | Required evidence |
|---|---|---|
| M01 | Adapt reference schema.sql to migration; existing Auth schema untouched | Clean local reset, FK/CHECK/index tests |
| M02 | Relationship/immutability/timezone triggers, profile sync provisioning, private predicate helpers | Cross-context inserts rejected, published content locked |
| M03 | Whitelisted user RPC and feature handlers; function privilege revocation | Direct authenticated RPC isolation and unauthenticated denial |
| M04 | Service-only job/provision functions, storage bucket policies | Browser cannot invoke service paths; private asset deny checks |
| M05 | Test/demo fixtures via explicit seed command; no real staff/passwords in source | Deterministic totals and repeatable fixture seed |

Development migrations can reset only the explicitly designated local/test database. Never reset a remote pilot project as a verification shortcut. All later edits become forward migrations after real records exist.

## Storage contract

Bucket `pglearn-private`, public=false. No anon/authenticated object SELECT/INSERT/UPDATE/DELETE policies. Server issues short-lived signed uploads for authorized admin asset IDs and signed downloads for exact authorized class assets. Object names: `versions/{version_id}/classes/{class_id}/{asset_id}/{sanitized_filename}`; no user input path traversal. Never reuse an object key for changed published bytes. Admin upload finalization checks actual object size/type, class/draft identity and source parsing before setting ready. Service credentials authorize signing, so these route checks are security-critical.
