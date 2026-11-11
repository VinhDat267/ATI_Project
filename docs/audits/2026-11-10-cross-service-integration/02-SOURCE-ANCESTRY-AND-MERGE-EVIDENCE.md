# 02 — Source Ancestry, `--no-ff` Merge Assembly & Complete Commit Lineage

**Audit Bundle:** `docs/audits/2026-11-10-cross-service-integration/`  
**Document Status:** Tasks A–D Settled; Task E Local Gate Complete (`WORKER REPORTED` on Frozen Code+Test Candidate `4056fef20127d7da3c3139f34830035facbf5daf`); Draft PR `#315` Open (`isDraft: true`); Final Docs-Head Exact-Head CI & Coordinator Acceptance `PENDING / NOT VERIFIED` at Commit Time  
**Date:** 2026-11-11  
**Isolated Integration Worktree:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate`  
**Integration Branch:** `VinhDat267/ati-v3-cross-service-integration-gate`  
**Current Gate Status at Commit Time (Pre-Push of Final Docs Head `C_E3`):**
- **Gate A:** `NOT READY — BLOCKING DEFECT OR MISSING CRITICAL EVIDENCE` *(solely pending final exact-head GitHub Actions `v3 check` on `C_E3` — `PENDING / NOT VERIFIED` at commit time — and Coordinator Codex independent acceptance; conditional worker proposal once both complete: `PASS — VERIFIED WITHIN TESTED SCOPE`)*
- **Gate B:** `NOT READY` *(pending final exact-head CI on `C_E3` and Coordinator Codex acceptance; conditional worker proposal once both complete: `MERGE READY FOR OWNER REVIEW`, Draft PR `#315` only — explicit Owner approval required)*
- **Gate C:** `PRODUCTION ACTIVATION — HOLD`

---

## 1. Session Provenance & Source Head Revalidation (`2026-11-10` .. `2026-11-11`)

### 1.1. Model, Effort & Workspace Isolation
| Check | Result | Evidence | Label |
| --- | --- | --- | --- |
| **Effective Launch Model & Effort** | `antigravity/gemini-4-carbon-high/high` (`EFFORT LEVEL: 1.00`, no fallback, zero subagents) | Orca `worker-show` `launch.effective = antigravity/gemini-4-carbon-high/high` (verified by coordinator Codex across dispatches, incl. Task E `ctx_0839a6aea5c4`); `settings.json:3` `"model": "Gemini 4 Carbon (High)"`; `transcript.jsonl` | `INDEPENDENTLY VERIFIED` (Orca launch) / `WORKER REPORTED` (Task E session) |
| **Raw Upstream Model Wire Header** | Not exposed in local session transcript | Local `transcript.jsonl` records `source: "MODEL"` without raw HTTP `modelVersion` header | `NOT VERIFIED` |
| **Environment & `.env` Isolation** | `has_dotenv=False`; clean `npm ci` (`added 302 packages` in `19s`, `exit 0`); zero live credentials loaded | `Test-Path .env` -> `False` across Tasks B, C, D, and E | `INDEPENDENTLY VERIFIED` (Codex) / `WORKER REPORTED` (Task E) |
| **Disposable PostgreSQL Isolation** | Dedicated owned containers per phase (`ati-xsvc-v2-taskb-56789`, `ati-xsvc-v2-taskc-56791`, Codex `f49d6d85b71d` on `56793`, `ati-xsvc-v2-taskd-d2-56534`, and Task E `ati-xsvc-v2-taske-56534`), each removed via `docker rm -f` immediately after verification | Other agents' concurrent active containers (`ati-notion-n2b-pg-20261111` on `58909`, `ati-gmail-g2-a1-pg-738984a1` on `51850`, `ati-gmail-g2-codex-175a2007` on `60015`) and stopped checkpoints (`eba2bdc4b9f0`, `9718bcf4290f`, `20f50936ac02`, `bbb95cabe5a4`, `synthia-release-*`) remained untouched | `INDEPENDENTLY VERIFIED` (Tasks B–C) / `WORKER REPORTED` (Tasks D–E) |

