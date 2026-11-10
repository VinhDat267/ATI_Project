# 02 — Source Ancestry, `--no-ff` Merge Assembly & Task B Focused Contract Evidence

**Audit Bundle:** `docs/audits/2026-11-10-cross-service-integration/`  
**Document Status:** Task B Completed — Combined Candidate Assembled & Shared Contracts Verified (`INDEPENDENTLY VERIFIED`); Tasks C, D, E `PENDING / NOT RUN`  
**Date:** 2026-11-10  
**Isolated Integration Worktree:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate`  
**Integration Branch:** `VinhDat267/ati-v3-cross-service-integration-gate` (local only — **not pushed**, **no PR opened yet**)  
**Current Gate Status:**
- **Gate A:** `NOT READY — BLOCKING DEFECT OR MISSING CRITICAL EVIDENCE` (Tasks C, D, E pending by phase gate)
- **Gate B:** `NOT READY`
- **Gate C:** `PRODUCTION ACTIVATION — HOLD`

---

## 1. Session Provenance & Source Head Revalidation (`2026-11-10`)

### 1.1. Model, Effort & Workspace Isolation
| Check | Result | Evidence | Label |
| --- | --- | --- | --- |
| **Effective Launch Model & Effort** | `antigravity/gemini-4-carbon-high/high` (`EFFORT LEVEL: 1.00`, no fallback) | Orca `worker-show` `launch.effective = antigravity/gemini-4-carbon-high/high` (verified by coordinator Codex); `settings.json` `"model": "Gemini 4 Carbon (High)"`; initial transcript `step_index: 0` `Model Selection` = `Gemini 4 Carbon (High)` | `INDEPENDENTLY VERIFIED` |
| **Raw Upstream Model Wire Header** | Not exposed in local session transcript | Local `transcript.jsonl` records `source: "MODEL"` without raw HTTP `modelVersion` header | `NOT VERIFIED` |
| **Environment & `.env` Isolation** | `has_dotenv=False`; clean `npm ci` (`added 302 packages` in `19s`, `exit 0`); zero live credentials loaded | `Test-Path .env` -> `False`; `npm ci` (`exit 0`) | `INDEPENDENTLY VERIFIED` |
| **Disposable PostgreSQL Isolation** | Dedicated container `ati-xsvc-v2-taskb-56789` (`9beaf3ad4ef631e99919d2207933947e151c9a140ecd3cc8fa30b09df981658b`, `postgres:16-alpine`, `127.0.0.1:56789->5432/tcp`, DB `ati_v3_taskb`, `ALLOW_ISOLATED_TEST_PORT=1`), removed via `docker rm -f ati-xsvc-v2-taskb-56789` after verification | Pre-existing `ati-cal-combined-gate-56657` (`9718bcf4290f`, `127.0.0.1:56657`) remained untouched before, during, and after Task B | `INDEPENDENTLY VERIFIED` |

### 1.2. Pre-Merge Revalidation of `origin/main` and Source Draft PRs
Executed `git fetch origin --prune`, `git rev-parse`, and `gh pr view 313/314/306 --json number,state,isDraft,headRefName,headRefOid` immediately before `M0` (`exit 0`). Zero source movement occurred:

| Role | Branch / Draft PR | State | Exact Commit SHA | Exact Full-Tree SHA | Merge-Base vs `origin/main` |
| --- | --- | --- | --- | --- | --- |
| **Baseline** | `origin/main` | Base | `2eed8d1d4309e833088d6f1d3fa774189049e283` | `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4` | `2eed8d1d4309e833088d6f1d3fa774189049e283` |
| **Source 1 (Trello)** | PR `#313` (`VinhDat267/trello-v3-combined-gate`) | `OPEN` (`isDraft: true`) | `1c17527f16715b2c6655c170cdb448673a84dd1b` | `f53ed6b2b7cfdeae0f27d18e1fc7831cc69f7d76` | `2eed8d1d4309e833088d6f1d3fa774189049e283` |
| **Source 2 (Calendar)** | PR `#314` (`VinhDat267/calendar-v3-combined-gate`) | `OPEN` (`isDraft: true`) | `3807986542dbe3470b8f3f1cd42413cb7bd460dd` | `8805043497bfffe05d9620c520d098abfb00a60c` | `2eed8d1d4309e833088d6f1d3fa774189049e283` |
| **Source 3 (Sheets R2)** | PR `#306` (`VinhDat267/sheets-gas-recovery-guard-argon`) | `OPEN` (`isDraft: true`) | `f292884d0ae965ffb9841e7063b8843cd266b17e` | `a9ca98c257a99da8b8d1fde266091f2a3897719b` | `2eed8d1d4309e833088d6f1d3fa774189049e283` |

