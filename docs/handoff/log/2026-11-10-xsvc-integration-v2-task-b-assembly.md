# Handoff Log — `2026-11-10` — `XSVC-INTEGRATION-V2` Task B (`--no-ff` Assembly, Shared Contract Resolutions & Focused Proofs)

- **Task Card:** `docs/handoff/tasks/XSVC-INTEGRATION-V2.md`
- **Phase Executed:** **Task B ONLY** (Task A Provenance Corrections, `--no-ff` Candidate Assembly `Trello #313 -> Calendar #314 -> Sheets #306`, Shared Integration Contract Resolutions, TDD/Mutation Proofs, and Focused Verification)
- **Worktree:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate`
- **Branch:** `VinhDat267/ati-v3-cross-service-integration-gate` (local only — **not pushed**, **no PR opened yet**)
- **Baseline (`origin/main`):** `2eed8d1d4309e833088d6f1d3fa774189049e283` (full-tree `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4`)
- **Pre-Docs Code+Test Anchor Commit:** `07c086bfb5299632fc35dd85cbcf906ce4cd1099` (full-tree `fcd0e64019b0c70eb96f7e0d6352ead5f1fc7d4d`)
- **Current Gate Status:** Gate A `NOT READY — BLOCKING DEFECT OR MISSING CRITICAL EVIDENCE` | Gate B `NOT READY` | Gate C `PRODUCTION ACTIVATION — HOLD`

---

## 1. Provenance Corrections (`f228d8a4159b944a466f246ec44a9b6e1b28b74c`) & Source Revalidation

1. **Task A Provenance Fixes Committed First (`f228d8a4159b944a466f246ec44a9b6e1b28b74c`, tree `ac3f4abdb526e51942303896a48999e4b251b671`):**
   - Updated `01-INTEGRATION-EXECUTION-PLAN.md`, `03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md`, and `docs/handoff/tasks/XSVC-INTEGRATION-V2.md` before executing any merge:
     - Replaced non-existent `eval:security` / `check:plumbing` references with the exact `package.json` `check` script (`npm run typecheck:v3 && npm run test:v3 && npm run test:eval:v3 && npm run build:v3 && node scripts/test-v3-web-build-security.mjs && npm run test:launcher:v3 && node --test scripts/v3-local-env.test.mjs scripts/fake-oidc.test.mjs scripts/google-oidc-fixture.test.mjs scripts/slack/inventory.test.mjs scripts/fake-slack-personal.test.mjs scripts/slack/contract-probe.test.mjs`) and actual workspace scripts.
     - Corrected `.github/workflows/v3-check.yml` description to its actual **single job `v3`** (which runs both `npm run check` and `npm run test:browser:v3`).
     - Reclassified pre-assembly overlap risks (`RISK-01..03`) as **`SHARED CONTRACT RISK`** (unassembled hypothetical conflict risk, distinct from reproduced regressions or confirmed P0 defects) and corrected `SlackAdapter` source-diff attribution against `2eed8d1d`.
     - Locked Owner exact allowed verdicts (Gate A 4 verdicts, Gate B `MERGE READY FOR OWNER REVIEW` / `NOT READY`, Gate C `PRODUCTION ACTIVATION — HOLD`), full-tree SHA equivalence rules (zero path exclusions), `NO STATIC OVERLAP (RUNTIME NOT VERIFIED)` matrix wording, Task C/D isolated-worktree parallelism rules, and Orca `launch.effective = antigravity/gemini-4-carbon-high/high` provenance (raw upstream wire header `NOT VERIFIED`).
2. **Source Head Revalidation (`git fetch origin --prune`, `gh pr view 313/314/306` — `exit 0`):**
   - Confirmed zero source movement: `origin/main` = `2eed8d1d4309e833088d6f1d3fa774189049e283`; PR `#313` = `1c17527f16715b2c6655c170cdb448673a84dd1b` (`OPEN`, `Draft`); PR `#314` = `3807986542dbe3470b8f3f1cd42413cb7bd460dd` (`OPEN`, `Draft`); PR `#306` = `f292884d0ae965ffb9841e7063b8843cd266b17e` (`OPEN`, `Draft`).
   - Verified `Test-Path .env` = `False` (`has_dotenv=False`) and ran clean `npm ci` (`added 302 packages in 19s`, `exit 0`).

