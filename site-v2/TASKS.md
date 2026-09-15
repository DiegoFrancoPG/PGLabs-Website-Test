# PGLearn — implementation task map

Generated view of [tasks.json](tasks.json), the authoritative task/status ledger. All tasks currently start as todo.

| Task | Deliverable | Release | Dependencies | Acceptance cases |
|---|---|---|---|---|
| T01 | Bootstrap repository and shared contracts | demo | None | AC-001 |
| T02 | Create schema migration and constraint tests | demo | T01 | AC-002, AC-003 |
| T03 | Implement relationship guards and permission boundary | demo | T02 | AC-004, AC-005 |
| T04 | Implement verified session and profile services | demo | T03 | AC-006, AC-007, AC-064 |
| T05 | Implement invitation onboarding and password recovery | demo | T04 | AC-008, AC-009 |
| T06 | Implement organization and invitation administration | demo | T05 | AC-010, AC-011 |
| T07 | Implement cohorts and catalog grants | demo | T06 | AC-012, AC-013 |
| T08 | Implement draft content CRUD and ordering | demo | T03 | AC-014 |
| T09 | Implement private uploads, captions and file access | demo | T08, T04 | AC-015, AC-016, AC-017, AC-062 |
| T10 | Implement publication and frozen content | demo | T09 | AC-018, AC-019 |
| T11 | Implement dated offerings and enrollment | demo | T07, T10 | AC-020, AC-021, AC-022, AC-063, AC-065 |
| T12 | Build learner dashboard and class experience | demo | T11 | AC-066 |
| T13 | Implement durable playback, text progress and resume | demo | T12 | AC-023, AC-024, AC-025, AC-026, AC-027, AC-028, AC-029, AC-030 |
| T14 | Implement short-response exercise completion | demo | T13 | AC-031, AC-032, AC-033 |
| T15 | Implement certificates and completion transaction | demo | T14 | AC-034, AC-035 |
| T16 | Implement scoped manager/admin reporting | demo | T15 | AC-036, AC-037, AC-038 |
| T17 | Implement tutor context retrieval and privacy | demo | T10, T11 | AC-039 |
| T18 | Implement tutor model adapter and budget accounting | demo | T17 | AC-040, AC-041, AC-043, AC-044 |
| T19 | Build tutor UI and evaluate adapter behavior | demo | T18, T12 | AC-040, AC-041, AC-042, AC-067 |
| T20 | Implement reminder eligibility and outbox claims | demo | T15 | AC-045, AC-046, AC-047, AC-048 |
| T21 | Connect email, webhooks and cron | demo | T20, T06 | AC-009, AC-049, AC-050 |
| T22 | Implement redacted operations and configuration failures | demo | T21, T18 | AC-048, AC-051 |
| T23 | Integrate responsive admin/manager/learner UI | demo | T16, T19, T22 | AC-053 |
| T24 | Run cross-context and end-to-end verification | demo | T23 | AC-003, AC-004, AC-007, AC-021, AC-023, AC-032, AC-038, AC-039, AC-064, AC-065 |
| T25 | Rehearse and record demo gate | demo | T24 | AC-052, AC-054, AC-061 |
| T26 | Add validated bulk roster import | pilot | T11, T21 | AC-055 |
| T27 | Add new-version cloning UI and checks | pilot | T10 | AC-056 |
| T28 | Implement retention and verify recovery | pilot | T22 | AC-057, AC-058 |
| T29 | Measure 40-user load and operational limits | pilot | T24, T26, T27, T28 | AC-059 |
| T30 | Release pilot and onboard manager | pilot | T25, T29 | AC-060 |

## Execution rule

Select the first task in the requested release scope whose dependencies are done. The task ledger specifies implementation targets, contract reading, checks and evidence. An implementation task may test an explicitly injected provider adapter; the demo gate requires actual provider/source verification and cannot be completed by mocks.

T26–T28 can proceed once their technical dependencies pass even if missing assets or credentials hold up the live demo gate. T30 requires both real demo evidence and pilot checks.
