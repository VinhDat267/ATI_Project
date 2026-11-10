# Google Sheets Personal (`MYSHEETS-LIVE`) & Digest V2 (`SHEETS-DIGEST-V2`) Staging Runbook & Sanitized Receipt Template

> **STATUS:** `NOT_RUN` — This document is a finite staging verification runbook and sanitized receipt template (`GAS-03`).
> **IMPORTANT:** No live Google OAuth Picker sessions, live Google Sheets writes, live Slack/Gmail/Telegram outbound messages, or live third-party LLM calls were executed during the automated `GAS-01..GAS-12` remediation run. Production activation of `MYSHEETS_ENABLED=on`, `ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=true`, or live `sheets_digest` schedules remains gated on completing this runbook with owner-approved disposable staging accounts and attaching real, sanitized receipts.

---

## 1. Scope & Evidence Classification

To prevent conflating mocked/loopback tests with real provider verification, every verification artifact in Planora v3 must declare one of the following classifications:

| Classification | Description | What It Certifies | What It Does NOT Certify |
| :--- | :--- | :--- | :--- |
| **`UNIT_AND_LOOPBACK_HARNESS`** | Vitest unit/integration suites against real isolated PostgreSQL (`127.0.0.1:56534/ati_v3`) + local HTTP loopback provider fixtures. | SQL CAS/lease semantics, receipt validation (`GAS-01`), post-claim lifecycle safety (`GAS-04`), explicit range binding (`GAS-05`), locale/unformatted math (`GAS-06`), raw-key aggregation (`GAS-07`), immutable run config snapshot (`GAS-08`), paused retry guard (`GAS-09`), cross-worker append lease (`GAS-10`), Drive target allowlist (`GAS-11`). | Live Google OAuth consent screen, Google Picker origin/token binding, or live Slack/Gmail/Telegram network delivery. |
| **`JSDOM_REAL_BACKEND`** | `apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx` (React/JSDOM + real Express HTTP + isolated PostgreSQL). | End-to-end HTTP + DB state transitions from React components (`ScheduleSection`, `ScheduleMoment`, `ScheduleRunRecovery`). | Real Chromium layout, real browser navigation, or live external OAuth redirects. |
| **`BROWSER_MOCKED_API`** | `apps/chat-web/tests/browser/sheets-digest-v2-recovery.spec.ts` (Playwright Chromium with `/api/**` route interception, wired via `SCENARIO=sheets_digest_v2_recovery`). | Real Chromium DOM rendering, interactive checkboxes, buttons, alerts, and navigation. | Backend SQL queries or live external providers. |
| **`LIVE_STAGING_PROVIDER` (`NOT_RUN`)** | Manual/staging execution against real Google OAuth + Picker + Sheets API and real Slack/Gmail/Telegram test destinations using this runbook. | Full production readiness for `MYSHEETS-LIVE` and `SHEETS-DIGEST-V2`. | Must be re-run at the exact release candidate commit SHA before production signoff. |

---

## 2. Disposable Staging Prerequisites (Owner-Approved Only)

Before executing this runbook, provision dedicated, non-production resources:

1. **Google Cloud OAuth & Picker Test Account (`mysheets`)**:
   - Disposable Google account (e.g., `staging-mysheets-a@example.com`).
   - Two disposable spreadsheets in Google Drive:
     - `Allowed Spreadsheet A` (selected in Google Picker; contains tab `Tasks` with `vi_VN` and `en_US` formatted numbers).
     - `Unselected Spreadsheet B` and `Unselected Doc C` (never selected in Google Picker — used to verify `403 MYSHEETS_SPREADSHEET_NOT_ALLOWED` and `403 MYSHEETS_DRIVE_TARGET_NOT_ALLOWED`).
2. **Organization Service Account (`sheets`)**:
   - Disposable Google Workspace service account shared only with `Org Spreadsheet D`.
3. **Disposable Outbound Destinations**:
   - **Slack**: Dedicated staging channel `#staging-sheets-digest` in test workspace.
   - **Gmail**: Disposable recipient inbox `staging-digest-sink@example.com`.
   - **Telegram**: Disposable staging bot + test group chat.

---

## 3. Finite Staging Execution Matrix (`STATUS: NOT_RUN`)