---

## 2. Traceable `--no-ff` Merges & Shared Integration Contract Resolutions

1. **`M0` — Merge Trello Combined PR `#313` (`b0232fdd9f5f59c6d1b4c0fc2b882eaf2fcd8954`, tree `d896d0997d3b79f3265ad40ac10e306b717ac773`, parents `f228d8a4...` + `1c17527f...`):** `exit 0`, `0` conflicts.
2. **`M1` — Merge Calendar Combined PR `#314` (`edbeeffeca97cdb95a4b5dec88f9ee61645910aa`, tree `021ce568864dbb9fb33e095e72bf8e820b0361e9`, parents `b0232fdd...` + `38079865...`):** `exit 0`, clean auto-merge of `apps/chat-api/src/services/chat-service.ts`; intermediate `npm run typecheck:v3` exited `0`.
3. **`M2` — Merge Sheets R2 PR `#306` (`678c5337f0558c3158994825a23e9d09d6ad744c`, tree `6185a45a29537cad679a3b161ede539350696877`, parents `edbeeffe...` + `f292884d...`):** Resolved the exact 3 textual conflicts without blind `ours`/`theirs`:
   - `packages/tool-adapters/src/slack/slack-adapter.ts`: Enforced strict string + trimmed non-empty + `!== 'undefined'` + `!== 'null'` on both `res?.ts` and `res?.channel`, throwing `StepError({ category: 'UNKNOWN', retryable: false, details: { requestSent: true } })` (no invented error symbol) and returning `{ ts: rawTs, channel: rawChannel }`.
   - `apps/chat-api/src/services/schedules/schedule-service.ts`: Preserved all `SCHEDULE_CONFLICTS` (`SCHEDULE_PAUSED` with `'tạm dừng'`, `CONFIG_CHANGED_SINCE_RUN`, `MISSING_DISPATCH_SNAPSHOT`), zero `'slack'` literals (`static-guard.test.ts` green), per-kind `run.dispatched_config` + `schedule.version === run.schedule_version` guard on `mark_sent`, and per-kind paused/version/config-hash/reauth/active-credential guards + `dispatched_config` `INSERT` columns on `retry_new_run`.
   - `scripts/test-v3-browser.mjs`: Preserved `#313`'s ESM exports (`OMITTED_SCENARIO_ROUTING`, `scenarios`, `resolveActiveScenarios`, `isMainModule`) and merged `sheets_digest_v2_recovery` (**25** total scenario groups), `needsSchedule` regexes, and `GMAIL_ENABLED` / `MYSHEETS_ENABLED` / `SCHEDULES_ENABLED` flags.
4. **Code+Test Anchor Commit (`07c086bfb5299632fc35dd85cbcf906ce4cd1099`, full-tree `fcd0e64019b0c70eb96f7e0d6352ead5f1fc7d4d`):**
   - `apps/chat-web/src/pages/Privacy/PrivacyPage.tsx`: Strict TDD (`PRIVACY_RED_EXIT=1` on `calendar-rem-c-09-oauth-disclosure.test.tsx` before editing -> minimal line-459 alignment covering disconnected baseline + personal Google Sheets `drive.file`/`spreadsheets` + personal Google Calendar `calendar.readonly`/`calendar.events`/allowlist -> `PRIVACY_GREEN_EXIT=0`).
   - Added focused combined contract tests in `packages/tool-adapters/tests/slack-adapter.test.ts` (real `node:http` loopback over 12 malformed `{ ok: true }` payloads), `apps/chat-api/tests/services/schedules/trello-telegram-delivery-invariants.test.ts` (`XSVC-B` immutable dispatch snapshot & paused guards across `sheets_digest` + `trello_digest`), `apps/chat-web/tests/browser-scenario-selection.test.ts` (`25` scenarios & `sheets_digest_v2_recovery` routing), and `apps/chat-web/tests/calendar-rem-c-09-oauth-disclosure.test.tsx` (`XSVC-B` combined Google privacy overview).
   - Verified mutation sensitivity: substituting `#313`'s `args.channel` fallback in `slack-adapter.ts` failed (`MUTATION_SLACK_EXIT=1`), and substituting `#313`'s unguarded `schedule.digest_config` in `schedule-service.ts` failed (`MUTATION_SCHED_EXIT=1`); restored cleanly with `0` diff.
