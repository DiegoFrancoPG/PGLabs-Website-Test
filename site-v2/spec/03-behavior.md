# 03 — State transitions and business algorithms

These rules are normative and tested using the named acceptance scenarios. Server clock is authoritative; tests inject time into domain services, never through a production HTTP override.

## 1. Invitations and identity

Public signup disabled. Admin/manager invitation command is idempotent and first authorizes the requested organization/role. Managers may invite only learners into their own organization; admin can invite managers or personal learners. Normalize email by trim + lowercase, without provider-specific dot/plus rewriting.

For a new email, server generates a Supabase invite link using the Auth admin API; this creates an Auth identity but does not itself send application mail. Provision matching profile with onboarded_at=null, then create pending invitation, invited membership and invitation outbox record. Auth and Postgres cannot be one distributed transaction: reconcile by normalized email and request ID after failure; never create duplicate membership or expose the Auth link to the manager. Pending Auth identity alone grants no learning access.

For an existing identity, create the same pending invitation/membership and email `/invitations/{id}`; accepting requires login as the verified matching user. The route does not reset an existing password. Existing active membership returns existing status without another invitation. An active learner membership cannot be promoted by a manager invitation. Invite expiry is 24 hours; resend expires the old pending invitation and creates a new one, preserving user/cohort assignments. Repeated resend request ID reuses its result.

New-user callback verifies Supabase OTP/code using the configured SSR flow and opens password setup. Require password 12–128 characters and matching confirmation. Only after a successful Auth password update and matching unexpired invitation acceptance set onboarded_at, active membership and accepted_at. Acceptance is idempotent; wrong account gets 404. Personal acceptance sets profile onboarding but creates no organization membership. A verified user can accept multiple organizations without resetting their password.

Pending invited profiles may be enrolled; their entries count as assigned and remain 0% until onboarding and membership are active. Password-reset request always returns a generic success message, regardless of email existence. Do not expose account lookup to unauthenticated callers.

## 2. Program publication and assets

Draft→published is one transaction after validation and chunk indexing. Required fields: program/version/module/class titles; positions contiguous starting at zero; at least one class per module and one required class per version; text body nonempty or ready primary audio/video with duration; every class has source text from body/transcript; each video has a valid caption track; any exercise has instructions and belongs to required class. Optional handouts must be ready if attached.

Positions are unique within parents and reorder operation accepts the exact complete sibling ID list without duplicates. The transaction defers position uniqueness checks, rewrites positions and restores constraints. Cross-parent IDs reject the entire operation.

Supported uploads: MP4 video (H.264/AAC, prepared outside this platform), MP3/M4A audio, PDF handout, UTF-8 TXT transcript, VTT/SRT captions. Maximum primary video/audio 1 GiB, PDF 25 MiB, text/captions 2 MiB. MIME and extension must agree with supported set; server checks object metadata and file signatures/parser where applicable. There is no arbitrary external URL importer.

Store millisecond media duration supplied by admin/player metadata and verified against the actual file during integration; no claim of secure server transcoding. Reject duration outside 1 second–4 hours. SRT is converted to WebVTT, preserving timestamps, with safe plain cue text. Reject negative/non-numeric timestamps and end <= start. Overlapping cues are allowed; cues beyond duration+2 seconds reject. Store normalized caption object separately and derive plain searchable source text; author can supply an additional approved transcript. Do not execute HTML inside captions/Markdown.

Signed upload expires according to Supabase’s supported signed-upload behavior, recorded in response; client must obtain a fresh authorization on expiration. For caption assets sign playback_key (normalized VTT); for other roles sign storage_key. Signed download TTL=900 seconds, refresh after 720 seconds or on authorization-expiry error. Reauthorize before renewal, preserve playback position and do not loop indefinitely. Previously issued URLs can remain usable until expiry; revocation cannot claw back already downloaded bytes.

## 3. Enrollment and dates

