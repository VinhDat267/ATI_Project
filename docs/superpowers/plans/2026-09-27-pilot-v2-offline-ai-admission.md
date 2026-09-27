# Pilot v2 Offline AI Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chứng minh offline bằng PostgreSQL/HTTP và fake adapter rằng pilot AI chỉ dispatch một call được grant theo principal, giữ ngân sách bền vững, và lưu/hiển thị outcome an toàn.

**Architecture:** Run + source snapshot commit trước; run `planning` chưa thể dispatch khi chưa có attempt được reserve. API coordinator kiểm grant, run, snapshot và campaign trong một transaction cùng reservation; claim dispatch bằng CAS ở transaction thứ hai. Fake adapter trả envelope tin cậy tách metadata thanh toán giả lập khỏi proposal của model; router settlement và tái kiểm quyền trước approval, owner-only GET chỉ chiếu thông điệp server tạo.

**Tech Stack:** TypeScript, Node 22.12+/24+, Zod 4, postgres.js, PostgreSQL 16, Vitest 4, HTTP API.

**Spec:** [2026-09-27-pilot-v2-offline-ai-admission-design.md](../specs/2026-09-27-pilot-v2-offline-ai-admission-design.md) — `APPROVED_BY_PROJECT_OWNER`; kế hoạch này chưa được duyệt/thực thi.

## Global Constraints

- Không gọi Gemini/OpenAI thật, không bật pilot provider trong `apps/api/src/main.ts`, không tạo Trello card hoặc thay `PILOT_V2_WRITE_ENABLED`.
- Không tự cấp grant từ session/API key, không chia campaign B/local; một active run toàn DB, owner/policy/snapshot/version/hash và approval TTL **10 phút** vẫn do router kiểm.
- Một attempt/call mỗi run; claim đã commit là ranh giới dispatch; timeout/crash sau claim giữ hold khi chi phí không rõ, không retry hoặc tự giải hold. Operator đối chiếu **read-only** trong batch này.
- `clarification/refusal` chỉ lưu và trả message cố định do server tạo; không lưu raw proposal text/prompt/provider response/secret trong outcome, log, event hoặc workflow plan.
- Test phải dùng PostgreSQL cô lập của `makeApiFixture`, fake adapter, `pilotLiveWriteEnabled:false`; `npm run check` không thay thế integration/quality evidence.
- Working tree đã có nhiều file sửa trước task này, gồm `apps/api/src/pilot-router.ts`, test, README và `apps/api/src/pilot-planner.ts` **untracked**. Ghi lại `git status --short`/`git diff` trước khi sửa; giữ nguyên mọi hunk có sẵn. Không `git add .`, không commit toàn file đã dirty; chỉ stage hunk sở hữu sau khi soát staged diff, nếu không tách được thì để uncommitted và báo rõ. Không tạo worktree mặc định từ nguồn dirty.

## Review Focus

1. **Hai request cùng một grant ở giới hạn call/budget:** chỉ một reservation thắng, không thể vượt `max_calls`/held+committed (Task 4).
2. **Grant bị revoke giữa reserve và dispatch, hoặc giữa claim và kết quả:** không gọi callback nếu revoke trước claim; sau claim phải settle nhưng không phát approval (Tasks 4–5).
3. **Timeout, kết quả trễ hay callback bỏ qua AbortSignal:** không tự suy cost=0, không approval/re-dispatch, hold còn và run đã sweep không sống lại (Tasks 3, 5, 7).
4. **Model echo credential/source nhạy cảm trong question/reason:** DB, GET, log và event không chứa text gốc; principal khác nhận 404 (Tasks 6–7).
5. **Reservation/settlement gặp lỗi DB hoặc process chết:** rollback không để attempt gọi được nếu reservation lỗi; sau claim không retry và settlement lặp đồng nhất không tăng chi phí lần hai (Tasks 2, 4, 7).

---

## File map / interfaces shared across tasks

