# Security, Tenant Isolation & Credential Scope Findings (Waves 1, 2, 3 & 4 — Complete)

- **Baseline Commit SHA (`origin/main`):** `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`
- **Scope:** Personal vs Organization Workspace Isolation, Hybrid Opt-In Policy, Credential Encryption & Decryption, Pinned Connection Revalidation, Allowlist Enforcement, Report Evidence Verification, and Cross-Tenant Data Boundaries across Waves 1–4.

---

## 1. Architectural Baseline: Hybrid Opt-In & Workspace Isolation Model

Planora v3 implements a **Hybrid Opt-In Workspace Model** ([`workspace-context.ts:28-81`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/middleware/workspace-context.ts#L28-L81), [`gmail-tools-runtime.ts:127-202`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/config/gmail-tools-runtime.ts#L127-L202)):
1. **Personal Workspace Mode (`mode = 'personal'`, `workspaceId = null`):**
   - Users access their own personal OAuth connections (`gmail`, `mycalendar`, `mysheets`, `myslack`, `trello`, `github`, `notion`, `telegram`).
   - Shared organization credentials (`user_id IS NULL`) MUST NOT be used or exposed to Personal Mode users.
2. **Organization Workspace Mode (`mode = 'organization'`, `workspaceId = <uuid>`):**
   - Verified active members (`workspace_members.status = 'active'`) can use shared organization credentials (`slack`, `calendar`, `sheets`, `jira`) scoped to `workspace_id = <uuid>` ([`0015_workspaces.sql:43-77`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/db/v3/0015_workspaces.sql#L43-L77)).
   - Members may also opt in their own personal connections (`gmail`, `mycalendar`, `mysheets`, `myjira`, `trello`, `github`, `notion`, `telegram`) inside an Organization Workspace. Under the Hybrid Opt-In rule, a user's own personal connection appearing in Organization Mode is **by design**, provided:
     - Member A's personal credentials are never used by Member B (`user_id = callerUserId`),
     - Organization-scoped team allowlists (`trello_team_scope`, `telegram_team_scope`, `jira_authorization_leases`) are isolated per `workspace_id`, and
     - Pinned `PlanConnections` are revalidated at execution time against live DB ownership, status, and resource membership.

---

## 2. Confirmed Security & Tenant Isolation Findings (Waves 1–3)

### 2.1. `AUD-W1-10` (P1) — `calendar_digest` Unscoped Shared Slack Query Exposes Foreign Tenant `channelId` Metadata
- **Verification Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 3 in deterministic reproduction harness)
- **Root Cause:**
  In [`calendar-digest-candidate.ts:172-179`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/calendar-digest-candidate.ts#L172-L179), `evaluateCalendarDigestCandidate` executes an inline query:
  ```sql
  SELECT status, config FROM service_credentials WHERE service = 'slack' AND user_id IS NULL
  ```
  Because [`0015_workspaces.sql:43-48, 108-110`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/db/v3/0015_workspaces.sql#L43-L48) partitioned shared `service_credentials` rows by `workspace_id` (`idx_service_credentials_workspace_id` and `ux_service_credentials_service_owner ON service_credentials (service, COALESCE(user_id, ''), COALESCE(workspace_id, ''))`), omitting `AND workspace_id = $1` causes PostgreSQL to return whichever organization's shared Slack row is scanned first.
- **Exact Security Impact (Metadata Exposure vs Runtime Block):**
  - **Confirmed Cross-Tenant Metadata Exposure (`INTEGRATION_REPRODUCED`):** When Personal User B (or a user in Organization B) creates a `calendar_digest` schedule targeting Slack without specifying a channel ID, `evaluateCalendarDigestCandidate` auto-selects `slack.channels[0]` from Organization A's shared Slack row (`C01ORGA9999`) and persists `{ service: 'slack', channelId: 'C01ORGA9999' }` into User B's `schedules.digest_config` row.
  - **Runtime Content Dispatch Blocked (`INTEGRATION_REPRODUCED`):** At execution time, [`calendar-digest-runner.ts:364-367`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/calendar-digest-runner.ts#L364-L367) calls `getAdapter('slack', { userId: run.userId, phase: 'execution' })` without `workspaceMode` or `workspaceId`. [`CredentialRepo.getCredentials`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/credential-repo.ts#L140-L165) then queries `WHERE service = $1 AND user_id IS NULL AND workspace_id IS NOT DISTINCT FROM $2` (with `$2 = null`), which returns `null` and throws `"No credentials configured for service 'slack'"`. Thus, calendar event content is **not** dispatched to Organization A's Slack channel unless a legacy row with `workspace_id IS NULL` exists.

---

### 2.2. `AUD-W3-01` (P1) — `GitHubTeamRepo` Hardcodes Singleton `scope_id = 'default'`, Causing Cross-Tenant Admin Scope Overwrite & Repo `fullName` Metadata Exposure
- **Verification Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 9 in deterministic reproduction harness)
- **Root Cause:**
  Unlike [`TrelloTeamRepo`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/trello-team-repo.ts#L20-L93) and [`TelegramTeamRepo`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/telegram-team-repo.ts#L21-L88) — which accept `scopeId` (`'default'`, `<workspaceId>`, or `personal:<userId>`) after [`0015_workspaces.sql:63-77`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/db/v3/0015_workspaces.sql#L63-L77) — [`GitHubTeamRepo`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/github-team-repo.ts#L30-L121) hardcodes `'default'` across `get()` (`lines 33-54`) and `replace()` (`lines 56-120`, specifically at lines `35, 41, 85, 89, 101`).
- **Exact Actor Model & Security Impact (Admin Write Collision & Authenticated Read Metadata Exposure vs Live Content Protection):**
  1. **Global Admin Scope Overwrite & Personal-Mode Admin Gate (`INTEGRATION_REPRODUCED & CODE_TRACE_CONFIRMED`):**Both `GET /api/connections/github/candidate-repos` ([`routes/connections/github.ts:274-314`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/connections/github.ts#L274-L314)) and `PUT /api/connections/github/scope` ([`routes/connections/github.ts:316-381`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/connections/github.ts#L316-L381)) enforce a global `if (!isAdmin(user, options.adminUserIds))` guard (`lines 276, 318`). Arbitrary non-admin authenticated users **cannot** overwrite the scope (receiving HTTP `403 Forbidden`, which also blocks non-admin Personal Workspace users from selecting their own repositories despite `GET /api/services` returning `canSelectTeamScope: true` at [`services-routes.ts:661`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L661)). However, **any user passing the global `isAdmin()` check** (`user.role === 'admin'` or listed in `adminUserIds`) who saves GitHub repository selections for Organization A overwrites the single global `github_team_scope` (`id = 'default'`) and `github_team_repos` (`scope_id = 'default'`) rows across all organizations and personal workspaces.
  2. **Cross-Tenant Repository Metadata Exposure to Any Authenticated User (`INTEGRATION_REPRODUCED`):** When an admin configures `org-a/secret-roadmap` in the global scope, **any authenticated user** (including non-admin users in another organization or Personal Workspace) who connects their personal GitHub account and calls `GET /api/connections/github` ([`routes/connections/github.ts:383-461`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/connections/github.ts#L383-L461)) receives:
     ```json
     {
       "status": "needs_membership",
       "repos": [{ "repoId": "9001", "fullName": "org-a/secret-roadmap", "name": "secret-roadmap", "accessible": false }]
     }
     ```
     And `GET /api/services` ([`services-routes.ts:522-533`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L522-L533)) returns `allowedScope: ["org-a/secret-roadmap"]` and `connected: true` (`personalStatus: 'connected'`) to any authenticated user with a personal GitHub credential because `services-routes.ts` does not check live GitHub repository membership.
  3. **Live Repository Content Access Blocked (`INTEGRATION_REPRODUCED`):** Both [`createGitHubConnectionLookup`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/github/connection-reference.ts#L22-L108) and [`AdapterFactory.githubAdapter`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L487-L590) decrypt only the caller's own personal OAuth token (`getPersonalCredentials('github', userId)`) and intersect `scope.repos` with `githubOAuthClient.repos(accessToken)` (`r.member !== false`). Consequently, User B cannot read or write issues/PRs in `org-a/secret-roadmap` unless User B's own GitHub account is also a member of `org-a/secret-roadmap`.

---

### 2.3. Missing Pinned `connections.telegram` Revalidation in Scheduled Digest Runners (`AUD-W1-09`, `AUD-W2-02`, `AUD-W3-02`)
- **Verification Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Cases 4, 6, and 10 in deterministic reproduction harness)
- **Root Cause:**
  [`AdapterFactory.telegramAdapter`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L592-L677) enforces a strict execution-phase security gate at lines 600–623:
  ```ts
  if (context?.phase === 'execution') {
    const previewed = context.connections?.telegram;
    if (
      !previewed ||
      !previewed.credentialId ||
      record.id !== previewed.credentialId ||
      (previewed.telegramUserId && config.telegramUserId !== previewed.telegramUserId)
    ) {
      throw telegramError('AUTH_ERROR', 'Kết nối Telegram đã thay đổi, hãy lập lại kế hoạch.');
    }
  }
  ```
  While [`telegram-digest-runner.ts:638-649`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/telegram-digest-runner.ts#L638-L649) and [`github-digest-runner.ts:297-308`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/github-digest-runner.ts#L297-L308) properly pass `connections: { telegram: { credentialId, telegramUserId, username, chatIds } }`, three other digest runners omit `connections.telegram` when calling `getAdapter('telegram', { userId: run.userId, phase: 'execution' })`:
  1. [`calendar-digest-runner.ts:364-367`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/calendar-digest-runner.ts#L364-L367) (`AUD-W1-09`),
  2. [`trello-digest-runner.ts:283-286`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/trello-digest-runner.ts#L283-L286) (`AUD-W2-02`), and
  3. [`notion-digest-runner.ts:430-433`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/schedules/notion-digest-runner.ts#L430-L433) (`AUD-W3-02`).
- **Impact:** All three digest runners fail deterministically at execution time with `StepError(AUTH_ERROR): 'Kết nối Telegram đã thay đổi, hãy lập lại kế hoạch.'` and neither pin nor revalidate `telegramCredentialId`/`telegramUserId` at runtime.

---

### 2.4. `AUD-W2-06` (P2) — `JiraOAuthRepo.saveSitesGrant` / `syncSites` Does Not Revoke Active Authorization Leases for Deselected Sites
- **Verification Status:** `CONFIRMED (INTEGRATION_REPRODUCED)` (Case 8 in deterministic reproduction harness)
- **Root Cause:**
  When a user disconnects their Jira account via [`JiraOAuthRepo.disconnect`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/jira-oauth-repo.ts#L564-L645), lines 619–624 explicitly revoke active leases (`UPDATE jira_authorization_leases SET status = 'revoked', released_at = clock_timestamp() WHERE jira_account_id = $1 AND status = 'active'`).
  However, when a user updates their site grant via [`JiraOAuthRepo.saveSitesGrant`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/jira-oauth-repo.ts#L286-L410) or [`syncSites`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/jira-oauth-repo.ts#L412-L479) and removes a previously authorized `cloud_id`, lines 371–378 (and 447–454) delete the deselected site from `jira_grant_sites`:
  ```sql
  DELETE FROM jira_grant_sites WHERE grant_id = $1 AND NOT (cloud_id = ANY($2))
  ```
  without revoking active rows in `jira_authorization_leases` for the removed `cloud_id` and without incrementing `jira_accounts.identity_version` (`identity_version` is only incremented in `upsertAccountAndReplaceGrants` at lines `118-284` and `disconnect` at lines `564-645`).
- **Impact:** Active authorization leases for the deselected Jira site remain `status = 'active'` in `jira_authorization_leases` until their 30-second TTL expires (`expires_at`), and `identity_version` is not bumped upon site deselection.

---

### 2.5. `AUD-W1-07` & `AUD-W1-08` (P2) — `SlackProposalService` Hardcoded Dev Fallback Keys & Unverified Proposal Scope
- **Verification Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Root Cause & Nuanced Impact:**
  1. **Hardcoded Fallback Keys (`AUD-W1-07`):** [`tryDecryptCredentialConfig`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/slack/slack-proposal-service.ts#L31-L53) in `SlackProposalService` tries `this.encryptionKey` and `process.env.ENCRYPTION_KEY` first, so production decryption succeeds whenever `ENCRYPTION_KEY` is configured. However, it appends hardcoded development keys (`'01234567890123456789012345678901'` and `'0123456789abcdef0123456789abcdef'`) as fallback candidates, violating secret-hygiene rules.
  2. **Unverified Proposal Scope vs Enforced Execution Scope (`AUD-W1-08`):** [`SlackProposalService.prepare`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/slack/slack-proposal-service.ts#L182-L232) attaches raw `allowedScope` from `service_credentials` into `PlanProposal.connections` without live provider membership verification at proposal creation time. Runtime execution (`phase: 'execution'`) still re-validates credentials and scope through `AdapterFactory`.

---

### 2.6. `AUD-W4-01` (P1) — `PersonalSheetsAdapter` Drive/Docs Tools Lack ATI Target Allowlist Enforcement, `append_doc_text` Uploads Plain-Text Media, and Unpicked `mysheets` Blacks Out Organization Shared `sheets`
- **Verification Status:** `CONFIRMED (INTEGRATION_REPRODUCED via Mock HTTP Transport & CODE_TRACE_CONFIRMED; Live External Google Provider Mutation NOT_TESTED per Audit Rule 4)` (Sanitized 14-test reproduction package `W4 Test 1`)
- **Root Cause, Exact Authorization Boundary & Security Impact:**
  1. **ATI Application-Layer `allowedScope` Bypass vs. Google OAuth Authorization Boundary (`INTEGRATION_REPRODUCED`):**
     - **Boundary Distinction:** This finding is an **ATI application-layer `allowedScope` boundary bypass**, **NOT** a Google OAuth token/account privilege escalation or cross-account bypass. The caller is already authenticated with their own Google OAuth token (`drive.readonly` + `drive.file` or `drive` scopes on their own Google account).
     - Within Planora/ATI, [`PersonalSheetsAdapter`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/personal-sheets-adapter.ts#L101-L113) enforces `checkedId(value)` (`lines 101-106`, calling `this.assertAllowedScope('spreadsheets', value)`) on all 9 spreadsheet tools. In contrast, all 6 Google Drive/Docs tools (`mysheets.list_drive_files`, `create_drive_folder`, `create_doc`, `get_doc`, `append_doc_text`, `move_drive_file` at `lines 733-965`) call `this.checkedDriveId(value, fieldName)` (`lines 108-113`), which validates only regex `/^[A-Za-z0-9_-]{10,128}$/` and never consults `this.allowedScope`. Consequently, `mysheets.move_drive_file` (`lines 940-964`) can move a spreadsheet inside the user's Google Drive (`unapproved_sheet_999999`) that the user explicitly excluded from Planora's `allowedScope.spreadsheets` (rejected by `mysheets.read_range`), and [`ChatService.bindConnections`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/chat-service.ts#L515-L545) checks only `step.args?.spreadsheetId`, ignoring `documentId`, `fileId`, and `folderId`.
  2. **Mock-Reproduced Plain-Text Overwrite Request in `mysheets.append_doc_text` (`INTEGRATION_REPRODUCED via Mock HTTP Transport`):**
     - Code trace and mock `fetchFn` capture (`W4 Test 1`) prove that [`PersonalSheetsAdapter.appendDocText`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/personal-sheets-adapter.ts#L900-L938) exports the target Google Doc as `text/plain` (`GET /drive/v3/files/{documentId}/export?mimeType=text%2Fplain`) and issues `PATCH /upload/drive/v3/files/{documentId}?uploadType=media` with `Content-Type: text/plain; charset=UTF-8` instead of calling Google Docs API `documents.batchUpdate` (`insertText`). While no live Google Docs write was executed (per Audit Rule 4) and no actual production user data loss is claimed, this implementation carries a P1 risk of overwriting rich Google Doc formatting.
     - **Proposed Production Mitigation (`ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=false` — Proposed Code Change, Not Yet on `main`):** `ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=false` does not currently exist on `origin/main` (`08c8d8c5e7bf12625857ac3496fb96ec3914e34f`). Implementing it as a short-term operational kill-switch requires: (1) creating the runtime config flag (`ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS`, default `false`), (2) enforcing it in **both** [`registered-services.ts:14-21`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/registered-services.ts#L14-L21) (catalog suppression) and [`PersonalSheetsAdapter.execute`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/sheets/personal-sheets-adapter.ts#L204-L265) (adapter execution guard), (3) adding unit and integration tests, and (4) reviewing, merging (coordinating with Gate A `PR #291` on `personal-sheets-adapter.ts`), and deploying to production.
  3. **Organization Shared `sheets` Catalog Blackout & Gate A `PR #293` Coordination (`INTEGRATION_REPRODUCED`):**
     - At baseline `origin/main` (`08c8d8c5e7bf12625857ac3496fb96ec3914e34f`), when an Organization member connects personal `mysheets` OAuth with `selectedSpreadsheets: []` (`0` spreadsheets picked), [`getToolCatalogFor`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/registered-services.ts#L199-L221) (`lines 209-213`) still injects the 6 `MYSHEETS_DRIVE_TOOLS` (`service: 'mysheets'`). Then [`runtimeToolCatalog`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/config/gmail-tools-runtime.ts#L76-L91) sees `hasMySheets === true` and strips all Organization shared `sheets.*` tools (`line 86`). Open Gate A Draft `PR #293` (`e8e7ce31d950acd7dcdc915c65f175893d2770cf`) updates `gmail-tools-runtime.ts` to `stripSharedSheets = hasMySheetsSpreadsheets && !isOrgMode`; this sub-finding remains `OPEN` until `PR #293` merges to `main` and passes post-merge regression verification.

---

### 2.7. `AUD-W4-05` (P2) — Process-Local `ReportArtifactStore` Lacks Persistence and TTL Eviction
- **Verification Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Root Cause & Impact:**
  [`ReportArtifactStore`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/planner/src/reports/artifacts.ts#L21-L82) keeps `ReportArtifact` records (`actor.userId`, `actor.workspaceId`, `items`, `renderedText`, `contentHash`) in a process-local `Map<string, ReportArtifact>()` (`line 22`). While [`verifyPlanReportEvidence`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/report-evidence-guard.ts#L97-L145) properly checks actor ownership (`artifact.actor.userId !== context.userId` and `artifact.actor.workspaceId !== context.workspaceId` at `lines 116-130`), any server restart or multi-instance hop causes `store.getArtifact(ev.artifactId)` to return `undefined` (`409 Conflict` at [`execution-service.ts:215-240`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/execution-service.ts#L215-L240)), while long-running single instances retain all un-evicted observation payloads in heap memory indefinitely.

---

### 2.8. `AUD-W4-07` (P2) — Non-`myjira` Plan Approval / Recovery SQL CAS Omits Active Membership Verification & Shared Service Pinning
- **Verification Status:** `CONFIRMED (CODE_TRACE_CONFIRMED)`
- **Root Cause & Impact:**
  1. In [`PlanRepo.approvePlan`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/plan-repo.ts#L161-L183) (`lines 170-174`) and [`PlanRepo.claimRecovery`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/db/repositories/plan-repo.ts#L274-L289) (`lines 280-286`), only plans with `jiraGuard` check `users.status = 'active'` and `workspace_members.status = 'active'` inside the SQL CAS transaction; non-`myjira` plans check only `conversations.user_id = $3`.
  2. In [`ExecutionService.continueStep`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/execution-service.ts#L578-L646) (`lines 594-610`), when `reuseController === true` (controller cached in `this.activeControllers`), `planRepo.claimRecovery` is only called for `myslack` plans (`line 605`).
  3. [`PlanConnections`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/chat-service.ts#L353-L362) pins personal/team OAuth services (`gmail`, `mycalendar`, `mysheets`, `trello`, `github`, `telegram`, `notion`, `myslack`, `myjira`), but does not pin `credentialId` or `updatedAt` for shared Organization services (`slack`, `sheets`, `calendar`, `jira`).

---

## 3. Summary of Verified Tenant & Credential Controls (No Vulnerability Found)

| Control Area | Implementation Reference | Audit Verdict |
|---|---|---|
| **AES-256-GCM Credential Encryption** | [`crypto.ts:1-58`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/crypto.ts#L1-L58) | **PASS** — Random 12-byte IV, 16-byte auth tag, 32-byte key enforcement. |
| **Personal OAuth Manual Token Block (`400` / `410 Gone`)** | [`services-routes.ts:351-412, 432`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/routes/services-routes.ts#L351-L432) | **PASS** — Blocks manual token injection for `'gmail'`, `'mycalendar'`, `'mysheets'` (`400` at lines `351-381`) and `'trello'`, `'github'`, `'telegram'` (`410 Gone` at lines `383-412`, `isPersonalOAuth` at line `432`). (Note: `'notion'` is missing from `isPersonalOAuth` — tracked in `AUD-W3-05`). |
| **Personal vs Shared Fallback Guard (`mayFallbackToShared`)** | [`gmail-tools-runtime.ts:179-202`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/config/gmail-tools-runtime.ts#L179-L202) | **PASS** — Personal OAuth services (`gmail`, `mycalendar`, `mysheets`, `myjira`, `trello`, `github`, `telegram`) never fall back to shared credentials. |
| **MyJira 4-Version Lease Revalidation** | [`adapter-factory.ts:800-1109`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L800-L1109) | **PASS** — Verifies `membership_version`, `identity_version`, `workspace_version`, and `site_policy_version` on every execution call (subject to `AUD-W2-06` on site deselection). |
| **Notion Database & Page Parent Allowlist** | [`notion-adapter.ts:279-474`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/packages/tool-adapters/src/notion/notion-adapter.ts#L279-L474), [`adapter-factory.ts:704-798`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/src/services/adapter-factory.ts#L704-L798) | **PASS** — Normalizes 32-hex UUIDs and verifies `page.parent.database_id` is in `allowedScope.databases` before `get_page`, `update_page`, or `append_text`. |