---

## 2. Traceable `--no-ff` Commit Lineage & Anchored Pre-Docs Commit

> **Non-Self-Referential Anchor Rule:** Because a Git commit cannot contain its own SHA, all commit/tree provenance below is anchored at **`07c086bfb5299632fc35dd85cbcf906ce4cd1099`** (**Task B Pre-Docs Code+Test Anchor Commit**, full-tree SHA **`fcd0e64019b0c70eb96f7e0d6352ead5f1fc7d4d`**). The subsequent Task B documentation commit adds/updates only the 4 owned markdown files (`02`, `03`, `XSVC-INTEGRATION-V2.md`, and `docs/handoff/log/2026-11-10-xsvc-integration-v2-task-b-assembly.md`) with zero source or test changes relative to `07c086bfb5299632fc35dd85cbcf906ce4cd1099`.

### 2.1. First-Parent Commit & Merge Parent Table (`origin/main..07c086bf`)

| Step | Commit SHA | Full-Tree SHA (`^{tree}`) | Parent Commit SHA(s) (`%P`) | Commit Subject & Notes |
| --- | --- | --- | --- | --- |
| **Base** | `2eed8d1d4309e833088d6f1d3fa774189049e283` | `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4` | `0ea54325a9b141c6a04cd934fefad2d12c6a2d6d` `92821ecbe7a27196e6af54ac5bf54101f47d8267` | `Merge pull request #303 from VinhDat267/fix/r1-c1-digest-live-scope-guard` (`origin/main`) |
| **`C_A`** | `83cb340128fb9f1eefaa6b5ed346237f91667f30` | `84f3ec5e10877e48043c496b84f90e3ad514c06d` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | `docs(audit): add cross-service integration v2 preflight plan and conflict matrix` (Task A, 4 docs-only files) |
| **`C_B0`** | `f228d8a4159b944a466f246ec44a9b6e1b28b74c` | `ac3f4abdb526e51942303896a48999e4b251b671` | `83cb340128fb9f1eefaa6b5ed346237f91667f30` | `docs(audit): correct Task A script, workflow, risk, and gate provenance` (3 docs-only files corrected before merges) |
| **`M0`** | `b0232fdd9f5f59c6d1b4c0fc2b882eaf2fcd8954` | `d896d0997d3b79f3265ad40ac10e306b717ac773` | `f228d8a4159b944a466f246ec44a9b6e1b28b74c` `1c17527f16715b2c6655c170cdb448673a84dd1b` | `chore(integration): merge trello combined gate PR #313 (1c17527f)` (`exit 0`, `0` conflicts) |
| **`M1`** | `edbeeffeca97cdb95a4b5dec88f9ee61645910aa` | `021ce568864dbb9fb33e095e72bf8e820b0361e9` | `b0232fdd9f5f59c6d1b4c0fc2b882eaf2fcd8954` `3807986542dbe3470b8f3f1cd42413cb7bd460dd` | `chore(integration): merge calendar combined gate PR #314 (38079865)` (`exit 0`, clean auto-merge of `chat-service.ts`; intermediate `npm run typecheck:v3` `exit 0`) |
| **`M2`** | `678c5337f0558c3158994825a23e9d09d6ad744c` | `6185a45a29537cad679a3b161ede539350696877` | `edbeeffeca97cdb95a4b5dec88f9ee61645910aa` `f292884d0ae965ffb9841e7063b8843cd266b17e` | `chore(integration): merge sheets r2 gate PR #306 (f292884d) and resolve shared contracts` (`--no-commit` exited `1` on exact 3 conflicts; resolved & verified `typecheck:v3` + `static-guard.test.ts` `exit 0`) |
| **`C_B1` (Code+Test Anchor)** | **`07c086bfb5299632fc35dd85cbcf906ce4cd1099`** | **`fcd0e64019b0c70eb96f7e0d6352ead5f1fc7d4d`** | `678c5337f0558c3158994825a23e9d09d6ad744c` | `fix(integration): align Google privacy overview and add combined contract tests` (5 files: `PrivacyPage.tsx` + 4 focused contract test suites) |