### 1.2. Revalidation of `origin/main` and Source Draft PRs (Stationary Across Tasks A–E)
Executed `git fetch origin --prune`, `git rev-parse origin/main`, `gh pr view 313/314/306 --json number,state,isDraft,headRefName,headRefOid,baseRefName`, and `gh run view <id>` before `M0` (`2026-11-10`) and again in Task E (`2026-11-11`). Zero source movement occurred:

| Role | Branch / Draft PR | State | Exact Commit SHA | Exact Full-Tree SHA (`^{tree}`) | Merge-Base vs `origin/main` | Exact-Head CI Run |
| --- | --- | --- | --- | --- | --- | --- |
| **Baseline** | `origin/main` | Base | `2eed8d1d4309e833088d6f1d3fa774189049e283` | `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | Base `main` |
| **Source 1 (Trello)** | PR `#313` (`VinhDat267/trello-v3-combined-gate`) | `OPEN` (`isDraft: true`) | `1c17527f16715b2c6655c170cdb448673a84dd1b` | `f53ed6b2b7cfdeae0f27d18e1fc7831cc69f7d76` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | [`42809170181`](https://github.com/VinhDat267/ATI_Project/actions/runs/42809170181) (`success`) |
| **Source 2 (Calendar)** | PR `#314` (`VinhDat267/calendar-v3-combined-gate`) | `OPEN` (`isDraft: true`) | `3807986542dbe3470b8f3f1cd42413cb7bd460dd` | `8805043497bfffe05d9620c520d098abfb00a60c` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | [`42835422010`](https://github.com/VinhDat267/ATI_Project/actions/runs/42835422010) (`success`) |
| **Source 3 (Sheets R2)** | PR `#306` (`VinhDat267/sheets-gas-recovery-guard-argon`) | `OPEN` (`isDraft: true`) | `f292884d0ae965ffb9841e7063b8843cd266b17e` | `a9ca98c257a99da8b8d1fde266091f2a3897719b` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | [`42811254062`](https://github.com/VinhDat267/ATI_Project/actions/runs/42811254062) (`success`) |

---

## 2. Traceable `--no-ff` Commit Lineage & Frozen Tested Code+Test Anchor (`4056fef2`)

> **Non-Self-Referential Anchor Rule:** Because a Git commit cannot contain its own SHA, all tested code/test provenance in this bundle is anchored at **`4056fef20127d7da3c3139f34830035facbf5daf`** (**Task E Frozen Code+Test Anchor `C_E1`**, full-tree SHA **`270b82ba509d0ef01069c6548e18eb53853fa556`**). Initial docs commit `C_E2` (`11027dbc1e8c07f78af29c605f5c9eafc85c71a0`, tree `e5ff5077c87f09d60f26b78e9c69faa1dd8efd5f`) opened Draft PR `#315` (`OPEN`, `isDraft: true`) and is superseded by final docs provenance-correction commit `C_E3` (`git diff 4056fef20127d7da3c3139f34830035facbf5daf HEAD -- ':!docs'` === `0` bytes). At `C_E3` commit time, required GitHub Actions `v3 check` on `C_E3` is **`PENDING / NOT VERIFIED`** (superseded run `42955279986` on `11027dbc` does not certify `C_E3`); final `C_E3` SHA, `C_E3^{tree}` SHA, and actual exact-head `v3 check` outcome are recorded externally in Draft PR `#315`'s body and `worker_done` after `C_E3`'s own CI completes.

### 2.1. First-Parent Commit & Merge Parent Table (`origin/main..4056fef2`)

| Step | Commit SHA | Full-Tree SHA (`^{tree}`) | Parent Commit SHA(s) (`%P`) | Commit Subject & Notes |
| --- | --- | --- | --- | --- |
| **Base** | `2eed8d1d4309e833088d6f1d3fa774189049e283` | `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4` | `0ea54325a9b141c6a04cd934fefad2d12c6a2d6d` `92821ecbe7a27196e6af54ac5bf54101f47d8267` | `Merge pull request #303 from VinhDat267/fix/r1-c1-digest-live-scope-guard` (`origin/main`) |
| **`C_A`** | `83cb340128fb9f1eefaa6b5ed346237f91667f30` | `84f3ec5e10877e48043c496b84f90e3ad514c06d` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | `docs(audit): add cross-service integration v2 preflight plan and conflict matrix` (Task A, 4 docs-only files) |
| **`C_B0`** | `f228d8a4159b944a466f246ec44a9b6e1b28b74c` | `ac3f4abdb526e51942303896a48999e4b251b671` | `83cb340128fb9f1eefaa6b5ed346237f91667f30` | `docs(audit): correct Task A script, workflow, risk, and gate provenance` (3 docs-only files corrected before merges) |
| **`M0`** | `b0232fdd9f5f59c6d1b4c0fc2b882eaf2fcd8954` | `d896d0997d3b79f3265ad40ac10e306b717ac773` | `f228d8a4159b944a466f246ec44a9b6e1b28b74c` `1c17527f16715b2c6655c170cdb448673a84dd1b` | `chore(integration): merge trello combined gate PR #313 (1c17527f)` (`exit 0`, `0` conflicts) |
| **`M1`** | `edbeeffeca97cdb95a4b5dec88f9ee61645910aa` | `021ce568864dbb9fb33e095e72bf8e820b0361e9` | `b0232fdd9f5f59c6d1b4c0fc2b882eaf2fcd8954` `3807986542dbe3470b8f3f1cd42413cb7bd460dd` | `chore(integration): merge calendar combined gate PR #314 (38079865)` (`exit 0`, clean auto-merge of `chat-service.ts`; intermediate `npm run typecheck:v3` `exit 0`) |
| **`M2`** | `678c5337f0558c3158994825a23e9d09d6ad744c` | `6185a45a29537cad679a3b161ede539350696877` | `edbeeffeca97cdb95a4b5dec88f9ee61645910aa` `f292884d0ae965ffb9841e7063b8843cd266b17e` | `chore(integration): merge sheets r2 gate PR #306 (f292884d) and resolve shared contracts` (`--no-commit` exited `1` on exact 3 conflicts; resolved & verified `typecheck:v3` + `static-guard.test.ts` `exit 0`) |
| **`C_B1`** | `07c086bfb5299632fc35dd85cbcf906ce4cd1099` | `fcd0e64019b0c70eb96f7e0d6352ead5f1fc7d4d` | `678c5337f0558c3158994825a23e9d09d6ad744c` | `fix(integration): align Google privacy overview and add combined contract tests` (`PrivacyPage.tsx` + 4 focused contract test suites) |
| **`C_B2`** | `2fa749fc2a82fc642c008957f31df7a7a61d5ab0` | `9512c3e25bd161824234ac84421c7ae67915b927` | `07c086bfb5299632fc35dd85cbcf906ce4cd1099` | `docs(audit): record Task B merge ancestry, conflict dispositions, and focused verification` |
| **`C_C1`** | `7dcd3753742c755f3493ba3f010a7a743c72a074` | `f12bcb2d71d2812f95486d985e5431fe36ef9a89` | `2fa749fc2a82fc642c008957f31df7a7a61d5ab0` | `fix(chat-api): enforce cross-service pre-dispatch guards and digest telegram bindings` (8 backend code+test files: 4 TDD `RED -> GREEN` runtime/auth fixes + `cross-service-combined-gate.test.ts` + child worker + `trello-token-manager.test.ts` hook isolation) |
| **`C_C2`** | `a5309f2198354d2d46519778ac9100c665ceaa96` | `2e1a488020a1c4159a4424ee8293ec6aed4a19d8` | `7dcd3753742c755f3493ba3f010a7a743c72a074` | `docs(audit): record task c cross-service backend runtime evidence and risks` |
| **`C_D1`** | `5e2819985c205311af0354c796f6d28ac9c2eee2` | `07f6eb1ca67141381d9410c3fbbad5a00469a3b9` | `a5309f2198354d2d46519778ac9100c665ceaa96` | `fix(chat-web): enforce Cockpit schedule recovery parity and add C1/C2 Chromium calendar proofs` (4 files: `ScheduleRunRecovery.tsx`, `mycalendar.spec.ts`, `cross-service-recovery-privacy.test.tsx`, `scripts/fake-google-gmail.mjs`) |
| **`C_D2`** | `127ded5cf5eabeb50b26c9551880e6c9d40c0ab8` | `231611d80234a122f49d57209a9578e2637fc0b7` | `5e2819985c205311af0354c796f6d28ac9c2eee2` | `docs(audit): record task d chromium c1/c2 and ui evidence and fix provenance` |
| **`C_E1` (Frozen Tested Code+Test Anchor)** | **`4056fef20127d7da3c3139f34830035facbf5daf`** | **`270b82ba509d0ef01069c6548e18eb53853fa556`** | `127ded5cf5eabeb50b26c9551880e6c9d40c0ab8` | `fix(chat-web): fail closed on unknown schedule status and align mysheets OAuth disclosure` (4 files: `ScheduleRunRecovery.tsx`, `PrivacyPage.tsx`, `cross-service-recovery-privacy.test.tsx`, `calendar-rem-c-09-oauth-disclosure.test.tsx`) |
| **`C_E2` (Superseded Initial Docs Commit)** | `11027dbc1e8c07f78af29c605f5c9eafc85c71a0` | `e5ff5077c87f09d60f26b78e9c69faa1dd8efd5f` | `4056fef20127d7da3c3139f34830035facbf5daf` | `docs(audit): finalize cross-service integration v2 evidence bundle and task e verdicts` (12 `docs/` files; opened Draft PR `#315`; superseded by `C_E3` to correct premature CI/Gate provenance) |

### 2.2. Cryptographic Ancestry & Diff Metrics on `4056fef20127d7da3c3139f34830035facbf5daf`

| Verification Command | Result / Output | Attribution |
| --- | --- | --- |
| `git merge-base --is-ancestor 2eed8d1d4309e833088d6f1d3fa774189049e283 4056fef20127d7da3c3139f34830035facbf5daf` | `exit 0` (`origin/main` baseline preserved) | `INDEPENDENTLY VERIFIED` (at `2fa749fc`..`127ded5c`) / `WORKER REPORTED` (`4056fef2`) |
| `git merge-base --is-ancestor 1c17527f16715b2c6655c170cdb448673a84dd1b 4056fef20127d7da3c3139f34830035facbf5daf` | `exit 0` (Trello Combined PR `#313` full history preserved) | `INDEPENDENTLY VERIFIED` / `WORKER REPORTED` |
| `git merge-base --is-ancestor 3807986542dbe3470b8f3f1cd42413cb7bd460dd 4056fef20127d7da3c3139f34830035facbf5daf` | `exit 0` (Calendar Combined PR `#314` full history preserved) | `INDEPENDENTLY VERIFIED` / `WORKER REPORTED` |
| `git merge-base --is-ancestor f292884d0ae965ffb9841e7063b8843cd266b17e 4056fef20127d7da3c3139f34830035facbf5daf` | `exit 0` (Sheets R2 PR `#306` full history preserved) | `INDEPENDENTLY VERIFIED` / `WORKER REPORTED` |
| `git diff --shortstat 2eed8d1d4309e833088d6f1d3fa774189049e283..4056fef20127d7da3c3139f34830035facbf5daf` | `127 files changed, 24590 insertions(+), 1437 deletions(-)` | `WORKER REPORTED` |
| `git diff --shortstat 2eed8d1d4309e833088d6f1d3fa774189049e283..4056fef20127d7da3c3139f34830035facbf5daf -- ':!docs'` | `91 files changed, 21815 insertions(+), 1437 deletions(-)` | `WORKER REPORTED` |
| `git diff --shortstat 678c5337f0558c3158994825a23e9d09d6ad744c..4056fef20127d7da3c3139f34830035facbf5daf -- ':!docs'` | `17 files changed, 5266 insertions(+), 45 deletions(-)` (integration-only code & test delta after `M2`) | `WORKER REPORTED` |
| SQL Migrations Inventory (`Get-ChildItem db/v3/*.sql`) | **`47` SQL files** (`0001_v3_core.sql` .. `0035_sheets_gas_r2_remediation.sql`; **1** new migration vs `origin/main`: `0035_sheets_gas_r2_remediation.sql`; creates **`70` base tables** in `public`) | `INDEPENDENTLY VERIFIED` |

---

## 3. Shared Integration Conflict Dispositions & TDD / Mutation Proofs

No blind `ours`/`theirs` resolution was used on any file. Every shared file owned by Task B (and refined in Tasks D & E) was reconciled against the pre-declared contracts in `03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`:

### 3.1. `packages/tool-adapters/src/slack/slack-adapter.ts` (`M2` Conflict #1 — `GAS-01` ∩ `TRELLO-AUDIT-08`)
- **Conflict Observed:** `#313` validated `typeof res?.ts === 'string'`, rejected `'undefined'`, and attached `details: { requestSent: true }`, **but** fell back to `args.channel` when `res.channel` was missing/non-string/empty and did not reject `'null'`. `#306` validated `typeof res?.ts === 'string'`, **but** accepted `'undefined'`/`'null'`, fell back to `args.channel` without validating `res.channel`, and omitted `details: { requestSent: true }`.
- **Combined Disposition (`678c5337`):** Enforced strict string + non-empty + non-`'undefined'` + non-`'null'` validation on **both** `res?.ts` and `res?.channel`, throwing `StepError({ message: 'Slack chat.postMessage returned a malformed receipt without valid string channel and timestamp (ts)', category: 'UNKNOWN', retryable: false, details: { requestSent: true } })` (using actual `StepError` fields only; no invented error code symbol) and returning `{ ts: rawTs, channel: rawChannel }`.
- **Focused Test & Wrong-Behavior Proof (`packages/tool-adapters/tests/slack-adapter.test.ts`):**
  - Added real `node:http` loopback server test (`127.0.0.1:0`) exercising all 12 malformed `{ ok: true }` payloads + valid trimmed `{ ok: true, channel: '  C2  ', ts: '  1700000000.000100  ' }`.
  - **Mutation Sensitivity Verified:** Temporarily substituting `#313`'s `args.channel` fallback failed immediately (`MUTATION_SLACK_EXIT=1`), then passed (`exit 0`) when restored to `678c5337`.

### 3.2. `apps/chat-api/src/services/schedules/schedule-service.ts` (`M2` Conflict #2 — `GAS-08`/`GAS-09` ∩ `TRELLO-AUDIT-10`)
- **Combined Disposition (`678c5337`):**
  1. Preserved all conflict codes (`SCHEDULE_PAUSED` containing `'tạm dừng'`, `CONFIG_CHANGED_SINCE_RUN`, `MISSING_DISPATCH_SNAPSHOT`) and zero `'slack'` string literals (`'channelId' in dest` + `buildConfirmedTrelloDigestDelivery`, keeping `static-guard.test.ts` green).
  2. Preserved per-kind `mark_sent` immutable dispatch config across `sheets_digest`, `trello_digest`, and `telegram_digest` (falling back to `schedule.digest_config` **only** when `schedule.version === run.schedule_version`).
  3. Preserved per-kind `retry_new_run` protections and populated `dispatched_config, dispatched_config_hash` on replacement run `INSERT` for all kinds.
- **Mutation Sensitivity Verified:** Temporarily substituting `#313`'s unguarded `schedule.digest_config` lookup on `trello_digest` `mark_sent` failed immediately (`MUTATION_SCHED_EXIT=1`), then passed (`exit 0`) when restored.

### 3.3. `scripts/test-v3-browser.mjs` (`M2` Conflict #3 — `TRELLO-REM-C` ∩ `GAS-12`)
- **Combined Disposition (`678c5337`):** Preserved `#313`'s ESM exports (`OMITTED_SCENARIO_ROUTING`, `scenarios`, `resolveActiveScenarios`, `isMainModule`) and both Trello/Telegram groups while adding `sheets_digest_v2_recovery` (`schedulesEnabled: true`, `executionMode: 'mocked_browser_routes'`) for **25** total scenario groups, merging `sheets-digest-v2-recovery` into both `needsSchedule` regexes, and preserving `GMAIL_ENABLED`, `MYSHEETS_ENABLED`, and `SCHEDULES_ENABLED` activation (`browser-scenario-selection.test.ts` `4/4` PASS).

### 3.4. `apps/chat-web/src/pages/Privacy/PrivacyPage.tsx` (Task B `07c086bf` Overview Alignment + Task E `4056fef2` Truthful `drive.file` Scope Correction)
- **Task B (`07c086bf`):** Unified line 459 `"Quyền truy cập Google"` summary paragraph to encompass disconnected baseline, personal Google Sheets, and personal Google Calendar (`calendar.readonly`, `calendar.events`, selected-calendar allowlist).
- **Task E (`4056fef2`):** Corrected inherited `(phạm vi OAuth drive.file và spreadsheets)` wording at lines 459 & 477 to `(phạm vi OAuth drive.file)`, matching runtime `MYSHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file'` (`packages/tool-schemas/src/mysheets.ts:3`) via strict TDD (`RED` `exit 1` -> `GREEN` `exit 0`, zero OAuth policy expansion).

---

## 4. Historical Task B Verification Log (`07c086bfb5299632fc35dd85cbcf906ce4cd1099` / `2fa749fc2a82fc642c008957f31df7a7a61d5ab0`)

> **Provenance Attribution Note:** On `2fa749fc`, coordinator Codex **independently re-verified** all cryptographic ancestry checks and 4 focused suites (`15` tests PASS: `slack-adapter.test.ts`, `browser-scenario-selection.test.ts`, `calendar-rem-c-09-oauth-disclosure.test.tsx`, `static-guard.test.ts`). Full backend, frontend, and all-25-group Chromium results on final candidate `4056fef2` are recorded in `05-REGRESSION-TEST-EVIDENCE.md`.

| Step / Check | Exact Command | Exit Code | Files / Tests / Skips |
| --- | --- | :---: | --- |
| Web Production Build | `npm run build:v3` | `0` | Vite 8.3.0 client build (`214` modules, `1.43s`) |
| Workspace Typecheck | `npm run typecheck:v3` | `0` | `@wap/chat-api` + `@wap/chat-web` `tsc --noEmit` (`0` errors) |
| Tool Schemas Contracts & Unit | `npm test --workspace=@wap/tool-schemas` | `0` | `27` files, `593` passed, `0` skipped |
| Architecture Static Guard | `npx vitest run evaluations/generic-plumbing/static-guard.test.ts` | `0` | `1` file, `2` passed, `0` skipped |
| Web Build Bundle Security | `node scripts/test-v3-web-build-security.mjs` | `0` | `PASS: production build excludes credential sentinels and 8 forbidden UI claims` |
| Focused Non-DB Suites | `npx vitest run ...` (9 files) | `0` | `9` files, `127` passed, `0` skipped |
| Focused Shared Scheduler & Recovery Suites (`127.0.0.1:56789/ati_v3_taskb`) | `npx vitest run sheets-gas-r2-remediation.test.ts trello-telegram-delivery-invariants.test.ts` | `0` | `2` files, `22` passed, `0` skipped |
