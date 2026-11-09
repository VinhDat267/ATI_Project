# Prioritized Remediation Backlog (Waves 1, 2 & 3)

- **Repository:** `VinhDat267/ATI_Project`
- **Baseline Commit SHA (`HEAD`):** `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`
- **Scope:** Actionable engineering specifications for remediating all confirmed Wave 1 (`AUD-W1-01`..`11`), Wave 2 (`AUD-W2-01`..`07`), and Wave 3 (`AUD-W3-01`..`05`) findings outside Google Sheets Digest Gate A.
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