- `db/migrations/0013_pilot_ai_admission.sql`: schema grant, attempt, outcome; không sửa migration `0008` đã áp dụng.
- `packages/engine/src/ai/providers/postgres-ledger.ts`, `packages/engine/src/index.ts`: thêm primitive nhận `postgres.TransactionSql`, giữ wrapper B/local cũ.
- `apps/api/src/pilot-planner.ts`: adapter/result contract và timeout/parser, sửa trên nền untracked hiện hữu mà không thay các hunk khác.
- `apps/api/src/pilot-ai-admission.ts` (new): DB grant/admit/claim/settle, không nhận raw provider output hoặc HTTP request.
- `apps/api/src/pilot-ai-outcome.ts` (new): message allowlist và persistence/projection helper.
- `apps/api/src/pilot-router.ts`, `apps/api/src/app.ts`: wiring opt-in, recheck approval và owner-only projection. `main.ts` **không sửa**.
- `apps/api/tests/pilot-ai-admission.integration.test.ts` (new), `apps/api/tests/pilot-approval.integration.test.ts`, `packages/engine/tests/ai-postgres-ledger.integration.test.ts`, `apps/api/README.md`: DB/HTTP regression và giới hạn.

## Task 1: Additive SQL gate schema

**Files:** Create `db/migrations/0013_pilot_ai_admission.sql`; Test `apps/api/tests/pilot-ai-admission.integration.test.ts`.

**Interfaces:** Produces SQL tables `pilot_ai_grants(campaign_id,principal_id,provider,model,max_calls,max_estimated_cost_micros,expires_at,revoked_at)`, `pilot_ai_attempts(run_id,principal_id,campaign_id,call_id,state,dispatch_claimed_at)`, `pilot_planner_outcomes(run_id,principal_id,kind,reason_code,message)`; FK grant `(campaign_id,principal_id)` → campaign `(campaign_id,user_id)`, unique `(campaign_id,principal_id)` for attempt FK to grant, attempt FK run/call/grant, unique principal grant, run attempt PK, call ID unique; `CHECK campaign_id = 'pilot-v2:' || principal_id::text`, max >0, message length ≤500, closed enum values. Indexes for principal/attempt reads; no seed or auto-grant.

- [ ] **Step 1: Write failing migration test.** In new integration test, create DB with `makeApiFixture`; assert `INSERT pilot_ai_grants` succeeds only for matching campaign owner/prefix and positive caps; duplicate principal, foreign campaign, `max_calls=0` fail; a second attempt for same run fails. Assert missing outcome/attempt initially. Use `ensurePostgresProviderCampaign` for each test principal; always clean up via fixture.close().
- [ ] **Step 2: Run red:** `npm run build -w @wap/db && npm run build -w @wap/engine && npm run test:integration -w @wap/api -- tests/pilot-ai-admission.integration.test.ts` → FAIL because tables absent (requires isolated local PostgreSQL; if unavailable, mark NOT_RUN, do not use demo DB).
- [ ] **Step 3: Add migration** as specified, transactional/forward-only, no ALTER to applied `0008`; use `REFERENCES runs(id)`/`ai_provider_calls(call_id)` and owner joins in app where runs lacks composite owner key.
- [ ] **Step 4: Run green** with the same targeted command → migration constraints PASS. Review exact schema via `git diff`.
- [ ] **Step 5: Commit only owned new migration/test hunks** after `git diff --cached --check` and staged-diff review; if existing file is shared/dirty, defer that hunk instead of staging unrelated work.

## Task 2: Reusable transactional ledger reserve/settle

**Files:** Modify `packages/engine/src/ai/providers/postgres-ledger.ts`, `packages/engine/src/index.ts`; Test `packages/engine/tests/ai-postgres-ledger.integration.test.ts`.

**Interfaces:** Export `reservePostgresProviderCallInTransaction(tx: postgres.TransactionSql, options: PostgresProviderCallLedgerOptions, input: ProviderCallReservation): Promise<string>` and `settlePostgresProviderCallInTransaction(tx: postgres.TransactionSql, options: PostgresProviderCallLedgerOptions, callId: string, outcome: ProviderCallSettlement): Promise<{ overrun: boolean; conflict: boolean }>`; class `reserve/settle` delegate through `db.client.begin`. Conflict/overrun error is thrown **after** transaction commit so campaign halt survives; coordinator also examines flags before approval. Do not call `begin` inside primitives.

