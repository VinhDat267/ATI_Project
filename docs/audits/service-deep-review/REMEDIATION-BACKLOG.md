# Prioritized Remediation Backlog (Waves 1, 2, 3 & 4 — Complete)

- **Repository:** `VinhDat267/ATI_Project`
- **Baseline Commit SHA (`origin/main`):** `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`
- **Scope:** Actionable engineering specifications for remediating all confirmed Wave 1 (`AUD-W1-01`..`11`), Wave 2 (`AUD-W2-01`..`07`), Wave 3 (`AUD-W3-01`..`05`), and Wave 4 (`AUD-W4-01`..`07`) findings outside Google Sheets Digest Gate A (`RMD-00 → RMD-04`).
- **Audit Constraint:** This document is a specification only; zero product code has been modified in the audit worktree.

---

## 1. Prioritized Remediation Summary Matrix

| Remediation ID | Priority | Findings Covered | Target Packages / Modules | Summary of Fix |
|---|---|---|---|---|
| `RMD-W1-01` | **P1** | `AUD-W1-02` | `apps/chat-api`, `packages/tool-adapters`, `db/v3` | Establish an explicit per-chat read consent, content minimization, encrypted retention/TTL, and unified ingestion contract in `telegram_update_inbox` (since `projectTelegramUpdate()` currently strips ordinary message text), then route `TelegramAdapter.read_messages` through the inbox reader instead of competing raw `getUpdates` calls. |
| `RMD-W1-03` | **P1** | `AUD-W1-09`, `AUD-W1-10`, `AUD-W3-02`, `AUD-W3-03` | `apps/chat-api/src/services/schedules` | Pin and revalidate `connections.telegram` (`{ credentialId, telegramUserId, username, chatIds }`) in `calendar_digest` and `notion_digest`; resolve authoritative workspace scope from DB (`schedules.workspace_id` + `workspace_members`), verify active membership of `run.userId`, revalidate that pinned `digestConfig.workspaceMode`/`workspaceId` matches DB scope, and propagate trusted `workspaceMode`/`workspaceId` to all Organization Slack digest lookups and runners. |
| `RMD-W2-01` | **P1** | `AUD-W2-01` | `apps/chat-api/src/services/schedules`, `apps/chat-api/src/services/chat-service.ts`, `apps/chat-api/src/server.ts` | Wire `evaluateJiraDigestCandidate` and `runJiraDigest` into `ChatService`, `ScheduleRunner`, and `server.ts`; fix `myjira.search_issues` pagination arg (`limit: 20` instead of `maxResults: 20`) and output parser (`rawIssues.issues` & `it.title`). |
| `RMD-W2-02` | **P1** | `AUD-W2-02` | `apps/chat-api/src/services/schedules/trello-digest-*` | Pass scoped `scopeId` (`workspaceMode === 'organization' ? workspaceId : 'personal:' + userId`) into `trelloConnection(userId, scopeId)`, pin/revalidate `connections.trello` (`credentialId`, `boardIds`) and `connections.telegram` (`credentialId`, `telegramUserId`, `username`, `chatIds`), and pass DB-verified `workspaceMode`/`workspaceId` for Slack delivery. |
| `RMD-W3-01` | **P1** | `AUD-W3-01` | `db/v3`, `apps/chat-api/src/db/repositories/github-team-repo.ts`, `apps/chat-api/src/routes/connections/github.ts`, `apps/chat-api/src/routes/services-routes.ts` | Partition `GitHubTeamRepo` by mandatory `scopeId` (`<workspaceId>` in Org Mode, `personal:<userId>` in Personal Mode) with **no silent runtime fallback to `'default'`**, safely inventory/quarantine legacy `scope_id = 'default'` rows without auto-delete or auto-owner-transfer, and check live repo membership in `GET /api/services`. |
| `RMD-W1-02` | **P2** | `AUD-W1-03`, `AUD-W1-06`, `AUD-W1-11` | `packages/tool-adapters` (`telegram`, `slack`, `calendar`) | Track `writeDispatched` in `TelegramAdapter`, `SlackAdapter`, and `CalendarAdapter`: attach `details: { requestSent: false }` on pre-dispatch aborts/token failures, and classify post-dispatch network errors on write tools as ambiguous (`TIMEOUT` / `requestSent: true`). |
| `RMD-W1-04` | **P2** | `AUD-W1-01` | `packages/tool-adapters/src/gmail/gmail-adapter.ts` | Track `succeededThreadIds` in `gmail.batch_modify_threads` sequential loop and attach `{ requestSent: succeededThreadIds.length > 0, succeededThreadIds, failedThreadId }` on mid-batch failure. |
| `RMD-W1-05` | **P2** | `AUD-W1-05` | `packages/tool-schemas/src/index.ts`, `apps/chat-api/src/services/registered-services.ts`, `packages/executor/src/runner.ts` | Register `...SLACK_EXTENDED_TOOLS` (`slack.read_messages`) in `ALL_TOOLS`, `getConfiguredToolCatalog`, and `StepRunner` `catalog` Map. |
| `RMD-W1-06` | **P2 / P3** | `AUD-W1-04`, `AUD-W1-07`, `AUD-W1-08` | `apps/chat-api/src/services/slack/slack-proposal-service.ts`, `apps/chat-api/src/services/adapter-factory.ts` | Remove hardcoded dev fallback keys in `SlackProposalService` (`tryDecryptCredentialConfig`), scope `prepare()` by `workspaceId`, and remove unreachable legacy manual Telegram token branch in `AdapterFactory.telegramAdapter`. |
| `RMD-W2-03` | **P2** | `AUD-W2-03` | `packages/tool-adapters/src/trello/write-tools.ts`, `packages/executor/src/runner.ts` | Mark multi-step write failure after checklist creation (`trello.add_checklist`) with `details: { requestSent: true, checklistId, addedItems }` and update `StepRunner.executeStep` (`runner.ts:157-160`) so partial multi-step write failures transition to `unknown` rather than `failed` (preventing duplicate checklists on retry). |
| `RMD-W2-04` | **P2** | `AUD-W2-04`, `AUD-W2-06` | `apps/chat-api/src/routes/services-routes.ts`, `apps/chat-api/src/db/repositories/jira-oauth-repo.ts` | 1. Gate `myjira.connected` in `GET /api/services` on `req.workspace?.mode === 'organization' && Boolean(req.workspace?.workspaceId)`.<br>2. In `JiraOAuthRepo.saveSitesGrant` and `syncSites`, revoke active `jira_authorization_leases` for deselected `cloud_id`s and increment `identity_version` whenever the site list changes. |
| `RMD-W2-05` | **P2** | `AUD-W2-05`, `AUD-W2-07` | `packages/tool-adapters/src/jira/personal-jira-http.ts`, `packages/tool-adapters/src/jira/personal-jira-adapter.ts`, `packages/tool-adapters/src/jira/jira-adapter.ts` | Attach `details: { requestSent: false }` on pre-dispatch aborts and pre-write `GET` verification failures (`writing = false`) in `PersonalJiraHttpTransport.request` and shared `JiraAdapter.request`. |
| `RMD-W3-02` | **P2** | `AUD-W3-05` | `apps/chat-api/src/routes/services-routes.ts`, `apps/chat-api/src/config/gmail-tools-runtime.ts`, `packages/tool-schemas/src/index.ts`, `apps/chat-api/src/services/registered-services.ts`, `packages/executor/src/runner.ts` | Add `'notion'` to `isPersonalOAuth` and query `NotionConnectionRepo` in `GET /api/services`; exclude `'notion'` from `mayFallbackToShared` when personal OAuth is active; spread `...NOTION_OAUTH_TOOLS` (`notion.get_page`, `notion.update_page`) in `ALL_TOOLS` and `StepRunner` `catalog` Map. |
| `RMD-W3-03` | **P2** | `AUD-W3-04` | `packages/tool-adapters/src/github/github-adapter.ts`, `packages/tool-adapters/src/notion/notion-adapter.ts` | Track `writeDispatched` in `GitHubAdapter.request` and `NotionAdapter.request`: set `details: { requestSent: false }` on pre-dispatch aborts (`waitForSlot` / pre-fetch) so `StepRunner` does not mark un-sent write steps `unknown`. |
| `RMD-W4-01` | **P1** | `AUD-W4-01` | `apps/chat-api/src/services/registered-services.ts`, `apps/chat-api/src/config/gmail-tools-runtime.ts`, `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`, `apps/chat-api/src/services/chat-service.ts` | 1. Only set `hasMySheets = true` to suppress shared `sheets` when `personal` contains spreadsheet tools (`mysheets.read_range` / `spreadsheets.length > 0`).<br>2. Enforce an explicit Drive/Docs allowlist (`allowedScope.driveFiles` / session-created IDs) in `checkedDriveId` and `ChatService.bindConnections`, and block `move_drive_file` on unapproved spreadsheets.<br>3. Replace destructive `text/plain` media upload in `mysheets.append_doc_text` with Google Docs API `documents.batchUpdate` (`insertText` at `endOfSegmentLocation`) or disable `append_doc_text` on pre-existing formatted Docs until `documents` scope is enabled. |
| `RMD-W4-02` | **P2** | `AUD-W4-02` | `packages/tool-adapters/src/sheets/sheets-adapter.ts`, `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`, `packages/tool-adapters/src/sheets/sheets-shared.ts` | 1. Track `writeDispatched` in shared `SheetsAdapter` and attach `details: { requestSent: false }` on pre-write `GET` failures.<br>2. Never reset `writeDispatched = false` on a second `POST` after the first `POST` (`:batchUpdate` or `addSheet`) has already mutated the spreadsheet.<br>3. Surface explicit `truncated: true, scannedRange: 'A1:Z500'` metadata (or paginate ranges) and update only changed columns on `onDuplicate: 'update'` so formulas in other columns are preserved. |
| `RMD-W4-03` | **P2** | `AUD-W4-03` | `packages/tool-schemas/src/index.ts`, `packages/planner/src/prompts/system-prompt.ts` | Spread `...SHEETS_EXTENDED_TOOLS` in `ALL_TOOLS` and trigger spreadsheet extended-tool prompt rules in `buildSystemPrompt` when either `mysheets` or `sheets` extended tools are present. |
| `RMD-W4-04` | **P1** | `AUD-W4-04` | `packages/tool-schemas/src/report-evidence.ts`, `packages/planner/src/planner.ts`, `packages/planner/src/reports/renderers.ts` | 1. Add `mysheets.search_rows: 'sheets_rows'`, `sheets.search_rows: 'sheets_rows'`, and `sheets.aggregate_rows: 'sheets_metrics'` to `REPORT_SOURCE_TOOLS` and support `{ matches, headers }` in `renderSheetsRowsReport`.<br>2. In `bindReportEvidenceIfApplicable`, allow mixed report + work-item plans when the user reply resolves the clarification or bind report evidence only to notification steps (`slack`, `gmail`, `telegram`) without looping on work-item steps. |
| `RMD-W4-05` | **P2** | `AUD-W4-05` | `packages/planner/src/reports/artifacts.ts`, `apps/chat-api/src/db/repositories/plan-repo.ts` | Persist `ReportArtifact` payload/hash alongside `plans.report_evidence` in PostgreSQL (aligned with `plans.expires_at` 30m TTL) and add bounded TTL eviction (`maxAgeMs = 30 * 60_000`) to `ReportArtifactStore`. |
| `RMD-W4-06` | **P2** | `AUD-W4-06` | `packages/executor/src/resolver.ts`, `packages/planner/src/validator.ts` | Normalize bracket array indexing `path.replace(/\[(\d+)\]/g, '.$1')` inside `resolveRef` (`packages/executor/src/resolver.ts:6-42`) and `validator.ts:723` so `step_1.output[0].id` and `step_1.output.matches[0].rowNumber` resolve consistently across validation, preview, and execution. |
| `RMD-W4-07` | **P2** | `AUD-W4-07` | `apps/chat-api/src/db/repositories/plan-repo.ts`, `apps/chat-api/src/services/execution-service.ts`, `apps/chat-api/src/services/chat-service.ts` | Enforce `users.status = 'active'` and (when `workspace_id IS NOT NULL`) `workspace_members.status = 'active'` inside `PlanRepo.approvePlan` and `PlanRepo.claimRecovery` for all plans; always call `planRepo.claimRecovery` in `ExecutionService.continueStep`; and pin shared service `credentialId` in `PlanConnections`. |