### 2.2. Cryptographic Ancestry Verification (`INDEPENDENTLY VERIFIED`)

Executed against anchored commit `07c086bfb5299632fc35dd85cbcf906ce4cd1099` (and preserved identically by any descendant docs commit):

| Command | Exit Code | Verdict |
| --- | :---: | --- |
| `git merge-base --is-ancestor 2eed8d1d4309e833088d6f1d3fa774189049e283 07c086bfb5299632fc35dd85cbcf906ce4cd1099` | `0` | `origin/main` baseline preserved |
| `git merge-base --is-ancestor 1c17527f16715b2c6655c170cdb448673a84dd1b 07c086bfb5299632fc35dd85cbcf906ce4cd1099` | `0` | Trello Combined PR `#313` full history preserved |
| `git merge-base --is-ancestor 3807986542dbe3470b8f3f1cd42413cb7bd460dd 07c086bfb5299632fc35dd85cbcf906ce4cd1099` | `0` | Calendar Combined PR `#314` full history preserved |
| `git merge-base --is-ancestor f292884d0ae965ffb9841e7063b8843cd266b17e 07c086bfb5299632fc35dd85cbcf906ce4cd1099` | `0` | Sheets R2 PR `#306` full history preserved |

---

## 3. Shared Integration Conflict Dispositions & TDD / Mutation Proofs

No blind `ours`/`theirs` resolution was used on any file. Every shared file owned by Task B was reconciled against the pre-declared contracts in `03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`:

### 3.1. `packages/tool-adapters/src/slack/slack-adapter.ts` (`M2` Conflict #1 — `GAS-01` ∩ `TRELLO-AUDIT-08`)
- **Conflict Observed:** `#313` validated `typeof res?.ts === 'string'`, rejected `'undefined'`, and attached `details: { requestSent: true }`, **but** fell back to `args.channel` when `res.channel` was missing/non-string/empty and did not reject `'null'`. `#306` validated `typeof res?.ts === 'string'`, **but** accepted `'undefined'`/`'null'`, fell back to `args.channel` without validating `res.channel`, and omitted `details: { requestSent: true }`.
- **Combined Disposition (`678c5337`):** Enforced strict string + non-empty + non-`'undefined'` + non-`'null'` validation on **both** `res?.ts` and `res?.channel`, throwing `StepError({ message: 'Slack chat.postMessage returned a malformed receipt without valid string channel and timestamp (ts)', category: 'UNKNOWN', retryable: false, details: { requestSent: true } })` (using actual `StepError` fields only; no invented error code symbol) and returning `{ ts: rawTs, channel: rawChannel }`.
- **Focused Test & Wrong-Behavior Proof (`packages/tool-adapters/tests/slack-adapter.test.ts`):**
  - Added real `node:http` loopback server test (`127.0.0.1:0`) exercising all 12 malformed `{ ok: true }` payloads (`ts` missing, `''`, `'   '`, `{ bad: 1 }`, `12345`, `'undefined'`, `'null'`; `channel` missing, `''`, `{ id: 'C2' }`, `'undefined'`, `'null'`) + valid trimmed `{ ok: true, channel: '  C2  ', ts: '  1700000000.000100  ' }`.
  - **Mutation Sensitivity Verified:** Temporarily substituting `#313`'s `args.channel` fallback failed immediately (`MUTATION_SLACK_EXIT=1`: `Expected malformed receipt {"ok":true,"ts":"1700000000.000100"} to throw StepError`), then passed (`exit 0`) when restored to `678c5337`.

