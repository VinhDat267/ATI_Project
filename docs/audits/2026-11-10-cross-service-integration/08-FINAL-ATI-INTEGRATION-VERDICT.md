# 08 — Final ATI V3 Cross-Service Integration Gate Verdict

**Audit Bundle:** `docs/audits/2026-11-10-cross-service-integration/`  
**Date:** 2026-11-11  
**Integration Branch:** `VinhDat267/ati-v3-cross-service-integration-gate`  
**Draft Integration PR:** [`#315`](https://github.com/VinhDat267/ATI_Project/pull/315) (`OPEN`, `isDraft: true`, targeting `main` — **DO NOT MARK READY FOR REVIEW OR MERGE WITHOUT EXPLICIT OWNER APPROVAL**)  
**Baseline `origin/main`:** `2eed8d1d4309e833088d6f1d3fa774189049e283` (tree `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4`)  
**Integrated Source PR Heads (All Ancestors via `--no-ff`):**
- Trello Combined PR `#313`: `1c17527f16715b2c6655c170cdb448673a84dd1b` (CI [`42809170181`](https://github.com/VinhDat267/ATI_Project/actions/runs/42809170181) `success` — `CI VERIFIED`)
- Calendar Combined PR `#314`: `3807986542dbe3470b8f3f1cd42413cb7bd460dd` (CI [`42835422010`](https://github.com/VinhDat267/ATI_Project/actions/runs/42835422010) `success` — `CI VERIFIED`)
- Sheets R2 PR `#306`: `f292884d0ae965ffb9841e7063b8843cd266b17e` (CI [`42811254062`](https://github.com/VinhDat267/ATI_Project/actions/runs/42811254062) `success` — `CI VERIFIED`)
**Frozen Tested Code+Test Anchor (`C_E1`):** `4056fef20127d7da3c3139f34830035facbf5daf` (full-tree `270b82ba509d0ef01069c6548e18eb53853fa556`)  
**Superseded Initial Docs Commit (`C_E2`):** `11027dbc1e8c07f78af29c605f5c9eafc85c71a0` (full-tree `e5ff5077c87f09d60f26b78e9c69faa1dd8efd5f`; CI run `42955279986` superseded — does **not** certify `C_E3`)  
**Final Docs Commit (`C_E3`), Final Full-Tree (`HEAD^{tree}`) & Exact-Head CI Run on `C_E3`:** **`PENDING / NOT VERIFIED` at `C_E3` commit time**; recorded externally in the **Draft PR `#315` description**, **Orca `worker_done` report**, and **Coordinator Codex acceptance record** after `C_E3` is pushed and its own required `v3 check` run finishes (`0` non-`docs/` diff vs `4056fef20127d7da3c3139f34830035facbf5daf`).

---

## 1. Three Separate Gate Verdicts

### 1.1. Observed Gate Verdicts at `C_E3` Commit Time (Before `C_E3` Exact-Head CI & Coordinator Acceptance Complete)

| Gate | Observed Allowed Verdict at Commit Time | Commit-Time Justification |
| --- | --- | --- |
| **Gate A — Technical Cross-Service Code & Runtime Integration Gate** | **`NOT READY — BLOCKING DEFECT OR MISSING CRITICAL EVIDENCE`** | Observed status inside this committed file **solely because**: (1) required GitHub Actions workflow `v3 check` (`v3` job) on exact final docs commit `C_E3` is **`PENDING / NOT VERIFIED`** at commit time (cannot complete before `C_E3` is committed and pushed; superseded run `42955279986` on `11027dbc` does not verify `C_E3`), and (2) Coordinator Codex's final independent acceptance review of Task E is **`PENDING`** (`XSVC-RISK-10`). On frozen code+test anchor `4056fef20127d7da3c3139f34830035facbf5daf`, zero open code or test regressions were found: all 3 pinned source PR heads (`#313`, `#314`, `#306`) are `--no-ff` ancestors (`INDEPENDENTLY VERIFIED`), all 3 textual conflicts and 6 cross-service runtime/UI/disclosure fixes are verified via TDD `RED -> GREEN`, and uninterrupted local `npm run check` (`EXIT_CODE=0`, `47` SQL migrations, `6,494` passed, `0` failed, `1` conditional skip) plus all **25** browser scenario groups (`npm run test:browser:v3`: `EXIT_CODE=0`, `201` passed, `0` failed, `1` conditional skip) passed (`WORKER REPORTED`). |
| **Gate B — Repository Merge Readiness (`main`)** | **`NOT READY`** | Observed status at commit time pending completion of exact-head `v3 check` on `C_E3` and Coordinator Codex's independent acceptance review. Draft PR [`#315`](https://github.com/VinhDat267/ATI_Project/pull/315) remains strictly in **Draft** (`isDraft: true`) and unmerged, and requires explicit Project Owner approval even after Gate A/B prerequisites settle. |
| **Gate C — Production Deployment & Live Provider Activation** | **`PRODUCTION ACTIVATION — HOLD`** | **Strict unconditional HOLD.** Do **NOT** deploy to production, run `0035_sheets_gas_r2_remediation.sql` against production without serialized single-migrator controls (`XSVC-RISK-09`), or enable live `MYSHEETS_ENABLED=on` / `ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=true` / live scheduled digests until: (1) `GAS-03` live staging runbook (`docs/ai-evidence/SHEETS-DIGEST-V2-STAGING-RUNBOOK.md`, including live Google OAuth/Picker/Sheets, live third-party LLM prompt-injection checks with `includeAiSummary = true`, and live Slack/Gmail/Telegram delivery) is executed and signed off (`XSVC-RISK-11`), (2) live Calendar invitations/revocation & Trello OAuth staging checks complete, (3) multi-replica OAuth token refresh locking (`XSVC-RISK-08`), operator `sheets_append_leases` recovery tooling (`XSVC-RISK-07`), and Calendar receipt/pinning follow-ups (`XSVC-RISK-05..06`) are addressed for the target topology, and (4) explicit Owner production authorization is granted. |

### 1.2. Explicitly Conditional Worker Proposal (Contingent on Future Evidence — NOT an Observed Pass Assertion)

- **Condition Precedent (Both Required Externally After Push of `C_E3`):**
  1. Required GitHub Actions workflow `v3 check` (single job `v3`) completes with `status: "completed"` and `conclusion: "success"` on the **exact `C_E3` commit SHA** (`headSha === C_E3`, recorded externally in Draft PR `#315`'s description and `worker_done`); **and**
  2. Coordinator Codex independently reviews and accepts the final `C_E3` candidate, exact-head CI evidence, and Task E audit bundle.
- **Conditional Recommendation If Both Conditions Above Succeed:**
  - **Gate A (Conditional Proposal):** `PASS — VERIFIED WITHIN TESTED SCOPE` *(or `CONDITIONAL — NON-BLOCKING GAPS` if Coordinator Codex / Root Reviewer elects to treat inherited Calendar `calendar_digest` manual-recovery parity `XSVC-RISK-05` as a Gate A condition rather than an inherited post-Gate-B backlog item)*.
  - **Gate B (Conditional Proposal):** `MERGE READY FOR OWNER REVIEW` *(explicit Project Owner review and approval remains mandatory before marking PR `#315` Ready for Review or merging into `main`; constituent Draft PRs `#306`, `#313`, `#314` should be closed/superseded only if and when the Owner merges `#315`)*.
  - **Gate C:** Remains **`PRODUCTION ACTIVATION — HOLD`**.

---

## 2. Why the Single Combined Integration PR (`#315`) Is Recommended Over Sequential Merges

1. **Eliminates Broken Intermediate `main` States:** Merging `#313`, `#314`, and `#306` sequentially would expose intermediate commits on `main` lacking the strict `SlackAdapter.sendMessage` receipt intersection (`ts` & `channel` non-empty, `!== 'undefined'`, `!== 'null'`, `details: { requestSent: true }`) and lacking `GAS-08` version-guarded `dispatched_config` protection on `trello_digest`/`telegram_digest` `mark_sent`.
2. **Contains Cross-PR Runtime Fixes Absent From Every Individual PR:** None of the three constituent PRs alone contains the **6 cross-service fixes** proven necessary on the assembled runtime (`07c086bf`, `7dcd3753`, `5e281998`, `4056fef2`):
   - `CalendarDigestRunner` & `TrelloDigestRunner` verified `connections.telegram` binding (`XSVC-RISK-01`);
   - `AdapterFactory` & `ExecutionService` pre-cache fail-closed validation on blank `workspaceId` / `userId` (`XSVC-RISK-02`);
   - `AdapterFactory` inline `phase === 'execution'` credential status re-query & cache eviction (`XSVC-RISK-03`);
   - `PlanRepo.assertSourceDispatchAllowed` transactional `users` + `workspace_members` + `expectedScope` enforcement before every step (`XSVC-RISK-04`);
   - `ScheduleRunRecovery.tsx` Cockpit/History parity and fail-closed `'unknown'` `scheduleStatus` handling (`XSVC-RISK-13`, `XSVC-RISK-14`);
   - `PrivacyPage.tsx` unified Google overview and truthful `(phạm vi OAuth drive.file)` personal Sheets scope disclosure (`XSVC-RISK-15`).
3. **Preserves Constituent Audit Baselines Untouched:** PRs `#306`, `#313`, and `#314` remain frozen at their CI-certified SHAs while `--no-ff` merges (`M0`, `M1`, `M2`) retain 100% commit ancestry on the combined branch.

---

## 3. Explicit Coverage Boundaries, Three-Way Provenance Separation & Non-Claims

1. **Strict Three-Way Attribution (Coordinator `INDEPENDENTLY VERIFIED` vs. Actual `CI VERIFIED` vs. Local `WORKER REPORTED`):**
   - **Coordinator Codex `INDEPENDENTLY VERIFIED` (Observed Prior to `C_E3`):**
     - Ancestry & 4 Task B contract suites (`15` tests PASS on `2fa749fc`);
     - Combined backend PostgreSQL 16 + OS `SIGKILL` + negative-auth suite `cross-service-combined-gate.test.ts` (`15/15` PASS in `28.59s` on `a5309f21`);
     - 3 Task D frontend suites (`cross-service-recovery-privacy.test.tsx`, `browser-scenario-selection.test.ts`, `calendar-rem-c-review-regressions.test.tsx` -> `3` files / `17` tests PASS in `2.90s` on `127ded5c`);
     - Draft PR `#315` open/Draft state, baseline `2eed8d1d`, and diff metrics (`133` files `+25105/-1437` at `11027dbc`).
     - Coordinator Codex's final acceptance review of Task E is **`PENDING`** at `C_E3` commit time.
   - **Actual GitHub Actions Evidence (`CI VERIFIED` vs. `PENDING / NOT VERIFIED`):**
     - Source PR exact-head runs (`42809170181` on `#313`, `42835422010` on `#314`, `42811254062` on `#306`) are **`CI VERIFIED`**.
     - Superseded `11027dbc` run [`42955279986`](https://github.com/VinhDat267/ATI_Project/actions/runs/42955279986) (`completed` / `success` on `11027dbc1e8c07f78af29c605f5c9eafc85c71a0`, which was `in_progress` when `11027dbc` was reviewed) applies to superseded commit `11027dbc` only and **does NOT certify final docs commit `C_E3`**.
     - Exact-head `v3 check` on final docs commit `C_E3` is **`PENDING / NOT VERIFIED`** inside this committed file and is recorded externally in Draft PR `#315` body and `worker_done` only after `C_E3`'s own required check finishes.
   - **Local Worker Execution (`WORKER REPORTED` on `4056fef20127d7da3c3139f34830035facbf5daf`):**
     - Scoped `RED -> GREEN` fixes in `4056fef2` (`ScheduleRunRecovery.tsx` `'unknown'` `scheduleStatus` fail-closed + `PrivacyPage.tsx` `drive.file` disclosure -> `8/8` PASS across `cross-service-recovery-privacy.test.tsx` & `calendar-rem-c-09-oauth-disclosure.test.tsx`);
     - Uninterrupted `npm run check` (`EXIT_CODE=0`, `6,494` passed, `0` failed, `1` conditional skip in `761.71s`);
     - Uninterrupted all **25** browser scenario groups via `npm run test:browser:v3` (`EXIT_CODE=0`, `201` passed, `0` failed, `1` conditional skip in `1115.47s`).
2. **Real Transport vs. Fixture-Seeded / Route-Mocked Browser Boundaries:**
   - **23 of 25** browser scenario groups (`198` passed, `0` failed, `1` conditional skip) execute against **real Vite + real `@wap/chat-api` + real PostgreSQL 16 + real loopback HTTP provider fixtures**. Within `SCENARIO=mycalendar` (`10/10` PASS), `Flow 6` (`C1`/cross-midnight/DST/`RRULE`) and `Flow 7` (`C2` `sendInvites` / `sendUpdates=none|all`) **seed certified plans via `seedCertifiedCalendarPlan` + `certifyFixturePlan`** — planner LLM generation in those two flows is fixture-seeded, while browser OAuth connection, `PlanMoment`/`PreviewModal` DOM, approval click, `ExecutionService`, `PersonalCalendarAdapter`, and loopback HTTP capture (`/__stats`) are 100% real.
   - **2 of 25** browser scenario groups (`sheets_digest_v2_recovery` `1/1`, `trello_telegram_mocked_ui` `2/2` -> `3` passed total) intercept `/api/**` via Playwright `page.route` (`mocked_browser_routes`) and prove **Chromium UI/DOM interaction only** (real backend/DB coverage for those features is provided separately by `schedule-sheets-digest-v2-real-backend.test.tsx`, `trello_telegram_sandbox_e2e`, and backend PostgreSQL suites).
3. **No Universal Provider-Level "Exactly-Once" Delivery Claim:** External HTTP APIs (Slack `chat.postMessage`, Telegram `sendMessage`, Gmail `messages.send`, Google Sheets `values:append`) do not provide cross-crash two-phase commit; if a worker crashes or drops TCP after the provider accepts a write, Planora fails closed to `'needs_attention'` (`*_DELIVERY_UNKNOWN`) or `'unknown_outcome'` (`sheets_append_leases`) with **zero automatic replay**, requiring human or provider-verified reconciliation.
4. **Product Value, User Adoption & ROI (`NOT VERIFIED`):** Technical gate verification does not certify end-user comprehension, multi-service Phase 7 product completion (`AGENTS.md` §1.2 / v3 spec §1.4), or business ROI (`XSVC-RISK-12`).

---

## 4. Required Next Actions

1. **Exact-Head CI & Coordinator Acceptance (Gate A / B Prerequisites):** Verify that GitHub Actions `v3 check` (`v3` job) completes with `conclusion: "success"` on exact final docs `HEAD` (`C_E3`), record that run externally in Draft PR `#315`'s description and `worker_done`, and complete Coordinator Codex's independent acceptance review.
2. **Project Owner Review (Gate B):** Keep Draft PR [`#315`](https://github.com/VinhDat267/ATI_Project/pull/315) in **Draft** until explicit Owner review and approval; if approved for `main` integration, merge `#315` and close superseded Draft PRs `#306`, `#313`, `#314`.
3. **Maintain Gate C (`PRODUCTION ACTIVATION — HOLD`):** Do not deploy or enable live provider flags until staging runbook `docs/ai-evidence/SHEETS-DIGEST-V2-STAGING-RUNBOOK.md` (`GAS-03`), live provider staging checks (`XSVC-RISK-11`), serialized migration execution (`XSVC-RISK-09`), and operational recovery/refresh prerequisites (`XSVC-RISK-05..08`) are completed and signed off.