| Gate ID | Scenario | Expected Provider & DB Outcome | Status |
| :--- | :--- | :--- | :--- |
| **`STG-MYSHEETS-01`** | Connect Personal Google Sheets via OAuth + select only `Allowed Spreadsheet A` in Google Picker. | `service_credentials.allowed_scope.spreadsheetIds` contains only `Allowed Spreadsheet A`. Reading `Unselected Spreadsheet B` returns `403 MYSHEETS_SPREADSHEET_NOT_ALLOWED` with 0 Google Sheets value mutations. | `NOT_RUN` |
| **`STG-MYSHEETS-02`** | Execute `mysheets.append_rows` with `deduplicateByColumn` from two concurrent requests against `Allowed Spreadsheet A`. | `sheets_append_leases` serializes the two workers; post-lease fresh read observes the first write; exactly 1 row is appended in Google Sheets readback. | `NOT_RUN` |
| **`STG-MYSHEETS-03`** | Verify `ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=false` (default) blocks `create_drive_folder`, `create_doc`, `append_doc_text`, `move_drive_file`; when temporarily set to `true` in staging, verify `move_drive_file` / `append_doc_text` on `Unselected Doc C` fails closed (`403 MYSHEETS_DRIVE_TARGET_NOT_ALLOWED`). | 0 Drive/Docs mutations on unselected files. | `NOT_RUN` |
| **`STG-DIGEST-01`** | Create & confirm V2 `sheets_digest` schedule with explicit range (`Tasks!A1:B3`) and `includeAiSummary = false` (deterministic mode) -> trigger run to **Slack**. | Google Sheets API request queries `Tasks!A1:B3` with `valueRenderOption=UNFORMATTED_VALUE` + `FORMATTED_VALUE`; 0 calls to `9router`/LLM; `schedule_runs.state = 'digest_sent'`; `delivery.slackMessageTs` matches Slack channel readback. | `NOT_RUN` |
| **`STG-DIGEST-02`** | Trigger V2 `sheets_digest` schedule with `includeAiSummary = true` to **Gmail** and **Telegram**. | `schedule_runs.dispatched_config` and `dispatched_config_hash` captured at claim; `delivery.gmailMessageId` and `delivery.telegramMessageId` persisted and verified in recipient inbox/chat. | `NOT_RUN` |
| **`STG-DIGEST-03`** | Simulate post-send network drop after `markRunDeliveryStarted` -> verify `needs_attention` (`SHEETS_DELIVERY_UNKNOWN`) -> test `mark_sent` and `retry_new_run` (including paused schedule 409 guard). | No automatic retry on uncertain delivery; `mark_sent` uses immutable `run.dispatched_config` snapshot; paused schedule rejects `retry_new_run` with `409 SCHEDULE_PAUSED` without consuming resolution. | `NOT_RUN` |
| **`STG-DIGEST-04`** | Close browser tab -> wait for scheduled due window -> restart API process across missed window. | Background runner executes due run with browser closed; single recovery run created after restart according to missed-run policy. | `NOT_RUN` |

---

## 4. Sanitized Receipt Bundle Template (`NOT_RUN`)

When executing this runbook in staging, save sanitized JSON receipts under `docs/ai-evidence/staging-receipts-<git-sha>/` using the template below (redact all OAuth tokens, refresh tokens, cookies, and personal emails):

```json
{
  "bundleVersion": "1.0",
  "status": "NOT_RUN",
  "gitHeadSha": "<REPLACE_WITH_EXACT_GIT_HEAD_SHA>",
  "executedAt": null,
  "operator": null,
  "environment": "staging",
  "gates": {
    "STG-MYSHEETS-01": { "status": "NOT_RUN", "allowedSpreadsheetIdRedacted": null, "unselectedBlockedStatus": null },
    "STG-MYSHEETS-02": { "status": "NOT_RUN", "leaseId": null, "fencingTokensObserved": [], "finalSheetRowCount": null },
    "STG-MYSHEETS-03": { "status": "NOT_RUN", "killSwitchDefaultOffVerified": null, "unselectedDriveTargetBlockedStatus": null },
    "STG-DIGEST-01": { "status": "NOT_RUN", "runId": null, "dispatchedConfigHash": null, "slackMessageTs": null, "llmCallsCount": null },
    "STG-DIGEST-02": { "status": "NOT_RUN", "gmailRunId": null, "gmailMessageId": null, "telegramRunId": null, "telegramMessageId": null },
    "STG-DIGEST-03": { "status": "NOT_RUN", "uncertainRunId": null, "pausedRetryHttpStatus": null, "markSentSourceSnapshotVerified": null },
    "STG-DIGEST-04": { "status": "NOT_RUN", "browserClosedRunId": null, "restartRecoveryRunId": null }
  },
  "artifactSha256Manifest": {}
}
```

### Integrity & Hash Verification Command

```powershell
Get-ChildItem docs/ai-evidence/staging-receipts-* -File | ForEach-Object {
  $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
  "$hash  $($_.Name)"
}
```