### 3.2. `apps/chat-api/src/services/schedules/schedule-service.ts` (`M2` Conflict #2 — `GAS-08`/`GAS-09` ∩ `TRELLO-AUDIT-10`)
- **Conflict Observed:** Three conflict hunks in `SCHEDULE_CONFLICTS` (`CONFIG_CHANGED_SINCE_RUN` vs `MISSING_DISPATCH_SNAPSHOT` + `SCHEDULE_PAUSED` message), `resolveRunDelivery` `mark_sent`, and `resolveRunDelivery` `retry_new_run`.
- **Combined Disposition (`678c5337`):**
  1. Preserved all conflict codes (`SCHEDULE_PAUSED` containing `'tạm dừng'`, `CONFIG_CHANGED_SINCE_RUN`, `MISSING_DISPATCH_SNAPSHOT`) and zero `'slack'` string literals (`'channelId' in dest` + `buildConfirmedTrelloDigestDelivery`, keeping `static-guard.test.ts` green).
  2. Preserved per-kind `mark_sent` immutable dispatch config: `sheets_digest` uses `run.dispatched_config` (or `schedule.digest_config` only when `schedule.version === run.schedule_version`) and fails closed with `MISSING_DISPATCH_SNAPSHOT` if missing without prior `targetId`/`spreadsheetId`; `trello_digest` and `telegram_digest` likewise prefer `run.dispatched_config` and fall back to `schedule.digest_config` **only** when `schedule.version === run.schedule_version` (preventing post-run mutated `schedule.digest_config` leakage).
  3. Preserved per-kind `retry_new_run` protections: `sheets_digest` enforces `assertSheetsDigestCanResumeInTx` + `schedule.status !== 'active'` -> `SCHEDULE_PAUSED`; `trello_digest` / `telegram_digest` enforce `paused` (`REAUTHORIZATION_REQUIRED` vs `SCHEDULE_PAUSED`), `SCHEDULE_CLOSED`, `CONFIG_CHANGED_SINCE_RUN` (version + canonical hash), and pinned active `service_credentials`; replacement run `INSERT` populates `dispatched_config, dispatched_config_hash` for all kinds.
- **Focused Test & Wrong-Behavior Proof (`apps/chat-api/tests/services/schedules/trello-telegram-delivery-invariants.test.ts` & `sheets-gas-r2-remediation.test.ts`):**
  - Added `XSVC-B (GAS-08 ∩ TRELLO-AUDIT-10)` on isolated PostgreSQL 16 (`127.0.0.1:56789`).
  - **Mutation Sensitivity Verified:** Temporarily substituting `#313`'s unguarded `schedule.digest_config` lookup on `trello_digest` `mark_sent` failed immediately (`MUTATION_SCHED_EXIT=1`: expected `'C_OPS'`, received `'C_MUTATED_WRONG'`), then passed (`exit 0`) when restored to `678c5337`.

### 3.3. `scripts/test-v3-browser.mjs` (`M2` Conflict #3 — `TRELLO-REM-C` ∩ `GAS-12`)
- **Conflict Observed:** `#313` refactored `scripts/test-v3-browser.mjs` into an importable ESM module (`OMITTED_SCENARIO_ROUTING`, `scenarios`, `resolveActiveScenarios`, `isMainModule`) and added `trello_telegram_mocked_ui` + `trello_telegram_sandbox_e2e` (`24` scenarios), whereas `#306` added `sheets_digest_v2_recovery` + `GMAIL_ENABLED`/`MYSHEETS_ENABLED`/`SCHEDULES_ENABLED` flags on the pre-refactor layout (`23` scenarios).
- **Combined Disposition (`678c5337`):** Preserved `#313`'s ESM exports and both Trello/Telegram groups while adding `sheets_digest_v2_recovery` (`schedulesEnabled: true`, `executionMode: 'mocked_browser_routes'`) for **25** total scenario groups, merging `sheets-digest-v2-recovery` into both `needsSchedule` regexes, and preserving `GMAIL_ENABLED`, `MYSHEETS_ENABLED`, and `SCHEDULES_ENABLED` activation.
- **Focused Test (`apps/chat-web/tests/browser-scenario-selection.test.ts`):** Asserts `mod.scenarios` length === `25`, `SCENARIO=sheets_digest_v2_recovery` filtering, CLI spec-path `needsSchedule` resolution, and env-flag wiring (`4/4` tests passed).

### 3.4. `apps/chat-web/src/pages/Privacy/PrivacyPage.tsx` (Semantic Auto-Merge Alignment — Strict TDD `RED -> GREEN`)
- **Semantic Mismatch Exposed (`RED`):** Auto-merge in `M2` exited `0`, keeping both `#mycalendar` (`#314`) and `#mysheets` (`#306`) sections intact, but left `#306`'s top `"Quyền truy cập Google"` summary paragraph mentioning only personal Google Sheets (`drive.file` and `spreadsheets`) without personal Google Calendar (`calendar.readonly`, `calendar.events`, selected-calendar allowlist).
- **TDD Proof:**
  1. **RED (`PRIVACY_RED_EXIT=1`):** Added `XSVC-B (Combined Google Privacy Disclosure)` to `apps/chat-web/tests/calendar-rem-c-09-oauth-disclosure.test.tsx` before touching `PrivacyPage.tsx`; Vitest failed at line 76 (`expected '... Quyền truy cập Google ...' to contain 'calendar.readonly'`).
  2. **GREEN (`PRIVACY_GREEN_EXIT=0`):** Minimally updated line 459 of `PrivacyPage.tsx` to include personal Google Calendar (`calendar.readonly`, `calendar.events`, selected-calendar allowlist) alongside personal Google Sheets (`drive.file`, `spreadsheets`) and the disconnected baseline; both `calendar-rem-c-09-oauth-disclosure.test.tsx` (`2/2`) and `mysheets-ui.test.tsx` (`24/24`) passed.