- [ ] **Step 1: Write red DB tests:** call `reserve...InTransaction` inside a transaction that throws afterward: no `ai_provider_calls` row or held delta; concurrency 60+60 under limit 100 yields one winner; identical settlement replay leaves committed unchanged, conflicting settlement halts campaign, known overrun halts campaign. Existing public `PostgresProviderCallLedger` tests must remain unchanged.
- [ ] **Step 2: Run red:** `npm run build -w @wap/db && npm run test:integration -w @wap/engine -- tests/ai-postgres-ledger.integration.test.ts` → FAIL missing exports.
- [ ] **Step 3: Extract ledger methods** preserving owner checks, lock/settlement semantics and `CALL_ALREADY_SETTLED`/`BUDGET_OVERRUN` behavior; reuse same code via wrappers rather than duplicating SQL.
- [ ] **Step 4: Run green** on engine DB test, then `npm run test:unit -w @wap/engine -- tests/ai-provider-accounting.test.ts` → PASS; check staged diff.
- [ ] **Step 5: Commit only reviewed owned hunks** (guard shared dirty files as above).

## Task 3: Define fake adapter envelope and timeout semantics

**Files:** Modify `apps/api/src/pilot-planner.ts`; Test `apps/api/tests/pilot-planner.test.ts` (new).

**Interfaces:** Add `PilotAccountedPlanner` alongside the old `PilotPlanner` temporarily (Task 5 migrates router/tests): `provider: 'google' | 'openai'`, `model: string`, `estimatedCostMicros: number` (positive safe integer), `propose({runId,principalId,sourceKey,sourceRevision,context,signal}): Promise<{ proposal: unknown; usage: ProviderCallUsage | null; costMicros: number | null }>`; `requestAccountedPilotProposal(planner,input,timeoutMs): Promise<{ proposal: PilotPlannerProposal; usage: ProviderCallUsage | null; costMicros: number | null }>` parses only proposal as model output; validate cost/usage metadata separately. Unknown/malformed cost cannot authorize approval or imply 0. Production launcher remains without adapter.

- [ ] **Step 1: Write red unit tests:** valid `plan`, `clarification`, `refusal` envelopes parse; extra proposal `args` rejected; credential-looking reason stays only in in-memory parsed proposal and never becomes billing metadata; negative/NaN cost and usage rejected; callback ignoring AbortSignal times out in ≤configured test window and does not return a late success.
- [ ] **Step 2: Run red:** `npm run test:unit -w @wap/api -- tests/pilot-planner.test.ts` → FAIL because accounted helper is absent.
- [ ] **Step 3: Implement adapter contract** and runtime checks. Do not add a network client or insert DB/log writes in this file; caller must treat post-claim timeout as ambiguous.
- [ ] **Step 4: Run green** targeted unit and `npm run build -w @wap/engine && npm run build -w @wap/api` → PASS; old interface stays intact until Task 5.
- [ ] **Step 5: Preserve untracked file contents** and commit only if every byte added to it is owned and staging is safe; otherwise leave it untracked and report.

## Task 4: Durable admission and single-winner dispatch

**Files:** Create `apps/api/src/pilot-ai-admission.ts`; extend `apps/api/tests/pilot-ai-admission.integration.test.ts`.

**Interfaces:** `createPilotAiAdmission({db,policy,config})` produces `preflight(principalId,planner: PilotAccountedPlanner): Promise<void>`, `admit({runId,principalId,versionId,sourceKey,sourceRevision,provider,model,estimate,requestHash}): Promise<{callId:string;campaignId:string}>`, `claim({runId,principalId,callId,versionId,sourceRevision}): Promise<boolean>`, `settle({runId,principalId,callId,outcome:ProviderCallSettlement}): Promise<{overrun:boolean;conflict:boolean}>`; all DB mutations owner-scoped. `requestHash` is SHA-256 of bound context, never raw context. Implement call count by counting campaign's `ai_provider_calls` under the campaign row lock, not a pre-lock count. Never issue callbacks from this module.