Org manager chooses existing grant and published version, creates an offering and explicitly enrolls selected cohort members. Adding a new cohort member does not auto-enroll them; UI provides the assignment action. Duplicate member/offering enroll returns existing row. Removing cohort member changes its status=removed and cancels active enrollments for that offering context; re-adding does not silently restore prior enrollment. Admin can explicitly reactivate cancelled enrollment if all predicates pass; this preserves progress. Retake uses new offering; personal retake uses next attempt number.

Personal enrollment is admin-created from the individual grant, with explicit start/due/optional end. No payment needed. Latest published version is only a UI default; the command always submits an explicit version ID.

Offering dates are copied into enrollment. Subsequent offering date changes apply only to selected active incomplete enrollment IDs; validate all before changing any. Backend checks actual current grant each request, so revoking/shortening it takes effect without rewriting enrollment history.

Derived learning state: cancelled if status cancelled; otherwise completed if completed_at exists; otherwise in_progress if started_at exists; else not_started. Availability is independent (security spec). At t=due incomplete is not overdue; t>due is overdue. Completion exactly at due is on time. Completion after due is allowed if still accessible. At t=hard-end no new learning write is accepted.

## 4. Playback and completion

`start_playback` validates can_learn and media class version. Lock enrollment, close its old open playback session, increment resume_generation, create new session and record last_class_id. This supersedes an older browser tab/device. Return current saved position and class status. Starting a session alone does not count as learning activity.

Heartbeat every 15 seconds while playing and on pause/navigation, with integer-millisecond positions. A seek ends the previous interval; do not span skipped time. Request contains event_id, session_id, sequence (starting at 1), position_ms, elapsed_ms, rate and optional single played interval. Rate must be 0.5–2; elapsed 0–30,000; interval bounds within media duration; position within [0,duration]. If no interval, only save position. Playback paused/backgrounded sends no growing interval.

Transaction algorithm:

1. Validate identity, access and exact enrollment/class/session associations. If known event_id belongs to another enrollment, return 404; same ID with changed payload returns 409. A known same event replay returns current canonical progress without new activity.
2. Lock enrollment and session. Closed/superseded session returns 409 SESSION_SUPERSEDED. Sequence <= last_sequence with new event ID returns accepted=false, reason=stale_sequence and current progress; makes no state change. Gaps are permitted.
3. Require interval length <= min(elapsed_ms, max(0, server_now-last_received_at)+2,000) × rate + 1,000 and <=60,000 ms. Positive length must have elapsed_ms>0. This bounds obvious fabricated coverage; it cannot prove human attention or defeat a determined authenticated simulator.
4. Union accepted [start,end) interval with `int8multirange` played_ranges, which normalizes overlaps. Coverage = sum of range lengths, capped by media duration. Criterion is coverage*100 >= duration_ms*90 using integer arithmetic.
5. Only newer accepted session/sequence changes position and resume pointer. Record event and update session sequence/time. A positive accepted played interval sets started_at if absent and last_activity_at=server_now. Pure zero-interval position saves do not.
6. When content criterion first passes, set content_completed_at. If no exercise or a saved exercise completion exists, set class completed_at. Preserve existing timestamps.
7. Recompute completed required classes on the pinned version. If all required classes complete, set enrollment completed_at once and insert certificate snapshot ON CONFLICT enrollment DO NOTHING. Include certificate notification outbox record in the transaction.

Text completion uses event_id, validates text class, sets content_completed_at and follows steps 6–7. Class view/read alone never completes text. Exercise completion can precede media/text completion: save response and confirmation, but keep class incomplete until both parts pass.

Normalize exercise text to NFC and trim Unicode whitespace in application and handler-equivalent validation. Count Unicode code points consistently with PostgreSQL char_length, not JavaScript UTF-16 string.length. Allow 1–2,000, confirmation=true. First successful response is final/read-only in v1. Retry with same request ID/body returns it; another different response after completion is 409 EXERCISE_ALREADY_COMPLETED. Failure rolls back response/completion together. No grades and no managers reading responses.

Continue target: last_class_id when it is still incomplete; else first incomplete required class in module/class order; else program completion page. Completed course can still be revisited while accessible. Overall percent uses required classes only, rounded to one decimal for display; use integer counts for completion.

## 5. Certificates and reports