---

## 4. Task B Verification Log (`INDEPENDENTLY VERIFIED` on `07c086bfb5299632fc35dd85cbcf906ce4cd1099`)

All commands below were executed sequentially from `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate` without `.env`:

| Step / Check | Exact Command | Exit Code | Files / Tests / Skips |
| --- | --- | :---: | --- |
| Web Production Build | `npm run build:v3` | `0` | Vite 8.3.0 client build (`214` modules, `1.43s`) |
| Workspace Typecheck | `npm run typecheck:v3` | `0` | `@wap/chat-api` + `@wap/chat-web` `tsc --noEmit` (`0` errors) |
| Tool Schemas Contracts & Unit | `npm test --workspace=@wap/tool-schemas` | `0` | `27` files, `593` passed, `0` skipped |
| Architecture Static Guard | `npx vitest run evaluations/generic-plumbing/static-guard.test.ts` | `0` | `1` file, `2` passed, `0` skipped |
| Web Build Bundle Security | `node scripts/test-v3-web-build-security.mjs` | `0` | `PASS: production build excludes credential sentinels and 8 forbidden UI claims` |
| Focused Non-DB Suites (Slack loopback, Trello remediation, Browser selector, Recovery UI, Privacy, Planner SHA-256 hashes) | `npx vitest run packages/tool-adapters/tests/slack-adapter.test.ts packages/tool-adapters/tests/trello-audit-remediation.test.ts apps/chat-web/tests/browser-scenario-selection.test.ts apps/chat-web/tests/schedule-sheets-digest-v2.test.tsx apps/chat-web/tests/schedule-trello-digest-mode.test.tsx apps/chat-web/tests/mysheets-ui.test.tsx apps/chat-web/tests/calendar-rem-c-09-oauth-disclosure.test.tsx packages/planner/tests/read-answers.test.ts packages/planner/tests/schedules.test.ts` | `0` | `9` files, `127` passed, `0` skipped |
| Focused Shared Scheduler & Sheets/Trello/Telegram Recovery Suites (Isolated PostgreSQL 16 `127.0.0.1:56789/ati_v3_taskb`) | `$env:DATABASE_URL="postgresql://ati_v3:ati_v3_taskb_disposable@127.0.0.1:56789/ati_v3_taskb"; $env:ALLOW_ISOLATED_TEST_PORT="1"; npx vitest run apps/chat-api/tests/services/sheets-gas-r2-remediation.test.ts apps/chat-api/tests/services/schedules/trello-telegram-delivery-invariants.test.ts` | `0` | `2` files, `22` passed, `0` skipped |

---

## 5. Remaining Scope Explicitly `PENDING / NOT RUN` After Task B

- **Task C (`PENDING / NOT RUN`):** Full backend cross-service runtime verification (`cross-service-combined-gate.test.ts`, fresh `0001..0035` + `<=0032` upgrade migration suite, simultaneous 3-service due digests, 2-process OS scheduler + `SIGKILL` crash/reconciliation, full negative-auth `outbound === 0` matrix, and full `@wap/tool-adapters` / `@wap/executor` / `@wap/chat-api` workspace runs).
- **Task D (`PENDING / NOT RUN`):** Real Chromium Playwright E2E scenarios (`scripts/test-v3-browser.mjs`) and Calendar `C1/C2` Chromium extension in `apps/chat-web/tests/browser/mycalendar.spec.ts`.
- **Task E (`PENDING / NOT RUN`):** Uninterrupted full `npm run check` + all 25 Chromium scenario groups, Draft PR publication, exact-head GitHub Actions `v3 check` (single job `v3`) verification, and final audit bundle `04..08`.
