# Pilot v2 SaaS Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove UC1, one approved UC2 create, UC3, and owner isolation against an allowlisted Google Sheet and Trello sandbox with a redacted, reviewable evidence trail.

**Architecture:** Keep the existing `/pilot/v2` API and PostgreSQL approval as the only write path. Add a read-only operator preflight; bind its exact target and principal to an evidence artifact. Dispatch one approved create through the API, then verify the Trello receipt by reading the remote card. The standalone P6 runner must not become a second write path.

**Tech Stack:** Node.js 22+, TypeScript, Fastify API, PostgreSQL, Google Sheets and Trello HTTP adapters, Vitest, Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md` sections 3, 8 and 9; `docs/plans/2026-09-22-mvp-v2-backend/06-LIVE-HANDOFF.md` BE-26/27/29. AI measurement has its own [plan](2026-09-23-pilot-v2-ai-quality.md).

## Global Constraints

- Google Sheets is read-only; Trello write is at most one card create after current owner approval, with a server-enforced ten-minute expiry.
- Use exactly one allowlisted spreadsheet/tab and one allowlisted sandbox board/list. Credentials remain server-side and outside Git.
- `PILOT_V2_WRITE_ENABLED` remains false for preflight and until the single write session is authorized.
- An uncertain POST outcome stays `reconciliation_required`; no blind retry or new run for the same intent.
- Fixture, API, browser and SaaS evidence have separate labels. `SAAS_LIVE_EXERCISED` requires remote observations.
- Do not deliberately inject response loss or timeouts into the real SaaS session; cover V2-19 with fake transport.

## Review Focus

1. A private Sheet configured with service-account keys currently has no bearer-token path: preflight must fail closed until a supported auth path is implemented and tested.
2. A valid credential pointed at the wrong spreadsheet, board, list or principal must fail policy checks before dispatch.
3. Changed source revision, expired preview or a second operator must receive a rejection with zero Trello POST.
4. A Trello create response without a valid card ID or a DB confirmation failure must preserve `unknown` for reconciliation.
5. Duplicate approval or stale `running` state must not send another POST when a client refreshes or retries.

## File map and order

| Unit | Files | Independently testable result |
|---|---|---|
| BE-26 operator preflight | `packages/engine/src/pilot/live-preflight.ts`, `packages/engine/src/pilot/adapters/sheets.ts`, new `packages/engine/src/pilot/live-preflight-cli.ts`, matching engine tests | An explicit read-only command emits redacted JSON and exits nonzero on a failed read. |
| BE-27 API write boundary | `apps/api/src/pilot-router.ts`, `packages/engine/src/pilot/adapters/trello-write.ts`, `apps/api/tests/pilot-approval.integration.test.ts`, `packages/engine/tests/pilot-v2-concurrency.integration.test.ts` | One approval creates at most one card; unknown outcome is retained. |
| BE-29 live evidence and handoff | `docs/PILOT-V2-RUNBOOK.md`, `docs/plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md`, new redacted evidence under `docs/ai-evidence/PILOT-V2-LIVE/` | Reproducible read and write observations with exact commit and target IDs. |

### Task 1: Make the read preflight operable and fail closed

**Interfaces:** Consume `runPilotLivePreflight(PreflightOptions)` and `loadPilotConfig`; produce `node packages/engine/dist/pilot/live-preflight-cli.js --principal $env:PILOT_OPERATOR_ID --request-id $env:PILOT_TEST_REQUEST_ID --output .\pilot-preflight-redacted.json`. The CLI requires both flags, accepts no write option, prints one `PreflightCheckResult`, and exits 0 only when both live reads pass. Build `@wap/engine` before invoking it.

- [ ] Add failing adapter and CLI tests: a service-account-only private Sheet must either send a valid authorization header or stop before GET; a missing principal/request ID, disabled pilot, wrong allowlist, or missing credential must stop with no network request. Assert `writesAttempted === 0`, no `POST`, and redaction of API key, token, private key and URL query secrets.
- [ ] Run `npm run test:unit -w @wap/engine -- tests/pilot-sheets-adapter.test.ts tests/pilot-live-preflight.test.ts`; confirm the new tests fail for the intended reason.
- [ ] Implement the private-Sheet authentication path if that is the chosen source. Keep the existing API-key path only for a source the operator can actually read with it. Remove fallback defaults for principal and request ID at the CLI boundary; reject `allowSimulatedFallback` for live invocation. Do not print source row content.
- [ ] Run the same tests and `npm run typecheck`; review the emitted artifact fields and exit codes. Commit this code/test batch.

### Task 2: Close the one-write and reconciliation gates

**Interfaces:** Consume the existing `/pilot/v2/runs` preview and `/pilot/v2/runs/:id/approve` API with durable `pilot_approvals`; produce a receipt containing the actual Trello card ID/URL and bound board/list, or an explicit reconciliation state.

- [ ] Add integration tests with fake Trello for source/list drift, owner B reading or approving A's run, approval after TTL, two simultaneous approvals, invalid Trello receipt, late response after reconciliation, and restart/replay. In every rejected or uncertain branch assert POST count is zero or one as appropriate and never two.
- [ ] Run `npm run test:integration -w @wap/api -- tests/pilot-approval.integration.test.ts tests/pilot-use-cases.integration.test.ts` and `npm run test:integration -w @wap/engine -- tests/pilot-v2-concurrency.integration.test.ts`; confirm each new regression test fails before a fix.
- [ ] Fix only failed invariants in `pilot-router.ts`, the write adapter or reservation store. Keep `PILOT_V2_WRITE_ENABLED` false by default. Do not wire `live-uc2-runner.ts` as another write endpoint.
- [ ] Rerun targeted tests, `npm run check:backend`, and `npm run test:live -w @wap/web -- tests/live/pilot-approval.spec.ts tests/live/pilot-use-cases.spec.ts`. Review DB state and call counts; commit this code/test batch.

### Task 3: Execute BE-26 live read on a bounded sandbox

**Inputs to collect before this task:** operator identity; one test spreadsheet/tab/request ID; one sandbox Trello board/list; two permitted principals; working credential method. Record IDs in a private run sheet and only safe IDs in evidence. No credential or environment file enters Git.

- [ ] Freeze commit and redacted configuration hash; validate the configured IDs and the Sheet test row's uniqueness. Keep the write flag off. Run the explicit preflight command from Task 1 with the exact principal and request ID.
- [ ] Save timestamp, commit, principal, source/board/list IDs, Sheet source revision, Trello lists/members response summary, redacted errors and `writesAttempted: 0`. Confirm remote audit/HTTP trace contains GETs and no POST. If either read fails, label `BLOCKED_EXTERNAL` or `FAILED`; stop before Task 4.
- [ ] Review the artifact for secrets and source content. Mark only `SAAS_READ_CONFIRMED` when both reads are independently observed.

### Task 4: Run one approved UC2 and verify UC1/UC3

**Entry gate:** Task 3 passed; target list and intended card payload are reviewable; the operator has separately authorized one create on that sandbox target. Use the existing API/browser path and its PostgreSQL approval, not the P6 standalone runner.

- [ ] With principal A, run UC1 on the selected row and record that it made no write. Create a new UC2 run; review owner, source revision, preview, list, content, hash and expiry. With principal B, verify A's run remains inaccessible. Do not approve a stale or mismatched preview.
- [ ] Enable write only for the bounded session. Approve once within the server TTL. Capture the API run ID, intent key, response, DB reservation and the single Trello create call. Immediately turn the write flag off after the session.
- [ ] Read the card directly from Trello by returned card ID, compare board/list/member/content to preview, and run UC3 through the browser/API using the source request ID. Confirm the displayed link matches the remote card and B still cannot read A's run.
- [ ] If dispatch is uncertain, record `reconciliation_required`, stop writes and use the runbook's read-only search; absence from one search does not authorize another create. Do not mark the session passed without remote card and DB receipt agreement.

### Task 5: Review evidence and update handoff labels

- [ ] Have an independent reviewer check redaction, exact target, GET/POST counts, owner denial, snapshot/approval binding, card content and DB receipt. Reconcile any disagreement before publishing a verdict.
- [ ] Update `docs/PILOT-V2-RUNBOOK.md` and `P6-REVIEW.md` with the actual commands, artifacts, failures and label for each UC. `SAAS_LIVE_EXERCISED` requires UC1 zero write, one correct approved UC2 card, UC3 live read, and A/B isolation. Keep `AI_QUALITY_NOT_RUN` and `CUSTOMER_VALIDATED_NOT_RUN` unless their separate evidence exists.
- [ ] Run `git diff --check`, inspect the exact diff for secrets, and commit the evidence/doc batch. A failed or blocked live session remains visible as failed or blocked.
