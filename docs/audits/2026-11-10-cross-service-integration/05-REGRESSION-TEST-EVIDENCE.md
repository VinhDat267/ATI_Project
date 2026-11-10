# 05 — Cross-Service Regression & Runtime Test Evidence

**Audit Bundle:** `docs/audits/2026-11-10-cross-service-integration/`  
**Document Status:** Task C Backend Section Completed (`INDEPENDENTLY VERIFIED` on `7dcd3753742c755f3493ba3f010a7a743c72a074`); Task D Frontend/Browser & Task E Full Gate/CI Sections `PENDING / NOT RUN`  
**Date:** 2026-11-11  
**Isolated Integration Worktree:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate`  
**Integration Branch:** `VinhDat267/ati-v3-cross-service-integration-gate` (local only — not pushed, no PR opened yet)  
**Task C Code+Test Anchor Commit (`C_C1`):** `7dcd3753742c755f3493ba3f010a7a743c72a074` (full-tree `f12bcb2d71d2812f95486d985e5431fe36ef9a89`)  
**Current Gate Status:**
- **Gate A (Code Acceptance):** `NOT READY — BLOCKING DEFECT OR MISSING CRITICAL EVIDENCE` (Tasks D & E not yet executed; Gate A cannot be marked `PASS` from Tasks B/C alone)
- **Gate B (Merge Readiness):** `NOT READY`
- **Gate C (Production Activation):** `PRODUCTION ACTIVATION — HOLD`

---

## 1. Provenance, Environment Isolation & Task B Baseline Audit Note

### 1.1. Non-Self-Referential Commit Anchor & Task B Verification Attribution
- **Task B Baseline Provenance Clarification:** On Task B commit `2fa749fc2a82fc642c008957f31df7a7a61d5ab0` (code+test anchor `07c086bfb5299632fc35dd85cbcf906ce4cd1099`), coordinator Codex independently re-verified ancestry and 4 focused suites (`15` tests PASS: `packages/tool-adapters/tests/slack-adapter.test.ts`, `apps/chat-web/tests/browser-scenario-selection.test.ts`, `apps/chat-web/tests/calendar-rem-c-09-oauth-disclosure.test.tsx`, `evaluations/generic-plumbing/static-guard.test.ts`), while the remaining Task B counts (`127` non-DB, `22` DB, `593` schema) stood as `WORKER REPORTED` pending Task C/D/E execution.
- **Task C Non-Self-Referential Anchor (`C_C1`):** All backend runtime tests, TDD `RED -> GREEN` fixes, Layer A workspace suites, and 82-file post-fix `@wap/chat-api` regression checks reported below correspond to exact source+test tree **`f12bcb2d71d2812f95486d985e5431fe36ef9a89`** at commit **`7dcd3753742c755f3493ba3f010a7a743c72a074`**. The subsequent Task C documentation commit updates only audit/handoff markdown and `.txt` log files under `docs/audits/2026-11-10-cross-service-integration/` and `docs/handoff/` with zero changes to `packages/**`, `apps/**`, `db/**`, or `scripts/**`.

### 1.2. Disposable PostgreSQL 16 & Loopback Isolation
| Check | Exact Value / Proof | Status |
| --- | --- | --- |
| **Live `.env` Presence** | `Test-Path .env` -> `False` (`has_dotenv=False` before, during, and after Task C; only `.env.example` exists) | `INDEPENDENTLY VERIFIED` |
| **Owned Disposable PostgreSQL 16 Container** | `ati-xsvc-v2-taskc-56791` (container ID `432c5fa8ca7d`, `postgres:16-alpine` `PostgreSQL 16.15`, loopback binding `127.0.0.1:56791->5432/tcp`, disposable local credential `postgresql://ati_v3:ati_v3_taskc_disposable@127.0.0.1:56791/ati_v3_taskc`, `ALLOW_ISOLATED_TEST_PORT=1`) | Created for Task C & removed via `docker rm -f ati-xsvc-v2-taskc-56791` (`exit 0`) |
| **Unrelated Containers Untouched** | Pre-existing `ati-cal-combined-gate-56657` (`9718bcf4290f`, `127.0.0.1:56657->5432/tcp`) and `ati-v3-test-db-56534` (`20f50936ac02`) were inspected before/after and never connected to, modified, or stopped | `INDEPENDENTLY VERIFIED` |
| **Provider Network Isolation** | 100% `node:http` loopback (`http://127.0.0.1:<ephemeral_port>`) across Google OAuth/Sheets/Calendar/Gmail, Trello, Slack, and Telegram; zero external internet calls | `INDEPENDENTLY VERIFIED` |

---

## 2. Database Migration Verification (`0001..0035` — 47 Actual SQL Files)

Sanitized raw log: [`evidence/task-c-migrations.txt`](./evidence/task-c-migrations.txt) (plus automated assertions `0a` & `0b` in `apps/chat-api/tests/services/schedules/cross-service-combined-gate.test.ts`).

### 2.1. Exact SQL Migration Inventory (`db/v3/` — 47 Files Across Numeric Prefixes `0001..0035`)
> **Inventory Correction vs. Early Plan Shorthand:** `db/v3/` contains **47** `.sql` files spanning numeric prefixes `0001` through `0035` (`44` files `<= 0032` plus `3` post-`0032` remediation files `0033`, `0034`, `0035`), because historical wave merges share numeric prefixes `0014` (×2), `0015` (×2), `0016` (×2), `0017` (×2), `0018` (×2), `0019` (×3), `0020` (×3), `0021` (×3), and `0022` (×2). `db/v3/migrate.mjs` sorts filenames lexicographically (`.sort()`) and executes all 47 files deterministically.

1. `0001_v3_core.sql`
2. `0002_v3_invariants.sql`
3. `0003_auth_sessions.sql`
4. `0004_conversation_titles.sql`
5. `0005_auth_tokens_outbox.sql`
6. `0006_fe03_resource_labels.sql`
7. `0007_oauth_states.sql`
8. `0008_account_google_email.sql`
9. `0009_gmail_personal_connections.sql`
10. `0010_schedules.sql`
11. `0011_oauth_return_to.sql`
12. `0012_mycalendar_personal_connections.sql`
13. `0013_mysheets_personal_connections.sql`
14. `0014_slack_oauth_connections.sql`
15. `0014_trello_oauth.sql`
16. `0015_slack_callback_order.sql`
17. `0015_workspaces.sql`
18. `0016_sheets_automation_and_digest.sql`
19. `0016_slack_processing_consents.sql`
20. `0017_calendar_automation_digest.sql`
21. `0017_slack_source_store.sql`
22. `0018_github_oauth_and_digest.sql`
23. `0018_slack_derived_lineage_and_purge.sql`
24. `0019_jira_workspaces.sql`
25. `0019_slack_signed_event_ingress.sql`
26. `0019_telegram_oauth_and_digest.sql`
27. `0020_notion_oauth_and_digest.sql`
28. `0020_slack_lifecycle_validation_leases.sql`
29. `0020_telegram_update_inbox.sql`
30. `0021_calendar_digest_delivery.sql`
31. `0021_jira_oauth_token.sql`
32. `0021_slack_message_lineage_manifest.sql`
33. `0022_jira_authorization_leases.sql`
34. `0022_slack_plan_execution_lineage.sql`
35. `0023_slack_schedule_lineage.sql`
36. `0024_slack_derived_expiry_proofs.sql`
37. `0025_slack_message_origin.sql`
38. `0026_slack_plan_origin.sql`
39. `0027_slack_schedule_origin.sql`
40. `0028_slack_authorization_fanout.sql`
41. `0029_slack_write_outbox.sql`
42. `0030_slack_assistant_modes.sql`
43. `0031_slack_inbox_and_digest.sql`
44. `0032_jira_digest_schedule_kind.sql` *(end of `<= 0032` pre-remediation baseline: 44 files)*
45. `0033_sheets_digest_v2_remediation.sql`
46. `0034_github_workspace_scoped_team_scope.sql`
47. `0035_sheets_gas_r2_remediation.sql`

### 2.2. Migration Path Verification Summary
| Migration Test Case | Command / Mechanism | Result & Verified Invariants |
| --- | --- | --- |
| **Fresh DB Apply + Idempotency (`0a`)** | `node db/v3/migrate.mjs` executed 3 times on fresh DB `ati_v3_taskc_fresh` (twice on empty DB, once post-seed) | `exit 0` on all 3 runs (`47` `Applied ...` lines per run, matching `db/v3/migrate.mjs`'s stateless idempotent DDL contract — repository has no `schema_migrations` tracking table). Verified `schedule_runs` columns (`delivery_started_at`, `delivery_resolution`, `delivery_resolved_at`, `delivery_resolved_by`, `delivery_followup_run_id`, `dispatched_config`, `dispatched_config_hash`), tables (`sheets_digest_v2_migration_audit`, `github_team_scope_legacy_archive`, `github_team_repos_legacy_archive`, `sheets_append_leases`), and trigger `trg_schedule_runs_capture_dispatched_config`. |
| **Pre-Remediation `<=0032` -> `0035` Upgrade + Row Preservation + Idempotency (`0b`)** | Applied `44` SQL files (`0001..0032`) to `ati_v3_taskc_upgrade`, seeded `users` (`1`), `workspaces` (`1`), `workspace_members` (`1`), `service_credentials` (`6`), `conversations` (`4`), `schedules` (`4`: personal `sheets_digest` v1, org `sheets_digest` v1, `trello_digest`, `calendar_digest`), `schedule_runs` (`3`), and legacy `github_team_scope`/`github_team_repos` (`scope_id = 'default'`), then ran `node db/v3/migrate.mjs` twice | `exit 0` on both upgrade runs (`511ms`, `434ms`). 100% of seeded users/workspaces/credentials/conversations/schedules/runs preserved (`schedules_n=4`, `runs_n=3`, non-destructive `0033` left existing schedule rows unmutated with `sheets_audit_n=0`); `0034` archived `scope_id='default'` GitHub rows (`live_default_gh_scope_n=0`, `archived_default_gh_scope_n=1`, `archived_default_gh_repos_n=1`); `0035` trigger automatically populated `dispatched_config` and `dispatched_config_hash` on newly inserted `sheets_digest` `schedule_runs`. |
| **Migrator Transaction / Lock Observation (`XSVC-RISK-09`)** | Code + runtime inspection of `db/v3/migrate.mjs` + `db/v3/0034_github_workspace_scoped_team_scope.sql` | `db/v3/migrate.mjs` opens a single `BEGIN` + `SELECT pg_advisory_xact_lock(20260929)` before looping over all 47 files, **but** `0034_github_workspace_scoped_team_scope.sql` contains its own explicit `BEGIN; ... COMMIT;`, which commits the outer transaction early and releases `pg_advisory_xact_lock(20260929)` before `0035_sheets_gas_r2_remediation.sql` executes (and causes `migrate.mjs`'s trailing `COMMIT` to be a no-op). Recorded in `07-INHERITED-RISKS-AND-STAGING-GAPS.md` (`XSVC-RISK-09`, `STAGING EVIDENCE GAP`). |

---

## 3. TDD `RED -> GREEN` Backend Integration Defects Found & Fixed in Task C

Before touching any `src/` file, `apps/chat-api/tests/services/schedules/cross-service-combined-gate.test.ts` was executed against Task B's assembled tree (`07c086bf` / `2fa749fc`). The pure `RED` run ([`evidence/task-c-combined-gate-red.txt`](./evidence/task-c-combined-gate-red.txt)) exited `1` (`9 passed | 6 failed` out of `15` tests: `S1`, `S2`, `S6`, `N1`, `N2 & N3`, `N4`), exposing **4 genuine backend integration/authorization defects**. Each was closed with the smallest surgical `GREEN` fix in `7dcd3753742c755f3493ba3f010a7a743c72a074` (`0` new SQL migrations, `0` weakened assertions/timeouts):

| Defect ID | RED Symptom in `cross-service-combined-gate.test.ts` | Root Cause in Assembled Runtime | Minimal Surgical `GREEN` Fix (`7dcd3753`) |
| --- | --- | --- | --- |
| **Defect #1** (`XSVC-RISK-01`) | `S1`, `S2`, `S6` failed on `trello_digest -> telegram` and `calendar_digest -> telegram` (`AUTH_ERROR: Telegram chưa được kết nối cho tài khoản này` -> `paused` / `blocked`) | `AdapterFactory.telegramAdapter` (`apps/chat-api/src/services/adapter-factory.ts:660-666`) requires `context.connections?.telegram`, which `ChatService` populates on interactive turns, **but** both `CalendarDigestRunner` (`calendar-digest-runner.ts:288`) and `TrelloDigestRunner` (`trello-digest-runner.ts:518`) called `getAdapter('telegram', { phase: 'execution', ... })` without `connections.telegram`. | Both runners now load the active personal `telegram` credential via `CredentialRepo`, enforce `config.telegramCredentialId` pin matching in `TrelloDigestRunner`, and pass `connections: { telegram: { credentialId, telegramUserId, username, chatIds } }` to `getAdapter('telegram', ...)`. |
| **Defect #2** (`XSVC-RISK-02`) | `N1` failed: `AdapterFactory.getAdapterForService('sheets', { workspaceMode: 'organization', workspaceId: '' })` returned a cached personal adapter instead of throwing `AUTH_ERROR`, and `ExecutionService` allowed org mode on a conversation with blank `workspace_id` | In `adapter-factory.ts`, `cacheKey` fell back to `context?.workspaceId ?? 'default'` **before** checking `isOrgMode && !workspaceId`, hitting a warm `'default'` cache entry; `personal` mode also did not reject blank `userId` or `service_account` services before cache lookup. In `execution-service.ts`, `getOwnedPlan` / `getLatestExecutionSnapshot` checked `conversation.workspace_id !== workspaceId` without rejecting empty/whitespace `conversation.workspace_id` in `organization` mode. | `adapter-factory.ts` validates non-blank `workspaceId` (in `organization` mode) and non-blank `userId` + `!isServiceAccountService` (in `personal` mode) **before** computing `cacheKey` or checking `adapterCache`. `execution-service.ts` rejects blank `conversation.workspace_id` in `organization` mode with `403 WORKSPACE_ACCESS_DENIED`. |
| **Defect #3** (`XSVC-RISK-03`) | `N4` failed: after warming `AdapterFactory` during planning/read and revoking `service_credentials.status = 'revoked'` (or deleting the personal credential row) immediately before execution, `getAdapterForService(..., { phase: 'execution' })` returned the cached live adapter and sent `1` unauthorized HTTP request | `AdapterFactory.adapterCache` returned warm adapter instances unconditionally without re-checking `CredentialRepo` when `context?.phase === 'execution'`, and workspace `getDecrypted(service, workspaceId)` did not check `record.status === 'active'`. | Tracked `{ id, config }` in `adapterCacheMeta` and added `verifyCachedAdapterActiveForExecution` in `adapter-factory.ts`: whenever `context?.phase === 'execution'`, `AdapterFactory` re-queries `CredentialRepo` (`getPersonalConnectionById` / `getPersonalConnection` / `getById` / `getDecrypted`), evicts cache, and throws `AUTH_ERROR` (`0` outbound HTTP requests) if missing, not `'active'`, or rotated, while preserving non-execution cache hits and `static-guard.test.ts` (`2/2` PASS). |
| **Defect #4** (`XSVC-RISK-04`) | `N2 & N3` failed: deactivating `workspace_members.status = 'removed'` or mutating `conversations.workspace_mode` / `workspace_id` after `approvePlan` but before step dispatch still allowed step 1 (`trello.create_card`) to execute (`1` unauthorized POST) | `PlanRepo.assertSourceDispatchAllowed` (`apps/chat-api/src/db/repositories/plan-repo.ts:260`) checked `conversations.user_id === userId` and `plan_hash`, **but** did not join `users` / `workspace_members` or compare `conversations.workspace_mode` / `workspace_id` against the approved controller's `expectedScope`. | Extended `PlanRepo.assertSourceDispatchAllowed` (and `ExecutionService.buildController` `beforeStepDispatch` caller) to join `users` and `workspace_members` in-transaction and throw `AUTH_ERROR` (`details: { requestSent: false }`, `0` outbound HTTP requests) if `user_status === 'disabled'`, if `workspace_mode === 'organization'` with blank `workspace_id` or `member_status !== 'active'`, or if `workspace_mode`/`workspace_id` drifted from `expectedScope`. |

Also fixed a test-only isolation defect in `apps/chat-api/tests/services/trello-token-manager.test.ts` (moved `createMigratedSchema('trello_refresh_once')` from inside the `5000ms` `it(...)` body to `beforeAll`/`afterAll` without changing any timeout or assertion).

---

## 4. Combined Cross-Service Runtime Matrix (`S1`–`S6`, Negative Auth & Recovery)

Suite: `apps/chat-api/tests/services/schedules/cross-service-combined-gate.test.ts` + child worker `apps/chat-api/tests/helpers/cross-service-scheduler-worker.ts` (`15/15` tests PASS, `0` skipped — [`evidence/task-c-combined-gate-green.txt`](./evidence/task-c-combined-gate-green.txt)).

### 4.1. Fixture Composition (What Is Real vs. What Is Loopback-Simulated)
| Layer / Component | Real Production Code Executed | Loopback / Controlled Test Seam |
| --- | --- | --- |
| **Database & Locks** | Real PostgreSQL 16.15 (`ati-xsvc-v2-taskc-56791`), real SQL migrations `0001..0035` via `node db/v3/migrate.mjs`, real `FOR UPDATE` row locks, `xmin` CAS, `trg_schedule_runs_capture_dispatched_config`, and `sheets_append_leases` fencing tokens | Isolated per-suite schema + disposable container port `56791` |
| **Scheduler & OS Processes** | Real `ScheduleRunner`, `ScheduleService`, `PostgresScheduleStore`, `SheetsDigestRunner`, `TrelloDigestRunner`, `CalendarDigestRunner`, `PostgresSheetsAppendLeaseStore`, and real `child_process.spawn` Node/tsx worker processes killed via `process.kill(pid, 'SIGKILL')` | Deterministic HTTP barrier (`holdSlackSend` / `holdSheetsAppend`) pauses loopback response only *after* child flushes `[XSVC-BARRIER]` IPC proving durable `delivery_started_at IS NOT NULL` or `sheets_append_leases.status = 'dispatched'` |
| **Execution, Auth & Adapters** | Real `ExecutionService`, `ExecutionController`, `StepRunner`, `PlanRepo`, `AdapterFactory`, `CredentialRepo`, `PersonalSheetsAdapter`, `SheetsAdapter`, `PersonalCalendarAdapter`, `TrelloAdapter` (`TrelloOAuthAdapter`), `SlackAdapter`, `TelegramAdapter`, `GmailPersonalAdapter`, `GmailTokenManager`, `TrelloTokenManager` | Real `node:http` loopback server on `127.0.0.1:0` serving Google OAuth2 token refresh, Sheets values/metadata/append, Calendar events/freeBusy, Gmail `messages/send` (`nodemailer` stream/API seam -> loopback HTTP in `CalendarDigestRunner` / `SheetsDigestRunner`), Trello `/1/*`, Slack `/slack/api/*`, and Telegram `/bot*/sendMessage` |

### 4.2. Scenarios `S1`–`S6` Outcomes
| Scenario | Setup & Concurrency / Fault Condition | Verified Runtime Outcome |
| --- | --- | --- |
| **`S1` — Three Simultaneously Due Cross-Service Digests** | `sheets_digest` (v2 -> Slack `C_SHEETS_S1`), `trello_digest` (org workspace -> Telegram `100200300`), and `calendar_digest` (personal -> Gmail `owner@example.com`) all due in the same `ScheduleRunner.tick()` window | **PASS (`3145ms`):** Exactly `3` `schedule_runs` created with distinct `id` and `conv_id`, all `status = 'digest_sent'`. Verified exact provider routing (`1` Slack `chat.postMessage` `ts='1700000100.000101'`, `1` Telegram `sendMessage` `message_id=9101`, `1` Gmail send to `owner@example.com`), pinned credential bindings, distinct conversation message types (`sheets_digest_sent`, `answer` with `trelloDigest` receipt, `calendar_digest_sent`), and zero cross-schedule state or receipt contamination. |
| **`S2` — Two Independent OS Scheduler Child Processes** | Two independent child OS processes (`w1.pid=33948 (exit=0), w2.pid=10340 (exit=0)` in standalone run; `w1.pid=34284 (exit=0), w2.pid=4968 (exit=0)` in 82-file sweep) spawned simultaneously against the same PostgreSQL schema with all 3 due digests | **PASS (`3673ms`):** PostgreSQL row-level locking guaranteed atomic single-winner execution (`1` `schedule_runs` row per schedule, all `'digest_sent'`), bounded provider outbound deliveries (`slack=1`, `telegram=1`, `gmail=1`), intact ownership, and zero duplicate or unsafe retry calls. |
| **`S3` — Pause / Cancel Before vs. After Dispatch Barrier** | (a) Pause `sheets_digest` before outbound claim; (b) Pause `sheets_digest` while Slack HTTP send is in flight after `delivery_started_at` commits and returns valid `ts`; (c) Cancel `sheets_digest` while Slack HTTP socket drops mid-flight after `delivery_started_at` | **PASS (`2761ms`):** (a) Pre-claim pause -> run `'discarded'`, `slackOutbound=0`; (b) Post-claim confirmed receipt -> run `'digest_sent'` preserved with Slack receipt `ts` despite concurrent schedule pause; (c) Post-claim socket drop + cancel -> run `'needs_attention'` (`SHEETS_DELIVERY_UNKNOWN`, `delivery_started_at != null`) preserved rather than overwritten to `'discarded'`; zero impossible external recall claims. |
| **`S4` — Real Deterministic OS Child `SIGKILL` & Restart Fencing** | **`S4a` (Digest Victim):** Child `pid=33456` (`33976` in sweep) commits `delivery_started_at`, pauses on loopback Slack barrier, killed via `process.kill(33456, 'SIGKILL')` (`exitCode=1, signal=null`). Surviving process instantiates fresh store/runner and runs `reconcileScheduleRuns()` + `tick()` + `replanRun()`.<br>**`S4b` (Sheets Append Lease Victim):** Child `pid=32580` (`22160` in sweep) enters durable `sheets_append_leases.status = 'dispatched'` (`fencing_token=1`), killed via `process.kill(32580, 'SIGKILL')` (`exitCode=1, signal=null`). Surviving worker attempts replay, stale-token pre-dispatch check, manual override flags, and provider-verified reconciliation. | **PASS (`6030ms`):**<br>• **`S4a`:** `reconcileScheduleRuns` transitioned run `status='planning'` -> `'needs_attention'` (`SHEETS_DELIVERY_UNKNOWN`), subsequent `tick()` issued `0` replay requests (`slackSendsAfterRestart = 0`), and `replanRun` threw `ScheduleConflict('RUN_NOT_REPLANNABLE')`.<br>• **`S4b`:** Surviving worker blocked with `SHEETS_APPEND_UNKNOWN_OUTCOME_UNRECONCILED` (`0` duplicate append POSTs) even after lease TTL expiry; stale pre-dispatch `fencing_token` threw `SHEETS_APPEND_LEASE_LOST` (`0` POSTs); manual override flags (`manualOperatorDecision`, `acknowledgeDuplicateRisk`, `confirmDuplicateRisk`) rejected fail-closed; provider-verified reconciliation with generation CAS cleanly resolved the lease. |
| **`S5` — Credential Revocation Immediately Pre-Dispatch** | Revoked `mysheets` personal connection, `trello` org `service_credentials` (`status='revoked'`), and `mycalendar` personal connection immediately before `ScheduleRunner.tick()` | **PASS (`763ms`):** `unauthorizedOutbound === 0` (`calls.length === 0` across Google OAuth, Sheets, Trello, Calendar, Slack, Telegram, Gmail); all 3 schedules transitioned to `'paused'` and runs to `'blocked'` / skipped with zero provider traffic. |
| **`S6` — Mixed-Batch Cross-Service Fault Isolation + Healthy Control** | Single `tick()` with 4 due schedules: (1) Sheets read hangs -> `AbortSignal` timeout (`150ms` adapter timeout); (2) Trello digest receives HTTP 200 `{ ok: true, channel: 'C_OPS', ts: 'undefined' }` from Slack; (3) Calendar digest receives paginated page 1 (`20` items + `nextPageToken`, page 2 `503`) -> incomplete coverage -> Telegram; (4) Healthy Calendar -> Gmail control | **PASS (`1658ms`):** (1) Loopback server observed real `AbortSignal` socket close (`sheetsAbortedObserved === true`), `0` Slack sends, run `'failed'`/`'blocked'` without poisoning peers; (2) Trello run marked `'needs_attention'` (`TRELLO_DELIVERY_UNKNOWN`) with `delivery_started_at != null`; (3) Calendar incomplete-coverage run delivered truthful `'độ phủ: PARTIAL'` warning to Telegram without dropping page-1 events; (4) Healthy Calendar -> Gmail control committed `'digest_sent'` cleanly. |

### 4.3. Combined Negative Authorization Matrix (`N1`–`N7`)
> **Scope Disclaimer:** These tests prove fail-closed behavior **within the tested execution, `AdapterFactory`, and adapter paths listed below**; they do **not** constitute a universal security claim across untested endpoints or external infrastructure.

| Case | Negative Auth Vector Tested | Authorized Metadata Prechecks | Unauthorized Outbound Requests | Result |
| --- | --- | :---: | :---: | --- |
| **`N1`** | Blank/whitespace `workspaceId` (`''`, `'   '`) in `organization` mode across `AdapterFactory` (cold & warm cache) and `ExecutionService` | `0` | **`0`** | **PASS** (`AUTH_ERROR` / `403 WORKSPACE_ACCESS_DENIED`) |
| **`N2`** | Workspace membership revocation (`workspace_members.status = 'removed'`), conversation `workspace_mode`/`workspace_id` drift, and conversation `user_id` substitution between `approvePlan` and step dispatch | `0` | **`0`** | **PASS** (`PlanRepo.assertSourceDispatchAllowed` -> `AUTH_ERROR`, `requestSent: false`) |
| **`N3`** | Personal `credentialId` UUID substitution to another user's Google/Trello credential between preview/approval and execution | `0` | **`0`** | **PASS** (`AUTH_ERROR`, `0` HTTP calls) |
| **`N4`** | Immediate pre-dispatch credential revocation (`service_credentials.status = 'revoked'` & deleted personal connection) against a warm `AdapterFactory` instance (`phase: 'execution'`) | `0` | **`0`** | **PASS** (cache evicted, `AUTH_ERROR`, `0` HTTP calls) |
| **`N5`** | Trello path traversal (`../../members/me/tokens`, `card/evil`, `board?x=1`), out-of-`allowedBoards` `get_card` / `search_cards` / `create_card`, and non-member board `create_card` | Traversal & out-of-scope `create_card`: `0`.<br>Out-of-scope `get_card` / `search_cards`: **`1`** minimal `GET /1/cards/:id?fields=id,idBoard` or `GET /1/lists/:id?fields=id,idBoard` to resolve parent `idBoard`.<br>Non-member `create_card`: **`1`** `GET /1/boards/:id/memberships`. | **`0`** (`0` checklist reads, `0` list-card reads, `0` card-write `POST`s) | **PASS** |
| **`N6`** | Out-of-allowlist `spreadsheetId` on `PersonalSheetsAdapter` (`mysheets.read_range`, `mysheets.append_rows`) and `SheetsAdapter` (`sheets.read_range`, `sheets.append_rows`) | `0` | **`0`** | **PASS** |
| **`N7`** | Out-of-allowlist `calendarId` on `PersonalCalendarAdapter` (`mycalendar.list_events`, `mycalendar.create_event`) | `0` | **`0`** | **PASS** |

### 4.4. Malformed Receipts, Partial Writes, Manual Recovery & Calendar Truthfulness
- **Execution Receipt & Compound-Write Safety:** Verified in `cross-service-combined-gate.test.ts` that `SlackAdapter.sendMessage` receiving `{ ok: true, channel: 'C_1', ts: {} }` (or `12345` / `'undefined'` / `'null'` / missing `channel`) and `TrelloOAuthAdapter` `trello.add_checklist` failing on item 2 after checklist creation (`partialWrite: true`) transition the step to `'unknown'`, transition `ExecutionService.getExecutionStatus` to `'reconciliation_required'`, and reject `ExecutionController.retryStep` (`0` duplicate checklist or Slack writes).
- **Manual Delivery Recovery (`ScheduleService.resolveRunDelivery`):** Verified cross-user rejection, missing `confirmDuplicateRisk` rejection (`DUPLICATE_RISK_CONFIRMATION_REQUIRED`), `SCHEDULE_PAUSED` and `CONFIG_CHANGED_SINCE_RUN` blocks on `retry_new_run`, immutable `run.dispatched_config` preservation on `mark_sent` after post-run `schedule.digest_config` mutation (`GAS-08` ∩ `TRELLO-AUDIT-10`), and single-use CAS (`DELIVERY_ALREADY_RESOLVED` on second call).
- **Calendar Coverage, Half-Open `[start, end)` Free-Slots & IANA Timezone:** Verified `ChatService` planning conflict precheck suppresses `"Không phát hiện trùng lịch"` when secondary calendar coverage is incomplete (`nextPageToken` present), `PersonalCalendarAdapter` `find_free_slots` preserves half-open `[start, end)` boundaries across `America/New_York` DST (`2026-03-08`), and `create_event`/`update_event` preserve explicit IANA `timeZone` on outbound JSON bodies.

---

## 5. Proven Invariants vs. Explicit Limitations

| Category | Proven Within Tested Scope (`INDEPENDENTLY VERIFIED`) | Explicit Architectural / Operational Limitation |
| --- | --- | --- |
| **Delivery Semantics** | Single-winner PostgreSQL `schedule_runs` claim across 2 OS processes; durable `delivery_started_at` before outbound HTTP; malformed HTTP 200 `{ ok: true }` receipts & post-claim `SIGKILL` crashes fail closed to `'needs_attention'` (`*_DELIVERY_UNKNOWN`) with **zero automatic replay** | **Not provider-level "exactly-once" delivery:** Slack `chat.postMessage`, Telegram `sendMessage`, and Gmail `messages.send` do not expose cross-crash idempotency keys in this flow; if the process dies or drops TCP after the provider commits the message, the message may have been delivered once externally while Planora records `'unknown'` / `'needs_attention'` for human reconciliation. |
| **Pause / Cancel Semantics** | Pre-claim pause/cancel prevents dispatch (`outbound = 0`, `'discarded'`); post-claim pause/cancel never erases a confirmed receipt or masks an `'unknown'` state | **No external message recall:** Pausing or cancelling a schedule cannot unsend or delete a Slack/Telegram/Gmail message already accepted by the provider. |
| **Sheets Append Lease (`GAS-10`)** | Monotonic `BIGINT` `fencing_token` blocks stale pre-dispatch workers with `0` POSTs; `SIGKILL` during `'dispatched'` transitions to durable `'unknown_outcome'` surviving TTL expiry; programmatic provider-verified reconciliation uses generation CAS | **No manual UI/API force-override:** `PostgresSheetsAppendLeaseStore` intentionally rejects manual override flags (`manualOperatorDecision`, `acknowledgeDuplicateRisk`, `confirmDuplicateRisk`) fail-closed; if automated read-back cannot match the sentinel row, recovery requires external spreadsheet inspection. |
| **Token Refresh Single-Flight** | In-process concurrent 401/expiry refreshes coalesce to `1` token endpoint POST (`GmailTokenManager`, `TrelloTokenManager`) | Single-flight refresh maps in `GmailTokenManager` and `TrelloTokenManager` are per-Node-process `Map`s (not cross-process DB leases like `JiraTokenManager`); documented in `07` (`XSVC-RISK-07`, `XSVC-RISK-08`). |

---

## 6. Complete Backend Command, Exit Code, Count & Failure Classification Log

Sanitized raw logs: [`evidence/task-c-layer-a-workspaces.txt`](./evidence/task-c-layer-a-workspaces.txt), [`evidence/task-c-postfix-api-suites.txt`](./evidence/task-c-postfix-api-suites.txt), [`evidence/task-c-combined-gate-red.txt`](./evidence/task-c-combined-gate-red.txt), [`evidence/task-c-combined-gate-green.txt`](./evidence/task-c-combined-gate-green.txt), [`evidence/task-c-migrations.txt`](./evidence/task-c-migrations.txt).

| Command Executed | Exit Code | Files / Tests / Skips | Failure Classification (if any) |
| --- | :---: | --- | --- |
| `npm run typecheck:v3` | `0` | `@wap/chat-api` + `@wap/chat-web` (`0` TS errors) | None |
| `npx vitest run evaluations/generic-plumbing/static-guard.test.ts` | `0` | `1` file, `2` passed, `0` skipped | None |
| `npm test --workspace=@wap/tool-schemas` | `0` | `27` files, `593` passed, `0` skipped | None |
| `npm test --workspace=@wap/tool-adapters` | `0` | `27` Vitest files (`712` tests) + `32` `node --test` probe tests = `744` passed, `0` skipped | None |
| `npm test --workspace=@wap/planner` | `0` | `40` files, `567` passed, `0` skipped | None |
| `npm test --workspace=@wap/executor` | `0` | `7` files, `56` passed, `0` skipped | None |
| `npm run test:eval:v3` *(with disposable `DATABASE_URL` + `ALLOW_ISOLATED_TEST_PORT=1`)* | `0` | `31` files, `500` passed, `1` skipped *(pre-existing conditional skip in `evaluations`)* | None *(an initial attempt without `DATABASE_URL` exited `1` on 2 DB-backed eval suites — `environmental`, resolved immediately by setting `DATABASE_URL`)* |
| `node db/v3/migrate.mjs` *(fresh DB ×3 + `<=0032 -> 0035` upgrade ×2 + main disposable DB)* | `0` | `47` SQL files applied idempotently across all 6 invocations | None |
| **Pure `RED` Baseline:** `npx vitest run apps/chat-api/tests/services/schedules/cross-service-combined-gate.test.ts` *(before `src/` fixes)* | `1` *(expected RED)* | `1` file, `9` passed, `6` failed (`15` total) | **`integration` (`INTEGRATION-INTRODUCED`):** Exposed Defects `#1`..`#4` above; all 4 fixed in `7dcd3753` |
| **Post-Fix `GREEN` Combined Gate:** `npx vitest run apps/chat-api/tests/services/schedules/cross-service-combined-gate.test.ts` | `0` | `1` file, `15` passed, `0` skipped (`42.75s`) | None |
| **Unthrottled 12-Worker Full `@wap/chat-api` Diagnostic Run:** `npm test --workspace=@wap/chat-api` *(276 files at default 12 Vitest workers on WSL2 Docker)* | `1` | `162` files passed, `114` files hit `beforeAll` `10000ms` DDL hook timeout (`1232` passed, `9` failed, `1484` skipped) | **`environmental`:** 12 parallel workers simultaneously running 47-file `createMigratedSchema` DDL + `0a`/`0b` `pg_advisory_xact_lock(20260929)` contended on WSL2 PostgreSQL catalog locks, and `ALLOW_ISOLATED_TEST_PORT=1` tripped `jira-workspace-migration.test.ts`'s port-guard unit assertion (`expect(validateDatabaseUrl(...)).toThrow(/56534/)`). Zero post-fix behavioral regressions: `slack-proposals.test.ts` passed `8/8` (`exit 0`) when re-run without 12-worker contention, and all 82 affected suites passed `800/800` below. |
| **Post-Fix 82-File Affected `@wap/chat-api` Regression Sweep (`--maxWorkers=2` + `public` schema migrated):** all `calendar*`, `mycalendar*`, `trello*`, `sheets*`, `mysheets*`, `execution*`, `plan*`, `adapter-factory*`, `workspace-isolation*`, `workspaces-routes*`, `slack-proposals*`, `slack-write-safety*`, `gmail*`, `schedule-runner*`, `schedule-routes*`, `digest-scope-guard*`, and `cross-service-combined-gate.test.ts` | `0` | **`82` files, `800` passed, `0` failed, `0` skipped** (`80/82` on unmigrated `public` + `2/2` `calendar-extension` & `sheets-extension` immediately after running `node db/v3/migrate.mjs` on `public`, matching CI `.github/workflows/v3-check.yml`) | None |

---

## 7. Frontend Unit & Real Chromium E2E Evidence — `[PENDING TASK D — NOT RUN]`

Reserved for **Task D** owner (`apps/chat-web/**`, `scripts/test-v3-browser.mjs`, `npm test --workspace=@wap/chat-web`, Calendar `C1/C2` Chromium assertions in `apps/chat-web/tests/browser/mycalendar.spec.ts`, and targeted Chromium scenario groups). Task C made **zero** edits to `apps/chat-web/**` or `scripts/test-v3-browser.mjs`.

---

## 8. Uninterrupted Full `npm run check`, All-25 Browser Gate & Exact-Head CI — `[PENDING TASK E — NOT RUN]`

Reserved for **Task E** owner (full `npm run check`, uninterrupted 25-scenario `npm run test:browser:v3`, Draft PR publication, and exact-head GitHub Actions `v3 check` single job `v3` verification).