- [ ] **Step 1: Write red integration tests:** missing/revoked/expired grant or wrong owner/provider/model and estimate > `max_estimated_cost_micros` deny; no attempt/hold after failed admission; 1 of 2 competing *direct coordinator* admissions on prepared rows wins `max_calls=1` (router vẫn cấm hai active runs), held+committed không vượt campaign cap; claim CAS chỉ thắng một lần; revoke giữa reserve và claim chặn callback; source/version/checklist drift denies; B/local campaign cannot be used.
- [ ] **Step 2: Run red:** `npm run build -w @wap/db && npm run build -w @wap/engine && npm run test:integration -w @wap/api -- tests/pilot-ai-admission.integration.test.ts` → FAIL missing coordinator.
- [ ] **Step 3: Implement coordinator:** transaction locks campaign/grant/run/snapshot in consistent documented order, revalidates policy, creates attempt+reserves via Task 2 primitive in same transaction; `planning` without reserved attempt cannot dispatch. `claim` locks/rechecks immediately before CAS; `settle` makes call+attempt updates atomic, never reopens provider transport, returns flags only after commit. Preserve campaign halt on overrun/conflict and do not produce approval.
- [ ] **Step 4: Run green** targeted DB test and ledger regression → PASS; inspect separate principal isolation and rollback queries.
- [ ] **Step 5: Commit only reviewed owned hunks**; no grant provisioning endpoint/production bootstrap.

## Task 5: Wire router to admission, adapter and conservative settlement

**Files:** Modify `apps/api/src/pilot-router.ts`, `apps/api/src/app.ts`, `apps/api/tests/pilot-approval.integration.test.ts`; extend `apps/api/tests/pilot-ai-admission.integration.test.ts`.

**Interfaces:** Replace `PilotRouterOptions.pilotPlanner?: PilotPlanner` with `PilotAccountedPlanner` and migrate all opt-in fake fixtures (do not leave old callback as bypass); planner-enabled checklist-pass path calls preflight after intake, persists snapshot, admits, claims, calls Task 3 adapter, settles via Task 4, then rechecks owner/source/version/checklist/grant/policy before model `plan` can create approval. Preserve `pilotLiveWriteEnabled:false`, `PilotRunAcceptedResponseSchema` (`202`, status `planning`) and existing approval hash/TTL path. A late result/revoke/settlement overrun never creates approval; non-planner checklist branch unchanged.

- [ ] **Step 1: Write red HTTP tests:** update opt-in fixture to provision isolated grants and fake envelope (no bypass); source snapshot visible to fake callback; two principal campaigns isolated; missing grant fails before run creation, refusal/needs_input checklist never calls planner; revoked before claim yields zero calls; revoke after claim, timeout, invalid proposal, unknown cost, policy drift and stale/swept run yield no approval. Assert `ai_provider_calls` held/committed/status, `pilot_approvals` empty on every failure, zero Trello POST and no external provider `fetch`.
- [ ] **Step 2: Run red:** `npm run build -w @wap/db && npm run build -w @wap/engine && npm run test:integration -w @wap/api -- tests/pilot-approval.integration.test.ts tests/pilot-ai-admission.integration.test.ts` → FAIL old ungated flow.
- [ ] **Step 3: Implement minimal wiring:** no `main.ts` provider; plan path retains existing owner-built write args/preview and 10-minute TTL. Final approval transaction must lock grant before run/snapshot in the same order as claim and recheck revocation; cost-known failure settles correct cost even if grant revoked; post-claim timeout/unknown cost retains hold; pre-claim proven no transport settles cost 0. Do not log exceptions or raw proposal. Keep cleanup `failed` state guarded by `planning` compare-and-set.
- [ ] **Step 4: Run green** targeted integration plus `npm run test:unit -w @wap/api -- tests/pilot-planner.test.ts` → PASS; if fail, inspect state/ledger before adjusting assertions.
- [ ] **Step 5: Stage only new hunks of already dirty router/tests** after exact staged review; never blindly commit older work.

## Task 6: Persist and expose safe planner outcomes

