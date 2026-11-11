# Handoff Log — `2026-11-11` — `XSVC-INTEGRATION-V2` Task C (Backend Runtime Gate, Migrations `0001..0035`, OS `SIGKILL` & Negative Auth)

- **Task Card:** `docs/handoff/tasks/XSVC-INTEGRATION-V2.md`
- **Phase Executed:** **Task C ONLY** (Disposable PostgreSQL 16 Migrations `0001..0035` Fresh + `<=0032` Upgrade, Combined Cross-Service Runtime Suite `S1`–`S6` + Negative Auth `N1`–`N7`, 4 TDD `RED -> GREEN` Backend Integration Fixes, Layer A Workspace Suites, 82-File `@wap/chat-api` Regression Sweep, `05` Backend Evidence, and `07` Initial Risk Register)
- **Worktree:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate`
- **Branch:** `VinhDat267/ati-v3-cross-service-integration-gate` (local only — **not pushed**, **no PR opened yet**)
- **Baseline (`origin/main`):** `2eed8d1d4309e833088d6f1d3fa774189049e283` (full-tree `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4`)
- **Task C Pre-Docs Code+Test Anchor Commit (`C_C1`):** `7dcd3753742c755f3493ba3f010a7a743c72a074` (full-tree `f12bcb2d71d2812f95486d985e5431fe36ef9a89`)
- **Current Gate Status:** Gate A `NOT READY — BLOCKING DEFECT OR MISSING CRITICAL EVIDENCE` | Gate B `NOT READY` | Gate C `PRODUCTION ACTIVATION — HOLD`

---

## 1. Environment, Disposable PostgreSQL 16 Lifecycle & Migration Proofs (`0001..0035`)

1. **Isolation & Container Ownership:**
   - Verified `Test-Path .env` = `False` (`has_dotenv=False`) throughout Task C; zero live credentials or external provider endpoints were used.
   - Launched dedicated disposable PostgreSQL 16.15 container `ati-xsvc-v2-taskc-56791` (`432c5fa8ca7d`, `postgres:16-alpine`, `127.0.0.1:56791->5432/tcp`, `POSTGRES_DB=ati_v3_taskc`, `ALLOW_ISOLATED_TEST_PORT=1`) and tore it down cleanly via `docker rm -f ati-xsvc-v2-taskc-56791` after all suites passed. Pre-existing containers `ati-cal-combined-gate-56657` (`9718bcf4290f`, `56657`) and `ati-v3-test-db-56534` (`20f50936ac02`) were never touched.
2. **Actual `node db/v3/migrate.mjs` Verification (`47` SQL Files Across `0001..0035`):**
   - Verified exact inventory of **47** `.sql` files (`44` files `<= 0032` + `0033_sheets_digest_v2_remediation.sql`, `0034_github_workspace_scoped_team_scope.sql`, `0035_sheets_gas_r2_remediation.sql`) and updated `03-SHARED-FILE-CONFLICT-AND-CONTRACT-MATRIX.md` §2.10 accordingly.
   - Verified fresh apply + idempotency (3 consecutive `node db/v3/migrate.mjs` runs, `exit 0`) and `<=0032` -> `0035` upgrade with seeded `users`, `workspaces`, `workspace_members`, `service_credentials`, `conversations`, `schedules` (`sheets_digest` personal + org v1, `trello_digest`, `calendar_digest`), `schedule_runs`, and legacy `github_team_scope`/`github_team_repos` (`scope_id = 'default'`), preserving 100% of seeded rows and verifying `trg_schedule_runs_capture_dispatched_config` (`docs/audits/2026-11-10-cross-service-integration/evidence/task-c-migrations.txt`).
   - Recorded `0034`'s explicit `BEGIN; ... COMMIT;` early release of `migrate.mjs`'s outer `pg_advisory_xact_lock(20260929)` as `XSVC-RISK-09` (`STAGING EVIDENCE GAP`) in `07-INHERITED-RISKS-AND-STAGING-GAPS.md`.

---

## 2. Combined Runtime Gate (`cross-service-combined-gate.test.ts`) & TDD `RED -> GREEN` Fixes

1. **Pure `RED` Reproduction (`evidence/task-c-combined-gate-red.txt`):**
   - Before modifying any `src/` file, ran `apps/chat-api/tests/services/schedules/cross-service-combined-gate.test.ts` on `2fa749fc` (`07c086bf` code tree): `9 passed | 6 failed (15)` (`S1`, `S2`, `S6`, `N1`, `N2 & N3`, `N4`), exposing 4 real integration/auth defects.
2. **Surgical `GREEN` Fixes Committed in `7dcd3753742c755f3493ba3f010a7a743c72a074` (`0` new migrations, `0` weakened assertions/timeouts):**
   - `apps/chat-api/src/services/schedules/calendar-digest-runner.ts` & `trello-digest-runner.ts`: Passed live `connections.telegram` (`{ credentialId, telegramUserId, username, chatIds }`) into `AdapterFactory` for `telegram` digest delivery and enforced `config.telegramCredentialId` pin match on `TrelloDigestRunner` (`XSVC-RISK-01`).
   - `apps/chat-api/src/services/adapter-factory.ts` & `execution-service.ts`: Validated non-blank `workspaceId` (org mode) and non-blank `userId` + non-`service_account` service (personal mode) **before** computing `cacheKey` or checking `adapterCache`, and rejected blank `conversation.workspace_id` in `ExecutionService` org mode (`XSVC-RISK-02`).
   - `apps/chat-api/src/services/adapter-factory.ts`: Added `adapterCacheMeta` + `verifyCachedAdapterActiveForExecution` so `phase === 'execution'` re-verifies live `CredentialRepo` active status and evicts revoked/deleted adapters from warm cache (`0` unauthorized outbound calls; `static-guard.test.ts` `2/2` PASS) (`XSVC-RISK-03`).
   - `apps/chat-api/src/db/repositories/plan-repo.ts` & `execution-service.ts`: Re-verified active `users` + `workspace_members` and approved `expectedScope` (`workspaceMode`, `workspaceId`) inside `PlanRepo.assertSourceDispatchAllowed` immediately before step dispatch (`XSVC-RISK-04`).
   - `apps/chat-api/tests/services/trello-token-manager.test.ts`: Moved `createMigratedSchema` from `it(...)` to `beforeAll`/`afterAll` without changing test timeouts or assertions.
3. **Post-Fix `GREEN` Combined Runtime Gate (`evidence/task-c-combined-gate-green.txt`):**
   - `npx vitest run apps/chat-api/tests/services/schedules/cross-service-combined-gate.test.ts` -> `exit 0` (`15/15` passed, `0` skipped, `42.75s`), proving `S1`–`S6` (with real OS child PIDs: `S2` `33948`/`10340`; `S4a` digest `SIGKILL` `pid=33456` `exitCode=1`; `S4b` append lease `SIGKILL` `pid=32580` `exitCode=1`), `N1`–`N7` (`unauthorizedOutbound === 0` across all 7 negative cases), malformed receipts / `add_checklist` `partialWrite` -> `reconciliation_required`, `ScheduleService.resolveRunDelivery` snapshot/pause guards, and Calendar coverage/free-slot/IANA `timeZone` invariants.

---

## 3. Layer A & Affected `@wap/chat-api` Verification Counts and Handoff to Task D

- **Verified Backend Suites on `7dcd3753742c755f3493ba3f010a7a743c72a074`:**
  - `npm run typecheck:v3` -> `exit 0`
  - `npx vitest run evaluations/generic-plumbing/static-guard.test.ts` -> `exit 0` (`2/2` passed)
  - `npm test --workspace=@wap/tool-schemas` -> `exit 0` (`27` files, `593` passed, `0` skipped)
  - `npm test --workspace=@wap/tool-adapters` -> `exit 0` (`27` Vitest files `712` + `32` `node --test` = `744` passed, `0` skipped)
  - `npm test --workspace=@wap/planner` -> `exit 0` (`40` files, `567` passed, `0` skipped)
  - `npm test --workspace=@wap/executor` -> `exit 0` (`7` files, `56` passed, `0` skipped)
  - `npm run test:eval:v3` -> `exit 0` (`31` files, `500` passed, `1` skipped)
  - Affected `@wap/chat-api` regression sweep (`--maxWorkers=2` + `node db/v3/migrate.mjs` on `public`) -> `exit 0` (**`82` files, `800` passed, `0` failed, `0` skipped**).
- **Ownership Handoff for Task D (Next Sequential Writer on Same Worktree):**
  - Clean `git status` on `VinhDat267/ati-v3-cross-service-integration-gate`; **zero** files under `apps/chat-web/**`, `scripts/test-v3-browser.mjs`, `docs/handoff/CURRENT-STATE.md`, or `docs/handoff/ROADMAP.md` were touched in Task C.
  - Task D owns `npm test --workspace=@wap/chat-web`, `apps/chat-web/tests/browser/mycalendar.spec.ts` (`MB-05` Calendar `C1/C2` cross-midnight/DST/IANA/`sendInvites`/recurring `timeZone` in real Chromium), targeted `scripts/test-v3-browser.mjs` scenarios, and Section 7 of `05-REGRESSION-TEST-EVIDENCE.md`.
  - Task E owns uninterrupted `npm run check`, all 25 Chromium groups, Draft PR creation, exact-head GitHub Actions `v3 check` verification, and final audit bundle `04..08`.
