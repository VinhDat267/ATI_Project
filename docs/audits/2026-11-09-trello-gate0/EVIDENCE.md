# TRELLO-G0 — Evidence First / Independent Gate 0

Status: **OPEN — deliberately RED contract tests; no production implementation approved**  
Date: 2026-11-09 (Asia/Bangkok)  
Repository: VinhDat267/ATI_Project  
Frozen baseline: main = 08c8d8c5e7bf12625857ac3496fb96ec3914e34f  
Baseline CI: https://github.com/VinhDat267/ATI_Project/actions/runs/42497095638 (success)

## Scope and evidence taxonomy

This Gate reviews OAuth 2.0 compatibility, tenant scope, digest coverage and Slack/Telegram receipts. **Tests and documentation only**: no production edits, schema changes, deployments, merges, provider writes or forced reauthorization.

- SOURCE_VERIFIED: confirmed from main source at frozen HEAD.
- OFFICIAL_DOC_VERIFIED: official provider docs, not a native call.
- RED_EXPECTED: executable test contract added; expected to fail against existing behavior.
- CI_OBSERVED: only when exact branch CI run and failure logs have been inspected.
- NATIVE_NOT_RUN: no real OAuth consent, token or provider-backed execution performed.

## G0-01: OAuth compatibility — corrected finding

**OFFICIAL_DOC_VERIFIED.** Atlassian Trello REST reference lists OAuth 2.0 read:board:trello and Bearer authorization for:
- GET /boards/{id}/cards
- GET /boards/{id}/lists
- GET /boards/{id}/members

Reference: https://developer.atlassian.com/cloud/trello/rest/api-group-boards/  
Confidential OAuth: https://developer.atlassian.com/cloud/trello/guides/rest-api/oauth-2-confidential-client-usage/

**Correction:** a previous assertion that these endpoints were incompatible with Trello OAuth 2.0 was unfounded and is **withdrawn**. No rewrite PR may be justified by that assertion. Native confidential-client consent, scopes, membership and response correctness still require verification (NATIVE_NOT_RUN).

Relevant source: apps/chat-api/src/services/trello/oauth-client.ts; packages/tool-adapters/src/trello/base.ts and read-tools.ts; apps/chat-api/src/routes/connections/trello.ts.

| Native read-only probe | Required evidence | Gate |
|---|---|---|
| OAuth consent, callback, token refresh | Redacted provider metadata, user/workspace association | NATIVE_NOT_RUN |
| Member identity and board listing | Sanitized ID, membership proof | NATIVE_NOT_RUN |
| Allowed board lists/cards read | Status, response shape and count/coverage | NATIVE_NOT_RUN |
| Revoked/forbidden board read | 403 or equivalent, fail-closed | NATIVE_NOT_RUN |
| Provider rate-limit/timeout | Verified outcome, no write replay | NATIVE_NOT_RUN |

## G0-02: Trusted workspace scope

**SOURCE_VERIFIED.** Trello connection lookup accepts userId and scopeId with fallback default. Digest candidate invokes lookup with userId only; digest runner likewise. Runner creates Trello adapter without workspaceMode/workspaceId, allowing default-scope resolution. Candidate currently uses the first five member boards when an explicitly requested board name does not match.

**RED_EXPECTED** in apps/chat-api/tests/services/trello-gate0-scope.red.test.ts:
- candidate resolves trusted Personal scope, not default;
- an explicit unknown board must not be silently replaced by another board;
- organization run forwards trusted scope to connection lookup AND adapter.

The additional scopeId test input is a **proposed interface contract**, not an existing production guarantee. GREEN must derive scope from trusted conversation/schedule state, never accept user-provided authorization authority.

## G0-03: Digest completeness and honesty

**SOURCE_VERIFIED.** Current runner reads Trello cards at limit 50 per board. Its overdue, due-soon and unassigned lists are each capped at 15 elements, and displayed counts come from the capped lists. No coverage metadata indicates the discrepancy.

**RED_EXPECTED** in apps/chat-api/tests/services/trello-gate0-digest.red.test.ts: a 70-card board read truncated at 50 must not produce a silently complete digest. An explicit partial-data marker or blocked outcome is sufficient for the Gate 0 contract; later GREEN specifies full matchedCount, displayedCount, scannedCount, and coverage.

## G0-04: Receipts and destination verification

**SOURCE_VERIFIED.** Runner correctly has pre-send delivery claim, delivery_unknown and no-blind-retry intentions. But Slack response without ts and Telegram response without messageId currently can yield digest_sent. Slack channel-lookup exceptions other than AUTH_ERROR are ignored before attempting send.

**RED_EXPECTED** in apps/chat-api/tests/services/trello-gate0-digest.red.test.ts:
- missing Slack ts is not a verified send;
- missing Telegram messageId is not a verified send;
- channel membership cannot be verified: do not send.

All new tests use controlled transport doubles; **they are not evidence of durable concurrency**. Native readback and real PostgreSQL cancellation/timeout/claim tests are future GREEN/live gates.

## Existing evidence and limitations

- main CI at frozen HEAD is green; it did not run these new RED tests.
- apps/chat-api/tests/services/trello-digest.test.ts includes migrated PostgreSQL ScheduleService-to-ScheduleRunner integration with fake external adapters, not native Trello-to-destination confirmation.
- FLOW-07 remains OPEN; XSVC-01 Trello-to-Slack preview was cancelled with zero execution steps.
- No authorized Trello native credentials were accessed in this audit. Do not persist tokens, card content or user data in logs/artifacts.

## Reproduction

With repo dependencies and test DB available:

    npx --workspace=@wap/chat-api vitest run tests/services/trello-gate0-scope.red.test.ts tests/services/trello-gate0-digest.red.test.ts

Observe exact assertion failures before approving implementation. Failing CI on the draft RED branch is expected; avoid assuming cause from job status alone. Once approved GREEN code exists, rerun old Trello tests, the new tests, PostgreSQL integration, browser checks and npm run check.

## Concurrent Google Sheets Gate A

Draft stacked PRs #289–#295 still open at baseline. Shared files with potential conflicts: apps/chat-api/src/server.ts, apps/chat-api/src/services/chat-service.ts, apps/chat-api/src/services/schedules/schedule-service.ts and schedule-runner.ts, packages/tool-schemas/src/types.ts, db/v3, schedule routes/config.

**None of these files may be changed during Gate 0.** GREEN runtime edits involving shared modules need explicit dependency review and separate owner approval after Sheets contracts stabilize.

## Gate exit criteria

1. Independent reviewer verifies RED is caused by expected behavior assertions, not test fixture/import/DB setup.
2. Product owner approves trusted scope contract and fail-closed unresolved-board behavior.
3. Product owner approves digest full/partial coverage rules and truthful counts.
4. Product owner approves receipt and channel membership verification policy.
5. Native OAuth and end-to-end provider checks stay NATIVE_NOT_RUN until authorized test access is supplied.
6. No auto-merge or deploy. Do not merge intentionally RED tests into main before GREEN remediation.

No production logic was changed during this Gate.