---

## 2. Detailed P1 & P2 Remediation Contracts

### `RMD-W1-01` — Telegram Consent-Gated Message Ingestion, Content Minimization, Retention & Unified Inbox Reader (`AUD-W1-02`)
1. **Why Reading Current `telegram_update_inbox` Alone Is Insufficient:**
   - In [`apps/chat-api/src/services/telegram/update-inbox.ts:13-41`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/telegram/update-inbox.ts#L13-L41), `projectTelegramUpdate(update)` intentionally strips all ordinary message text (`/** Minimize before persistence: no ordinary message text or raw pairing state. */`), retaining only `update_id`, `/start ati_<token>` `pairingStateHash` + sender profile (`lines 18-31`), and group/supergroup/channel chat header metadata (`id, type, title, username` at `lines 32-39`) before persisting to `telegram_update_inbox` ([`0020_telegram_update_inbox.sql:1-17`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/db/v3/0020_telegram_update_inbox.sql#L1-L17), [`telegram-update-repo.ts:7-52`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/telegram-update-repo.ts#L7-L52)).
   - Simply modifying [`TelegramAdapter.read_messages`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/telegram/telegram-adapter.ts#L109-L181) to query `telegram_update_inbox` as currently stored will return updates with **no message text**.
2. **Prerequisite Consent, Privacy, Minimization & Ingestion Contract:**
   - **Explicit Per-Chat Read Consent:** Only ingest message text for `chat.id` values explicitly authorized in the user's or workspace's `allowedScope.chats` (`selectedChats` / `telegram_team_chats`) where the user/admin has granted explicit message-read consent. For all unconsented chats and `/start` pairing messages, continue running `projectTelegramUpdate` with ordinary message text stripped.
   - **Content Minimization & Encryption at Rest:** Store only the minimal fields required by `telegram.read_messages` (`update_id`, `message_id`, `chat.id`, `from.id`/`username`/`first_name`, `date`, and truncated `text`/`caption` up to 4,096 chars), encrypted at rest using AES-256-GCM (`ENCRYPTION_KEY`, matching `service_credentials.config` in [`crypto.ts:1-58`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/crypto.ts#L1-L58)) rather than storing plaintext message bodies in `payload jsonb`.
   - **Retention / TTL & Revocation Purge:** Enforce strict bounded retention (e.g., 24h TTL via `expires_at` index `idx_telegram_update_inbox_expires` in [`0020_telegram_update_inbox.sql:16`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/db/v3/0020_telegram_update_inbox.sql#L16)) and immediately purge stored updates for a `chat_id` or `bot_key` when a chat is deselected from scope (`PUT /api/connections/telegram/scope`) or the connection is deleted (`DELETE /api/connections/telegram`).
   - **Single Cursor-Serialized Ingestion Path:** Route both `TelegramBotClient.getUpdates` and `TelegramAdapter.read_messages` through the single `TelegramUpdateStore` cursor (`telegram_update_cursor`) so `TelegramAdapter.read_messages` never issues competing direct `POST /bot<token>/getUpdates` calls.

---

### `RMD-W1-03` — Unified Digest Destination Pinned Telegram Revalidation & Authoritative DB Workspace Scope Enforcement (`AUD-W1-09`, `AUD-W1-10`, `AUD-W3-02`, `AUD-W3-03`)
1. **Database & Candidate Scope for `calendar_digest` (`AUD-W1-10`):**
   - In [`calendar-digest-candidate.ts:172-179`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/calendar-digest-candidate.ts#L172-L179), pass `workspaceMode` and `workspaceId` into `evaluateCalendarDigestCandidate`.
   - Only query shared Slack credentials when `workspaceMode === 'organization' && workspaceId` using:
     ```sql
     SELECT status, config FROM service_credentials
     WHERE service = 'slack' AND user_id IS NULL AND workspace_id = $1
     LIMIT 1
     ```
2. **Pinned Telegram Connection Contract (`AUD-W1-09`, `AUD-W3-02`):**
   - Persist `telegramCredentialId`, `telegramUserId`, and `telegramUsername` in `CalendarDigestConfig.destination` (and use the existing `telegramCredentialId` / `telegramUserId` / `telegramUsername` fields on `NotionDigestConfig`).
   - At execution time in [`calendar-digest-runner.ts:364-367`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/calendar-digest-runner.ts#L364-L367) and [`notion-digest-runner.ts:430-433`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/notion-digest-runner.ts#L430-L433), revalidate `telegramConnection(userId)` (matching owner `userId`, `status === 'connected'`, `credentialId`, `telegramUserId`, and `chatIds` inclusion) and pass the exact contract required by [`AdapterFactory.telegramAdapter`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L592-L677):
     ```ts
     telegramAdapter = await options.getAdapter('telegram', {
       userId: run.userId,
       phase: 'execution',
       connections: {
         telegram: {
           credentialId: telegramCredentialId,
           telegramUserId,
           username: telegramUsername,
           chatIds: [String(config.telegramChatId)],
         },
       },
     });
     ```
3. **Authoritative DB Workspace Resolution & Pinned Reference Revalidation (`AUD-W1-09`, `AUD-W3-03`):**
   - **Security Invariant:** `workspaceMode` and `workspaceId` stored inside `schedules.digest_config` are **pinned references for drift/consistency detection only, NOT an authorization authority**.
   - At execution time (`ScheduleRunner` / digest runners):
     1. Load the authoritative schedule scope (`schedules.workspace_id` and `schedules.user_id`) from the `schedules` table ([`0015_workspaces.sql:36-41`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/db/v3/0015_workspaces.sql#L36-L41)).
     2. When `schedules.workspace_id IS NOT NULL` (Organization Mode), verify that `run.userId` is currently an active member (`workspace_members.status = 'active'`) of `schedules.workspace_id` via [`WorkspaceRepo.getMemberRole`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/workspace-repo.ts#L166-L185). If membership was revoked or suspended, fail closed (`state: 'blocked'`) and pause the schedule.
     3. Revalidate that the pinned `digestConfig.workspaceMode` and `digestConfig.workspaceId` match the authoritative DB `schedules.workspace_id` (rejecting any mismatched or tampered config), and pass the DB-verified `workspaceMode` and `workspaceId` into `getAdapter('slack', { userId: run.userId, phase: 'execution', workspaceMode: trustedMode, workspaceId: trustedWorkspaceId })` across all candidate evaluators (`github-digest-candidate.ts:225`, `notion-digest-candidate.ts:219`, `trello-digest-candidate.ts:209`) and runners (`calendar-digest-runner.ts:364`, `github-digest-runner.ts:310`, `notion-digest-runner.ts:435`, `trello-digest-runner.ts:288`).

---

### `RMD-W2-01` — End-to-End `myjira_digest` Wiring & Adapter Contract Alignment (`AUD-W2-01`)
1. **Fix `PersonalJiraAdapter` Call & Output Parsing in [`jira-digest-runner.ts:141-196`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/jira-digest-runner.ts#L141-L196):**
   - Replace `maxResults: 20` with `limit: 20` in `jiraAdapter.execute('myjira.search_issues', { siteId: proj.siteId, projectKey: proj.projectKey, limit: 20 })`.
   - Extract issues via `const issueList = Array.isArray(rawIssues) ? rawIssues : Array.isArray((rawIssues as any)?.issues) ? (rawIssues as any).issues : [];`.
   - Map issue title via `summary: String(it.summary || it.title || '')`.
2. **Wire `myjira_digest` into `ChatService`, `ScheduleRunner`, and `server.ts`:**
   - In [`chat-service.ts:1388-1446`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/chat-service.ts#L1388-L1446) and [`server.ts:660-706`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/server.ts#L660-L706), inject `myjiraDigestConnection` into `new ChatService(...)` so `evaluateJiraDigestCandidate` runs when `ctx.workspaceMode === 'organization' && ctx.workspaceId`.
   - In [`schedule-runner.ts:31-55, 224-275`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/schedule-runner.ts#L31-L55), add `runJiraDigest?: RunJiraDigest` to `ScheduleRunnerDeps` and dispatch `scheduleKind === 'myjira_digest'`, mapping `digest_sent` (persisting `delivery_channel_id`, `delivery_message_ts`, and `digest_issue_count`), `digest_skipped`, `digest_failed`, and `blocked` (calling `pauseForDigestBlock`).
   - Wire `runJiraDigest` in [`server.ts:280-364`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/server.ts#L280-L364) with `revalidatePolicy` backed by `JiraWorkspaceRepo` / `JiraOAuthRepo` and `getAdapter` forwarding `workspaceMode: 'organization'` and `workspaceId: digestConfig.workspaceId`.

---

### `RMD-W2-02` — `trello_digest` Scoped Lookup & Pinned Connection Revalidation (`AUD-W2-02`)
1. **Pass Scoped `scopeId` to `trelloConnection`:**
   - In [`trello-digest-candidate.ts:82`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/trello-digest-candidate.ts#L82) and [`trello-digest-runner.ts:224`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/trello-digest-runner.ts#L224), compute `const scopeId = workspaceMode === 'organization' && workspaceId ? workspaceId : 'personal:' + userId;` and call `options.trelloConnection(userId, scopeId)`.
2. **Pin & Revalidate `connections.trello` and `connections.telegram`:**
   - In `trello-digest-runner.ts:257-292`, keep `connections.trello` (`credentialId`, `memberId`, `username`, `boardIds`) and pass `connections: { telegram: { credentialId: telegramCredentialId, telegramUserId, username: telegramUsername, chatIds: [String(config.telegramChatId)] } }` to `getAdapter('telegram', ...)`.

---

### `RMD-W2-04` — `myjira` Personal Mode Status Gate & Deselected Site Lease Revocation (`AUD-W2-04`, `AUD-W2-06`)
1. **Gate `myjira.connected` on Organization Mode (`AUD-W2-04`):**
   - In [`services-routes.ts:598-656`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L598-L656), when `req.workspace?.mode !== 'organization' || !req.workspace?.workspaceId`, return `connected: false` and `connectionStatus: 'unconfigured'` (while preserving `personalStatus: 'connected'` if the user has linked their Atlassian account so the UI can explain that Organization Mode is required).
2. **Revoke Active Leases When a Site Is Deselected (`AUD-W2-06`):**
   - Note: `JiraOAuthRepo.disconnect` ([`jira-oauth-repo.ts:619-624`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/jira-oauth-repo.ts#L619-L624)) already revokes all active leases (`SET status = 'revoked', released_at = clock_timestamp()`) when the entire account is disconnected.
   - In [`JiraOAuthRepo.saveSitesGrant`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/jira-oauth-repo.ts#L286-L410) and [`syncSites`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/jira-oauth-repo.ts#L412-L479), before deleting deselected sites from `jira_grant_sites` (`lines 371-378` and `447-454`), revoke active leases in `jira_authorization_leases` ([`db/v3/0022_jira_authorization_leases.sql:13-25`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/db/v3/0022_jira_authorization_leases.sql#L13-L25)) for any removed `cloud_id`:
     ```sql
     UPDATE jira_authorization_leases
     SET status = 'revoked',
         released_at = clock_timestamp()
     WHERE grant_id = $1
       AND status = 'active'
       AND NOT (cloud_id = ANY($2::text[]))
     ```
   - Also increment `jira_accounts.identity_version` whenever the set of authorized `cloud_id`s changes so any in-flight plan or schedule referencing the deselected site fails version revalidation immediately.

---

### `RMD-W3-01` — `GitHubTeamRepo` Mandatory Scoped Partitioning (No `'default'` Fallback) & Safe Legacy Inventory/Quarantine (`AUD-W3-01`)
1. **Safe Pre-Migration Inventory & Quarantine of Legacy `scope_id = 'default'` Rows (No Auto-Delete or Auto-Owner-Transfer):**
   - **CRITICAL:** Do **not** automatically delete existing `github_team_scope WHERE id = 'default'` / `github_team_repos WHERE scope_id = 'default'` rows and do **not** automatically transfer ownership to `personal:<chosen_by>` or any organization workspace, because `'default'` was previously shared globally across workspaces and users.
   - Instead, the migration MUST safely inventory and quarantine legacy `'default'` rows:
     1. Copy or rename any existing row with `id = 'default'` (`github_team_scope`) and `scope_id = 'default'` (`github_team_repos`) to a quarantined non-runtime archive key (`scope_id = 'legacy_quarantined_default'`) or dedicated audit archive table (`github_team_scope_legacy_archive`, `github_team_repos_legacy_archive`) preserving `chosen_by`, `updated_at`, and `repo_id`/`full_name` for operator audit.
     2. Require each Organization Workspace admin (`<workspaceId>`) and Personal Workspace user (`personal:<userId>`) to explicitly select and save their own scoped repository allowlist before GitHub tools are enabled in that scope.
2. **Forbid Silent Runtime Fallback to `scope_id = 'default'`:**
   - Update [`GitHubTeamRepo`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/github-team-repo.ts#L30-L121) methods `get(scopeId: string)` and `replace({ chosenBy, repos, scopeId })` so `scopeId` is a **required parameter with no `'default'` default value**, and explicitly reject empty or `'default'` `scopeId` values in runtime calls (`if (!scopeId || scopeId === 'default') throw new Error('Explicit GitHub scopeId required')`).
   - In [`routes/connections/github.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/connections/github.ts#L274-L461), [`connection-reference.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/github/connection-reference.ts#L22-L108), [`adapter-factory.ts:500`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L500), and [`services-routes.ts:522-533`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L522-L533), resolve `scopeId = workspaceMode === 'organization' && workspaceId ? workspaceId : 'personal:' + userId`, and update `GET /candidate-repos` & `PUT /scope` in `routes/connections/github.ts:276, 318` to allow Personal Mode users to configure `personal:<userId>` while requiring organization admin (`isAdminUser`) for `<workspaceId>`.

---

### `RMD-W3-02` — Notion OAuth Service Status, Runtime Policy & `NOTION_OAUTH_TOOLS` Catalog Registration (`AUD-W3-05`)
1. **Update `GET /api/services` & `410 Gone` Guard in [`services-routes.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L383-L615):**
   - Add `'notion'` to `isPersonalOAuth` at line 432 and the `410 Gone` guard at lines `383-412`.
   - Inject `notionRepo?: NotionConnectionRepo` into `ServicesRoutesOptions` and query `notionRepo.getDefaultForUser(userId)` for `service === 'notion'`, returning `configured: true`, `connected: conn.status === 'active' && conn.allowedDatabases.length > 0`, and `allowedScope: conn.allowedDatabases`.
2. **Exclude `'notion'` from `mayFallbackToShared` When Personal OAuth Is Active:**
   - In [`gmail-tools-runtime.ts:179-202`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/config/gmail-tools-runtime.ts#L179-L202), add `'notion'` to the personal-OAuth exclusion list when `notionOAuthEnabled` is active.
3. **Register `NOTION_OAUTH_TOOLS` (`notion.get_page`, `notion.update_page`) in `ALL_TOOLS` & Static Catalogs:**
   - In [`packages/tool-schemas/src/index.ts:47`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/index.ts#L47), spread `...NOTION_OAUTH_TOOLS` into `ALL_TOOLS` so `getConfiguredToolCatalog` ([`registered-services.ts:71-108`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/registered-services.ts#L71-L108)), `GET /api/services` (`services-routes.ts:576`), `backupPlanner` (`server.ts:576` via `prepareSearchCall` at [`packages/planner/src/search.ts:154-167`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/search.ts#L154-L167)), and [`packages/executor/src/runner.ts:16-18`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/runner.ts#L16-L18) (`catalog` Map) all include `notion.get_page` and `notion.update_page`.

---

### `RMD-W4-01` — `mysheets` Empty-Picker Shared `sheets` Preservation, Drive/Docs Scope Enforcement & Non-Destructive `append_doc_text` (`AUD-W4-01`)
1. **Prevent Empty `mysheets` Picker (`spreadsheets.length === 0`) from Blacking Out Organization Shared `sheets`:**
   - In [`apps/chat-api/src/config/gmail-tools-runtime.ts:78-91`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/config/gmail-tools-runtime.ts#L78-L91), compute `const hasMySheets = personal.some((t) => t.name === 'mysheets.read_range');` (rather than `t.service === 'mysheets'`) so that when `spreadsheets.length === 0` (`scope_required`), Organization shared `sheets.*` tools remain available.
2. **Enforce Allowed Scope on `PersonalSheetsAdapter` Drive/Docs Tools:**
   - In [`packages/tool-adapters/src/sheets/personal-sheets-adapter.ts:108-113, 733-965`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/personal-sheets-adapter.ts#L108-L113) and [`apps/chat-api/src/services/chat-service.ts:515-545`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/chat-service.ts#L515-L545), check `fileId` / `documentId` / `folderId` against an explicit Drive/Docs allowlist (or files created via `drive.file` by the app and pinned in `connections.mysheets`), and reject `mysheets.move_drive_file` on any spreadsheet ID not present in `allowedScope.spreadsheets`.
3. **Eliminate Destructive `text/plain` Media Overwrite in `mysheets.append_doc_text`:**
   - In [`personal-sheets-adapter.ts:900-938`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/personal-sheets-adapter.ts#L900-L938), replace `GET .../export?mimeType=text/plain` + `PATCH /upload/drive/v3/files/{documentId}?uploadType=media` (`Content-Type: text/plain`) with Google Docs REST API `POST https://docs.googleapis.com/v1/documents/{documentId}:batchUpdate` (`insertText` at `endOfSegmentLocation: {}`), which appends text non-destructively while preserving all headings, tables, links, and inline images.

---

### `RMD-W4-02` — Shared `SheetsAdapter` Pre-Write `requestSent: false` Tracking, Atomic Multi-POST `writeDispatched` Guard & `A1:Z500` Truncation Safety (`AUD-W4-02`)
1. **Track `writeDispatched` in Shared `SheetsAdapter` ([`sheets-adapter.ts:62-102, 201-405`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/sheets-adapter.ts#L62-L102)):**
   - Mirror `PersonalSheetsAdapter`'s `writeDispatched` flag in `SheetsAdapter.execute` so any failure during token exchange or pre-write `GET` (`tabs` or `A1:Z500` dedup read) attaches `details: { requestSent: false }`.
2. **Preserve `writeDispatched = true` Across Multi-POST Mutations ([`personal-sheets-adapter.ts:290, 305, 500-534, 672-721`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/personal-sheets-adapter.ts#L500-L534)):**
   - Once the first mutating `POST` (`:batchUpdate` in `append_rows` or `addSheet` in `create_sheet`) has been dispatched (`writeDispatched = true`), pass a sticky dispatcher callback `(dispatched) => { if (dispatched) writeDispatched = true; }` to the second `POST` so a 401/429 on the second `POST` never resets `writeDispatched` back to `false`.
3. **Preserve Formula Cells on `onDuplicate: 'update'` & Surface `A1:Z500` Truncation Metadata:**
   - When `append_rows` updates duplicate rows from `records`, generate per-column cell ranges (`${quotedSheet}!${colLetter}${rowNumber}`) for only the keys provided in `record` (matching `update_rows` behavior) instead of overwriting the entire row `A${rowNumber}`.
   - Return `scannedRange: 'A1:Z500'` and `truncated: fetchedRows.length >= 500` on `search_rows` and `aggregate_rows`.

---

### `RMD-W4-03` — Register `SHEETS_EXTENDED_TOOLS` in `ALL_TOOLS` and Align Planner System Prompt (`AUD-W4-03`)
- In [`packages/tool-schemas/src/index.ts:47`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/index.ts#L47), spread `...SHEETS_EXTENDED_TOOLS` into `ALL_TOOLS`.
- In [`packages/planner/src/prompts/system-prompt.ts:57-59`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/prompts/system-prompt.ts#L57-L59), check `tools.some(t => t.service === 'mysheets' || t.name === 'sheets.search_rows')` and emit service-appropriate tool names (`mysheets.*` vs `sheets.*`).

---

### `RMD-W4-04` — Ground `mysheets.search_rows` / `sheets.search_rows` / `sheets.aggregate_rows` in `REPORT_SOURCE_TOOLS` and Resolve Mixed Report + Work-Item Clarification Loop (`AUD-W4-04`)
1. **Add Missing Spreadsheet Tools to `REPORT_SOURCE_TOOLS` ([`packages/tool-schemas/src/report-evidence.ts:84-87`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-schemas/src/report-evidence.ts#L84-L87)):**
   - Register `'mysheets.search_rows': 'sheets_rows'`, `'sheets.search_rows': 'sheets_rows'`, and `'sheets.aggregate_rows': 'sheets_metrics'` in `REPORT_SOURCE_TOOLS`.
   - Update `renderSheetsRowsReport` ([`packages/planner/src/reports/renderers.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/reports/renderers.ts#L1-L120)) to accept `{ headers, matches }` output from `search_rows` in addition to `{ values }` from `read_range`.
2. **Unblock Mixed Report + Work-Item Plans ([`packages/planner/src/planner.ts:288-290`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/planner.ts#L288-L290)):**
   - When `parsed.steps` contains both a report notification step (`slack.send_message`, `gmail.send_message`, `telegram.send_message`) and a work-item creation step (`github.create_issue`, `trello.create_card`, `jira.create_issue`, `myjira.create_issue`), bind `reportEvidence` to the notification step(s) without forcing a clarification loop on the work-item step, or honor the user's clarification reply on the next turn.

---

### `RMD-W4-05`, `RMD-W4-06` & `RMD-W4-07` — Durable `ReportArtifactStore`, Bracket Array `$ref` Normalization & Approval/Recovery SQL CAS Hardening (`AUD-W4-05`, `AUD-W4-06`, `AUD-W4-07`)
1. **`RMD-W4-05` (`AUD-W4-05`):** Persist `ReportArtifact` records in PostgreSQL (or serialize the verified artifact snapshot inside `plans.report_evidence`) with a 30-minute TTL matching `plans.expires_at`, and evict expired entries from the in-memory `ReportArtifactStore` cache.
2. **`RMD-W4-06` (`AUD-W4-06`):** In [`packages/executor/src/resolver.ts:6-42`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/executor/src/resolver.ts#L6-L42) (`resolveRef`) and [`packages/planner/src/validator.ts:723`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/validator.ts#L723), normalize bracket array indices via `const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1');` before `.split('.')` (matching [`chat-service.ts:49`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/chat-service.ts#L49)).
3. **`RMD-W4-07` (`AUD-W4-07`):** In [`PlanRepo.approvePlan`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/plan-repo.ts#L161-L183) and [`PlanRepo.claimRecovery`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/plan-repo.ts#L274-L289), enforce `EXISTS (SELECT 1 FROM users u WHERE u.id = $3 AND u.status = 'active')` and (when `conversations.workspace_id IS NOT NULL`) `EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = c.workspace_id AND wm.user_id = $3 AND wm.status = 'active')` for all plans; and always invoke `planRepo.claimRecovery` in [`ExecutionService.continueStep`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/execution-service.ts#L594-L610).

---

## 3. Master Remediation Sequencing Roadmap (Post-Audit Execution Order)

To minimize merge conflicts with Google Sheets Digest Gate A (`RMD-00 → RMD-04`) and respect package ownership boundaries in `docs/team-workflow.md`:

1. **Phase R1 — P1 Tenant Isolation, Scope Enforcement & Data Safety (`RMD-W4-01`, `RMD-W3-01`, `RMD-W1-03`):**
   - Fix `PersonalSheetsAdapter` `append_doc_text` plain-text overwrite, Drive/Docs allowlist, and empty-picker `sheets` blackout (`RMD-W4-01`).
   - Partition `GitHubTeamRepo` by mandatory `scopeId` and quarantine legacy `'default'` rows (`RMD-W3-01`).
   - Close `calendar_digest` unscoped Slack query and enforce authoritative DB workspace + pinned Telegram revalidation across digest runners (`RMD-W1-03`).
2. **Phase R2 — P1 Planner Grounding & Scheduled Digest Wiring (`RMD-W4-04`, `RMD-W2-01`, `RMD-W2-02`, `RMD-W1-01`):**
   - Add `mysheets.search_rows`, `sheets.search_rows`, and `sheets.aggregate_rows` to `REPORT_SOURCE_TOOLS` and fix the mixed report + work-item clarification loop (`RMD-W4-04`).
   - Wire `myjira_digest` end-to-end (`RMD-W2-01`) and fix `trello_digest` `scopeId` + `connections.telegram` (`RMD-W2-02`).
   - Implement consent-gated, encrypted Telegram inbox message retention and route `telegram.read_messages` through `TelegramUpdateStore` (`RMD-W1-01`).
3. **Phase R3 — P2 Adapter Idempotency, Executor `$ref` Resolution & Approval Hardening (`RMD-W1-02`, `RMD-W1-04`, `RMD-W2-03`, `RMD-W2-05`, `RMD-W3-03`, `RMD-W4-02`, `RMD-W4-05`, `RMD-W4-06`, `RMD-W4-07`):**
   - Standardize pre-dispatch `details: { requestSent: false }` across all adapters and prevent two-POST `writeDispatched` resets (`RMD-W1-02`, `RMD-W2-03`, `RMD-W2-05`, `RMD-W3-03`, `RMD-W4-02`).
   - Normalize bracket array `$ref` paths in `resolveRef` (`RMD-W4-06`), persist `ReportArtifactStore` (`RMD-W4-05`), and harden `PlanRepo.approvePlan` / `claimRecovery` (`RMD-W4-07`).
4. **Phase R4 — P2/P3 Catalog Registration, Service Status Badges & Recovery UX (`RMD-W1-05`, `RMD-W1-06`, `RMD-W2-04`, `RMD-W3-02`, `RMD-W4-03`):**
   - Register `SLACK_EXTENDED_TOOLS`, `NOTION_OAUTH_TOOLS`, and `SHEETS_EXTENDED_TOOLS` in `ALL_TOOLS` and align `GET /api/services` for `notion` and `myjira`.