5. **Ancestry Proof (`git merge-base --is-ancestor <sha> 07c086bfb5299632fc35dd85cbcf906ce4cd1099`):** `exit 0` for `2eed8d1d4309e833088d6f1d3fa774189049e283`, `1c17527f16715b2c6655c170cdb448673a84dd1b`, `3807986542dbe3470b8f3f1cd42413cb7bd460dd`, and `f292884d0ae965ffb9841e7063b8843cd266b17e`.

---

## 3. Verification Commands, Disposable DB Lifecycle & Explicit Remaining Scope

- **Fresh Uninterrupted Verification Sweep on `07c086bfb5299632fc35dd85cbcf906ce4cd1099`:**
  - `npm run build:v3` -> `exit 0` (`214` modules)
  - `npm run typecheck:v3` -> `exit 0`
  - `npm test --workspace=@wap/tool-schemas` -> `exit 0` (`27` files, `593` passed, `0` skipped)
  - `npx vitest run evaluations/generic-plumbing/static-guard.test.ts` -> `exit 0` (`1` file, `2` passed, `0` skipped)
  - `node scripts/test-v3-web-build-security.mjs` -> `exit 0`
  - Focused non-DB Vitest sweep (`slack-adapter.test.ts`, `trello-audit-remediation.test.ts`, `browser-scenario-selection.test.ts`, `schedule-sheets-digest-v2.test.tsx`, `schedule-trello-digest-mode.test.tsx`, `mysheets-ui.test.tsx`, `calendar-rem-c-09-oauth-disclosure.test.tsx`, `packages/planner/tests/read-answers.test.ts`, `packages/planner/tests/schedules.test.ts`) -> `exit 0` (`9` files, `127` passed, `0` skipped)
  - Focused isolated PostgreSQL 16 recovery sweep (`sheets-gas-r2-remediation.test.ts`, `trello-telegram-delivery-invariants.test.ts`) on disposable container `ati-xsvc-v2-taskb-56789` (`9beaf3ad4ef631e99919d2207933947e151c9a140ecd3cc8fa30b09df981658b`, `postgres:16-alpine`, `127.0.0.1:56789->5432/tcp`, `POSTGRES_DB=ati_v3_taskb`, `ALLOW_ISOLATED_TEST_PORT=1`) -> `exit 0` (`2` files, `22` passed, `0` skipped). Container `ati-xsvc-v2-taskb-56789` was immediately removed (`docker rm -f ati-xsvc-v2-taskb-56789`); pre-existing `ati-cal-combined-gate-56657` remained untouched.
- **Explicitly `PENDING / NOT RUN` After Task B:**
  - **Task C (`PENDING / NOT RUN`):** Full backend cross-service runtime verification (`cross-service-combined-gate.test.ts`, fresh + `<=0032` upgrade migrations, 3 simultaneous due digests, 2 OS scheduler processes + `SIGKILL`, negative-auth `outbound === 0` matrix, full workspace backend runs).
  - **Task D (`PENDING / NOT RUN`):** Real Chromium Playwright E2E scenarios (`scripts/test-v3-browser.mjs`) and Calendar `C1/C2` Chromium extension in `apps/chat-web/tests/browser/mycalendar.spec.ts`.
  - **Task E (`PENDING / NOT RUN`):** Uninterrupted full `npm run check` + all 25 Chromium scenario groups, Draft PR publication, exact-head GitHub Actions `v3 check` verification, and final audit bundle `04..08`.
  - `docs/handoff/CURRENT-STATE.md` and `docs/handoff/ROADMAP.md` were NOT modified.