Certificate UUID is the verification identity; no public endpoint in v1. Owner/admin/authorized organization manager may read metadata/download, including after course access expiry. PDF uses stored learner/program/version/issuer/completion snapshots, UTC issue date and verification route. Bundle a licensed font supporting the actual learner names, including accented characters; do not silently replace unsupported characters. User renaming or program catalog title edits do not rewrite certificates. Revocation requires admin reason 1–500 chars; revoked metadata remains visible, PDF endpoint returns 409 CERTIFICATE_REVOKED. One revoke is idempotent; a different reason does not overwrite it silently.

Report rows are enrollments plus invited/onboarded profile state. Manager scope is forcibly organization-bound. Filters: organization (admin only), offering, derived learning status, overdue, completed_from inclusive, completed_to exclusive. Completion timestamp filters exclude incomplete rows; current-progress filters do not imply a historical snapshot.

Summary for matching non-cancelled rows: assigned count; not_started/in_progress/completed disjoint counts; completion_rate=completed/assigned; mean progress includes zeros. Empty denominator yields null in JSON and “—” in UI. Cancelled rows may be requested separately, never silently enter active summary denominators. Overdue requires incomplete and now>due, even if access expired; availability separately tells manager whether action is possible. No inferred competence/time-spent metric.

CSV UTF-8 with BOM, CRLF rows, RFC4180 quoting. For user-entered values whose first non-whitespace char is =,+,-,@ or tab, prefix a single quote before CSV escaping. Header order matches API ReportRow schema. Include ISO UTC timestamps and a timezone column. Report retrieves enrollment rows, not raw exercise/chat text. At most 10,000 rows synchronously; larger request returns 422 EXPORT_LIMIT instead of truncating invisibly.

## 6. Reminder algorithm and retry boundaries

Scheduler runs hourly (`0 * * * *`) via secret-protected GET `/api/v1/jobs/reminders`. Fixed priority: overdue > due_today > due_soon > inactivity; choose earliest due then enrollment UUID as tie break. Learner local date uses profile.timezone. Eligible sending hours are 09:00 through 17:59 local; next hourly run catches a missed window, without backdating prior-day sends.

Eligibility: active accessible enrollment and profile, onboarded, reminders_enabled, not completed, not cancelled. Inactivity when now-max(last_activity_at,starts_at)>=72 hours; repeat after >=7 days since last accepted inactivity send. Due_soon when local due date minus current local date=3. Due_today when same date and now<=due. Overdue once when now>due. Due-date campaign key includes due_at; changing due starts a new campaign. Inactivity key includes the 7-day interval number anchored at max(last_activity_at,starts_at)+72 hours.

Per user/local date claim is unique in reminder_days. Event key is `learning/{enrollment_id}/{rule}/{campaign_key}`. In one transaction: calculate priority, insert outbox ON CONFLICT DO NOTHING, claim daily slot if unclaimed. Invitations/certificates do not consume that learning slot. Recheck completion/access/preferences immediately before sending; suppressed slot may be released only before provider invocation. Once an invocation may have sent, keep its slot.

Claim up to 20 due messages, lock with SKIP LOCKED and 5-minute lease; provider concurrency max 3. Set first_attempt_at before the network request. Freeze recipient/template/rendered payload across retry. Provider Idempotency-Key=outbox UUID. Retry eligible failures after 1,5,15,60 minutes, maximum five attempts total. A timeout is not proof of failure. Recover lease with same identity; after 23 hours from first attempt, move unknown outcome to uncertain and require provider reconciliation. Never assume indefinite provider deduplication. Verified definitive rejection can be failed; a deliberate fresh resend creates a linked audited new event only after outcome review.

Verified webhooks dedupe by provider event ID; out-of-order accepted/delivered cannot downgrade delivered, but bounce/failure is recorded as final failed when appropriate. If webhook arrives before provider ID is saved, retain event ID/type/email ID and reconcile after finish. Schedule and webhook errors appear in admin operation status. Emails already dispatched before a concurrent completion cannot be recalled; guarantee recheck before dispatch, not cancellation of mail in transit.
