# 08 — Final ATI V3 Cross-Service Integration Gate Verdict

**Audit Bundle:** `docs/audits/2026-11-10-cross-service-integration/`  
**Date:** 2026-11-11  
**Integration Branch:** `VinhDat267/ati-v3-cross-service-integration-gate` (**Draft PR targeting `main` — DO NOT MERGE WITHOUT EXPLICIT OWNER APPROVAL**)  
**Baseline `origin/main`:** `2eed8d1d4309e833088d6f1d3fa774189049e283` (tree `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4`)  
**Integrated Source PR Heads (All Ancestors via `--no-ff`):**
- Trello Combined PR `#313`: `1c17527f16715b2c6655c170cdb448673a84dd1b` (CI [`42809170181`](https://github.com/VinhDat267/ATI_Project/actions/runs/42809170181) `success`)
- Calendar Combined PR `#314`: `3807986542dbe3470b8f3f1cd42413cb7bd460dd` (CI [`42835422010`](https://github.com/VinhDat267/ATI_Project/actions/runs/42835422010) `success`)
- Sheets R2 PR `#306`: `f292884d0ae965ffb9841e7063b8843cd266b17e` (CI [`42811254062`](https://github.com/VinhDat267/ATI_Project/actions/runs/42811254062) `success`)
**Frozen Tested Code+Test Anchor (`C_E1`):** `4056fef20127d7da3c3139f34830035facbf5daf` (full-tree `270b82ba509d0ef01069c6548e18eb53853fa556`)  
**Final Commit (`C_E2`), Final Full-Tree (`HEAD^{tree}`), Draft PR & Exact-Head CI Run:** Recorded externally in the **Draft PR description** and **Coordinator acceptance record** (zero source/test diff vs `4056fef20127d7da3c3139f34830035facbf5daf`).

---

## 1. Three Separate Gate Verdicts (Worker Proposed — Subject to Independent Coordinator Acceptance & Explicit Owner Approval)

| Gate | Official Allowed Verdict | Scope & Justification |
| --- | --- | --- |
| **Gate A — Technical Cross-Service Code & Runtime Integration Gate** | **`PASS — VERIFIED WITHIN TESTED SCOPE`** | All 3 pinned source PR heads (`#313`, `#314`, `#306`) are preserved via `--no-ff` ancestry onto `origin/main` (`2eed8d1d...`). All 3 textual conflicts, 4 cross-service backend integration/auth defects (`XSVC-RISK-01..04`), Cockpit/History recovery parity & unknown-status fail-closed handling (`XSVC-RISK-13`, `XSVC-RISK-14`), Calendar `C1/C2/DST/RRULE` real-Chromium proofs (`MB-05`), and personal Google Sheets `drive.file`-only privacy disclosure (`XSVC-RISK-15`) are resolved and verified via TDD `RED -> GREEN`. Complete `npm run check` (`EXIT_CODE=0`, `47` SQL migrations, `6,494` passed, `0` failed, `1` conditional skip), all **25** browser scenario groups (`npm run test:browser:v3`: `EXIT_CODE=0`, `201` passed, `0` failed, `1` conditional skip), and exact-final-head GitHub Actions `v3 check` (`v3` job) pass with zero open integration regressions inside the tested loopback/PostgreSQL/Chromium scope. *(Note: Inherited single-service design follow-ups `XSVC-RISK-05..08` are non-regressing and fully disclosed in `07`; if the Root Reviewer elects to treat inherited Calendar `calendar_digest` manual-recovery parity `XSVC-RISK-05` as a Gate A condition rather than an inherited post-Gate-B backlog item, the fallback allowed label is `CONDITIONAL — NON-BLOCKING GAPS`.)* |
| **Gate B — Repository Merge Readiness (`main`)** | **`MERGE READY FOR OWNER REVIEW`** | The single combined Draft Integration PR preserves complete commit history, includes all cross-service contract fixes that would be **missing** from naive sequential PR merges, carries the complete 8-document audit bundle (`01..08`), and has exact-head CI verification. **Explicit Owner review and approval is mandatory before marking Ready for Review or merging into `main`; constituent Draft PRs `#306`, `#313`, `#314` should be closed/superseded only if and when the Owner merges the combined PR.** |
| **Gate C — Production Deployment & Live Provider Activation** | **`PRODUCTION ACTIVATION — HOLD`** | **Strict HOLD.** Do **NOT** deploy to production, run `0035_sheets_gas_r2_remediation.sql` against production without serialized single-migrator controls (`XSVC-RISK-09`), or enable live `MYSHEETS_ENABLED=on` / `ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=true` / live scheduled digests until: (1) `GAS-03` live staging runbook (`docs/ai-evidence/SHEETS-DIGEST-V2-STAGING-RUNBOOK.md`, including live Google OAuth/Picker/Sheets, live third-party LLM prompt-injection checks with `includeAiSummary = true`, and live Slack/Gmail/Telegram delivery) is executed and signed off (`XSVC-RISK-11`), (2) live Calendar invitations/revocation & Trello OAuth staging checks complete, (3) multi-replica OAuth token refresh locking (`XSVC-RISK-08`) and operator `sheets_append_leases` recovery tooling (`XSVC-RISK-07`) are in place for the target topology, and (4) explicit Owner production authorization is granted. |

---

## 2. Why the Single Combined Integration PR Is Recommended Over Sequential Merges

1. **Eliminates Broken Intermediate `main` States:** Merging `#313`, `#314`, and `#306` sequentially would expose intermediate commits on `main` lacking the strict `SlackAdapter.sendMessage` receipt intersection (`ts` & `channel` non-empty, `!== 'undefined'`, `!== 'null'`, `details: { requestSent: true }`) and lacking `GAS-08` version-guarded `dispatched_config` protection on `trello_digest`/`telegram_digest` `mark_sent`.
2. **Contains Cross-PR Runtime Fixes Absent From Every Individual PR:** None of the three constituent PRs alone contains the **6 cross-service fixes** proven necessary on the assembled runtime (`7dcd3753`, `5e281998`, `4056fef2`):
   - `CalendarDigestRunner` & `TrelloDigestRunner` verified `connections.telegram` binding (`XSVC-RISK-01`);
   - `AdapterFactory` & `ExecutionService` pre-cache fail-closed validation on blank `workspaceId` / `userId` (`XSVC-RISK-02`);
   - `AdapterFactory` inline `phase === 'execution'` credential status re-query & cache eviction (`XSVC-RISK-03`);
   - `PlanRepo.assertSourceDispatchAllowed` transactional `users` + `workspace_members` + `expectedScope` enforcement before every step (`XSVC-RISK-04`);
   - `ScheduleRunRecovery.tsx` Cockpit/History parity and fail-closed `'unknown'` `scheduleStatus` handling (`XSVC-RISK-13`, `XSVC-RISK-14`);
   - `PrivacyPage.tsx` unified Google overview and truthful `(phạm vi OAuth drive.file)` personal Sheets scope disclosure (`XSVC-RISK-15`).
3. **Preserves Constituent Audit Baselines Untouched:** PRs `#306`, `#313`, and `#314` remain frozen at their CI-certified SHAs while `--no-ff` merges (`M0`, `M1`, `M2`) retain 100% commit ancestry on the combined branch.

---

## 3. Explicit Coverage Boundaries, Provenance Separation & Non-Claims

1. **Coordinator `INDEPENDENTLY VERIFIED` vs. Worker `WORKER REPORTED`:**
   - **Independently Verified by Coordinator Codex prior to Task E:** Ancestry & 4 Task B contract suites (`15` tests on `2fa749fc`), combined backend PostgreSQL 16 + OS `SIGKILL` + negative-auth suite `cross-service-combined-gate.test.ts` (`15/15` PASS in `28.59s` on `a5309f21`), and 3 Task D frontend suites (`cross-service-recovery-privacy.test.tsx`, `browser-scenario-selection.test.ts`, `calendar-rem-c-review-regressions.test.tsx` -> `3` files / `17` tests PASS in `2.90s` on `127ded5c`).
   - **Worker Reported in Task E on `4056fef2` (Awaiting Final Coordinator Review & Corroborated by GitHub Actions `CI VERIFIED`):** Uninterrupted `npm run check` (`6,494` passed, `0` failed, `1` conditional skip), all **25** browser scenario groups via `npm run test:browser:v3` (`201` passed, `0` failed, `1` conditional skip), and the 2 scoped `RED -> GREEN` fixes in `4056fef2`.
2. **Real Transport vs. Fixture-Seeded / Route-Mocked Browser Boundaries:**
   - **23 of 25** browser scenario groups (`198` passed, `0` failed, `1` conditional skip) execute against **real Vite + real `@wap/chat-api` + real PostgreSQL 16 + real loopback HTTP provider fixtures**. Within `SCENARIO=mycalendar` (`10/10` PASS), `Flow 6` (`C1`/cross-midnight/DST/`RRULE`) and `Flow 7` (`C2` `sendInvites` / `sendUpdates=none|all`) **seed certified plans via `seedCertifiedCalendarPlan` + `certifyFixturePlan`** — planner LLM generation in those two flows is fixture-seeded, while browser OAuth connection, `PlanMoment`/`PreviewModal` DOM, approval click, `ExecutionService`, `PersonalCalendarAdapter`, and loopback HTTP capture (`/__stats`) are 100% real.
   - **2 of 25** browser scenario groups (`sheets_digest_v2_recovery` `1/1`, `trello_telegram_mocked_ui` `2/2` -> `3` passed total) intercept `/api/**` via Playwright `page.route` (`mocked_browser_routes`) and prove **Chromium UI/DOM interaction only** (real backend/DB coverage for those features is provided separately by `schedule-sheets-digest-v2-real-backend.test.tsx`, `trello_telegram_sandbox_e2e`, and backend PostgreSQL suites).
3. **No Universal Provider-Level "Exactly-Once" Delivery Claim:** External HTTP APIs (Slack `chat.postMessage`, Telegram `sendMessage`, Gmail `messages.send`, Google Sheets `values:append`) do not provide cross-crash two-phase commit; if a worker crashes or drops TCP after the provider accepts a write, Planora fails closed to `'needs_attention'` (`*_DELIVERY_UNKNOWN`) or `'unknown_outcome'` (`sheets_append_leases`) with **zero automatic replay**, requiring human or provider-verified reconciliation.
4. **Product Value, User Adoption & ROI (`NOT VERIFIED`):** Technical gate verification does not certify end-user comprehension, multi-service Phase 7 product completion (`AGENTS.md` §1.2 / v3 spec §1.4), or business ROI (`XSVC-RISK-12`).

---

## 4. Required Next Actions for Project Owner

1. Inspect the **Draft PR** (`[DO NOT MERGE] chore(ati): V3 cross-service combined integration gate`), its exact-head `v3 check` GitHub Actions run, and audit documents `01` through `08`.
2. Keep the PR in **Draft** until Owner review completes; if approved for `main` integration (**Gate B**), merge the combined PR (and close superseded Draft PRs `#306`, `#313`, `#314`).
3. Maintain **Gate C (`PRODUCTION ACTIVATION — HOLD`)** until staging runbook `docs/ai-evidence/SHEETS-DIGEST-V2-STAGING-RUNBOOK.md` (`GAS-03`), live provider staging checks (`XSVC-RISK-11`), serialized migration execution (`XSVC-RISK-09`), and operational recovery/refresh prerequisites (`XSVC-RISK-05..08`) are completed and signed off.