**Files:** Create `apps/api/src/pilot-ai-outcome.ts`; modify `apps/api/src/pilot-router.ts`; extend `apps/api/tests/pilot-approval.integration.test.ts`, `apps/api/tests/pilot-ai-admission.integration.test.ts`; update `apps/api/README.md`.

**Interfaces:** `savePilotPlannerOutcome(tx: postgres.TransactionSql, input:{runId:string;principalId:string;kind:'plan'|'clarification'|'refusal'|'failure';reasonCode:string}): Promise<void>` and `pilotOutcomeMessage(kind,reasonCode): string | null`; `GET /pilot/v2/runs/:id` maps owner-scoped row to existing nullable `clarificationQuestion`, `refusalReason`, `error` fields. Only server-owned codes/messages, max 500 chars, never freeform model text. No new endpoint/UI redesign.

- [ ] **Step 1: Write red tests:** fake model returns question/reason containing configured `fixture-token`, arbitrary source `client_ref` and HTML; DB row, GET, event and request log have only safe message/code, no raw bytes; `GET` with other principal returns 404; failure/timeout yields safe error, neither approval nor preview; `plan` never stores raw proposal.
- [ ] **Step 2: Run red:** `npm run test:integration -w @wap/api -- tests/pilot-approval.integration.test.ts tests/pilot-ai-admission.integration.test.ts` → FAIL missing projection.
- [ ] **Step 3: Implement allowlisted outcome helper** and owner-scoped query/write in router with status+event transaction. `clarification/refusal` have no approval; keep unrelated field null. Update API README with design/limitations and `NOT_RUN` pending final gate; promote to `OFFLINE_TESTED` only in Task 7 after checks pass, no assertion of AI quality.
- [ ] **Step 4: Run green** targeted integration, build API and check `git diff --check` → PASS.
- [ ] **Step 5: Stage only owned hunks**; README/router/test already dirty, leave uncommitted if cannot isolate safely.

## Task 7: Failure-matrix gate and independent review

**Files:** Extend `apps/api/tests/pilot-ai-admission.integration.test.ts`, `packages/engine/tests/ai-postgres-ledger.integration.test.ts` only if Task 1–6 miss a Review Focus case; update `apps/api/README.md` only with measured evidence.

**Interfaces:** No new production surface; acceptance is repeatable isolated-DB tests and honest evidence labels.

- [ ] **Step 1: Add missing red fault tests** for DB rollback at reservation, fail between reserve/claim, crash just after claim, response after sweep/revoke, repeated/conflicting settlement, held budget after unknown cost, cross-owner `GET`/approve. Use callbacks/gates, not real network or sleep-loop; assert exact attempts/holds/status/approval counts.
- [ ] **Step 2: Run targeted red then green** with `npm run test:integration -w @wap/api -- tests/pilot-ai-admission.integration.test.ts tests/pilot-approval.integration.test.ts` (build dependent workspaces first). If no gap remains, document coverage instead of adding redundant tests.
- [ ] **Step 3: Run `npm run check`, API/engine targeted integration and `git diff --check`; inspect generated files and `git status --short` for unintended changes.** If DB unavailable, mark affected integration `NOT_RUN` with reason; only if the offline gates pass, update API README evidence label to `OFFLINE_TESTED` with exact commands. Passing tests are offline evidence only.
- [ ] **Step 4: Request independent `Code Reviewer`** on auth, transactions, revocation/settlement and secret boundaries after implementation; apply only substantiated fixes with new regression tests, rerun affected gates. Main agent integrates verdict; no reviewer edits.
- [ ] **Step 5: Commit only isolated reviewed hunks** if feasible; otherwise report exact files left uncommitted and why. Report actual roles/run IDs, checks, unverified live provider/quality/customer gates.

## Execution handoff

Kế hoạch chỉ cho batch offline. Trước code, người dùng cần duyệt kế hoạch này và chọn native hoặc subagent-driven execution. Với working tree dirty và router/test đang có hunk chưa commit, **khuyến nghị Native** để giữ một writer/kiểm hunk chặt; vẫn yêu cầu reviewer độc lập sau implementation. Không yêu cầu user cấp provider key, quota, Trello write hay bật cờ live ở bước này.
