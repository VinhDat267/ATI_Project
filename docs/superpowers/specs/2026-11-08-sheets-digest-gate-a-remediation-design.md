# Planora / ATI — Gate A (`RMD-00 → RMD-04`) Technical Design Specification: Google Sheets Digest Remediation

- **Document ID:** `SPEC-2026-11-08-SHEETS-DIGEST-GATE-A`
- **Version:** `2.4 (Pre-Task-3 Conditions Resolved — Approved for Tasks 0–2)`
- **Date:** `2026-11-08`
- **Baseline Commit:** `main@05bb05fe24dd47b5802cc53ddb67747794c9a214` (post-PR #287; Task 0 baseline verified at `b05d49a20b68361f3f63b222f9332d744de5b7c6` and rebased onto `05bb05fe`)
- **In Scope:** Gate A (`RMD-00`, `RMD-01`, `RMD-02`, `RMD-03`, `RMD-04`)
- **Out of Scope (Official Roadmap IDs Preserved per `PLANORA_TECHNICAL_REMEDIATION_PLAN_REVIEWED.md`):**
  - `RMD-05`: ADR — Workflow Ownership Model for Personal & Organization (`ownerType = user | organization`, RBAC, execution identity, founder deletion, design-only).
  - `RMD-06A` (`06A.1`, `06A.2`, `06A.3`) & `RMD-06B`: Persisted Workflow Definition, Organization ACL, schedule handover, and Organization Workflow Management UI (requires Gate A + Gate B + `RMD-08A`).
  - `RMD-07` (`07A`, `07B`): Trigger Google Sheets v1 — read-only row change detector (`row_added` / `row_updated`) with durable checkpoint (`07A`) and action dispatch/dedup/recovery (`07B`).
  - `RMD-08` (`08A`, `08B`): Early user discovery post-Gate A (`08A`) and final business + live provider acceptance post-Gate C (`08B`).

---

## 1. Executive Summary, Priority Hierarchy & Baseline Revalidation

### 1.1. Project Priority Hierarchy (No Artificial Deadline Shortcuts)

1. **Correctness & Security:** Strict tenant isolation, explicit credential pinning, fail-closed revocation, and honest data boundaries.
2. **User Needs & Product Direction:** First-class support for both **Personal Workspace** and **Organization Workspace** via a **Hybrid Opt-in** model with explicit source/destination identity, sender vs. recipient separation, and user confirmation.
3. **Architectural Compatibility:** Seamless integration across `ChatService`, `ScheduleService`, `ScheduleRunner`, `SheetsDigestRunner`, `schedules`, `schedule_runs`, and `service_credentials`, with staged v1/v2 compatibility so code deployment never disrupts active schedules prior to inventory and approval.
4. **Long-Term Scalability & Maintainability:** Versioned `SheetsDigestConfig` (`version: 2`) that cleanly separates Gate A operational bounds from permanent architectural capabilities.
5. **Test Quality & Acceptance Evidence:** Real PostgreSQL concurrency tests (`FOR UPDATE` / `FOR SHARE NOWAIT`, barrier synchronization, zero boolean mocks) and deterministic end-to-end tests (`TC-01` through `TC-25`).
6. **Implementation Time:** Subordinate to all five priorities above.

### 1.2. Baseline Revalidation at `main@b05d49a2` (Post-PR #286)

Revalidating the codebase at `b05d49a20b68361f3f63b222f9332d744de5b7c6` confirms:

1. **Database Migrations (`db/v3/`):** Migrations `0025_slack_message_origin.sql` through `0032_jira_digest_schedule_kind.sql` are present on `main`. Accordingly, the Gate A schema migration is **`db/v3/0033_sheets_digest_v2_remediation.sql`**. Because [`db/v3/migrate.mjs`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/db/v3/migrate.mjs) executes every `.sql` file automatically on startup/deploy, `0033_sheets_digest_v2_remediation.sql` **must contain idempotent DDL schema changes only**; all v1→v2 schedule inventory, dry-run, apply, and rollback operations are isolated in a controlled CLI/service (`sheets-digest-v2-migrate`).
2. **PR #286 Impact on `F-03` (`registered-services.ts` & `gmail-tools-runtime.ts`):**
   - PR #286 updated [`registered-services.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/registered-services.ts#L199-L214) and [`connection-reference.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/gmail/connection-reference.ts#L64) so a user with an active `mysheets` OAuth connection but **zero selected spreadsheets** (`spreadsheets.length === 0`) still receives the 6 Google Drive/Docs tools (`mysheets.create_doc`, etc.) in `getToolCatalogFor`.
   - Because those 6 Drive tools have `tool.service === 'mysheets'`, [`gmail-tools-runtime.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/config/gmail-tools-runtime.ts#L78-L120) (`const hasMySheets = personal.some((t) => t.service === 'mysheets')`) evaluates `hasMySheets = true` even when 0 spreadsheets are selected, stripping shared `sheets` and `SHEETS_EXTENDED_TOOLS` in both `live` and `sandbox` modes.
   - **Remediation in `RMD-03`:** `gmail-tools-runtime.ts` checks `hasMySheetsSpreadsheets = personal.some((t) => t.name === 'mysheets.read_range')` and in `workspaceMode === 'organization'` preserves `sheets.*` (and `SHEETS_EXTENDED_TOOLS`) alongside `mysheets.*`.
3. **End-to-End Trusted Scope Gap in `chat-service.ts` (`F-01`):**
   - In [`chat-service.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/chat-service.ts#L1487-L1508), `ChatService.prepareProposal` is called from lines `1637` and `1814` using `actorForConversation(conversationId, userId)` (`chat-service.ts:1598-1617`), which reads `workspace_id` and `workspace_mode` from `conversations` (note that at `chat-service.ts:1604`, `actorForConversation` maps `'legacy'` to `fallbackMode` when `workspaceRepo` is present, whereas `ScheduleService.confirmProposal` at `schedule-service.ts:339-340` reads raw `owner.rows[0].workspace_mode ?? 'legacy'`). Furthermore, line 1494 calls `analyzeSheetsDigestCandidate` without passing `workspaceMode`, `workspaceId`, `recurrence`, or `fetchOrgSheetsMetadata`.
   - Similarly, [`schedule-service.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/schedule-service.ts#L475-L492) calls `analyzeSheetsDigestCandidate` during `confirmProposal` without `workspaceMode`, `workspaceId`, or `recurrence`, and does not verify `sheetsDigestCandidateMatches(sheetsCandidate, recheck)` before persisting `schedules`.

---

## 2. Schema, Trusted Context Pipeline, Staged Rollout & Reauthorization (`RMD-00` & `RMD-01`)

### 2.1. `SheetsDigestConfig` v2 & `SheetsDigestCandidate` Schema (`packages/tool-schemas/src/types.ts`)

```ts
export type SheetsDigestWorkspaceMode = 'personal' | 'organization' | 'legacy';

export type SheetsDigestDataScope =
  | 'full_tab_verified'
  | 'full_requested_range'
  | 'partial';

export interface SheetsDigestConfigV1 {
  version: 1;
  source: {
    service: 'mysheets' | 'sheets';
    credentialId?: string;
    email?: string;
    spreadsheetId: string;
    spreadsheetTitle: string;
    sheetName?: string;
    range?: string;
    tailRows: number;
  };
  destination:
    | { service: 'slack'; channelId: string; channelLabel?: string }
    | { service: 'telegram'; chatId: string; chatLabel?: string }
    | { service: 'gmail'; recipientEmail: string; credentialId?: string };
  focus?: string;
  includeAiSummary: boolean;
}

export interface SheetsDigestSourceConfigV2 {
  service: 'mysheets' | 'sheets';
  credentialId: string;          // REQUIRED non-null UUID in v2
  email?: string;                // Connected Google OAuth account email (for mysheets)
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName?: string;
  range?: string;                // Explicit A1 range if requested by user; omitted for default bounded scan
  tailRows: number;
}

export type SheetsDigestDestinationConfigV2 =
  | {
      service: 'slack';
      credentialId: string;      // REQUIRED non-null UUID in v2
      channelId: string;
      channelLabel?: string;
    }
  | {
      service: 'telegram';
      credentialId: string;      // REQUIRED non-null UUID in v2 (personal OAuth row owned by schedule.user_id)
      chatId: string;
      chatLabel?: string;
    }
  | {
      service: 'gmail';
      credentialId: string;      // REQUIRED non-null UUID in v2 (personal Gmail OAuth row owned by schedule.user_id)
      senderEmail?: string;      // Authenticated Gmail OAuth account email (dec.email) that sends the message
      recipientEmail: string;    // Approved target recipient email address (may be senderEmail or another single valid email in prompt)
    };

export interface SheetsDigestConfigV2 {
  version: 2;
  workspaceMode: SheetsDigestWorkspaceMode;
  workspaceId: string | null;    // Non-null UUID iff workspaceMode === 'organization'
  source: SheetsDigestSourceConfigV2;
  destination: SheetsDigestDestinationConfigV2;
  focus?: string;
  includeAiSummary: boolean;
}

export type SheetsDigestConfig = SheetsDigestConfigV1 | SheetsDigestConfigV2;

export interface SheetsDigestPreviewInfo {
  workspaceMode: SheetsDigestWorkspaceMode;
  workspaceName?: string;
  sourceConnectionLabel: string;      // e.g. "Google Sheets Cá nhân" | "Google Sheets Tổ chức"
  sourceOwnerLabel: string;           // e.g. "alice@gmail.com" | "Không gian Tổ chức" (never raw credentialId UUID)
  spreadsheetTitle: string;
  spreadsheetId: string;
  sheetName?: string;
  requestedRangeLabel: string;        // e.g. "Tasks!A1:F100" | "Vùng quét mặc định (A1:Z502)"
  destinationConnectionLabel: string; // e.g. "Slack Tổ chức" | "Gmail Cá nhân (gửi từ alice@gmail.com)" | "Telegram Cá nhân"
  destinationTargetLabel: string;     // e.g. "#general" | "finance@company.com" | "Nhóm Vận hành"
  crossBoundaryWarning?: string;      // Present when Personal mysheets sends to Organization Slack
}
```

### 2.2. Gmail Sender Identity vs. Target Recipient Email

In existing production code ([`sheets-digest-candidate.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-candidate.ts#L333-L361) and [`sheets-digest-runner.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-runner.ts#L292-L302)), a user's personal `gmail` OAuth credential provides the **sender account** (`gmail.send_message` sends from the authenticated Google user `dec.email`), while `recipientEmail` is the **target recipient** extracted from the prompt (either an explicit email like `"gửi báo cáo tới manager@company.com"` or defaulting to `dec.email` when the prompt says `"cho tôi / cho mình / email của tôi"`).

Gate A preserves this product capability while locking both identities:
1. **`credentialId` & `senderEmail` (Sender Identity):** `destination.credentialId` pins the `service_credentials.id` row (`service = 'gmail'`, `user_id = schedule.user_id`, `workspace_id IS NULL`), and `destination.senderEmail` records the normalized `dec.email` of that OAuth connection when present. At runtime, `SheetsDigestRunner.verifyConfigAndScope` verifies `gmailRec.id === config.destination.credentialId`, `gmailRec.user_id === schedule.user_id`, and (when `config.destination.senderEmail` is present) `normalizeEmail(dec.email) === normalizeEmail(config.destination.senderEmail)`.
2. **`recipientEmail` (Target Recipient Identity):** `destination.recipientEmail` may be any single valid email address approved by the user in the preview (it is **not** forced to equal `senderEmail`). Both `senderEmail` (`destinationConnectionLabel`) and `recipientEmail` (`destinationTargetLabel`) are displayed in `SheetsDigestPreviewInfo` and bound into `computeSheetsDigestHash`.

### 2.3. Canonical Hash Computation (`computeSheetsDigestHash` & `computeSheetsDigestV1Hash`)

- `computeSheetsDigestV1Hash({ userId, recurrence, config })`: Exact v1 canonical JSON hash retained to verify `version: 1` rows in `compat` mode and during migration inventory/apply.
- `computeSheetsDigestHash({ userId, workspaceMode, workspaceId, recurrence, config })`:
  - When `config.version === 1`: delegates to `computeSheetsDigestV1Hash({ userId, recurrence, config })`.
  - When `config.version === 2`: requires non-empty `source.credentialId` and `destination.credentialId`, and computes SHA-256 over:
    ```json
    {
      "kind": "sheets_digest",
      "version": 2,
      "userId": "<userId>",
      "workspaceMode": "<personal|organization|legacy>",
      "workspaceId": "<workspaceId|null>",
      "recurrence": "<canonicalRecurrence>",
      "source": {
        "service": "<mysheets|sheets>",
        "credentialId": "<uuid>",
        "email": "<normalizedEmail|null>",
        "spreadsheetId": "<id>",
        "sheetName": "<sheetName|null>",
        "range": "<range|null>",
        "tailRows": 20
      },
      "destination": {
        "service": "<slack|telegram|gmail>",
        "credentialId": "<uuid>",
        "senderEmail": "<normalizedSenderEmail|null>",
        "target": "<channelId|chatId|normalizedRecipientEmail>"
      },
      "includeAiSummary": true
    }
    ```

### 2.4. Allowed Source × Destination Matrix by Workspace Mode (Hybrid Opt-In Policy)

| `workspaceMode` | Source `service` | Source Credential Scope | Destination `service` | Destination Credential Scope | Gate A Policy |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`'personal'`** | `'mysheets'` | `user_id = schedule.user_id AND workspace_id IS NULL` | `'gmail'` or `'telegram'` | `user_id = schedule.user_id AND workspace_id IS NULL` | **Allowed** (Standard Personal workflow) |
| **`'personal'`** | `'sheets'` or `'slack'` | Any shared/org credential | Any | Any | **Rejected Fail-Closed** (Personal workspace never accesses shared credentials) |
| **`'legacy'`** | `'mysheets'` or `'sheets'` | `workspace_id IS NULL` (`user_id = schedule.user_id` for `mysheets`) | `'gmail'`, `'telegram'`, `'slack'` | `workspace_id IS NULL` (`user_id = schedule.user_id` for `gmail`/`telegram`) | **Allowed** (`telegram` strictly requires `user_id = schedule.user_id`; shared `telegram` fallback removed per `F-08`) |
| **`'organization'`** | `'sheets'` (Org) | `workspace_id = schedule.workspace_id AND user_id IS NULL` | `'slack'` (Org) | `workspace_id = schedule.workspace_id AND user_id IS NULL` | **Allowed** (Standard Organization workflow) |
| **`'organization'`** | `'mysheets'` (Personal) | `user_id = schedule.user_id AND workspace_id IS NULL` | `'slack'` (Org) | `workspace_id = schedule.workspace_id AND user_id IS NULL` | **Allowed via Hybrid Opt-in** with explicit `crossBoundaryWarning` in Preview disclosing Personal source → Organization Slack |
| **`'organization'`** | `'mysheets'` (Personal) | `user_id = schedule.user_id AND workspace_id IS NULL` | `'gmail'` or `'telegram'` (Personal) | `user_id = schedule.user_id AND workspace_id IS NULL` | **Allowed (Personal-to-Personal inside Org):** Both source and destination belong strictly to `schedule.user_id`; **zero Organization data is accessed or exfiltrated**. Preview explicitly labels both source and destination as `Cá nhân`. |
| **`'organization'`** | `'sheets'` (Org) | `workspace_id = schedule.workspace_id AND user_id IS NULL` | `'gmail'` or `'telegram'` (Personal) | `user_id = schedule.user_id AND workspace_id IS NULL` | **Rejected Fail-Closed in Gate A (`ORG_DATA_EGRESS_FORBIDDEN`):** Reading Organization `sheets` and sending to a Personal `gmail`/`telegram` destination is blocked until an organizational data-egress policy is approved. |

### 2.5. End-to-End Trusted Workspace Context Propagation, Feature Flag Precedence & Two-Phase Zero-Network Confirmation (`chat-service.ts` → `schedule-service.ts` → `schedule-runner.ts` → `server.ts`)

Workspace context is **never** derived from LLM output, untrusted prompt text, or `ChatService.actorForConversation`'s `fallbackMode`. Instead, a shared pure helper `resolveTrustedScheduleScope(row: { workspace_mode?: string | null; workspace_id?: string | null }): { workspaceMode: SheetsDigestWorkspaceMode; workspaceId: string | null }` extracts scope directly from the stored `conversations` or `schedules` row:
- `row.workspace_mode === 'organization'`: requires non-empty UUID `row.workspace_id` (fails closed if null) and returns `{ workspaceMode: 'organization', workspaceId: row.workspace_id }`.
- `row.workspace_mode === 'personal'`: requires `row.workspace_id == null` and returns `{ workspaceMode: 'personal', workspaceId: null }`.
- `row.workspace_mode === 'legacy'` or `null`: requires `row.workspace_id == null` and returns `{ workspaceMode: 'legacy', workspaceId: null }` — **never** coercing a `'legacy'` (`workspace_id = null`) conversation into `'personal'` or `'organization'`.

#### Feature Flag Precedence & Zero Silent V1 Downgrade Policy (`isSheetsDigestEmitV2Enabled`)
1. **Deterministic Precedence Order (`apps/chat-api/src/config/schedules-runtime.ts`):**
   ```ts
   export function isSheetsDigestEmitV2Enabled(options?: { emitV2?: boolean }): boolean {
     if (typeof options?.emitV2 === 'boolean') return options.emitV2;
     const raw = process.env.SHEETS_DIGEST_EMIT_V2?.trim().toLowerCase();
     if (raw === 'true' || raw === '1' || raw === 'on') return true;
     if (raw === 'false' || raw === '0' || raw === 'off') return false;
     return false; // Safe default off until PR-3 v2 runner is deployed and verified
   }
   ```
   - Precedence: **(1) Explicit `options?.emitV2` (`boolean`)** → **(2) `process.env.SHEETS_DIGEST_EMIT_V2`** → **(3) Safe default `false`**.
2. **Prohibition of Unsafe V1 Auto-Digest Creation (Zero Silent Security Downgrade):**
   - Creating a new `version: 1` `sheets_digest` schedule would mint a schedule lacking `source.credentialId`, `destination.credentialId`, `workspaceMode`, and `workspaceId` (`F-01`, `F-08`).
   - Therefore, once `PR-4` lands, **`analyzeSheetsDigestCandidate` and `ScheduleService.confirmProposal` NEVER emit or persist a new `version: 1` `sheets_digest` schedule under any flag state**:
     - When `isSheetsDigestEmitV2Enabled` is `true` (or when generating a `reauthorize-preview`): `analyzeSheetsDigestCandidate` emits `config.version === 2` with full `credentialId` and tenant bindings.
     - When `isSheetsDigestEmitV2Enabled` is `false` (before `PR-3` verification or during an emergency kill-switch): `analyzeSheetsDigestCandidate` fails closed for auto-digest (`canAutoDigest: false`, `reason: 'Chế độ tự động tổng hợp Google Sheets v2 đang tạm tắt theo cấu hình hệ thống (SHEETS_DIGEST_EMIT_V2=false). Lịch sẽ chạy ở chế độ nhắc duyệt (notify_only).'`) — it **never** silently downgrades to an unpinned `version: 1` `sheets_digest` config.
3. **Preview-to-Confirm Flag Drift & Stale V1 Proposal Guards:**
   - If `SHEETS_DIGEST_EMIT_V2` was `true` when `ChatService.prepareProposal` generated the preview (`sheetsCandidate.canAutoDigest === true`), and the flag is toggled to `false` before `ScheduleService.confirmProposal` executes, `confirmProposal` **rejects with `ScheduleConflict('DIGEST_V2_DISABLED_SINCE_PREVIEW', 'Chế độ tự động tổng hợp Google Sheets v2 đã tạm tắt sau khi tạo bản xem trước. Vui lòng tạo lại đề xuất lịch.')` (`HTTP 409`)** — never silently downgrading the confirmed schedule to `version: 1` or `notify_only`.
   - If a user attempts to confirm a stale pre-`PR-4` `schedule_proposal` message whose `sheetsCandidate.config.version !== 2` (`!isSheetsDigestConfigV2(sheetsCandidate.config)`), `confirmProposal` **rejects with `ScheduleConflict('LEGACY_V1_PROPOSAL_STALE', 'Đề xuất lịch phiên bản cũ (v1) không đủ thông tin ràng buộc bảo mật. Vui lòng tạo đề xuất mới để xác nhận.')` (`HTTP 409`)**.

Trusted context flows across 5 hops with **zero external network calls inside any DB transaction**:

1. **Hop 1 — `ChatService.prepareProposal` (Outside DB Transaction, [`apps/chat-api/src/services/chat-service.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/chat-service.ts#L1487-L1508)):**
   - Reads the conversation row `conv` from `conversations` and resolves `{ workspaceMode, workspaceId } = resolveTrustedScheduleScope(conv)` (preserving `'legacy'` when `conv.workspace_mode === 'legacy'`).
   - Reads `emitV2 = isSheetsDigestEmitV2Enabled(this.schedules)` (default `false`).
   - Calls `analyzeSheetsDigestCandidate` **outside any DB transaction** (where `fetchOrgSheetsMetadata` may query Google Sheets API with a bounded `AbortSignal` timeout):
     ```ts
     digestCandidate = await analyzeSheetsDigestCandidate({
       userId: actor.userId,
       workspaceMode,
       workspaceId,
       request: proposal.request,
       recurrence,
       services,
       credentialRepo: this.schedules.credentialRepo,
       encryptionKey: this.schedules.encryptionKey,
       mysheetsEnabled: this.schedules.mysheetsEnabled,
       fetchOrgSheetsMetadata: this.schedules.fetchOrgSheetsMetadata,
       emitV2,
     });
     ```
   - When `digestCandidate.canAutoDigest` is true, `digestCandidate.config` is guaranteed to be `version: 2`, and `services` in `ScheduleProposalMetadata` is normalized to `[digestCandidate.config.source.service, digestCandidate.config.destination.service]`.
2. **Hop 2 — `ScheduleService.confirmProposal` (Two-Phase: Zero Network Calls Inside DB Transaction, [`apps/chat-api/src/services/schedules/schedule-service.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/schedule-service.ts#L293-L500)):**
   - **Invariant (BLOCKER 1):** `ScheduleService.confirmProposal` **never** calls `analyzeSheetsDigestCandidate` or `fetchOrgSheetsMetadata` (or any external HTTP API) while holding a PostgreSQL transaction open. Because `metadata.digestCandidate.config` already contains the resolved `spreadsheetId`, `spreadsheetTitle`, `sheetName`, `range`, `source.credentialId`, and `destination.credentialId` from Hop 1, confirmation performs a **pure-DB transactional verification (`verifySheetsDigestCandidateInTx`)** using the active `pg.PoolClient` (`client`):
     1. Locks `conversations` (`FOR UPDATE`), `schedules` (`FOR UPDATE` if existing), `users` (`FOR UPDATE`), and (when `wsMode === 'organization'`) `workspace_members` (`FOR SHARE`). Verifies `users.status === 'active'` and `workspace_members.status === 'active'`.
     2. Extracts `{ workspaceMode: wsMode, workspaceId: wsId } = resolveTrustedScheduleScope(owner.rows[0])` and `emitV2 = isSheetsDigestEmitV2Enabled(this.options)`.
     3. Verifies flag & version consistency (zero silent downgrade):
        - If `!emitV2 && !metadata.reauthorize`: throws `ScheduleConflict('DIGEST_V2_DISABLED_SINCE_PREVIEW')` (`HTTP 409`).
        - If `!isSheetsDigestConfigV2(sheetsCandidate.config)` (`sheetsCandidate.config.version !== 2`): throws `ScheduleConflict('LEGACY_V1_PROPOSAL_STALE')` (`HTTP 409`).
        - If `sheetsCandidate.config.workspaceMode !== wsMode || sheetsCandidate.config.workspaceId !== wsId`: throws `ScheduleConflict('DIGEST_PREVIEW_CHANGED')` (`HTTP 409`).
     4. Locks and reads the live source and destination `service_credentials` rows **via the same transactional `client` (`SELECT * FROM service_credentials WHERE ... FOR SHARE`)**:
        - Decrypts `config` in memory (CPU-only AES-256-GCM decryption; zero network I/O).
        - Verifies `status === 'active'`, exact tenant ownership (`user_id = userId AND workspace_id IS NULL` for personal credentials; `user_id IS NULL AND workspace_id = wsId` for Org credentials), `sc.id === config.*.credentialId`, `decSource.email === config.source.email` (for `mysheets`), `config.source.spreadsheetId` in `allowedScope.spreadsheets` / `selectedSpreadsheets`, and destination target (`channelId` in `allowedScope.channels`, `chatId` in `allowedScope.chats` / `selectedChats`, or `decDest.email === config.destination.senderEmail` and valid `recipientEmail` for `gmail`).
     5. Recomputes `expectedHash = computeSheetsDigestHash({ userId, workspaceMode: wsMode, workspaceId: wsId, recurrence: proposal.recurrence!, config: sheetsCandidate.config })` and verifies `expectedHash === sheetsCandidate.configHash`.
     6. If any credential was rotated, revoked, disconnected, or scope-narrowed before or concurrently with `confirmProposal`, `verifySheetsDigestCandidateInTx` fails closed and throws `ScheduleConflict('DIGEST_PREVIEW_CHANGED')`.
     7. Writes `workspace_id = wsId`, `workspace_mode = wsMode`, `kind = 'sheets_digest'`, `digest_config = sheetsCandidate.config`, `digest_config_hash = expectedHash`, `digest_approved_at = now` to `schedules`.
3. **Hop 3 — `ScheduleRunner.executeDigestRun` ([`apps/chat-api/src/services/schedules/schedule-runner.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/schedule-runner.ts#L519-L691)):**
   - Passes the `ScheduleRow` (`id`, `conv_id`, `user_id`, `workspace_id`, `workspace_mode`, `version`, `digest_config`, `digest_config_hash`) and **mandatory non-null `runId`** to `SheetsDigestRunner.executeDigest(schedule, runVersion, runId, outerSignal)`.
4. **Hop 4 — `SheetsDigestRunner.verifyConfigAndScope` ([`apps/chat-api/src/services/schedules/sheets-digest-runner.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/services/schedules/sheets-digest-runner.ts)):**
   - Resolves `{ workspaceMode, workspaceId } = resolveTrustedScheduleScope(schedule)` and verifies `config` and live credentials against the schedule's trusted scope.
5. **Hop 5 — `createSheetsDigestAdapter` ([`apps/chat-api/src/server.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/server.ts#L285-L320)):**
   - Receives `(serviceId, userId, config, scheduleContext: { workspaceMode, workspaceId })`, verifies `scheduleContext` matches `config`, and passes `workspaceMode`, `workspaceId`, and pinned `connections` (`mysheets`, `gmail`, `telegram`) into `getAdapterForUser`.

### 2.6. Three-Stage V1/V2 Rollout, Honest Historical Evidence Boundary & Controlled V1 Policy

#### 2.6.1. Honest Historical Evidence Boundary of V1 Schedules (`Class A: v1_pinned_consistency_candidate` vs. `Class B: v1_unpinned_fail_closed`)
Code and schema inspection of [`0001_v3_core.sql`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/db/v3/0001_v3_core.sql#L68-L74), [`0009_gmail_personal_connections.sql`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/db/v3/0009_gmail_personal_connections.sql#L24-L26), [`credential-repo.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/db/repositories/credential-repo.ts), [`gmail-connection-repo.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/db/repositories/gmail-connection-repo.ts), and [`mysheets.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/apps/chat-api/src/routes/connections/mysheets.ts#L550-L692) establishes the exact boundary of what historical database columns can and cannot prove:
1. **Schema Reality of `service_credentials`:** The table has columns `(id, service, user_id, workspace_id, config, created_at, status, status_changed_at)` — it has **no `updated_at` / `config_updated_at` column and no historical config-mutation audit table prior to `0033`**.
2. **What `id`, `created_at`, `status_changed_at`, `connectedAt`, and `digest_config_hash` CAN verify:**
   - `GmailConnectionRepo.saveConnection` (`gmail-connection-repo.ts:57-66`) `DELETE`s and `INSERT`s a new row (new `id`, new `created_at`, new `config.connectedAt`), and `CredentialRepo.upsert*` (`credential-repo.ts:132,222`) rotates `id = gen_random_uuid()`. Thus, matching `sc.id === config.*.credentialId`, `sc.created_at <= s.digest_approved_at`, and (when present in decrypted JSON) `Date.parse(dec.connectedAt) <= Date.parse(s.digest_approved_at)` proves the credential row was not replaced via `saveConnection` or `upsert*` after approval.
   - Checking `sc.status === 'active'` and `(sc.status_changed_at IS NULL OR sc.status_changed_at <= s.digest_approved_at)` proves the credential did not transition to `'reconnect_required'` after approval.
   - Checking `decSource.email === config.source.email`, `config.source.spreadsheetId` in `allowedScope.spreadsheets`, and `s.digest_config_hash === computeSheetsDigestV1Hash(...)` proves the **current** state of the credential is consistent with the approved v1 snapshot.
3. **What They CANNOT Prove (Explicit Historical Evidence Boundary — Never Over-Claimed):**
   - `GmailConnectionRepo.updateConfigIfActive` (`gmail-connection-repo.ts:158`, called by `PUT /api/connections/mysheets/scope` and `POST /api/connections/mysheets/quick-create-spreadsheet`) and `CredentialRepo.updateCredentials` (`credential-repo.ts:337`, called by `services-routes.ts:900,920`) execute `UPDATE service_credentials SET config = $1 WHERE id = $2` **in-place without changing `id`, `created_at`, or `status_changed_at`**.
   - Therefore, **`created_at`, `status_changed_at`, and `digest_config_hash` NEVER provide absolute proof that `service_credentials.config` was never modified after `s.digest_approved_at`**. They establish only **Consistency Eligibility (`evidenceBoundary: 'consistency_only_not_config_immutability_proof'`)**.
4. **Two-Class V1 Inventory Classification (`inspectV1SheetsDigestSchedules`):**
   - **`Class A (`v1_pinned_consistency_candidate` — Consistency-Matched Only, Not Proven Immutable)`:**
     1. `s.workspace_mode IN ('personal', 'legacy') AND s.workspace_id IS NULL`.
     2. `config.source.service === 'mysheets'` with non-empty UUID `config.source.credentialId` + `config.source.email`, and `config.destination.service === 'gmail'` with non-empty UUID `config.destination.credentialId` + `config.destination.recipientEmail`.
     3. Live source and destination `service_credentials` rows exist with `id = config.*.credentialId`, `user_id = s.user_id`, `workspace_id IS NULL`, `status = 'active'`, `created_at <= s.digest_approved_at`, `(status_changed_at IS NULL OR status_changed_at <= s.digest_approved_at)`, `(dec.connectedAt == null || Date.parse(dec.connectedAt) <= Date.parse(s.digest_approved_at))`, `decSource.email === config.source.email`, `config.source.spreadsheetId` in `allowedScope.spreadsheets`, non-empty `decDest.email`, `users.status = 'active'`, and matching `computeSheetsDigestV1Hash`.
     4. Tagged explicitly in inventory reports with `evidenceBoundary: 'consistency_only_not_config_immutability_proof'` (and keeping `'v1_proven_continuable'` only as a backward-compatible alias in test fixtures if needed, while primary reporting uses `'v1_pinned_consistency_candidate'`).
   - **`Class B (`v1_unpinned_fail_closed`)`:**
     - Any `version: 1` schedule lacking pinned `source.credentialId` or `destination.credentialId` (which includes **100% of Organization `version: 1` schedules** and all `version: 1` schedules using `sheets`, `slack`, or `telegram`), or failing any consistency check above. Always fails closed under every rollout policy.

#### 2.6.2. Controlled Three-Stage Rollout & Operator Policy (`SHEETS_DIGEST_V1_COMPAT_POLICY`)
1. **Pre-Rollout Inventory Gate (`Task 0` / Mandatory Before Stage 1 Runner Deploy):**
   - Run read-only `inspectV1SheetsDigestSchedules` / `sheets-digest-v2-migrate --mode=inventory` to produce exact counts and per-schedule diagnostics for `Class A` (`v1_pinned_consistency_candidate`) and `Class B` (`v1_unpinned_fail_closed`).
2. **Controlled V1 Compatibility Policy (`SHEETS_DIGEST_V1_COMPAT_POLICY` in Stage 1 & `--class-a-policy` in Stage 2):**
   - Because `Class A` is consistency-matched rather than cryptographically proven immutable, continuing or auto-upgrading `Class A` is an explicit operator decision controlled by `SHEETS_DIGEST_V1_COMPAT_POLICY` (values: `'strict_pause_all' | 'allow_consistency_candidate'`, **fail-closed default `'strict_pause_all'`**):
     - **`'strict_pause_all'` (Fail-Closed Default):** Both `Class A` and `Class B` `version: 1` schedules fail closed (`blocked` → paused for reauthorization) on tick in `compat` mode and transition to `paused_reauth_required` in Stage 2 `--mode=apply`. No v1 schedule runs or upgrades without explicit owner reconfirmation unless the operator opts in after reviewing inventory.
     - **`'allow_consistency_candidate'` (Explicit Operator Opt-In After Inventory Review):** If the project owner inspects `--mode=inventory` and approves continuing `Class A` (`mysheets → gmail` personal/legacy schedules that pass all 6 consistency checks), setting `SHEETS_DIGEST_V1_COMPAT_POLICY=allow_consistency_candidate` (or passing `--class-a-policy=allow_consistency_candidate` to `sheets-digest-v2-migrate`) allows `Class A` to continue in Stage 1 `compat` mode and auto-upgrade in Stage 2 `apply`, while `Class B` still fails closed unconditionally.
3. **Stage 1 → Stage 2 → Stage 3 Sequence:**
   - **Pre-Stage 1:** Run read-only inventory (`inspectV1SheetsDigestSchedules`) and decide `SHEETS_DIGEST_V1_COMPAT_POLICY` (`strict_pause_all` default vs. `allow_consistency_candidate`).
   - **Stage 1 (`PR-3` + `PR-4`):** Deploy `0033` additive DDL + `PR-3` runner (`SHEETS_DIGEST_V2_MODE=compat`), then deploy `PR-4` and enable `SHEETS_DIGEST_EMIT_V2=true` so all newly created/confirmed schedules are `version: 2` (and when `SHEETS_DIGEST_EMIT_V2=false`, auto-digest fails closed to `notify_only` without ever creating new `version: 1` schedules).
   - **Stage 2 (`PR-6`):** Run `--mode=inventory` and `--mode=dry-run` (zero DB mutations), obtain explicit project owner sign-off on `--class-a-policy`, and run `--mode=apply --confirm-production-apply`.
   - **Stage 3:** Switch `SHEETS_DIGEST_V2_MODE=enforce` so only `version: 2` schedules can execute or resume.

#### 2.6.3. Audit Schema & Optimistic-Concurrency Rollback (`--mode=rollback`)
1. **Migration Audit Table (`db/v3/0033_sheets_digest_v2_remediation.sql`):**
   ```sql
   CREATE TABLE IF NOT EXISTS sheets_digest_v2_migration_audit (
     id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     schedule_id             UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
     user_id                 UUID NOT NULL,
     workspace_mode          TEXT,
     workspace_id            UUID,
     previous_status         TEXT NOT NULL,
     previous_pause_reason   TEXT,
     previous_next_run_at    TIMESTAMPTZ,
     previous_schedule_ver   INTEGER NOT NULL,
     migrated_schedule_ver   INTEGER NOT NULL,
     previous_config_version INTEGER,
     previous_digest_config  JSONB NOT NULL,
     previous_config_hash    TEXT,
     outcome                 TEXT NOT NULL CONSTRAINT sheets_digest_v2_audit_outcome_check
                               CHECK (outcome IN ('upgraded_v2', 'paused_reauth_required', 'already_v2', 'inactive_preserved')),
     reason_code             TEXT NOT NULL,
     reason_detail           TEXT NOT NULL,
     migrated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
     rolled_back_at          TIMESTAMPTZ,
     rollback_outcome        TEXT,
     CONSTRAINT sheets_digest_v2_audit_schedule_unique UNIQUE (schedule_id)
   );
   ```
2. **Safe Rollback Invariants (`--mode=rollback --confirm-production-rollback [--schedule-id=<uuid>]`):**
   - **Optimistic Concurrency / Version Check (`CAS`):** Rollback locks `conversations` and `schedules` `FOR UPDATE` and verifies `s.version === audit.migrated_schedule_ver`. If `s.version !== audit.migrated_schedule_ver` (meaning the user edited, resumed, reauthorized, paused, or cancelled the schedule after migration), rollback **refuses to overwrite** the schedule and records `rollback_outcome = 'skipped_user_modified'`.
   - **No Revival of Revoked Credentials or Permissions:** Before restoring `previous_status = 'active'`, rollback checks live `users.status === 'active'`, live `workspace_members.status === 'active'` (when `workspace_mode === 'organization'`), and verifies via `verifyV1CompatScope` that the live credentials referenced by `previous_digest_config` are still active and still grant scope to `spreadsheetId` and destination. If any permission or credential was revoked, rollback restores `digest_config = audit.previous_digest_config` and `digest_config_hash = audit.previous_config_hash` while keeping `status = 'paused'` (`rollback_outcome = 'restored_paused_due_to_revocation'`), never re-enabling a revoked schedule.

### 2.7. Strict `Resume` Separation & Two-Phase Zero-Network `Reauthorize` Protocol (BLOCKER 1)

1. **`Resume` (`POST /api/schedules/:id/resume` & chat `resume`):**
   - Never mutates `digest_config`, `credentialId`, or `digest_config_hash`.
   - Calls `verifyConfigAndScope` inside the `setStatus` transaction (pure DB verification via `client` with zero network I/O). If `version !== 2` (when enforced or paused for v2 reauth, or unpinned Class B v1 in `compat` mode), hash mismatches, or pinned `credentialId`/scope/user/membership is invalid, throws `ScheduleConflict('REAUTHORIZATION_REQUIRED', 'Kết nối hoặc phạm vi quyền của lịch đã thay đổi. Vui lòng xem lại bản xem trước và xác nhận cấp quyền lại trước khi bật lịch.')` (`HTTP 409`).
2. **Server-Side Reauthorization Preview (`POST /api/schedules/:id/reauthorize-preview` — Two-Phase, Zero Network Inside Transaction):**
   - **Phase A (Outside DB Transaction — Candidate & Metadata Resolution):**
     - Reads the target `schedules` row, verifies caller ownership (`s.user_id === userId`) and tenant scope (`resolveTrustedScheduleScope(s)`), and records `snapshotVersion = s.version`.
     - Calls `analyzeSheetsDigestCandidate` (`emitV2: true`, including any bounded `fetchOrgSheetsMetadata` Google API lookup) **outside any PostgreSQL transaction**.
   - **Phase B (Inside DB Transaction — Lock, Verify & Persist Proposal):**
     - Opens a short PostgreSQL transaction, locks `conversations` (`FOR UPDATE`), `schedules` (`FOR UPDATE`), `users` (`FOR SHARE`), and `workspace_members` (`FOR SHARE` when Org).
     - Verifies `s.version === snapshotVersion` (throws `ScheduleConflict('STALE_VERSION')` if modified concurrently during Phase A), verifies active user/member status, and runs pure-DB `verifySheetsDigestCandidateInTx(client, ...)` (locking live `service_credentials` `FOR SHARE` and verifying `configHash` and scope without any network call).
     - Persists a server-side `schedule_proposal` message via `MessageRepo.createMessage(..., client)` (sealing `slack_message_origins`) with `metadata.reauthorize = true`, `metadata.scheduleId = s.id`, `metadata.baseVersion = s.version`, `metadata.expiresAt = now + 15 minutes`, and `metadata.digestCandidate` (`config` v2, `configHash`, `preview`).
3. **Confirm Reauthorization (`POST /api/conversations/:convId/schedule-proposals/:messageId/confirm` — Zero Network Inside Transaction):**
   - Inside `ScheduleService.confirmProposal` transaction:
     - Checks `if (metadata.reauthorize && existing?.last_proposal_id === messageId) throw new ScheduleConflict('STALE_PROPOSAL')` **before** the idempotent `unchanged` return so a reauthorization proposal is strictly one-time-use.
     - Rejects if `messageId` is not the latest `schedule_proposal` in `convId`, if `existing.version !== metadata.baseVersion`, or if `Date.parse(metadata.expiresAt) < now.getTime()` (`ScheduleConflict('STALE_PROPOSAL')`).
     - Executes pure-DB `verifySheetsDigestCandidateInTx(client, ...)` (using the same transactional `client` with `FOR SHARE` on `users`, `workspace_members`, and `service_credentials`, **zero external network calls**). If credentials, account identity, or scopes changed since preview, throws `ScheduleConflict('DIGEST_PREVIEW_CHANGED')`.
     - Updates `schedules` to `kind = 'sheets_digest'`, `digest_config = metadata.digestCandidate.config` (`version: 2`), `digest_config_hash = expectedHash`, `digest_approved_at = now`, `status = 'active'`, `pause_reason = NULL`, `next_run_at = this.next(...)`, `last_proposal_id = messageId`, `version = existing.version + 1`.

---

## 3. Atomic Pre-Send Admission, Verified Lock Graph & Delivery Recovery (`RMD-02`)

### 3.1. Mandatory `runId`, Non-Bypassable Admission & Zero Network I/O Inside DB Transactions (BLOCKER 1 & BLOCKER 4)

1. **Mandatory `runId` & Non-Bypassable `claimSheetsDigestDelivery` (BLOCKER 4):**
   - Every production or test execution of `SheetsDigestRunner.executeDigest(schedule, runVersion, runId, outerSignal)` **requires a non-empty UUID `runId: string`** (`runId` is never optional).
   - Before constructing `destAdapter` or issuing any outbound HTTP request (`slack.send_message`, `gmail.send_message`, `telegram.send_message`), `executeDigest` **must** execute `claimSheetsDigestDelivery(pool, { runId, scheduleId: schedule.id, convId: schedule.conv_id, userId: schedule.user_id, workspaceMode, workspaceId, scheduleVersion: runVersion, digestConfigHash: schedule.digest_config_hash, sourceCredentialId, destinationCredentialId })` and receive `{ status: 'claimed' }`.
   - If `runId` is missing/invalid, or if `claimSheetsDigestDelivery` does not commit `UPDATE schedule_runs SET delivery_started_at = now() WHERE id = $1 AND schedule_id = $2 AND status = 'planning' AND delivery_started_at IS NULL` along with valid authority/credential checks, `executeDigest` **immediately aborts (`blocked`, `discarded`, or `digest_failed`) with zero outbound HTTP calls**. Legacy unit tests that previously called `executeDigest` without a `schedule_runs` row must create a `schedule_runs` row via the test harness.
2. **Strict Separation of Network I/O and DB Transactions (BLOCKER 1):**
   - `SheetsDigestRunner.executeDigest` performs **all** Google Sheets API reads (`readDigestWindow`), AI summarization (`summarizeWithAi`), and destination OAuth token refresh **before** opening the `claimSheetsDigestDelivery` transaction.
   - `claimSheetsDigestDelivery` executes in a short, self-contained PostgreSQL transaction (`SET LOCAL lock_timeout = '5s'`) that **commits and releases its pooled connection BEFORE the destination adapter sends the HTTP request**.
   - **Never** hold a PostgreSQL transaction or row lock open while awaiting Google, Slack, Gmail, Telegram, or LLM network calls.
3. **Linearization Definition:**
   - **Revocation Before Claim Commit (`T_revoke < T_claim`):** If user disable (`AdminUserRepo.mutate`), workspace member disable/remove (`AdminUserRepo.mutateForWorkspace`), credential disconnect/rotation/scope removal (`CredentialRepo` / `GmailConnectionRepo`), or schedule pause/cancel/edit (`ScheduleService.setStatus` / `confirmProposal`) commits before `claimSheetsDigestDelivery`, `claimSheetsDigestDelivery` observes the updated state and aborts admission (`blocked` or `discarded`) with **zero outbound destination HTTP calls**.
   - **Claim Commit Before Revocation (`T_claim < T_revoke`):** Once `claimSheetsDigestDelivery` commits `delivery_started_at = now()`, that single run has passed the admission point and immediately dispatches its prepared payload; any concurrent revocation waits until `claimSheetsDigestDelivery`'s millisecond DB transaction commits, and blocks all subsequent runs.

### 3.2. Complete Lock Graph Verification Across `apps/chat-api`

| Operation / Code Path | Advisory Lock | Blocking Row Locks (`FOR UPDATE` / `FOR SHARE`) | Non-Blocking Row Locks (`NOWAIT`) | Touches `conversations` / `schedules`? |
| :--- | :--- | :--- | :--- | :--- |
| **`ScheduleService.confirmProposal` / `setStatus`** (`schedule-service.ts:288-298, 700-750`) | `prelockScheduleArtifacts` | `conversations (FOR UPDATE)` → `schedules (FOR UPDATE)` → `users (FOR UPDATE)` | None | Yes (`c → s → u`) |
| **`ScheduleRunner.tick` / `executeDigestRun`** (`schedule-runner.ts:240, 574-579, 868-872`) | None | `conversations (FOR UPDATE)` → `schedules (FOR UPDATE)` → `schedule_runs (FOR UPDATE)` | None | Yes (`c → s → r`) |
| **`ScheduleRunner.cancelRun`** (`schedule-runner.ts:488`) | None | `schedule_runs (FOR UPDATE)` | None | No (`r` only) |
| **`AdminUserRepo.mutate`** (`admin-user-repo.ts:61-95`) | `pg_advisory_xact_lock(schema, 1096111176)` | `users (ORDER BY id FOR UPDATE)` → `auth_sessions (FOR UPDATE)` | None | **No** |
| **`AdminUserRepo.mutateForWorkspace`** (`admin-user-repo.ts:176-285`) | `pg_advisory_xact_lock(schema, workspaceId)` | `auth_sessions (FOR UPDATE)` → `workspace_members JOIN users (ORDER BY wm.user_id FOR UPDATE)` | None | **No** |
| **`CredentialRepo` / `GmailConnectionRepo`** (`credential-repo.ts:41, 271`, `gmail-connection-repo.ts:42-67, 142-160`) | `pg_advisory_xact_lock(service, target)` | `users (FOR UPDATE)` → `service_credentials (FOR UPDATE)` | None | **No** |
| **`claimSheetsDigestDelivery`** (`sheets-digest-runner.ts`) | None | `conversations (FOR UPDATE)` → `schedules (FOR UPDATE)` | `users (FOR SHARE NOWAIT)` → `workspace_members (FOR SHARE NOWAIT)` → `service_credentials (FOR SHARE NOWAIT)` → `schedule_runs (FOR UPDATE NOWAIT)` | Yes (`c → s`, then `NOWAIT` only) |

**Why `claimSheetsDigestDelivery` Cannot Form a Deadlock Cycle (`40P01`):**
1. The only blocking locks acquired by `claimSheetsDigestDelivery` are `conversations (c)` followed by `schedules (s)`. Every path in the codebase that locks both `c` and `s` (`ScheduleRepo.ownedSchedule`, `ScheduleService`, `ScheduleRunner`) acquires `c` before `s`. Because each schedule has a single immutable `conv_id`, `c → s` is a strict tree of depth 1.
2. All locks acquired after `s` inside `claimSheetsDigestDelivery` (`users`, `workspace_members`, `service_credentials`, `schedule_runs`) use **`NOWAIT`** (`FOR SHARE NOWAIT` on authority/credential rows, `FOR UPDATE NOWAIT` on `schedule_runs`):
   - `FOR SHARE` on `users`, `workspace_members`, and `service_credentials` conflicts with `UPDATE`/`DELETE` in `AdminUserRepo`, `CredentialRepo`, and `GmailConnectionRepo` (guaranteeing linearization against revocation), while remaining compatible with concurrent `FOR SHARE` readers (`conversation-repo.ts`, `workspace-core-repo.ts`).
   - If any `NOWAIT` query raises PostgreSQL `55P03` (`lock_not_available`) — for example, because `AdminUserRepo.mutateForWorkspace` is mid-transaction holding `wm, u` or `cancelRun` is holding `r` — `claimSheetsDigestDelivery` **immediately executes `ROLLBACK`**, releasing `c` and `s` so it never waits while holding locks! It then sleeps `25ms / 50ms / 100ms` (up to 3 retries) and restarts the transaction with a fresh snapshot.
   - Because a `NOWAIT` query never adds a waiting edge in PostgreSQL's lock wait-for graph, no cycle involving `u`, `wm`, `sc`, or `r` can ever form.

### 3.3. Delivery State Machine & Manual Recovery (`POST /api/schedule-runs/:id/resolve-delivery`)

Database constraints on `schedule_runs` ([`0016_sheets_automation_and_digest.sql`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/db/v3/0016_sheets_automation_and_digest.sql#L33-L52) + `0033_sheets_digest_v2_remediation.sql`):
- `status IN ('planning', 'planned', 'needs_attention', 'planning_failed', 'missed', 'blocked', 'interrupted', 'discarded', 'digest_sent', 'digest_failed')`
- `(status = 'digest_sent' AND delivery IS NOT NULL AND jsonb_typeof(delivery) = 'object') OR (status <> 'digest_sent' AND delivery IS NULL)`
- `delivery_started_at TIMESTAMPTZ` (**write-once**; never reset to `NULL`)
- `delivery_resolution IN ('confirmed_sent', 'retried_new_run')`

| Phase / Transition | `schedule_runs.status` | `delivery_started_at` | `delivery` | `delivery_resolution` | Semantics |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pre-Dispatch (`planOne`)** | `'planning'` | `NULL` | `NULL` | `NULL` | Run created; reading Sheets & refreshing destination token before claim. |
| **Pre-Claim Cancelled / Stale** | `'discarded'` | `NULL` | `NULL` | `NULL` | Schedule paused/cancelled/updated before claim. Zero sends. |
| **Pre-Claim Revoked / Blocked** | `'blocked'` | `NULL` | `NULL` | `NULL` | User/member deactivated or credential/scope/hash invalid before claim. Schedule paused. Zero sends. |
| **Pre-Claim Read/Token Failed** | `'digest_failed'` | `NULL` | `NULL` | `NULL` | Definite-not-sent (`definiteNotSent = true`): Sheets read failed, pre-claim token refresh failed, or 3x `55P03` claim lock contention before send. |
| **Pre-Claim Server Restart** | `'interrupted'` | `NULL` | `NULL` | `NULL` | `reconcileScheduleRuns` found `status = 'planning' AND delivery_started_at IS NULL`. |
| **Dispatch Claim Committed** | `'planning'` | `<TIMESTAMPTZ>` | `NULL` | `NULL` | `claimSheetsDigestDelivery` committed `delivery_started_at = now()`. Write-once claim consumed. |
| **Post-Claim Provider Accepted** | `'digest_sent'` | `<TIMESTAMPTZ>` | `<JSON receipt>` | `NULL` | Provider returned HTTP 2xx with valid message ID (`ts`, `id`, `message_id`). |
| **Post-Claim Definite Rejection** | `'digest_failed'` | `<TIMESTAMPTZ>` | `NULL` | `NULL` | Deterministic HTTP 4xx (`400`, `401`, `403`, `404`, Slack `channel_not_found`/`invalid_auth`) where provider guaranteed non-acceptance. `delivery_started_at` preserved. |
| **Post-Claim Delivery Unknown** | `'needs_attention'` | `<TIMESTAMPTZ>` | `NULL` | `NULL` | Timeout, socket reset after write, HTTP `429`/`5xx`, invalid 200 JSON, or server crash after claim (`error = SHEETS_DELIVERY_UNKNOWN`). |
| **Manual Recovery: `mark_sent`** | `'digest_sent'` | `<TIMESTAMPTZ>` | `<JSON manualResolution>` | `'confirmed_sent'` | User confirmed message arrived. Transitions to `'digest_sent'` with `delivery.manualResolution`. |
| **Manual Recovery: `retry_new_run`** | `'needs_attention'` (old run) + `'planning'` (new run) | `<TIMESTAMPTZ>` (old) / `NULL` (new) | `NULL` | `'retried_new_run'` (old) | **Preserves audit trail:** Old run stays `'needs_attention'` with `delivery_resolution = 'retried_new_run'` and `delivery_followup_run_id = newRun.id` (never falsified as `'digest_failed'`). Requires `confirmDuplicateRisk === true` (`400 DUPLICATE_RISK_CONFIRMATION_REQUIRED` otherwise). Inserts a brand-new `schedule_runs` row with `delivery_started_at = NULL`. |

---

## 4. Hybrid Source Resolution & Tool Catalog Coexistence (`RMD-03`)

### 4.1. Tool Catalog Coexistence (`apps/chat-api/src/config/gmail-tools-runtime.ts`)

1. Distinguish spreadsheet tools from Drive/Docs tools:
   ```ts
   const hasMySheetsSpreadsheets = personal.some((t) => t.name === 'mysheets.read_range');
   const isOrgMode = options.workspaceMode === 'organization' && Boolean(options.workspaceId);
   const stripSharedSheets = hasMySheetsSpreadsheets && !isOrgMode;
   ```
2. Applied consistently in **both** `mode === 'live'` and `sandbox` branches:
   - When `isOrgMode === true`: never strip `t.service === 'sheets'` or `SHEETS_EXTENDED_TOOLS` when `hasSheets` is true, even if `hasMySheetsSpreadsheets` is also true. Both `sheets.*` and `mysheets.*` coexist in the catalog.
   - When `isOrgMode === false` (`'personal'` or `'legacy'`): strip `t.service === 'sheets'` and `SHEETS_EXTENDED_TOOLS` only when `hasMySheetsSpreadsheets === true` (so a Drive-only `mysheets` connection with 0 spreadsheets never hides shared `sheets`).

### 4.2. Hybrid Source & Destination Resolution (`analyzeSheetsDigestCandidate`)

1. **Tenant-Scoped Credential Queries:**
   - `workspaceMode === 'personal'`: Queries only `credentialRepo.getPersonalCredentials('mysheets' | 'gmail' | 'telegram', userId)`. Never calls `getCredentials('sheets' | 'slack' | 'telegram')`.
   - `workspaceMode === 'organization'` (requires non-null `workspaceId`):
     - Queries Organization `sheets` via `credentialRepo.getCredentials('sheets', workspaceId)` and Personal `mysheets` via `credentialRepo.getPersonalCredentials('mysheets', userId)` (when `mysheetsEnabled` is true).
     - For destination `'slack'`, queries Organization `slack` via `credentialRepo.getCredentials('slack', workspaceId)`.
     - For destination `'gmail'` or `'telegram'`:
       - If the resolved source is Organization `sheets`, fails closed with `reason: 'Chính sách bảo mật Tổ chức hiện chưa cho phép tự động gửi dữ liệu từ Google Sheets Tổ chức ra Gmail hoặc Telegram cá nhân.'` (`ORG_DATA_EGRESS_FORBIDDEN`).
       - If the resolved source is Personal `mysheets`, queries `credentialRepo.getPersonalCredentials('gmail' | 'telegram', userId)` (allowed Personal-to-Personal flow inside Organization).
2. **Organization Spreadsheet Title Lookup (`fetchOrgSheetsMetadata`) & Fail-Closed Ambiguity Handling:**
   - When Organization `sheets` is connected and the prompt references a spreadsheet by title (without an explicit `"cá nhân / mysheets"` qualifier), `analyzeSheetsDigestCandidate` invokes `fetchOrgSheetsMetadata({ credentialId, allowedSpreadsheetIds, workspaceId, signal })`.
   - **Fail-Closed on Metadata Missing / Error:** If `fetchOrgSheetsMetadata` is missing, throws, times out, or fails to resolve titles so that an Organization match cannot be ruled in or out, returns `{ canAutoDigest: false, requiresClarification: true, reason: 'Không thể tải danh sách tên bảng Google Sheets của Tổ chức để đối chiếu nguồn dữ liệu. Vui lòng nêu rõ mã bảng tính (spreadsheetId) hoặc chỉ rõ nguồn dữ liệu (Google Sheets Tổ chức hay Cá nhân).' }` — never silently falling back to Personal `mysheets`.
   - **Collision Detection:** If a prompt matches both an Organization `sheets` spreadsheet and a Personal `mysheets` spreadsheet without explicit source disambiguation (`"tổ chức"` vs. `"cá nhân"`), returns `{ canAutoDigest: false, requiresClarification: true, reason: 'Có nhiều bảng tính trùng khớp giữa Google Sheets Tổ chức và Google Sheets Cá nhân. Vui lòng chỉ rõ nguồn dữ liệu cần dùng.' }`.

---

## 5. Honest 3-Tier KPI Verification via Internal Bounded Digest Reader (`RMD-04`)

### 5.1. Public Tool Limits Preserved vs. Internal Bounded Digest Reader (`readDigestWindow`)

- **Public Tools Unchanged:** `sheets.read_range`, `mysheets.read_range`, `sheets.aggregate_rows`, and `mysheets.aggregate_rows` retain their existing schemas and caps (`limit <= 50`, `tail:20`).
- **Internal Adapter Method (`readDigestWindow`):**
  - Implemented in [`sheets-shared.ts`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/packages/tool-adapters/src/sheets/sheets-shared.ts) and exposed on the adapter objects returned by [`createSheetsAdapter`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/packages/tool-adapters/src/sheets/sheets-adapter.ts) and [`createPersonalSheetsAdapter`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/system/packages/tool-adapters/src/sheets/personal-sheets-adapter.ts).
  - Scans either an explicit bounded user A1 range (`<= 500` data rows, `<= 26` cols) or default `<sheetTitle>!A1:Z502` (1 header row + up to 501 data rows to detect overflow past 500 populated rows), plus tab `gridProperties(rowCount, columnCount)`.

### 5.2. Deterministic 3-Tier `dataScope` Classification (`gridProperties.rowCount` Never Reported as Data Row Count)

1. **`full_tab_verified`:** `!explicitRangeRequested && !windowClipped && gridRowCapacity !== null && gridRowCapacity <= 501 && gridColCapacity !== null && gridColCapacity <= 26`.
   - Copy: `"Phạm vi dữ liệu: Đã xác minh toàn bộ trang tính (<scannedRange> · <totalRows> dòng có dữ liệu)."`
2. **`full_requested_range`:** `explicitRangeRequested && !windowClipped`.
   - Copy: `"Phạm vi dữ liệu: Toàn bộ vùng yêu cầu (<scannedRange> · <totalRows> dòng có dữ liệu)."`
3. **`partial`:**
   - **Sub-case 3a (`!windowClipped`, e.g., 20 populated rows on a 1,000-row default grid):** All `<totalRows>` populated rows in `A1:Z502` were read without clipping, but physical grid capacity exceeds `501×26`.
     - Copy: `"Phạm vi dữ liệu (trong vùng đã quét <scannedRange>): Ghi nhận <totalRows> dòng có dữ liệu trong vùng quét (không quét ngoài vùng <scannedRange>)."`
   - **Sub-case 3b (`windowClipped === true`, e.g., >500 data rows or >26 columns):**
     - Copy: `"⚠️ Phạm vi dữ liệu một phần (partial — vượt giới hạn quét <scannedRange>): Chỉ thống kê trên <totalRows> dòng dữ liệu đầu tiên trong vùng đã quét (KHÔNG phải tổng toàn bảng)."`

---

## 6. Verification Matrix & Acceptance Criteria (`TC-01` → `TC-25`)

| Test ID | Requirement | Deterministic Verification Scenario |
| :--- | :--- | :--- |
| **`TC-01`** | `RMD-01` | **Personal Workspace Isolation:** `workspaceMode: 'personal'` queries only `user_id = userId AND workspace_id IS NULL`. Shared/Org credentials are never read. |
| **`TC-02`** | `RMD-01` | **Organization Workspace Isolation:** Schedule in Org A uses only Org A's `workspace_id` credentials and never falls back to Org B or `workspace_id IS NULL`. |
| **`TC-03`** | `RMD-01` / `F-08` | **Telegram Personal-Only Enforcement:** User without personal `telegram` credential fails closed; legacy/other-user `telegram` rows are never read. |
| **`TC-04`** | `RMD-01` / `RMD-03` | **Org Hybrid Matrix & Gmail Sender vs. Recipient:** (a) `mysheets → org slack` succeeds with `crossBoundaryWarning`; (b) `mysheets → personal gmail/telegram` in Org succeeds as personal-only flow; (c) `org sheets → personal gmail/telegram` fails closed (`ORG_DATA_EGRESS_FORBIDDEN`); (d) Gmail pins both `senderEmail` (`dec.email`) and arbitrary valid `recipientEmail` (`finance@company.com`). |
| **`TC-05`** | `RMD-02` | **Pause Race Before Claim:** Schedule paused while reading Sheets (`delivery_started_at IS NULL`) → `claimSheetsDigestDelivery` returns `discarded`, 0 sends. |
| **`TC-06`** | `RMD-02` | **Member Deactivation Race Before Claim:** Org member deactivated before claim → `claimSheetsDigestDelivery` returns `blocked`, pauses schedule, 0 sends. |
| **`TC-07`** | `RMD-02` | **Credential Revocation / Scope Narrowing Race Before Claim:** Credential deleted or `spreadsheetId` removed before claim → `blocked`, pauses schedule, 0 sends. |
| **`TC-08`** | `RMD-02` | **Once-Schedule Completion Admission:** `recurrence.type = 'once'` (`status = 'completed'` after `tick()`) is admitted by `claimSheetsDigestDelivery` when version/hash match and `delivery_started_at IS NULL`. |
| **`TC-09`** | `RMD-02` | **Ambiguous Post-Claim Failure (`SHEETS_DELIVERY_UNKNOWN`):** Timeout or HTTP 5xx after `delivery_started_at` commit → `status = 'needs_attention'`, `error = SHEETS_DELIVERY_UNKNOWN`, no auto-retry, blocks `replan`. |
| **`TC-10`** | `RMD-03` | **Runtime Tool Catalog Coexistence (Post-PR #286):** In Org mode, `sheets.*` and `mysheets.*` coexist; a Drive-only `mysheets` connection (0 spreadsheets) never strips `sheets.*`. |
| **`TC-11`** | `RMD-04` | **Verified KPI Aggregation (20, 50, 500 rows) via Internal `readDigestWindow`:** Computes exact sums/counts across 20, 50, and 500 rows while public `read_range` tool remains capped at `limit <= 50` / `tail:20`. |
| **`TC-12`** | `RMD-04` | **Partial KPI Guard (>500 rows / >26 cols):** 650-row sheet is capped at 500 rows with `dataScope = 'partial'`, `windowClipped = true`, and partial warning banner. |
| **`TC-13`** | `RMD-00` / `RMD-01` | **Staged Rollout (`compat` vs `enforce`), Honest Class A/B Inventory (`evidenceBoundary`) & CAS Rollback:** (a) Inventory classifies v1 schedules into `Class A` (`v1_pinned_consistency_candidate`, `evidenceBoundary: 'consistency_only_not_config_immutability_proof'`) and `Class B` (`v1_unpinned_fail_closed`, `evidenceBoundary: 'unpinned_or_inconsistent'`), explicitly recording that `service_credentials` has no `updated_at` column or config-mutation audit log prior to `0033` so `created_at + status_changed_at + connectedAt + hash` proves consistency eligibility only and never proves config immutability; (b) `SHEETS_DIGEST_V1_COMPAT_POLICY` (`'strict_pause_all'` fail-closed default vs. `'allow_consistency_candidate'` explicit operator opt-in after inventory review) controls whether Class A rows are paused for reauthorization or allowed to continue/auto-upgrade; (c) `inventory` and `dry-run` mutate 0 rows; (d) `rollback` enforces `WHERE version = migrated_schedule_ver` and never reactivates revoked credentials. |
| **`TC-14`** | `RMD-00` / `RMD-01` | **`Resume` vs. Server-Side `Reauthorize` (TTL, Version, One-Time Use):** `resume` rejects rotated credentials with `REAUTHORIZATION_REQUIRED` without mutating `credentialId`/hash. `reauthorize-preview` creates a server-side proposal with 15m TTL and `baseVersion`; expired, reused, or drifted proposals reject on `confirmProposal`. |
| **`TC-15`** | `RMD-03` | **Hybrid Source Resolution — Org Metadata Lookup, Failure/Collision & Friendly Preview:** Org title lookup failure or Org/Personal title collision fails closed with `requiresClarification: true`; Preview shows friendly labels without raw UUID `credentialId`. |
| **`TC-16`** | `RMD-04` | **KPI 3-Tier `dataScope` & Sparse/1,000-Row Grid Honesty:** 20 data rows on a 1,000-row grid reports `dataScope = 'partial'` (`windowClipped = false`, 20 rows in `A1:Z502`, never claiming 1,000 data rows or full-tab verification); sparse rows beyond 501 report `partial`; explicit range `Tasks!A1:F100` reports `full_requested_range`; `<= 501` grid capacity reports `full_tab_verified`. |
| **`TC-17`** | `RMD-02` | **Crash-After-Claim, Non-Reuse of `delivery_started_at` & Audit-Preserving Recovery:** `delivery_started_at` is never cleared; `reconcileScheduleRuns` sets `needs_attention` (`SHEETS_DELIVERY_UNKNOWN`); `resolve-delivery` with `retry_new_run` requires `confirmDuplicateRisk: true`, keeps the old run in `needs_attention` with `delivery_resolution = 'retried_new_run'`, and creates a new `runId`. |
| **`TC-18`** | `RMD-02` | **Verified Lock Graph Concurrency Under Real PostgreSQL Locks:** Concurrent `setStatus`, `AdminUserRepo.mutateForWorkspace`, `CredentialRepo`, and `claimSheetsDigestDelivery` on real PostgreSQL connections complete with zero `40P01` deadlocks, zero DB locks held across HTTP calls, and deterministic `55P03` retry handling. |
| **`TC-19`** | `RMD-01` / `RMD-03` | **End-to-End Trusted Context Pipeline (`ChatService` → `ScheduleService` → `ScheduleRunner` → `SheetsDigestRunner` → `server.ts`):** Verifies trusted scope from `conversations` flows through `ChatService.prepareProposal`, `ScheduleService.confirmProposal`, `schedules`, `SheetsDigestRunner`, and `createSheetsDigestAdapter`. |
| **`TC-20`** | `RMD-01` / `RMD-02` (Blocker 1) | **Zero External Network Calls Inside `confirmProposal` / `reauthorize-preview` DB Transaction:** Verifies `ScheduleService.confirmProposal` and `createReauthorizePreview` execute `verifySheetsDigestCandidateInTx(client, ...)` purely against PostgreSQL (`FOR SHARE` on `service_credentials`) and make **0 calls** to `fetchOrgSheetsMetadata` or external HTTP endpoints while a DB transaction is open. |
| **`TC-21`** | `RMD-01` (Blocker 3 & Pre-Task-3 #2) | **Feature Flag Precedence, Zero Silent V1 Downgrade & Preview-to-Confirm Drift Guard (`isSheetsDigestEmitV2Enabled`):** (a) Verifies precedence `options.emitV2 > process.env.SHEETS_DIGEST_EMIT_V2 > false`; (b) when `emitV2 === false`, `analyzeSheetsDigestCandidate` returns `canAutoDigest: false` (`notify_only` fallback) and **never** emits an unpinned `version: 1` `sheets_digest` config; (c) if `SHEETS_DIGEST_EMIT_V2` flips from `true` (at Preview) to `false` (at Confirm), `confirmProposal` rejects with `409 DIGEST_V2_DISABLED_SINCE_PREVIEW`; (d) confirming a stale pre-`PR-4` `version: 1` proposal rejects with `409 LEGACY_V1_PROPOSAL_STALE`. |
| **`TC-22`** | `RMD-01` (Blocker 3) | **Legacy Conversation Trusted Workspace Mode Preservation:** A conversation with `workspace_mode = 'legacy'` and `workspace_id = NULL` retains `workspaceMode = 'legacy'` across `ChatService.prepareProposal`, `ScheduleService.confirmProposal`, `schedules`, and `SheetsDigestRunner` even when `workspaceRepo` is configured (never misclassified as `'personal'` or `'organization'`). |
| **`TC-23`** | `RMD-01` (Blocker 2 & Pre-Task-3 #1) | **Controlled V1 Compatibility Policy (`SHEETS_DIGEST_V1_COMPAT_POLICY: 'strict_pause_all' | 'allow_consistency_candidate'`):** (a) Organization `version: 1` schedules and all unpinned `Class B` schedules fail closed under every policy without binding to current Org or shared credentials; (b) under fail-closed default `SHEETS_DIGEST_V1_COMPAT_POLICY='strict_pause_all'`, `Class A` (`v1_pinned_consistency_candidate`) also fails closed (`paused_reauth_required`); (c) only when the operator explicitly sets `SHEETS_DIGEST_V1_COMPAT_POLICY='allow_consistency_candidate'` after reviewing `--mode=inventory` does `Class A` continue in `compat` mode / auto-upgrade in Stage 2. |
| **`TC-24`** | `RMD-02` (Blocker 4) | **Mandatory `runId` & Non-Bypassable Admission Claim:** Invoking `SheetsDigestRunner.executeDigest` with a missing/invalid `runId` or an unclaimed `schedule_runs` row fails closed before constructing `destAdapter` and makes **0 outbound HTTP calls** to any provider. |
| **`TC-25`** | `RMD-01` / `RMD-02` (Blocker 1) | **Concurrent Credential Rotation / Revocation During `confirmProposal`:** Real PostgreSQL barrier test where a credential is rotated/disconnected or user/member is deactivated concurrently with `ScheduleService.confirmProposal` → detected inside the transaction by `verifySheetsDigestCandidateInTx(client, ...)`, rejecting with `ScheduleConflict('DIGEST_PREVIEW_CHANGED')` and persisting 0 active schedules with revoked credentials. |
