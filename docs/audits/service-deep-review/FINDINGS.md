# Consolidated Audit Findings Register (Waves 1, 2, 3 & 4 — Complete)

- **Repository:** `VinhDat267/ATI_Project`
- **Baseline Commit SHA (`origin/main`):** `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`
- **Audit Branch:** `independent_service_audit` (`0` product code changes; documentation-only Draft PR `#298`)
- **Total Active Findings:** `30` (`0` P0, `9` P1, `20` P2, `1` P3)

## Evidence Classification Taxonomy
- **`CODE_TRACE_CONFIRMED`:** Proven directly by static source code, SQL migration schema, and TypeScript contract trace at baseline SHA `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`.
- **`INTEGRATION_REPRODUCED`:** Proven by both static code trace and deterministic runtime execution in an isolated PostgreSQL (`localhost:56534/ati_v3`, private test schema via `createIsolatedTestSchema`) + mock HTTP provider transport harness (`0` production side effects). The complete, sanitized 14-test reproduction package source code and self-extracting runner are embedded verbatim in [`EVIDENCE-AND-TEST-RESULTS.md` §6.6](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/docs/audits/service-deep-review/EVIDENCE-AND-TEST-RESULTS.md#L670) for independent re-execution.
- **`NOT_TESTED` (Live External Provider):** Requires live external third-party provider infrastructure (e.g., live Google Docs/Drive/Sheets API mutations, Atlassian/Notion/Slack production OAuth servers, or inbound webhook delivery) that is strictly prohibited under Audit Rule 4 (no live credential writes). No live external data loss or mutation was triggered during this audit.
- **`PRODUCT_GAP`:** Feature, cross-service handoff, or UX capability is not implemented or only partially wired by current architecture/roadmap state (distinguished from regressions in implemented code).

## Parallel Execution Guard: Baseline `main` vs. Unmerged Parallel PR Tracks
To prevent cross-stream confusion or file-ownership collisions with parallel engineering tracks, this audit strictly distinguishes code on `origin/main` (`08c8d8c5e7bf12625857ac3496fb96ec3914e34f`) from open unmerged PRs:

| Scope / PR Stream | Git Reference / PRs | Status on `origin/main` (`08c8d8c5...`) | Audit & Ownership Boundary Rule |
|---|---|---|---|
| **Baseline Production Tree** | `origin/main` (`08c8d8c5e7bf12625857ac3496fb96ec3914e34f`) | **Active Baseline** | All findings (`AUD-W1-01` .. `AUD-W4-07`), line numbers, and reproduction tests are verified against this exact commit. Findings are only marked `RESOLVED` after fixes are merged to `main` and regression-verified on the new `HEAD`. |
| **Track 1 — Google Sheets Scheduled Digest Gate A (`RMD-00 → RMD-04`)** | Open Draft PRs `#289` (`RMD-00` baseline), `#290` (`RMD-01` schemas), `#291` (`RMD-02` bounded reader), `#292` (`RMD-03` `0033` DDL & runner), `#293` (`RMD-04` v2 candidate, `e8e7ce31...`), `#294` (`RMD-04` reauthorize API), `#295` (`RMD-04` delivery recovery API), `#297` (`PR-6` v1-to-v2 migration & CAS rollback tool), `#299` (`PR-7` frontend recovery UI) | **UNMERGED (Out of Scope)** | Excluded from Wave 4 (`W4-A` audits interactive `sheets`/`mysheets` only). Per `gh pr diff --name-only`, Gate A owns `personal-sheets-adapter.ts` / `sheets-adapter.ts` / `sheets-shared.ts` (`PR #291`), `0033_sheets_digest_v2_remediation.sql` (added under `db/v3/` in `PR #292`) / `schedule-runner.ts` (`PR #292`), `gmail-tools-runtime.ts` / `chat-service.ts` (`PR #293`), and `schedule-routes.ts` (`PR #294`, `#295`) until Gate A integration is approved. |
| **Track 2 — Trello Product Review (`Gate 0`)** | Open Draft PR `#296` (`c1212b34...`, `test/trello-gate0-evidence`) | **UNMERGED (Parallel Track)** | Owns Trello scope & `trello_digest` remediation (`RMD-W2-02`, `RMD-W2-03`). |
| **Track 3 — Notion Product Review** | Open Draft PR `#189` (`codex/notion-oauth`) & Notion backlog | **UNMERGED (Parallel Track)** | Owns Notion OAuth catalog exposure (`RMD-W3-02`), `NotionAdapter` abort details (`RMD-W3-03`), and `notion_digest` delivery (`RMD-W1-03`). |
| **Track 4 — Calendar / Gmail Product Review** | Open Draft PR `#182` (`codex/gmail-04-enable-flags`) & Calendar/Gmail backlog | **UNMERGED (Parallel Track)** | Owns `gmail.batch_modify_threads` chunking (`RMD-W1-04`), `CalendarAdapter` abort details (`RMD-W1-02`), and `calendar_digest` scoping (`RMD-W1-03`). |
| **Independent Deep Service Audit (Waves 1–4)** | Branch `independent_service_audit` / Draft PR `#298` | **Audit-Only Docs PR** | Modifies only `docs/audits/service-deep-review/*.md`; zero overlap with production code or test files. |

---

## 1. Master Findings Summary Table

| Finding ID | Wave | Service(s) | Severity | Verification Status | Title | Remediation ID |
|---|---|---|---|---|---|---|
| `AUD-W1-01` | W1-A | `gmail` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | `gmail.batch_modify_threads` sequential loop lacks partial-progress reporting on mid-batch failure | `RMD-W1-04` |
| `AUD-W1-02` | W1-A | `telegram`, `telegram_digest` | **P1** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `TelegramBotClient.getUpdates` advances `offset` and drains Telegram queue before `TelegramAdapter.read_messages` runs | `RMD-W1-01` |
| `AUD-W1-03` | W1-A | `telegram` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | `TelegramAdapter.slot` and `request` omit `details: { requestSent: false }` on pre-dispatch abort | `RMD-W1-02` |
| `AUD-W1-04` | W1-A | `telegram` | **P3** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | Legacy manual Bot Token fallback branch in `AdapterFactory.telegramAdapter` is dead code behind HTTP `410 Gone` | `RMD-W1-06` |
| `AUD-W1-05` | W1-B | `slack` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | `SLACK_EXTENDED_TOOLS` (`slack.read_messages`) omitted from `ALL_TOOLS` and `getConfiguredToolCatalog` | `RMD-W1-05` |
| `AUD-W1-06` | W1-B | `slack` | **P2** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `SlackAdapter.request` omits `details: { requestSent: false }` on pre-dispatch slot wait (marking un-sent write `unknown`) and lacks explicit `requestSent` tracking | `RMD-W1-02` |
| `AUD-W1-07` | W1-B | `myslack`, `slack` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | `SlackProposalService` (`tryDecryptCredentialConfig`) includes hardcoded development fallback keys after `ENCRYPTION_KEY` | `RMD-W1-06` |
| `AUD-W1-08` | W1-B | `myslack`, `slack` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | `SlackProposalService.prepare` attaches unverified DB scope to proposal metadata (revalidated at execution) | `RMD-W1-06` |
| `AUD-W1-09` | W1-C | `calendar_digest`, `telegram`, `slack` | **P1** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `createCalendarDigestExecutor` omits `connections.telegram` and `workspaceMode`/`workspaceId`, failing deterministically | `RMD-W1-03` |
| `AUD-W1-10` | W1-C | `calendar_digest`, `slack` | **P1** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `calendar-digest-candidate.ts` queries shared Slack credentials without `workspace_id`, exposing foreign Org `channelId` metadata | `RMD-W1-03` |
| `AUD-W1-11` | W1-C | `calendar` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | `CalendarAdapter.request` omits `details: { requestSent: false }` on pre-dispatch token refresh and slot-wait failures | `RMD-W1-02` |
| `AUD-W2-01` | W2-B | `myjira_digest`, `myjira` | **P1** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `myjira_digest` fails at 3 layers: unwired in `ChatService`/`ScheduleRunner`/`server.ts`, invalid `maxResults: 20`, and output schema mismatch | `RMD-W2-01` |
| `AUD-W2-02` | W2-A | `trello_digest`, `trello` | **P1** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `trello_digest` candidate and runner query singleton `scope_id = 'default'` instead of `personal:<userId>` / `<workspaceId>` and omit `connections.telegram` | `RMD-W2-02` |
| `AUD-W2-03` | W2-A | `trello` | **P2** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `TrelloWriteTools.addChecklist` partial item failure (`RATE_LIMIT` 429) marks step `failed` instead of `unknown`, creating duplicate checklists on `retryStep` | `RMD-W2-03` |
| `AUD-W2-04` | W2-B | `myjira` | **P2** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `GET /api/services` reports `myjira` as `connected: true` in Personal Mode while `AdapterFactory.myjiraAdapter` rejects Personal Mode | `RMD-W2-04` |
| `AUD-W2-05` | W2-B | `myjira` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | `PersonalJiraHttpTransport.request` omits `details: { requestSent: false }` on pre-dispatch aborts and pre-write `GET` verification failures (`transition_issue`, `update_issue`, `add_comment`), marking un-sent write steps `unknown` | `RMD-W2-05` |
| `AUD-W2-06` | W2-B | `myjira` | **P2** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `JiraOAuthRepo.saveSitesGrant` and `syncSites` do not revoke active `jira_authorization_leases` or bump `identity_version` when a site is deselected | `RMD-W2-04` |
| `AUD-W2-07` | W2-B | `jira` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | `JiraAdapter.request` omits `details: { requestSent: false }` on pre-dispatch abort (marking un-sent write `unknown`) | `RMD-W2-05` |
| `AUD-W3-01` | W3 | `github`, `github_digest` | **P1** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `GitHubTeamRepo` hardcodes singleton `scope_id = 'default'`, causing cross-tenant admin scope overwrite, repo `fullName` metadata exposure to any authenticated user, and false-healthy status | `RMD-W3-01` |
| `AUD-W3-02` | W3 | `notion_digest`, `telegram` | **P1** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `createNotionDigestRunner` omits `connections.telegram` when calling `getAdapter('telegram', { phase: 'execution' })`, failing deterministically | `RMD-W1-03` |
| `AUD-W3-03` | W3 | `github_digest`, `notion_digest`, `trello_digest`, `slack` | **P2** | `CONFIRMED (INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED)` | Digest candidates and runners call `getAdapter('slack', ...)` without `workspaceMode`/`workspaceId`, breaking Organization Slack digest delivery | `RMD-W1-03` |
| `AUD-W3-04` | W3 | `github`, `notion` | **P2** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `GitHubAdapter.request` and `NotionAdapter.request` omit `details: { requestSent: false }` on pre-dispatch abort, causing `StepRunner` to mark un-sent write steps `unknown` | `RMD-W3-03` |
| `AUD-W3-05` | W3 | `notion` | **P2** | `CONFIRMED (INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED)` | Notion OAuth (`notion_connections` & `NOTION_OAUTH_TOOLS`) is omitted from `GET /api/services`, `ALL_TOOLS`, `getConfiguredToolCatalog`, `runner.ts` static `catalog` Map, and sandbox personal-OAuth policy | `RMD-W3-02` |
| `AUD-W4-01` | W4-A | `mysheets`, `sheets` | **P1** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `mysheets` with `0` selected spreadsheets (`scope_required`) blacks out Organization shared `sheets` catalog, and `PersonalSheetsAdapter` Drive/Docs tools (`move_drive_file`, `append_doc_text`, `get_doc`) bypass `allowedScope` + overwrite Google Docs as `text/plain` | `RMD-W4-01` |
| `AUD-W4-02` | W4-A | `sheets`, `mysheets` | **P2** | `CONFIRMED (INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED)` | Shared `SheetsAdapter` omits `details: { requestSent: false }` on pre-write `GET` failure (yielding false `unknown` state), `append_rows` (`onDuplicate: 'update'`) / `create_sheet` execute non-atomic two-POST mutations that reset `writeDispatched`, and `A1:Z500` caps scans at 500 rows | `RMD-W4-02` |
| `AUD-W4-03` | W4-A | `sheets` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | `SHEETS_EXTENDED_TOOLS` (`search_rows`, `aggregate_rows`, `update_rows`, `delete_rows`, `create_sheet`) omitted from `ALL_TOOLS` / `GET /api/services` and missing `buildSystemPrompt` rules when `sheets` (not `mysheets`) is active | `RMD-W4-03` |
| `AUD-W4-04` | W4-B/C | `mysheets`, `sheets`, `planner` | **P1** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `REPORT_SOURCE_TOOLS` omits `mysheets.search_rows`, `sheets.search_rows`, and `sheets.aggregate_rows` (causing `validatePlan` to reject search-based spreadsheet reports), and mixed report + work-item plans (`github`/`jira`/`myjira`/`trello`) trap users in an unresolvable clarification loop | `RMD-W4-04` |
| `AUD-W4-05` | W4-B/C | `planner`, `chat-api` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | `ReportArtifactStore` stores `ReportArtifact` entries solely in an unbounded in-memory `Map` with no database persistence or TTL eviction, breaking plan approval (`409 Conflict`) across server restarts or multi-replica routing | `RMD-W4-05` |
| `AUD-W4-06` | W4-B/C | `executor`, `planner` | **P2** | `CONFIRMED (INTEGRATION_REPRODUCED)` | `validatePlan` accepts bracket array indexing (`{ "$ref": "step_1.output[0].id" }`) on array-output tools, but Executor `resolveRef` (`resolver.ts:6-42`) splits strictly on `.` and throws `Property 'output[0].id' not found` at runtime | `RMD-W4-06` |
| `AUD-W4-07` | W4-C | `chat-api` | **P2** | `CONFIRMED (CODE_TRACE_CONFIRMED)` | Non-`myjira` `PlanRepo.approvePlan` / `claimRecovery` SQL CAS omits `users.status = 'active'` and `workspace_members.status = 'active'` verification, and in-memory `ExecutionService.continueStep` (`reuseController === true`) skips `claimRecovery` for non-`myslack` plans | `RMD-W4-07` |

---

## 2. Wave 1 Detailed Findings (`AUD-W1-01` → `AUD-W1-11`)

### `AUD-W1-01` (P2) — `gmail.batch_modify_threads` Sequential Loop Lacks Partial-Progress Reporting
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`packages/tool-schemas/src/gmail.ts:75-78`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/gmail.ts#L75-L78) (`gmail.batch_modify_threads`)
  - [`packages/tool-adapters/src/gmail/gmail-adapter.ts:49-65, 125-135, 170-174`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/gmail/gmail-adapter.ts#L125-L135)
- **Technical Root Cause:**
  `gmail.batch_modify_threads` iterates sequentially over `threadIds` (up to 50 threads), issuing `POST /users/me/threads/{id}/modify` via `request()`. Once thread 1 dispatches (`writeDispatched = true` at line 63), if thread $k > 1$ fails with 429/5xx or network timeout, the `catch` block at lines 170–174 rethrows `e` without `details: { requestSent: false }` and without attaching `succeededThreadIds` / `failedThreadId`. `StepRunner` marks the entire step `unknown` without surfacing which threads were already modified.
  *(Note: Gmail REST API only provides message-level `users.messages.batchModify`, not `users.threads.batchModify`; remediation must record per-thread partial progress in `e.details` rather than assuming a non-existent thread batch endpoint.)*

---

### `AUD-W1-02` (P1) — `TelegramBotClient.getUpdates` Advances Offset and Drains Queue Before `TelegramAdapter.read_messages` Runs, While `projectTelegramUpdate()` Strips Ordinary Message Text
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED)` (Case 1 in deterministic reproduction harness)
- **Source References:**
  - [`apps/chat-api/src/services/telegram/bot-client.ts:188-204`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/telegram/bot-client.ts#L188-L204)
  - [`apps/chat-api/src/services/telegram/update-inbox.ts:13-46`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/telegram/update-inbox.ts#L13-L46)
  - [`apps/chat-api/src/db/repositories/telegram-update-repo.ts:7-52`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/telegram-update-repo.ts#L7-L52)
  - [`packages/tool-adapters/src/telegram/telegram-adapter.ts:109-181`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/telegram/telegram-adapter.ts#L109-L181)
- **Technical Root Cause:**
  1. **Competing `getUpdates` Offset Race (`INTEGRATION_REPRODUCED`):** When a user discovers chats via `TelegramBotClient.getUpdates` (`GET /api/connections/telegram/chats`), `TelegramBotClient` polls via `TelegramUpdateStore` (`telegram_update_inbox`) and advances `offset = maxUpdateId + 1` on the next call, which permanently acknowledges and deletes all updates `< offset` on Telegram's Bot API server. Meanwhile, `TelegramAdapter.read_messages` (`telegram-adapter.ts:128-134`) calls raw `POST /bot<token>/getUpdates` directly against Telegram's API, receiving `[]` for all previously acknowledged messages.
  2. **Sanitized Projection Strips Ordinary Message Content (`CODE_TRACE_CONFIRMED`):** In [`update-inbox.ts:13-41`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/telegram/update-inbox.ts#L13-L41), `projectTelegramUpdate(update)` explicitly strips all ordinary message text (`/** Minimize before persistence: no ordinary message text or raw pairing state. */`), retaining only `update_id`, `/start ati_<token>` `pairingStateHash` + sender profile (`lines 18-31`), and group/supergroup/channel chat header metadata (`id, type, title, username` at `lines 32-39`) before persisting to `telegram_update_inbox`. Consequently, simply reading `telegram_update_inbox` as-is cannot recover message text for `telegram.read_messages` or `telegram_digest` without first introducing an explicit consent, content-minimization, retention, privacy, and ingestion contract (see `RMD-W1-01`).

---

### `AUD-W1-03` (P2) — `TelegramAdapter.slot` and `request` Omit `details: { requestSent: false }` on Pre-Dispatch Abort
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`packages/tool-adapters/src/telegram/telegram-adapter.ts:250-256, 269-318`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/telegram/telegram-adapter.ts#L250-L318)
  - [`packages/executor/src/runner.ts:41-66, 152-173`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/runner.ts#L152-L173)
- **Technical Root Cause:**
  If `signal` aborts during rate-limiter `slot()` wait (`telegram-adapter.ts:250-256`) or at the top of `request()` (`line 275`) before `fetchFn` is invoked, `TelegramAdapter` throws `StepError('TIMEOUT', 'Telegram request aborted', true)` without `details: { requestSent: false }`. In `StepRunner.executeStep` (`runner.ts:157-160`), `classifyErrorCategory` (`lines 41-66`) maps `'TIMEOUT'` to `'NETWORK'`, and `isWrite && err?.details?.requestSent !== false && (category === 'NETWORK' || category === 'SERVER_ERROR' || category === 'UNKNOWN')` evaluates to `true`, marking `telegram.send_message` as `status: 'unknown'` even though no HTTP request was sent.

---

### `AUD-W1-04` (P3) — Legacy Manual Bot Token Branch in `AdapterFactory.telegramAdapter` Is Dead Code Behind HTTP `410 Gone`
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`apps/chat-api/src/routes/services-routes.ts:383-412, 432`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L383-L432)
  - [`apps/chat-api/src/services/adapter-factory.ts:679-702`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L679-L702)
- **Technical Root Cause:**
  `services-routes.ts:383-412` blocks `POST /api/services/telegram/credentials` with HTTP `410 Gone` (and line `432` includes `'telegram'` in `isPersonalOAuth`). The shared-credential fallback branch at `adapter-factory.ts:679-702` is unreachable for new connections and should be removed or gated behind an explicit migration cleanup.

---

### `AUD-W1-05` (P2) — `SLACK_EXTENDED_TOOLS` (`slack.read_messages`) Omitted from `ALL_TOOLS` and `getConfiguredToolCatalog`
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`packages/tool-schemas/src/slack.ts:81-132`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/slack.ts#L81-L132)
  - [`packages/tool-schemas/src/index.ts:47, 77-92`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/index.ts#L47-L92)
  - [`apps/chat-api/src/services/registered-services.ts:71-108`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/registered-services.ts#L71-L108)
  - [`packages/planner/src/search.ts:154-167`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/search.ts#L154-L167)
- **Technical Root Cause:**
  `slack.read_messages` is defined in `SLACK_EXTENDED_TOOLS` (`slack.ts:81-132`), mapped in `SLACK_EXTENDED_TOOL_MAP` (`packages/tool-schemas/src/index.ts:77-79`, checked inside `getToolDefinition` at `lines 81-92`), and implemented in `SlackAdapter.readMessages` (`slack-adapter.ts:211-244`). However, `ALL_TOOLS` in `packages/tool-schemas/src/index.ts:47` only spreads `SLACK_TOOLS`. As a result, `slack.read_messages` is omitted from `getConfiguredToolCatalog` (`registered-services.ts:71-108`), `GET /api/services` (`services-routes.ts:576`), `backupPlanner` (`server.ts:576`, where `prepareSearchCall` at `packages/planner/src/search.ts:154-167` rejects tools not in the planner's catalog), and `StepRunner`'s static `catalog` Map (`runner.ts:16-18`).

---

### `AUD-W1-06` (P2) — `SlackAdapter.request` Omits `details: { requestSent: false }` on Pre-Dispatch Abort and Lacks Explicit `writeDispatched` Tracking
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 2 in deterministic reproduction harness)
- **Source References:**
  - [`packages/tool-adapters/src/slack/slack-adapter.ts:24-73, 187-209`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/slack/slack-adapter.ts#L24-L73)
  - [`packages/executor/src/runner.ts:41-66, 152-173`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/runner.ts#L152-L173)
- **Technical Root Cause:**
  1. When `signal` is aborted during `rateLimiter.waitForSlot` (`slack-adapter.ts:25-27`) before `fetchFn` is called, `SlackAdapter` throws `StepError('TIMEOUT', ..., true)` without `details: { requestSent: false }`. Because `StepRunner.executeStep` (`runner.ts:157-160`) checks `isWrite && err?.details?.requestSent !== false && (category === 'NETWORK' || category === 'SERVER_ERROR' || category === 'UNKNOWN')` (with `'TIMEOUT'` mapped to `'NETWORK'` by `classifyErrorCategory` at `lines 41-66`), `slack.send_message` is falsely marked `status: 'unknown'` even though `fetchFn` was never called.
  2. In `SlackAdapter.request` (`lines 43-50`), any `fetchFn` exception throws `new StepError('NETWORK', err.message, true)` without explicit `writeDispatched` / `details: { requestSent }` metadata.

---

### `AUD-W1-07` (P2) — `SlackProposalService` (`tryDecryptCredentialConfig`) Includes Hardcoded Dev Fallback Keys
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`apps/chat-api/src/services/slack/slack-proposal-service.ts:31-53`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/slack/slack-proposal-service.ts#L31-L53)
- **Technical Root Cause:**
  `tryDecryptCredentialConfig` in `SlackProposalService` (`lines 31-53`) prioritizes `this.encryptionKey` and `process.env.ENCRYPTION_KEY`, so production decryption works normally when `ENCRYPTION_KEY` is set. However, it also appends hardcoded development keys (`'01234567890123456789012345678901'` and `'0123456789abcdef0123456789abcdef'`) as fallback decryption candidates, which should be removed in production builds.

---

### `AUD-W1-08` (P2) — `SlackProposalService.prepare` Attaches Unverified Scope to Proposal Metadata
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`apps/chat-api/src/services/slack/slack-proposal-service.ts:182-232`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/slack/slack-proposal-service.ts#L182-L232)
- **Technical Root Cause:**
  When creating a plan proposal from Slack Socket Mode, `SlackProposalService.prepare` (`lines 182-232`) reads `allowedScope` directly from `service_credentials` without running live provider membership checks or workspace-scoped filtering (`workspace_id`). Although execution (`phase: 'execution'`) still re-validates through `AdapterFactory`, the previewed `PlanProposal.connections` stored on the plan record can contain stale or unscoped channel/board IDs.

---

### `AUD-W1-09` (P1) — `createCalendarDigestExecutor` Omits `connections.telegram` and `workspaceMode`/`workspaceId`, Failing Deterministically
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 3 & Case 4 in deterministic reproduction harness)
- **Source References:**
  - [`apps/chat-api/src/services/schedules/calendar-digest-runner.ts:364-390`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/calendar-digest-runner.ts#L364-L390)
  - [`apps/chat-api/src/services/adapter-factory.ts:212-238, 592-624`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L592-L624)
  - [`apps/chat-api/src/db/repositories/credential-repo.ts:140-165`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/credential-repo.ts#L140-L165)
- **Technical Root Cause:**
  At `calendar-digest-runner.ts:364-367`, the runner acquires the destination adapter via:
  ```ts
  const destAdapter = await options.getAdapter(destService, {
    userId: run.userId,
    phase: 'execution',
  });
  ```
  1. When `destService === 'telegram'`, omitting `connections.telegram` causes `AdapterFactory.telegramAdapter` (`lines 600-608`) to throw `StepError(AUTH_ERROR): 'Kết nối Telegram đã thay đổi, hãy lập lại kế hoạch.'`.
  2. When `destService === 'slack'` in an Organization Workspace, omitting `workspaceMode: 'organization'` and `workspaceId` causes `CredentialRepo.getCredentials('slack', null)` (`credential-repo.ts:140-165`) to query `WHERE service = $1 AND user_id IS NULL AND workspace_id IS NOT DISTINCT FROM $2` (`$2 = null`), throwing `"No credentials configured for service 'slack'"`.

---

### `AUD-W1-10` (P1) — `calendar-digest-candidate.ts` Queries Shared Slack Credentials Without `workspace_id`, Exposing Foreign Tenant `channelId` Metadata
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 3 in deterministic reproduction harness)
- **Source References:**
  - [`apps/chat-api/src/services/schedules/calendar-digest-candidate.ts:172-179, 290-314`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/calendar-digest-candidate.ts#L172-L179)
  - [`db/v3/0015_workspaces.sql:43-48, 108-110`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/db/v3/0015_workspaces.sql#L43-L48)
- **Technical Root Cause:**
  `calendar-digest-candidate.ts:172-179` runs `SELECT status, config FROM service_credentials WHERE service = 'slack' AND user_id IS NULL` without filtering by `workspace_id`. If Organization A has configured shared Slack credentials (`channelId: 'C01ORGA9999'`), Personal User B (or Organization B) creating a `calendar_digest` schedule with `services: ['mycalendar', 'slack']` automatically receives `destination: { service: 'slack', channelId: 'C01ORGA9999' }` in their persisted `digest_config`. (Actual runtime message delivery is blocked by `AUD-W1-09` because `calendar-digest-runner.ts` queries `workspace_id IS NOT DISTINCT FROM NULL`.)

---

### `AUD-W1-11` (P2) — `CalendarAdapter.request` Omits `details: { requestSent: false }` on Pre-Dispatch Failures
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`packages/tool-adapters/src/calendar/calendar-adapter.ts:201-244`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/calendar/calendar-adapter.ts#L201-L244)
- **Technical Root Cause:**
  In `CalendarAdapter.request` (shared Google Calendar adapter), pre-dispatch failures in `rateLimiter.waitForSlot` (`line 206`) or `tokenProvider.getAccessToken` (`line 208`) throw `StepError` without `details: { requestSent: false }`, causing `StepRunner` (`runner.ts:157-160`) to mark `calendar.create_event` as `status: 'unknown'` even when the write HTTP request was never sent.

---

## 3. Wave 2 Detailed Findings (`AUD-W2-01` → `AUD-W2-07`)

### `AUD-W2-01` (P1) — `myjira_digest` Fails at 3 Layers: Unwired in Runtime, Invalid `maxResults: 20` Arg, and Output Schema Mismatch
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 5 in deterministic reproduction harness)
- **Source References:**
  - [`apps/chat-api/src/services/chat-service.ts:1388-1446`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/chat-service.ts#L1388-L1446)
  - [`apps/chat-api/src/services/schedules/schedule-runner.ts:31-55, 224-275`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/schedule-runner.ts#L31-L55)
  - [`apps/chat-api/src/server.ts:280-364, 660-706`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/server.ts#L280-L364)
  - [`apps/chat-api/src/services/schedules/jira-digest-runner.ts:141-196`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/jira-digest-runner.ts#L141-L196)
  - [`packages/tool-adapters/src/jira/personal-jira-adapter.ts:342-370, 422-463`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/jira/personal-jira-adapter.ts#L342-L463)
- **Technical Root Cause:**
  1. **Unwired at Creation & Execution:** `ChatService.prepareProposal` (`chat-service.ts:1388-1446`, specifically `if (!this.myjiraDigestConnection)` at `lines 1399-1404`) refuses any schedule containing `myjira` (`'Tính năng lịch tự động chưa hỗ trợ tích hợp Jira cá nhân (myjira)'`) because `new ChatService(...)` in `server.ts:660-706` never passes `myjiraDigestConnection`. Furthermore, neither `ScheduleRunnerDeps` (`schedule-runner.ts:31-55`) nor `server.ts` (`lines 280-364`) wires `runJiraDigest`.
  2. **Input Schema Validation Failure:** `runJiraDigest` (`jira-digest-runner.ts:153-157`) calls `jiraAdapter.execute('myjira.search_issues', { siteId: proj.siteId, projectKey: proj.projectKey, maxResults: 20 })`. `PersonalJiraAdapter` (`personal-jira-adapter.ts:342-370, 422-463`) validates against `this.input('myjira.search_issues')` and rejects unknown pagination args (`maxResults`, requiring `limit` `1..50`), throwing `StepError('VALIDATION', 'Jira request failed: VALIDATION')`.
  3. **Output Schema Mismatch:** `PersonalJiraAdapter` (`personal-jira-adapter.ts:448-463`) returns `{ issues: [{ key, title, status, priority, assignee, updated, url }], nextPageToken }`, whereas `runJiraDigest` (`jira-digest-runner.ts:158-169`) checks `Array.isArray(rawIssues)` and reads `it.summary`, resulting in `0 issue` (`_(Không có issue nào)_`) even if validation is bypassed.

---

### `AUD-W2-02` (P1) — `trello_digest` Queries Singleton `scope_id = 'default'` Instead of Scoped `personal:<userId>` / `<workspaceId>` and Omits `connections.telegram`
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 6 in deterministic reproduction harness)
- **Source References:**
  - [`apps/chat-api/src/services/schedules/trello-digest-candidate.ts:80-86, 209`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/trello-digest-candidate.ts#L80-L86)
  - [`apps/chat-api/src/services/schedules/trello-digest-runner.ts:224, 283-291`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/trello-digest-runner.ts#L224-L291)
  - [`apps/chat-api/src/services/trello/connection-reference.ts:30-61`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/trello/connection-reference.ts#L30-L61)
  - [`apps/chat-api/src/routes/connections/trello.ts:43-49`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/connections/trello.ts#L43-L49)
- **Technical Root Cause:**
  1. When a user saves their Trello board scope via `PUT /api/connections/trello/scope`, `resolveTrelloScopeId(req)` (`routes/connections/trello.ts:43-49`) stores boards under `scope_id = 'personal:<userId>'` (Personal Mode) or `scope_id = '<workspaceId>'` (Organization Mode). However, `evaluateTrelloDigestCandidate` (`trello-digest-candidate.ts:82`) and `createTrelloDigestRunner` (`trello-digest-runner.ts:224`) call `trelloConnection(userId)` **without** `scopeId`, which defaults to `scopeId = 'default'` (`connection-reference.ts:30`, `trello-team-repo.ts:20`), returning `status: 'needs_scope'` and blocking schedule creation and execution.
  2. At execution time, `createTrelloDigestRunner` (`trello-digest-runner.ts:283-286`) calls `getAdapter('telegram', { userId: run.userId, phase: 'execution' })` without `connections.telegram`, which throws `AUTH_ERROR` in `AdapterFactory.telegramAdapter`.

---

### `AUD-W2-03` (P2) — `TrelloWriteTools.addChecklist` Partial Item Failure Marks Step `failed` Instead of `unknown`, Creating Duplicate Checklists on Retry
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 7 in deterministic reproduction harness)
- **Source References:**
  - [`packages/tool-adapters/src/trello/write-tools.ts:156-207`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/trello/write-tools.ts#L156-L207)
  - [`packages/executor/src/runner.ts:157-160`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/runner.ts#L157-L160)
  - [`packages/executor/src/controller.ts:116-148`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/controller.ts#L116-L148)
- **Technical Root Cause:**
  `TrelloWriteTools.addChecklist` (`write-tools.ts:156-207`) first creates the checklist on the card (`POST /1/cards/{cardId}/checklists`), then iterates through `args.items` (`POST /1/checklists/{id}/checkItems`). If item $k$ fails with `RATE_LIMIT` (`429`) after adapter retries, `request()` throws `StepError('RATE_LIMIT', ..., true)`. Because `StepRunner.executeStep` (`runner.ts:157-160`) only transitions a write step to `status: 'unknown'` when `category === 'NETWORK' || category === 'SERVER_ERROR' || category === 'UNKNOWN'`, a `'RATE_LIMIT'` error marks the step `status: 'failed'` (`retryable: true`), and `controller.retryStep` creates a second duplicate checklist on the Trello card.

---

### `AUD-W2-04` (P2) — `GET /api/services` Reports `myjira` as `connected: true` in Personal Mode While `AdapterFactory` Rejects Personal Mode
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 8 in deterministic reproduction harness)
- **Source References:**
  - [`apps/chat-api/src/routes/services-routes.ts:598-656`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L598-L656)
  - [`apps/chat-api/src/services/adapter-factory.ts:800-806`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L800-L806)
- **Technical Root Cause:**
  In `GET /api/services` (`services-routes.ts:598-656`), `jiraOAuthRepo.getConnectionStatus(userId)` is queried unconditionally regardless of whether `req.workspace.mode` is `'personal'` or `'organization'`. When a user has linked their Atlassian OAuth account, `GET /api/services` in Personal Mode (`workspaceId = null`) returns `myjira.connected = true` and `connectionStatus = 'healthy'`, causing the frontend and planner to believe `myjira` is available in Personal Mode, whereas `AdapterFactory.myjiraAdapter` (`adapter-factory.ts:804-805`) immediately throws `StepError('AUTH_ERROR', 'Jira cá nhân yêu cầu không gian làm việc.')`.

---

### `AUD-W2-05` (P2) — `PersonalJiraHttpTransport.request` Omits `details: { requestSent: false }` on Pre-Dispatch Aborts and Pre-Write `GET` Verification Failures
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`packages/tool-adapters/src/jira/personal-jira-http.ts:20-37, 56-226`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/jira/personal-jira-http.ts#L56-L226)
  - [`packages/tool-adapters/src/jira/personal-jira-adapter.ts:620-664, 695-859`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/jira/personal-jira-adapter.ts#L695-L859)
  - [`packages/executor/src/runner.ts:157-160`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/runner.ts#L157-L160)
- **Technical Root Cause:**
  In `PersonalJiraAdapter`, write tools `myjira.transition_issue` (`lines 710-731`), `myjira.update_issue` (`lines 824-831`), and `myjira.add_comment` (`lines 620-664`) perform pre-write `GET` verification requests (`writing = false`) before sending the mutating `POST`/`PUT` (`writing = true`). However, `PersonalJiraHttpTransport.request` (`personal-jira-http.ts:56-226`) never attaches `details: { requestSent: false }` when `createJiraStepError('NETWORK' | 'SERVER_ERROR')` (`lines 20-37`) is thrown during pre-dispatch abort (`lines 65-67, 77-79, 85-87, 99-101, 116-118, 124-126`) or during a pre-write `GET` verification call (`writing = false`, `lines 146, 149, 214`). Consequently, `StepRunner.executeStep` (`runner.ts:157-160`) sees `err?.details?.requestSent !== false` as `true` and marks the un-sent write step as `status: 'unknown'`.

---

### `AUD-W2-06` (P2) — `JiraOAuthRepo.saveSitesGrant` and `syncSites` Do Not Revoke Active Leases When a Site Is Deselected
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 8 in deterministic reproduction harness)
- **Source References:**
  - [`apps/chat-api/src/db/repositories/jira-oauth-repo.ts:286-410, 412-479, 564-645`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/jira-oauth-repo.ts#L286-L479)
- **Technical Root Cause:**
  While `JiraOAuthRepo.disconnect` (`lines 619-624`) revokes all active rows in `jira_authorization_leases` (`UPDATE jira_authorization_leases SET status = 'revoked', released_at = clock_timestamp() WHERE jira_account_id = $1 AND status = 'active'`), `saveSitesGrant` (`lines 371-378`) and `syncSites` (`lines 447-454`) delete deselected `cloud_id` rows from `jira_grant_sites` (`DELETE FROM jira_grant_sites WHERE grant_id = $1 AND NOT (cloud_id = ANY($2))`) without revoking active leases for those removed `cloud_id`s in `jira_authorization_leases` and without incrementing `jira_accounts.identity_version` (`identity_version` is only incremented in `upsertAccountAndReplaceGrants` at `lines 118-284` and `disconnect` at `lines 564-645`).

---

### `AUD-W2-07` (P2) — `JiraAdapter.request` Omits `details: { requestSent: false }` on Pre-Dispatch Abort
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`packages/tool-adapters/src/jira/jira-adapter.ts:147-176`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/jira/jira-adapter.ts#L147-L176)
- **Technical Root Cause:**
  In shared `JiraAdapter.request`, an abort during `rateLimiter.waitForSlot` (`line 151`) throws `StepError('TIMEOUT', ..., true)` without `details: { requestSent: false }`, causing `StepRunner` (`runner.ts:157-160`) to mark `jira.create_issue` and `jira.add_comment` as `status: 'unknown'` even when no HTTP request was dispatched.

---

## 4. Wave 3 Detailed Findings (`AUD-W3-01` → `AUD-W3-05`)

### `AUD-W3-01` (P1) — `GitHubTeamRepo` Hardcodes Singleton `scope_id = 'default'`, Causing Cross-Tenant Admin Scope Overwrite, Repo `fullName` Metadata Exposure to Any Authenticated User, and False-Healthy Status
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED)` (Case 9 in deterministic reproduction harness)
- **Source References:**
  - [`db/v3/0018_github_oauth_and_digest.sql:33-48`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/db/v3/0018_github_oauth_and_digest.sql#L33-L48)
  - [`apps/chat-api/src/db/repositories/github-team-repo.ts:30-121`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/github-team-repo.ts#L30-L121)
  - [`apps/chat-api/src/routes/connections/github.ts:274-381, 383-461`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/connections/github.ts#L274-L461)
  - [`apps/chat-api/src/routes/services-routes.ts:522-533, 660-661`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L522-L661)
  - [`apps/chat-api/src/services/github/connection-reference.ts:22-108`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/github/connection-reference.ts#L22-L108)
  - [`apps/chat-api/src/services/adapter-factory.ts:487-590`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L487-L590)
- **Technical Root Cause & Proven Actor Boundaries:**
  `GitHubTeamRepo` (`github-team-repo.ts:30-121`) hardcodes `'default'` in `get()` (`lines 33-54`) and `replace()` (`lines 56-120`, specifically at `lines 35, 41, 85, 89, 101`) without workspace or personal scope partitioning:
  1. **Cross-Tenant Admin Scope Overwrite & Personal-Mode Admin Gate (`INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED`):** `GET /api/connections/github/candidate-repos` (`routes/connections/github.ts:274-314`) and `PUT /api/connections/github/scope` (`routes/connections/github.ts:316-381`) are guarded by global `if (!isAdmin(user, options.adminUserIds))` (`lines 276, 318`). Arbitrary non-admin authenticated users cannot write to `PUT /api/connections/github/scope` (they receive HTTP `403 Forbidden`, which also blocks non-admin Personal Workspace users from selecting their own GitHub repositories despite `GET /api/services` returning `canSelectTeamScope: true` at `services-routes.ts:661`). However, **any user passing the global `isAdmin()` check** who saves GitHub repository selections for one organization overwrites `github_team_scope` (`id = 'default'`) and `github_team_repos` (`scope_id = 'default'`) globally across all organizations and personal workspaces.
  2. **Cross-Tenant Repo `fullName` Metadata Exposure to Any Authenticated User (`INTEGRATION_REPRODUCED`):** **Any authenticated user** (admin or non-admin, in any organization or Personal Workspace) who has connected a personal GitHub account and calls `GET /api/connections/github` (`routes/connections/github.ts:383-461`) receives the full list of `repoId`, `fullName`, and `name` stored in `scope_id = 'default'` (with `accessible: false`), exposing private repository names across tenants.
  3. **False-Healthy `GET /api/services` Status (`INTEGRATION_REPRODUCED`):** `services-routes.ts:522-533` reads `githubTeamScope.repos` for any authenticated user with an active personal GitHub credential without checking live GitHub membership, reporting `connected: true`, `personalStatus: 'connected'`, and `allowedScope: ['org-a/secret-roadmap']` to User B even when `createGitHubConnectionLookup` returns `status: 'needs_membership'`.
  4. **Live Repo Content Access Blocked (`INTEGRATION_REPRODUCED`):** `createGitHubConnectionLookup` and `AdapterFactory.githubAdapter` always use the caller's own personal OAuth token (`getPersonalCredentials('github', userId)`) and filter `scope.repos` against `githubOAuthClient.repos(accessToken)` (`r.member !== false`), preventing unauthorized read/write access to repository contents.

---

### `AUD-W3-02` (P1) — `createNotionDigestRunner` Omits `connections.telegram` When Calling `getAdapter('telegram', { phase: 'execution' })`
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 10 in deterministic reproduction harness)
- **Source References:**
  - [`apps/chat-api/src/services/schedules/notion-digest-runner.ts:415-445`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/notion-digest-runner.ts#L415-L445)
  - [`apps/chat-api/src/services/adapter-factory.ts:592-624`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L592-L624)
- **Technical Root Cause:**
  Although `createNotionDigestRunner` validates `options.telegramConnection(run.userId)` at lines 417–429, lines 430–433 call:
  ```ts
  telegramAdapter = await options.getAdapter?.('telegram', {
    userId: run.userId,
    phase: 'execution',
  });
  ```
  without passing `connections: { telegram: { credentialId, telegramUserId, username, chatIds: [String(config.telegramChatId)] } }`. `AdapterFactory.telegramAdapter` (`lines 600-608`) immediately rejects the call with `StepError('AUTH_ERROR', 'Kết nối Telegram đã thay đổi, hãy lập lại kế hoạch.')`, causing every `notion_digest` run targeting Telegram to fail with `state: 'blocked'`.

---

### `AUD-W3-03` (P2) — Organization Slack Digest Lookup Fails Across `github_digest`, `notion_digest`, and `trello_digest` Due to Missing `workspaceMode` / `workspaceId`
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED — Per-Call-Site Breakdown Below)`
- **Source References & Per-Call-Site Verification Granularity:**
  1. [`evaluateGithubDigestCandidate` (`github-digest-candidate.ts:225`)](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/github-digest-candidate.ts#L225) — `await input.getAdapter?.('slack', { userId, phase: 'planning' })`: **`CONFIRMED (INTEGRATION_REPRODUCED)`** (Case 11).
  2. [`createGithubDigestRunner` (`github-digest-runner.ts:310-313`)](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/github-digest-runner.ts#L310-L313) — `await options.getAdapter?.('slack', { userId: run.userId, phase: 'execution' })`: **`CONFIRMED (INTEGRATION_REPRODUCED)`** (Case 11).
  3. [`evaluateNotionDigestCandidate` (`notion-digest-candidate.ts:219`)](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/notion-digest-candidate.ts#L219) — `await input.getAdapter?.('slack', { userId, phase: 'planning' })`: **`CONFIRMED (INTEGRATION_REPRODUCED)`** (Case 11).
  4. [`createNotionDigestRunner` (`notion-digest-runner.ts:435-438`)](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/notion-digest-runner.ts#L435-L438) — `await options.getAdapter?.('slack', { userId: run.userId, phase: 'execution' })`: **`CONFIRMED (CODE_TRACE_CONFIRMED)`**.
  5. [`evaluateTrelloDigestCandidate` (`trello-digest-candidate.ts:209`)](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/trello-digest-candidate.ts#L209) & [`createTrelloDigestRunner` (`trello-digest-runner.ts:288-291`)](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/trello-digest-runner.ts#L288-L291): **`CONFIRMED (CODE_TRACE_CONFIRMED)`**.
- **Technical Root Cause:**
  In Organization Mode, shared Slack credentials are stored in `service_credentials` with `user_id IS NULL AND workspace_id = <orgWorkspaceId>`. Because none of the digest candidate evaluators or runners above forward `workspaceMode: 'organization'` and `workspaceId` into `getAdapter('slack', ...)`, `AdapterFactory.getAdapterForService` calls `credentialRepo.getCredentials('slack', null)` (`credential-repo.ts:140-165`, `WHERE workspace_id IS NOT DISTINCT FROM NULL`), throwing `"No credentials configured for service 'slack'"`.

---

### `AUD-W3-04` (P2) — `GitHubAdapter.request` and `NotionAdapter.request` Omit `details: { requestSent: false }` on Pre-Dispatch Abort
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 11 in deterministic reproduction harness)
- **Source References:**
  - [`packages/tool-adapters/src/github/github-adapter.ts:170-221`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/github/github-adapter.ts#L170-L221)
  - [`packages/tool-adapters/src/notion/notion-adapter.ts:210-250`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/notion/notion-adapter.ts#L210-L250)
  - [`packages/executor/src/runner.ts:41-66, 152-173`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/runner.ts#L152-L173)
- **Technical Root Cause:**
  In both `GitHubAdapter.request` (`github-adapter.ts:170-221`) and `NotionAdapter.request` (`notion-adapter.ts:210-250`), when `signal` is already aborted or aborts during `rateLimiter.waitForSlot` before `fetchFn` is called, both adapters throw `StepError('TIMEOUT', '... request aborted', true)` without `details: { requestSent: false }`. In `StepRunner.executeStep` (`runner.ts:157-160`), `classifyErrorCategory` (`lines 41-66`) maps `'TIMEOUT'` to `'NETWORK'`, and `isWrite && err?.details?.requestSent !== false && (category === 'NETWORK' || category === 'SERVER_ERROR' || category === 'UNKNOWN')` evaluates to `true`, marking write steps (`github.create_issue`, `notion.create_page`, etc.) as `status: 'unknown'` even though `fetchFn` was never called.

---

### `AUD-W3-05` (P2) — Notion OAuth (`notion_connections` & `NOTION_OAUTH_TOOLS`) Six-Layer Wiring & Registration Gaps
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED)` (Case 10 & Case 11 in deterministic reproduction harness)
- **Source References & 6-Layer Technical Analysis:**
  At baseline `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`, [`packages/tool-schemas/src/notion.ts:18-49`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/notion.ts#L18-L49) defines:
  - `NOTION_TOOLS` (`lines 18-36`, 4 tools): `notion.search_databases`, `notion.query_database`, `notion.create_page`, `notion.append_text`.
  - `NOTION_OAUTH_TOOLS` (`lines 38-49`, 2 tools): `notion.get_page`, `notion.update_page`.
  Tracing Notion OAuth across all 6 runtime layers reveals:
  1. **(a) `GET /api/services` Status Endpoint (`CONFIRMED — INTEGRATION_REPRODUCED`):**
     [`apps/chat-api/src/routes/services-routes.ts:432`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L432) defines:
     ```ts
     const isPersonalOAuth = id === 'trello' || id === 'github' || id === 'telegram';
     ```
     (while `'gmail'`, `'mycalendar'`, and `'mysheets'` have dedicated branches at `lines 589-597` and `400` guards at `lines 351-381`). Because `'notion'` is omitted from `isPersonalOAuth` and `services-routes.ts` never queries `notion_connections` (via `NotionConnectionRepo`), `GET /api/services` checks `service_credentials` for `service = 'notion'` and returns `configured: false, connected: false, connectionStatus: 'unconfigured'` even when the user has an active OAuth connection in `notion_connections`. Furthermore, `POST /api/services/notion/credentials` is not blocked by the `410 Gone` guard (`lines 383-412`).
  2. **(b) `createToolRuntimeFactory` Mode Routing (`CONFIRMED — CODE_TRACE_CONFIRMED`):**
     In [`apps/chat-api/src/config/gmail-tools-runtime.ts:169-176`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/config/gmail-tools-runtime.ts#L169-L176) and [`apps/chat-api/src/config/runtime-policy.ts:7-17`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/config/runtime-policy.ts#L7-L17), `createToolRuntimeFactory` routes `'notion'` to `personal` (`realAdapterFactory`) when `mode === 'live'`, whereas in `mode === 'sandbox'` line 175 only forwards `'gmail' | 'mycalendar' | 'mysheets' | 'myslack' | 'trello' | 'github' | 'telegram' | 'myjira'` to `personal(name, context)` and omits `'notion'`, routing `'notion'` to `sandbox(name)` (`createSandboxAdapter('notion')`).
  3. **(c) `mayFallbackToShared` Guard (`CONFIRMED — CODE_TRACE_CONFIRMED`):**
     In [`apps/chat-api/src/config/gmail-tools-runtime.ts:179-202`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/config/gmail-tools-runtime.ts#L179-L202), `mayFallbackToShared` checks `service === 'gmail' || service === 'mycalendar' || service === 'mysheets' || service === 'myjira' || (service === 'trello' && trelloOAuthEnabled) || (service === 'github' && githubOAuthEnabled) || (service === 'telegram' && telegramOAuthEnabled)` and does **not** exclude `'notion'`.
  4. **(d) Tool Catalog Registration (`ALL_TOOLS` & `getConfiguredToolCatalog` vs `getToolDefinition`, `getToolCatalogFor` & `runtimeToolCatalog`) (`CONFIRMED — CODE_TRACE_CONFIRMED`):**
     - [`packages/tool-schemas/src/index.ts:47`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/index.ts#L47) (`ALL_TOOLS`) and [`getConfiguredToolCatalog`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/registered-services.ts#L71-L108) (`registered-services.ts:71-108`) include `...NOTION_TOOLS` (`4` tools) but omit `...NOTION_OAUTH_TOOLS` (`notion.get_page`, `notion.update_page`). Consequently, static `ALL_TOOLS` consumers ([`services-routes.ts:576`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L576), [`server.ts:576`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/server.ts#L576) `backupPlanner` via `prepareSearchCall` at [`packages/planner/src/search.ts:154-167`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/search.ts#L154-L167), and [`runner.ts:16-18`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/runner.ts#L16-L18) `catalog` Map) omit `NOTION_OAUTH_TOOLS`.
     - Conversely, `NOTION_OAUTH_TOOL_MAP` ([`packages/tool-schemas/src/index.ts:69-71`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/index.ts#L69-L71)) IS checked inside `getToolDefinition(name)` (`lines 81-92`, specifically line `88`), [`getToolCatalogFor`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/registered-services.ts#L116-L379) (`lines 116-379`, Notion OAuth branch at `lines 345-354`), and `runtimeToolCatalog` ([`gmail-tools-runtime.ts:44-123`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/config/gmail-tools-runtime.ts#L44-L123), wired at [`server.ts:597-607`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/server.ts#L597-L607)).
  5. **(e) `isWriteTool` Safety Classification (`CONFIRMED — CODE_TRACE_CONFIRMED`):**
     [`packages/executor/src/runner.ts:16-27`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/runner.ts#L16-L27) defines a module-level `const catalog = new Map<string, ToolDefinition>([...ALL_TOOLS, ...])` (`lines 16-18`) that omits `NOTION_OAUTH_TOOLS`, and a standalone exported function `isWriteTool(toolName)` (`lines 20-27`) that checks `catalog.get(toolName)` to select write-vs-read timeout (`30000ms` vs `15000ms`) and post-error `unknown` classification. Because `NOTION_OAUTH_TOOLS` is omitted from `catalog`, `isWriteTool` falls back to its regex at line 26 (`/(create|update|add|send|delete|post|put|patch|schedule|append|move)/i.test(toolName)`), classifying `notion.get_page` as `false` (read) and `notion.update_page` as `true` (write).
  6. **(f) Adapter Availability from Planning to Execution (`CONFIRMED — CODE_TRACE_CONFIRMED`):**
     [`AdapterFactory.notionAdapter`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L195-L201) is wired in `getAdapterForService` (`lines 195-201`), supports personal OAuth via `this.options.notionRepo` (`lines 708-781`) with shared credential fallback (`lines 784-797`), and implements all 6 tools (`NOTION_TOOLS` + `NOTION_OAUTH_TOOLS`) in [`NotionAdapter.execute`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/notion/notion-adapter.ts#L277-L476).

---

## 5. Wave 4 Detailed Findings (`AUD-W4-01` → `AUD-W4-07`)

### `AUD-W4-01` (P1) — `mysheets` with `0` Selected Spreadsheets (`scope_required`) Blacks Out Organization Shared `sheets` Catalog, and `PersonalSheetsAdapter` Drive/Docs Tools Lack ATI Target Allowlist Enforcement + Issue Plain-Text Overwrite Requests in `append_doc_text`
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED via Mock HTTP Provider Transport & CODE_TRACE_CONFIRMED; Live External Google Provider Mutation NOT_TESTED per Audit Rule 4)` (Sanitized 14-test reproduction package `W4 Test 1`)
- **Source References:**
  - [`apps/chat-api/src/services/registered-services.ts:14-21, 199-221`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/registered-services.ts#L199-L221) (`MYSHEETS_DRIVE_TOOLS` & `getToolCatalogFor`)
  - [`apps/chat-api/src/config/gmail-tools-runtime.ts:76-91`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/config/gmail-tools-runtime.ts#L76-L91) (`runtimeToolCatalog`)
  - [`packages/tool-adapters/src/sheets/personal-sheets-adapter.ts:101-113, 733-965`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/personal-sheets-adapter.ts#L101-L113) (`checkedId`, `checkedDriveId`, and Drive/Docs tools)
  - [`apps/chat-api/src/services/chat-service.ts:515-545`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/chat-service.ts#L515-L545) (`bindConnections`)
- **Technical Root Cause, Exact Authorization Boundary & Evidence Precision:**
  1. **Sub-Issue `AUD-W4-01a` — Organization Shared `sheets` Blackout on Empty Picker Scope & Coordination with Gate A `PR #293` (`INTEGRATION_REPRODUCED`):**
     - At baseline `origin/main` (`08c8d8c5e7bf12625857ac3496fb96ec3914e34f`), in `getToolCatalogFor` (`registered-services.ts:209-213`), when a user has an active `mysheets` credential with `spreadsheets.length === 0` (`personalStatus: 'scope_required'`), `getToolCatalogFor` still appends the 6 `MYSHEETS_DRIVE_TOOLS` (`service: 'mysheets'`). Then `runtimeToolCatalog` (`gmail-tools-runtime.ts:78, 86, 89`) computes `hasMySheets = personal.some((t) => t.service === 'mysheets')` (`true`) and strips all Organization shared `sheets.*` tools (`!hasMySheets || t.service !== 'sheets'`), leaving the user with **zero** spreadsheet tools. Even when `spreadsheets.length > 0`, `origin/main` hides Organization shared `sheets.*` tools whenever personal `mysheets` is connected.
     - **Gate A Coordination (`PR #293`):** Open Draft PR `#293` (`feat/sheets-digest-v2-candidate`, commit `e8e7ce31d950acd7dcdc915c65f175893d2770cf`) modifies `apps/chat-api/src/config/gmail-tools-runtime.ts` to compute `const hasMySheetsSpreadsheets = personal.some((t) => t.name === 'mysheets.read_range'); const isOrgMode = options.workspaceMode === 'organization' && Boolean(options.workspaceId); const stripSharedSheets = hasMySheetsSpreadsheets && !isOrgMode;`. Per parallel-stream governance, `RMD-W4-01` delegates `gmail-tools-runtime.ts` to `PR #293` (avoiding duplicate edits), and `AUD-W4-01a` remains `OPEN` until `PR #293` is merged into `main` and regression-verified on the new `HEAD`.
  2. **Sub-Issue `AUD-W4-01b` — ATI Application-Layer `allowedScope` Bypass vs. Google OAuth Boundary (`INTEGRATION_REPRODUCED`):**
     - **Exact Security Boundary:** This is an **ATI application-layer `allowedScope` boundary bypass**, **NOT** a Google OAuth token/account authorization bypass or cross-user privilege escalation. The caller is already authenticated with their own Google OAuth token (`drive.readonly` + `drive.file` or `drive` scopes on their own Google account).
     - Within Planora/ATI, however, all 9 spreadsheet tools in `PersonalSheetsAdapter` call `this.checkedId(args.spreadsheetId)` (`personal-sheets-adapter.ts:101-106`, enforcing `this.assertAllowedScope('spreadsheets', value)` against the user's Picker-selected allowlist), whereas all 6 Drive/Docs tools (`mysheets.list_drive_files`, `create_drive_folder`, `create_doc`, `get_doc`, `append_doc_text`, `move_drive_file` at `lines 733-965`) call `this.checkedDriveId(value, fieldName)` (`lines 108-113`), which validates only regex syntax (`/^[A-Za-z0-9_-]{10,128}$/`) and never consults `this.allowedScope`. Consequently, `mysheets.move_drive_file` (`lines 940-964`) can relocate a spreadsheet in the user's Google Drive that the user explicitly excluded from Planora's `allowedScope.spreadsheets` (verified in `W4 Test 1`, where `mysheets.read_range` rejects `unapproved_sheet_999999` while `mysheets.move_drive_file` succeeds on the same ID). Additionally, `ChatService.bindConnections` (`chat-service.ts:522-535`) only inspects `step.args?.spreadsheetId`, ignoring `documentId`, `fileId`, and `folderId`.
  3. **Sub-Issue `AUD-W4-01c` — Plain-Text Media Upload in `mysheets.append_doc_text` (`INTEGRATION_REPRODUCED via Mock HTTP Transport`):**
     - **Mock-Verified Request Behavior vs. Live Provider Impact:** In `PersonalSheetsAdapter.appendDocText` (`personal-sheets-adapter.ts:900-938`), code trace and mock `fetchFn` capture (`W4 Test 1`) prove that the adapter issues `GET /drive/v3/files/{documentId}/export?mimeType=text%2Fplain` and then issues `PATCH /upload/drive/v3/files/{documentId}?uploadType=media` with header `Content-Type: text/plain; charset=UTF-8` and body `<existingPlainText>\n\n<appendedText>`, instead of calling the Google Docs API (`POST https://docs.googleapis.com/v1/documents/{documentId}:batchUpdate` with `insertText`). Because Drive API `files.update` (`uploadType=media`, `Content-Type: text/plain`) replaces the document media stream with plain text, executing this tool against a formatted Google Doc carries a **P1 high risk of overwriting rich document formatting** (headings, tables, links, inline elements).
     - **Live Provider Boundary:** Per Audit Rule 4 (no live credential writes), this behavior was verified against a deterministic mock HTTP transport (`fetchFn`); no live Google Docs document was modified and **no actual production user data loss has occurred or is claimed**.
  4. **Proposed Production Mitigation (`ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=false` — Proposed Implementation, Not Yet Present on `main`):**
     - `ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=false` is a **proposed code-level mitigation**, not an existing feature flag on `origin/main` (`08c8d8c5e7bf12625857ac3496fb96ec3914e34f`). Simply setting an environment variable on current `main` has no effect.
     - To activate this short-term safeguard before full `RMD-W4-01b/c` lands, an implementation PR must:
       1. **Create the runtime configuration flag** (`ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS`, defaulting to `false`).
       2. **Enforce the flag at both layers:** (a) omit `mysheets.append_doc_text` and `mysheets.move_drive_file` from `MYSHEETS_DRIVE_TOOLS` in [`apps/chat-api/src/services/registered-services.ts:14-21`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/registered-services.ts#L14-L21) **and** (b) fail closed in [`PersonalSheetsAdapter.execute`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/personal-sheets-adapter.ts#L204-L265) (`StepError('PERMISSION_DENIED', ..., false, { requestSent: false })`) if either tool is invoked directly.
       3. **Add unit and integration tests** verifying both catalog suppression and adapter execution rejection when the flag is `false`.
       4. **Review, merge (coordinating with Gate A `PR #291` on `personal-sheets-adapter.ts`), and deploy** — the mitigation only protects production after code review, merge, and deployment. *(Per audit-only rules, no runtime code or configuration is modified or deployed in this PR.)*

---

### `AUD-W4-02` (P2) — Shared `SheetsAdapter` Omits `details: { requestSent: false }` on Pre-Write `GET` Failures, `append_rows` / `create_sheet` Execute Non-Atomic Two-POST Mutations That Reset `writeDispatched`, and `A1:Z500` Caps Interactive Scans at 500 Rows
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED)` (Wave 4 reproduction harness Case 2)
- **Source References:**
  - [`packages/tool-adapters/src/sheets/sheets-adapter.ts:62-102, 166, 184, 201-258, 271-285, 316-333, 363-405`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/sheets-adapter.ts#L62-L102)
  - [`packages/tool-adapters/src/sheets/personal-sheets-adapter.ts:285-363, 390, 417, 460-535, 555-580, 610-635, 665-721, 985-995`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/personal-sheets-adapter.ts#L460-L535)
  - [`packages/executor/src/runner.ts:157-160`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/runner.ts#L157-L160)
- **Technical Root Cause:**
  1. **False `unknown` Write State in Shared `SheetsAdapter` (`INTEGRATION_REPRODUCED`):** Unlike `PersonalSheetsAdapter` (which tracks `writeDispatched` and attaches `details: { requestSent: false }` when `!writeDispatched`), shared `SheetsAdapter.request` (`sheets-adapter.ts:62-102`) never sets `details: { requestSent: false }` on pre-dispatch aborts, token exchange failures, or pre-write `GET` calls (`this.tabs(id)` and `GET .../values/...!A1:Z500` in `append_rows`, `update_rows`, `delete_rows`, `create_sheet`). A 5xx/network error during pre-write tab/header discovery causes `StepRunner.executeStep` (`runner.ts:157-160`) to mark the un-sent write step as `status: 'unknown'` (`reconciliation_required`).
  2. **Non-Atomic Multi-POST Mutations Reset `writeDispatched` (`INTEGRATION_REPRODUCED`):** In both `PersonalSheetsAdapter` (`personal-sheets-adapter.ts:500-534, 672-721`) and `SheetsAdapter` (`sheets-adapter.ts:231-258, 371-405`), `append_rows` (with `onDuplicate: 'update'` when a batch contains both duplicate updates and new rows) and `create_sheet` (with `headers`) execute two separate mutating `POST` requests. In `PersonalSheetsAdapter.request` (`lines 290, 305`), if the second `POST` (`:append` or header write) encounters HTTP 401 or 429, `onDispatch?.(false)` resets `writeDispatched = false` even though the first `POST` (`:batchUpdate` or `addSheet`) already mutated the spreadsheet. If the subsequent token refresh or retry aborts, `catch (e)` (`line 986`) attaches `details: { requestSent: false }`, allowing unsafe replay of an already partially applied write.
  3. **Hard `A1:Z500` Ceiling & Full-Row Formula Overwrite on `onDuplicate: 'update'` (`CODE_TRACE_CONFIRMED`):** All interactive table tools (`search_rows`, `aggregate_rows`, `update_rows`, `delete_rows`, and `append_rows` dedup scan) hardcode `A1:Z500`. Spreadsheets with $>500$ rows silently miss duplicates at rows `501+`, return truncated `aggregate_rows` metrics, and reject `rowNumber > 500`. Furthermore, while `update_rows` updates individual cells (preserving formulas in other columns), `append_rows` with `onDuplicate: 'update'` overwrites full row slices `A${rowNumber}` with formatted string values read from `A1:Z500`, overwriting any formula columns within that row.

---

### `AUD-W4-03` (P2) — Shared `sheets` Extended Tools (`SHEETS_EXTENDED_TOOLS`) Omitted from `ALL_TOOLS` / `GET /api/services` and Missing Planner System Prompt Rules
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`packages/tool-schemas/src/index.ts:47, 73-91`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/index.ts#L47-L91)
  - [`apps/chat-api/src/services/registered-services.ts:107`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/registered-services.ts#L107)
  - [`apps/chat-api/src/routes/services-routes.ts:576`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L576)
  - [`packages/planner/src/prompts/system-prompt.ts:57-59`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/prompts/system-prompt.ts#L57-L59)
- **Technical Root Cause:**
  `ALL_TOOLS` (`packages/tool-schemas/src/index.ts:47`) includes only `SHEETS_TOOLS` (4 tools), omitting `SHEETS_EXTENDED_TOOLS` (`sheets.search_rows`, `sheets.aggregate_rows`, `sheets.update_rows`, `sheets.delete_rows`, `sheets.create_sheet`). Consequently, `getConfiguredToolCatalog()` (`registered-services.ts:107`) and `GET /api/services` (`services-routes.ts:576`) report only 4 tools for `sheets`. Although `runtimeToolCatalog()` (`gmail-tools-runtime.ts:89`) injects `SHEETS_EXTENDED_TOOLS` in live mode when `!hasMySheets`, `buildSystemPrompt()` (`system-prompt.ts:57-59`) only injects spreadsheet extended-tool usage rules (`search_rows` before `update_rows`/`delete_rows`, `create_sheet` before `append_rows`, `deduplicate: true`) when `tools.some(t => t.service === 'mysheets')`, leaving shared `sheets` without planner prompt rules.

---

### `AUD-W4-04` (P1) — `REPORT_SOURCE_TOOLS` Omits `mysheets.search_rows`, `sheets.search_rows`, and `sheets.aggregate_rows`, and Mixed Report + Work-Item Plans Trap Users in a Clarification Loop
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED)` (Wave 4 reproduction harness Case 3)
- **Source References:**
  - [`packages/tool-schemas/src/report-evidence.ts:41-94`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/report-evidence.ts#L41-L94)
  - [`packages/planner/src/planner.ts:200-216, 263-435, 747-759`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/planner.ts#L263-L435)
  - [`packages/planner/src/validator.ts:861-920`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/validator.ts#L861-L920)
  - [`packages/planner/src/prompts/system-prompt.ts:58`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/prompts/system-prompt.ts#L58)
- **Technical Root Cause:**
  1. **`REPORT_SOURCE_TOOLS` Omission vs. System Prompt (`INTEGRATION_REPRODUCED`):** `REPORT_SOURCE_TOOLS` (`report-evidence.ts:84-87`) lists `mysheets.read_range`, `mysheets.aggregate_rows`, and `sheets.read_range`, but **omits** `mysheets.search_rows`, `sheets.search_rows`, and `sheets.aggregate_rows`. Meanwhile, `buildSystemPrompt` (`system-prompt.ts:58`) explicitly instructs the LLM: *"prefer `mysheets.search_rows` over `mysheets.read_range`"*. When a user asks to find/filter rows in a spreadsheet and send a summary/notification (`requiresReportEvidence(userTexts) === true`), `bindReportEvidenceIfApplicable` (`planner.ts:297`) ignores `mysheets.search_rows` because it is not in `REPORT_SOURCE_TOOLS`, attaches no `reportEvidence`, and `validatePlan` (`validator.ts:866-875`) rejects the plan with `Report content must be grounded in verified read observations via reportEvidence`.
  2. **Unresolvable Clarification Loop on Mixed Report + Work-Item Creation (`INTEGRATION_REPRODUCED`):** In `bindReportEvidenceIfApplicable` (`planner.ts:288-290`), if `requiresReportEvidence(groundingUserTexts)` is `true` and any step in `parsed.steps` targets `github`, `myjira`, `jira`, or `trello` with a `text`, `body`, or `content` argument (e.g., `github.create_issue`, `trello.add_comment`), `bindReportEvidenceIfApplicable` replaces the plan with a hardcoded clarification (`"Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng?"`). When the user replies to that clarification, `relevantGroundingUserTexts` (`planner.ts:200-216`) retains the original user turn in `groundingUserTexts` because the assistant turn was a `clarification`, re-triggering line `288` on every subsequent turn.

---

### `AUD-W4-05` (P2) — In-Memory `ReportArtifactStore` Loses Observation Artifacts Across Restarts/Replicas and Has No TTL Eviction
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`packages/planner/src/reports/artifacts.ts:21-82`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/reports/artifacts.ts#L21-L82)
  - [`apps/chat-api/src/server.ts:573, 631, 683, 910`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/server.ts#L573-L683)
  - [`apps/chat-api/src/services/execution-service.ts:215-240`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/execution-service.ts#L215-L240)
  - [`apps/chat-api/src/services/report-evidence-guard.ts:109-115`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/report-evidence-guard.ts#L109-L115)
- **Technical Root Cause:**
  `ReportArtifactStore` (`artifacts.ts:21-22`) stores `ReportArtifact` objects solely in a process-local `new Map<string, ReportArtifact>()` with no PostgreSQL persistence and no TTL or size eviction. While `plans` rows persist in PostgreSQL with a 30-minute `expires_at` window (`chat-service.ts:1853`), any process restart or multi-instance load-balancer hop between plan creation and `POST /api/plans/:id/approve` causes `ExecutionService.approveAndStart` (`execution-service.ts:215-240`) to fail with HTTP `409 Conflict` (`Unverified observation artifact: observation not found on server for artifactId '...'`). Conversely, in long-running processes, `this.artifacts` never evicts expired artifacts.

---

### `AUD-W4-06` (P2) — Cross-Step `$ref` / `$template` Resolution Fails on Bracket Array Indexing (`step_1.output[0].id`) and Non-String Schema Targets
- **Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Wave 4 reproduction harness Case 4)
- **Source References:**
  - [`packages/executor/src/resolver.ts:6-42`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/resolver.ts#L6-L42) (`resolveRef`)
  - [`packages/planner/src/validator.ts:62-69, 722-778`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/validator.ts#L62-L69) (`validateSchemaValue` & `$ref` semantic validation)
  - [`apps/chat-api/src/services/chat-service.ts:49`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/chat-service.ts#L49) (`normalizeStepRefPath`)
- **Technical Root Cause:**
  While `chat-service.ts:49` normalizes bracket array paths via `rawRef.replace(/\[(\d+)\]/g, '.$1')`, `resolveRef` in `packages/executor/src/resolver.ts:6-42` splits strictly on `.` (`path.split('.')`) without normalizing `[0]`. Any step referencing `{ "$ref": "step_1.output[0].id" }` or `{ "$template": "${step_1.output[0].name}" }` on an array-output tool passes `validatePlan` (`validator.ts:62-69, 761-777`) and then fails at execution time in `StepRunner` with `Error: Property 'output[0].id' not found on step 'step_1'`. Additionally, `validateSchemaValue` (`validator.ts:64`) restricts `$ref` and `$template` exclusively to `schema.type === 'string'`, prohibiting array/object handoffs such as passing a step output array directly to `append_rows.args.rows` or `records`.

---

### `AUD-W4-07` (P2) — Non-`myjira` Plan Approval / Recovery SQL CAS Omits Active Membership Verification, and In-Memory `continueStep` Skips `claimRecovery`
- **Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Source References:**
  - [`apps/chat-api/src/db/repositories/plan-repo.ts:161-183, 274-289`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/plan-repo.ts#L161-L183) (`approvePlan` & `claimRecovery`)
  - [`apps/chat-api/src/services/execution-service.ts:160-341, 578-646`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/execution-service.ts#L578-L646) (`approveAndStart` & `continueStep`)
  - [`apps/chat-api/src/services/chat-service.ts:353-362`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/chat-service.ts#L353-L362) (`PlanConnections`)
- **Technical Root Cause:**
  1. In `PlanRepo.approvePlan` (`plan-repo.ts:170-174`) and `PlanRepo.claimRecovery` (`lines 280-286`), when `jiraGuard` is absent (all non-`myjira` plans), the SQL CAS checks only `conversations.user_id = $3` and does not verify `users.status = 'active'` or `workspace_members.status = 'active'` inside the transaction.
  2. In `ExecutionService.continueStep` (`execution-service.ts:594-610`), when `controller` is still cached in `this.activeControllers` (`reuseController === true`), `claimRecovery` is only called for `myslack` plans (`line 605`). For all other services, retrying or skipping a failed step in memory does not transition `plans.status` from `'partial'` to `'executing'` in PostgreSQL before dispatching the step.
  3. Shared Organization services (`slack`, `sheets`, `calendar`, `jira`) are not pinned in `PlanConnections` (`chat-service.ts:353-362`), so credential rotation on a shared service between preview and approval is not detected at approval time.

---

## 6. Findings Change Log (Historical Traceability & ID Stabilization)

| Date / Revision | Finding ID(s) | Change Description | Reason for Change |
|---|---|---|---|
| `2026-11-08` (Wave 1 Approval Adjustment) | `AUD-W1-01` | Removed suggestion to use `users.threads.batchModify`; updated remediation to record per-thread partial progress (`succeededThreadIds`, `failedThreadId`) | Gmail API only provides `users.messages.batchModify`, not `users.threads.batchModify`. |
| `2026-11-08` (Wave 1 Approval Adjustment) | `AUD-W1-04` | Reclassified from active vulnerability to **P3 Legacy / Dead Code** (`CODE_TRACE_CONFIRMED`) | `services-routes.ts:383-412, 432` blocks `POST /api/services/telegram/credentials` with HTTP `410 Gone`. |
| `2026-11-08` (Wave 1 Approval Adjustment) | `AUD-W1-07`, `AUD-W1-08` | Clarified that `SlackProposalService` (`tryDecryptCredentialConfig`) tries `process.env.ENCRYPTION_KEY` first (`AUD-W1-07`) and separated hardcoded fallback keys from unverified proposal scope (`AUD-W1-08`) | `AdapterFactory` re-validates scope at `phase: 'execution'`. |
| `2026-11-08` (Wave 3 Evidence Integrity Gate) | `AUD-W2-01`..`AUD-W2-07` | Restored canonical Wave 2 IDs (`AUD-W2-01`: `myjira_digest` 3-layer failure; `AUD-W2-02`: `trello_digest` `scope_id='default'` & missing `connections.telegram`; `AUD-W2-03`: `trello.add_checklist` non-idempotent retry; `AUD-W2-04`: `myjira` Personal Mode status mismatch; `AUD-W2-05`: `PersonalJiraHttpTransport.request` missing `requestSent: false` on pre-dispatch/pre-write GET failures) and assigned non-colliding IDs `AUD-W2-06` (`JiraOAuthRepo.saveSitesGrant`/`syncSites` lease revocation on site deselection) and `AUD-W2-07` (`JiraAdapter.request` pre-dispatch abort) | Prevented `AUD-*` ID collisions across Wave 2 and Wave 3 revisions. |
| `2026-11-08` (Wave 3 Evidence Integrity Gate) | `AUD-W3-03` | Separated per-call-site evidence labels into `INTEGRATION_REPRODUCED` (`evaluateGithubDigestCandidate`, `createGithubDigestRunner`, `evaluateNotionDigestCandidate`) vs `CODE_TRACE_CONFIRMED` (`createNotionDigestRunner`, `evaluateTrelloDigestCandidate`, `createTrelloDigestRunner`) | Enforced strict per-call-site evidence accuracy. |
| `2026-11-08` (Wave 3 Evidence Integrity Gate) | `AUD-W3-05` | Corrected `NOTION_OAUTH_TOOLS` tool names to `notion.get_page` and `notion.update_page` (`packages/tool-schemas/src/notion.ts:38-49`), documented `NOTION_OAUTH_TOOL_MAP` in `getToolDefinition` (`packages/tool-schemas/src/index.ts:69-71, 81-92`) vs omission from `ALL_TOOLS` (`index.ts:47`) and `runner.ts:16-18` `catalog` Map, and documented all 6 Notion OAuth layers `(a)`–`(f)` | Replaced inaccurate tool names and inaccurate `StepRunner` claim with verified baseline contracts at `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`. |
| `2026-11-09` (Wave 4 Targeted Evidence Correction & Completion) | `AUD-W3-01`, `AUD-W1-02`, `AUD-W4-01`..`AUD-W4-07` | Clarified global `isAdmin()` guard on `PUT /api/connections/github/scope` (`AUD-W3-01`); documented `projectTelegramUpdate()` text stripping (`AUD-W1-02`); added Wave 4 findings `AUD-W4-01` through `AUD-W4-07` (`2` P1, `5` P2) with deterministic reproduction evidence | Completed Wave 4 (`W4-A`, `W4-B`, `W4-C`, `W4-D`) and targeted Wave 3 corrections. |
| `2026-11-09` (Final Audit Acceptance Gate Refinements) | `AUD-W4-01`, `RMD-W4-01`, `RMD-W4-06` | Refined `AUD-W4-01` to distinguish mock-reproduced HTTP requests (`uploadType=media` `text/plain`) from live external Google provider execution (zero live data loss claimed), separated ATI `allowedScope` boundary bypass from Google OAuth authorization, added production kill-switch mitigation, coordinated `RMD-W4-01` with Gate A `PR #293` (`stripSharedSheets = hasMySheetsSpreadsheets && !isOrgMode`), expanded `RMD-W4-06` typed `$ref` handoff criteria, and embedded the complete 14-test sanitized reproduction package in `EVIDENCE-AND-TEST-RESULTS.md` §6.6 | Addressed external review of Draft PR `#298`. |
| `2026-11-09` (Documentation Acceptance Gate Final Correction) | `AUD-W4-01`, `RMD-W1-03`..`RMD-W4-07` | Updated Shared-Module Ownership Matrix per `gh pr diff --name-only` across `PR #289–#299`, `#189`, `#182` (recording `PR #291` overlap on `personal-sheets-adapter.ts`/`sheets-adapter.ts`/`sheets-shared.ts` and `PR #293` overlap on `chat-service.ts`), unified `RMD-*` ↔ `AUD-*` traceability and `9` P1 findings count in `REMEDIATION-BACKLOG.md`, clarified `ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=false` is a proposed code change requiring catalog + adapter enforcement + tests + deployment, and hardened the 14-test self-extracting PowerShell runner with no-overwrite and non-zero exit propagation | Completed Documentation-Only Final Correction on Draft PR `#298`. |
