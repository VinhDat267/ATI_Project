# Slack Personal Assistant — SLACK-03B2: Derived-Source Lineage & Cascade Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Triển khai sổ bộ chuẩn hóa phả hệ bản sao phái sinh Slack (`slack_derived_copies` & `slack_derived_provenance_segments`), cổng ghi nguyên tử trong cùng 1 giao dịch PostgreSQL với trật tự khóa dòng chống deadlock, rào chắn kiểm tra toàn diện trước khi đọc/render/SSE/model-use, và bộ chạy cascade purge (`SlackCascadePurgeRunner`) cho đúng 7 nhóm bản sao phái sinh chuẩn tắc theo tiêu chuẩn nghiệm thu F3.

**Architecture:** Deep Modules tại `apps/chat-api` và `db/v3`. Sổ bộ phân đoạn chuẩn hóa đa workspace gắn với `ati_user_id`, trần TTL trích đoạn `<= 30 ngày` (`effective_retention_days <= storage_requested_retention_days`). Trật tự khóa một chiều: `conversations` (FOR UPDATE) -> `schedules` (FOR UPDATE) -> `plans` (FOR UPDATE) -> `connections` (FOR SHARE) -> `providers` (FOR SHARE) -> `consents` (FOR SHARE) -> `barriers` -> `lineage` -> `target writes`. Cổng fail-closed cho Inbox/Digest tương lai của SLACK-06.

**Tech Stack:** Node.js 22+, TypeScript 5.6+, Express 5, PostgreSQL 16 (`pg` pool), Vitest.
**Dependencies:** SLACK-01 (Foundation), SLACK-02 (OAuth/Consents), SLACK-03A (Schema contracts, PR #194 `bc8d6b69`), SLACK-03B1 (Raw store/intents queue - frozen interfaces `e9088d5e`).
**Task Card:** [`docs/handoff/tasks/SLACK-03B2-derived-lineage-and-purge.md`](../../handoff/tasks/SLACK-03B2-derived-lineage-and-purge.md).

---

## 1. Bounded Scope, Ownership & Core Invariants

1. **Ranh Giới Bounded Scope 03B2:**
   - 03B1 chỉ quản lý nguồn thô `slack_sources` (trần `<= 7 ngày`), rào chắn `slack_invalidation_barriers` và hàng đợi ý định `slack_invalidation_intents`. Hoàn thành 03B1 KHÔNG đóng F3.
   - 03B2 sở hữu sổ bộ bản sao phái sinh (`SLACK_DERIVED_TARGET_KINDS`), trích đoạn trần `<= 30 ngày`, mở rộng quét fanout sự kiện chính sách (epoch invalidation) qua `slack_derived_provenance_segments`, và điều phối cascade purge thực sự xóa sạch dữ liệu khỏi DB và in-memory.
   - 03B3 quản lý binding executor và hash validation trong `packages/executor`. 03C1 sở hữu adapter đọc transient (`retentionDays: 0`).
   - Cổng fail-closed: `proposal_excerpt` và `daily_digest_entry` thuộc SLACK-06 chưa có bảng/service; cấm tạo stub rỗng giả vờ đóng F3; bắt buộc fail-closed từ chối persist nếu chưa đăng ký lineage.
2. **Observation Capture Identity & Derived-Only Epochs:**
   - Định danh capture (`captureHash`, `capturedAt`, `sourceRef`, `targetOwnership`) không đòi hỏi body nguồn thô phải tồn tại vĩnh viễn trong `slack_sources`.
   - Khi quét sự kiện chính sách (`policy_epoch_invalidated`, `consent_revoked`), bộ quét fanout trực tiếp qua `slack_derived_provenance_segments`, bảo đảm bản sao phái sinh vẫn được purge sạch dù raw body đã hết hạn 7 ngày trước đó hoặc chỉ đọc transient.
3. **Canonical 8 Attributes của storagePolicyRef & TTL Hierarchy:**
   - Lưu trữ đủ 8 thuộc tính canonical: `binding` (5 trường), `purpose='storage'`, `requestedRetentionDays` (1-30), `providerProfileId`, `configFingerprint`, `policyVersion`, `consentRevision`, `providerRevision`, cùng bằng chứng thu thập `acquisition_purpose` và `acquisition_requested_retention_days`.
   - Phân cấp TTL chặt chẽ: `expiry <= effectiveTTL <= issuedTTL <= currentauthority` và trần `<= 30 ngày`. Cấm dùng cờ `isExcerpt` để lách luật lưu trữ raw source quá 7 ngày.
4. **Xác Thực Người Gọi, Mục Đích Tiêu Thụ & Chống Tái Gắn Phiên Bản:**
   - `slack_derived_copies` lưu rõ `ati_user_id`. `assertDerivedCopyAllowed` yêu cầu `callerAtiUserId`, `consumerPurpose`, và `expectedTargetVersion`.
   - Kiểm tra: `callerAtiUserId === derivedCopy.atiUserId`, khớp chủ sở hữu target và TẤT CẢ phân đoạn; cấm truy cập chéo người dùng ATI (nguồn đa workspace cho 1 user ATI hợp lệ, nhưng khác user ATI bị chặn).
   - Danh sách phân đoạn rỗng/thiếu KHÔNG ĐƯỢC PHÉP cấp quyền đọc (fail-closed). Chống tái gắn revision cũ/mới trên cùng target ID.
5. **Ghi Nguyên Tử & Trật Tự Khóa Dòng Chống Deadlock:**
   - Đăng ký phả hệ và ghi artifact đích BẮT BUỘC nằm trong 1 client transaction PostgreSQL.
   - Trật tự khóa sắp xếp theo ID tăng dần: `conversations` (FOR UPDATE) -> `schedules` (FOR UPDATE) -> `plans` (FOR UPDATE) -> `connections` (FOR SHARE) -> `providers` (FOR SHARE) -> `consents` (FOR SHARE) -> kiểm tra barrier -> ghi lineage -> ghi artifact.
6. **Pre-Read Guards, In-Memory Redaction & AbortSignal:**
   - Rào chắn kiểm tra TẤT CẢ phân đoạn trước khi trả qua HTTP, SSE stream, nạp vào planner context, hoặc chạy schedule run.
   - SSE stream và model execution gắn `AbortSignal` thực tế; ngắt truyền tải ngay khi có tín hiệu hủy hoặc rào chắn kích hoạt.
   - Vết bẩn Slack-derived: nếu văn bản model sinh là hỗn hợp không bóc tách được an toàn, redact toàn bộ câu sinh của model (thay bằng tombstone thu hồi), giữ nguyên tin nhắn người dùng.
   - AI/Planner interface: Backend công bố `IPlannerSlackLineageGuard` cho AI Engineer triển khai trong `packages/planner/`; Backend không sửa trực tiếp planner.

---

## 2. Coverage Mapping Table (7 Target Kinds)

| Target Kind | Bảng & Cột Lưu Trữ Thực Tế | Tác Giả Ghi (File + Symbol) | Tác Giả Đọc (File + Symbol) | Xử Lý Purge & Bảo Toàn Ràng Buộc DB | Thành Phần Tương Lai & Cổng Fail-Closed |
|---|---|---|---|---|---|
| `chat_history_message` | `messages.content`, `messages.metadata` (`plan`, `proposal`, `resource_labels`) | `MessageRepo.createMessage`, `ChatService.prepareResponse` / `write` | `MessageRepo.listMessages`, `ChatService` (lines 499-512 prompt hydration), `GET /api/conversations/:id/messages` | Redact content thành tombstone; scrub `metadata.plan`, `metadata.proposal`, `metadata.resource_labels`. Giữ nguyên tin nhắn người dùng gõ. | Hiện hữu trong `apps/chat-api`. |
| `working_memory_entity` | `messages` (`role='system'`, `metadata->>'type'='working_memory'`, `metadata->'state'`) | `ChatService.processMessage` (snapshot memory) | `ChatService.processMessage` (lines 516-519 `memory.fromJSON`) | Xóa sạch các khóa Slack: `__labels`, `__gatherPending`, `__gatherIntent`, `__gatherBindings`, `__gatherMissing`, `members`, và entities phái sinh khỏi state JSON. | Hiện hữu trong `apps/chat-api`. |
| `plan_step_arg` | `plans.plan_json`, `plan_text`, `resource_labels`; `execution_steps.args_json`, `output_json`, `error_json` | `PlanRepo.createPlan`, `StepRepo.createStep`, `StepRepo.updateStepStatus` | `PlanRepo.getPlan`, `PlanRepo.getPendingPlan`, `ExecutionService.runExecution`, `GET /api/conversations/:id/plan` | Pending plan chuyển sang `'superseded'` (thỏa `ux_plans_one_pending_per_conversation`). Scrub `resource_labels`, `args_json`, `output_json`, `error_json`. | Hiện hữu trong `apps/chat-api` & `executor`. |
| `scheduled_workflow_arg` | `schedules.request`, `recurrence`, `status`, `pause_reason`; `schedule_runs.plan_id`, `status`, `error` | `ScheduleService.createSchedule`, `saveFields`, `ScheduleRunner.createRun` | `ScheduleRunner.runDue`, `ScheduleRepo.ownedSchedule`, `GET /api/schedules` | BẢO TOÀN `schedules.request` (thỏa `CHECK char_length(request) BETWEEN 1 AND 1000`). Đặt `status='paused'`, `pause_reason='slack_source_invalidated'`, `next_run_at=NULL`. Chuyển run sang `'discarded'` khi detached plan (thỏa `schedule_runs_plan_check`). | Hiện hữu trong `apps/chat-api`. |
| `audit_log_entry` | `execution_steps.output_json`, `error_json` (bản ghi audit thực thi) | `StepRepo.updateStepStatus`, `StartupReconciliationService` | `ExecutionService.getExecution`, admin audit query | Scrub Slack payload untrusted; chỉ lưu receipt tombstone `(purged_at, reason, tombstone_id)`. (Minh định: không có bảng SQL `audit_logs` riêng trong `db/v3`). | Hiện hữu trong `apps/chat-api`. |
| `proposal_excerpt` | Chưa có bảng (Inbox Proposals SLACK-06) | Dịch vụ Inbox tương lai | UI duyệt đề xuất tương lai | Đánh dấu `revoked_by_source_purge`, scrub trích đoạn. | **Cổng Fail-Closed:** Ném lỗi từ chối lưu trữ trích đoạn nếu chưa có đăng ký lineage hợp lệ. |
| `daily_digest_entry` | Chưa có bảng (Daily Digest SLACK-06) | Digest worker tương lai | API/UI xem digest tương lai | Scrub trích đoạn khỏi digest hoặc đánh dấu `purged`. | **Cổng Fail-Closed:** Ném lỗi từ chối lưu trữ trích đoạn nếu chưa có đăng ký lineage hợp lệ. |

---

## 3. Database DDL: `db/v3/0018_slack_derived_lineage_and_purge.sql`

```sql
-- Migration 0018: Normalized Registry for Slack-Derived Lineage & Cascade Purge Tracking
-- (Dự kiến số 0018 sau 0017 của 03B1; ingress sẽ dùng số tiếp theo)
CREATE TABLE IF NOT EXISTS slack_derived_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ati_user_id UUID NOT NULL REFERENCES users(id),
  target_kind TEXT NOT NULL CHECK (target_kind IN (
    'chat_history_message', 'working_memory_entity', 'plan_step_arg',
    'proposal_excerpt', 'daily_digest_entry', 'scheduled_workflow_arg', 'audit_log_entry'
  )),
  target_id TEXT NOT NULL,
  target_sub_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'tombstoned', 'purged')),
  tombstoned_at TIMESTAMPTZ,
  purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT uq_slack_derived_copies_target UNIQUE (target_kind, target_id, target_sub_id)
);
CREATE INDEX IF NOT EXISTS idx_slack_derived_copies_active ON slack_derived_copies(target_kind, target_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_slack_derived_copies_user ON slack_derived_copies(ati_user_id);

CREATE TABLE IF NOT EXISTS slack_derived_provenance_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  derived_copy_id UUID NOT NULL REFERENCES slack_derived_copies(id) ON DELETE CASCADE,
  segment_index INT NOT NULL CHECK (segment_index >= 0),
  capture_hash TEXT NOT NULL,
  raw_source_id UUID,
  owner_source_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  ati_user_id UUID NOT NULL REFERENCES users(id),
  connection_id UUID NOT NULL,
  workspace_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  identity_version INT NOT NULL CHECK (identity_version > 0),
  provider_profile_id TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  consent_revision TEXT NOT NULL CHECK (consent_revision ~ '^[1-9][0-9]*$'),
  provider_revision TEXT NOT NULL CHECK (provider_revision ~ '^[1-9][0-9]*$'),
  acquisition_purpose TEXT NOT NULL CHECK (acquisition_purpose IN ('manual_lookup', 'triage', 'planning', 'digest')),
  acquisition_requested_retention_days INT NOT NULL CHECK (acquisition_requested_retention_days >= 0),
  policy_purpose TEXT NOT NULL DEFAULT 'storage' CHECK (policy_purpose = 'storage'),
  storage_requested_retention_days INT NOT NULL CHECK (storage_requested_retention_days > 0 AND storage_requested_retention_days <= 30),
  effective_retention_days INT NOT NULL CHECK (effective_retention_days > 0 AND effective_retention_days <= storage_requested_retention_days),
  captured_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT uq_slack_derived_provenance_segment UNIQUE (derived_copy_id, segment_index),
  CONSTRAINT chk_slack_derived_provenance_ttl CHECK (
    expires_at > captured_at AND
    expires_at <= captured_at + make_interval(days => effective_retention_days) AND
    expires_at <= captured_at + INTERVAL '30 days'
  )
);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_lookup ON slack_derived_provenance_segments(workspace_id, resource_type, resource_id, revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_binding ON slack_derived_provenance_segments(ati_user_id, connection_id, identity_version);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_epoch ON slack_derived_provenance_segments(provider_profile_id, policy_version, consent_revision, provider_revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_expires ON slack_derived_provenance_segments(expires_at);
```

---

## 4. Architecture Interfaces, Lock Order & 03B1 Seams

```ts
export interface ObservationCaptureIdentity {
  captureHash: string;
  rawSourceId?: string;
  capturedAt: string;
  sourceRef: SlackSourceRef;
  targetOwnership: { atiUserId: string; connectionId: string; workspaceId: string };
}

export interface ProvenanceSegmentInput {
  captureIdentity: ObservationCaptureIdentity;
  acquisitionPolicyRef: SlackPolicyReference;
  storagePolicyRef: SlackPolicyReference;
  effectiveRetentionDays: number;
}

export interface RegisterDerivedCopyInput {
  atiUserId: string;
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  targetSubId?: string;
  targetVersion?: string | number;
  segments: ProvenanceSegmentInput[];
}

export interface AssertDerivedCopyAllowedInput {
  callerAtiUserId: string;
  consumerPurpose: Exclude<SlackPolicyPurpose, 'storage'>;
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  targetSubId?: string;
  expectedTargetVersion?: string | number;
  signal?: AbortSignal;
}

export interface ISlackDerivedLineageStore {
  registerDerivedCopyInTransaction(client: pg.PoolClient, input: RegisterDerivedCopyInput): Promise<{ derivedCopyId: string }>;
  assertDerivedCopyAllowed(input: AssertDerivedCopyAllowedInput): Promise<
    | { allowed: true }
    | { allowed: false; reason: 'blocked_by_barrier' | 'epoch_invalidated' | 'retention_expired' | 'unauthorized_caller' | 'version_mismatch' | 'not_found'; safeTombstoneOnly?: string }
  >;
}

export interface ISlackCascadePurgeHandler {
  readonly targetKind: SlackDerivedTargetKind;
  purgeTarget(client: pg.PoolClient, targetId: string, targetSubId: string, reason: SlackTombstoneReason): Promise<void>;
}

export interface ISlackCascadePurgeRunner {
  processInvalidationIntent(intentId: string): Promise<{ rawPurged: number; derivedPurged: number }>;
}

export interface IPlannerSlackLineageGuard {
  filterHydratedHistory(callerAtiUserId: string, messages: ChatMessage[], signal?: AbortSignal): Promise<ChatMessage[]>;
  sanitizeWorkingMemory(callerAtiUserId: string, state: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

export interface IExecutorSlackLineageGuard {
  assertPlanStepsExecutable(callerAtiUserId: string, planId: string, steps: PlanStep[], signal?: AbortSignal): Promise<void>;
  sanitizeStepOutputForStorage(callerAtiUserId: string, stepId: string, output: unknown): Promise<unknown>;
}
```

### Global Lock Order Hierarchy & 2-Client Interleaving Proof:
- **Thứ tự khóa đơn điệu:** `conversations` (FOR UPDATE, ORDER BY id ASC) -> `schedules` (FOR UPDATE, ORDER BY id ASC) -> `plans` (FOR UPDATE, ORDER BY id ASC) -> `connections` (FOR SHARE, ORDER BY id ASC) -> `providers` (FOR SHARE, ORDER BY id ASC) -> `consents` (FOR SHARE, ORDER BY id ASC) -> `barriers` (SELECT check) -> `lineage` -> `target writes`.
- **Chứng minh 2 tiến trình đồng thời:**
  - Client 1 (Ghi lineage + artifact): Khóa `conversations` FOR UPDATE -> Khóa `slack_processing_consents` FOR SHARE.
  - Client 2 (Thu hồi quyền 02B/03B1): Khóa `slack_processing_consents` FOR UPDATE -> Stage barrier vào `slack_invalidation_barriers`.
  - Nếu Client 1 giữ FOR SHARE trước: Client 2 chờ ở FOR UPDATE. Client 1 ghi xong commit. Client 2 tiếp tục và purge artifact vừa ghi.
  - Nếu Client 2 giữ FOR UPDATE trước: Client 1 chờ ở FOR SHARE. Client 2 stage barrier commit. Client 1 tiếp tục, thấy barrier pending/revoked -> hủy ghi. KHÔNG BAO GIỜ DEADLOCK.
  - Purger cũng tuân thủ khóa target trước, rồi khóa `slack_derived_copies`, tránh deadlock purger-first vs writer-first.
- **Handoff Seam với 03B1:** 03B1 raw purge hoàn tất KHÔNG ĐƯỢC đánh dấu intent là completed; intent chỉ hoàn tất khi `SlackCascadePurgeRunner` hoàn thành cả 7 target kinds. Nếu handler lỗi, intent giữ trạng thái pending.

---

## 5. Execution Tasks & Real Test Matrix (Proposed NOT_RUN)

### Planned File List:
- Schema: `db/v3/0018_slack_derived_lineage_and_purge.sql`
- Repositories: `apps/chat-api/src/db/repositories/slack-derived-lineage-repo.ts`
- Services: `apps/chat-api/src/services/slack/slack-derived-lineage-store.ts`, `apps/chat-api/src/services/slack/slack-cascade-purge-runner.ts`, `apps/chat-api/src/services/slack/slack-lineage-guards.ts`
- Handlers: `apps/chat-api/src/services/slack/purge-handlers/`: `chat-history-message-purge-handler.ts`, `working-memory-entity-purge-handler.ts`, `plan-step-arg-purge-handler.ts`, `scheduled-workflow-arg-purge-handler.ts`, `execution-audit-purge-handler.ts`, `proposal-excerpt-purge-handler.ts` (fail-closed), `daily-digest-entry-purge-handler.ts` (fail-closed)
- Existing Integration Points: `apps/chat-api/src/services/chat-service.ts`, `plan-repo.ts`, `conversation-routes.ts`, `schedule-routes.ts`, `schedule-runner.ts`
- Tests: `apps/chat-api/tests/db/slack-derived-lineage-repo.test.ts`, `apps/chat-api/tests/services/slack/slack-cascade-purge.test.ts`, `apps/chat-api/tests/services/slack/slack-derived-guards.test.ts`, `apps/chat-api/tests/integration/slack-derived-writers-integration.test.ts`

### Task Decomposition:
- [ ] **Task 1: DDL Migration 0018**
  - Tệp: `db/v3/0018_slack_derived_lineage_and_purge.sql`
  - [Proposed: NOT_RUN] Kiểm tra cú pháp và ràng buộc CHECK TTL trên PostgreSQL 16.
- [ ] **Task 2: Repository & Concurrency Lock Layer**
  - Tệp: `apps/chat-api/src/db/repositories/slack-derived-lineage-repo.ts`
  - [Proposed: NOT_RUN] Test `tests/db/slack-derived-lineage-repo.test.ts`: 2 PG clients thật (Writer FOR SHARE vs Revoker FOR UPDATE), kiểm tra TTL `effective_retention_days <= storage_requested_retention_days <= 30`, đa workspace cho 1 user ATI hợp lệ, chặn cross-ATI user.
- [ ] **Task 3: Lineage Store & Pre-Read Transport Guards**
  - Tệp: `apps/chat-api/src/services/slack/slack-derived-lineage-store.ts`, `slack-lineage-guards.ts`
  - [Proposed: NOT_RUN] Test `tests/services/slack/slack-derived-guards.test.ts`: `assertDerivedCopyAllowed` chặn khi có barrier, chặn cross-ATI user, chặn phân đoạn rỗng, kiểm tra `AbortSignal` hủy stream SSE trước khi phát chunk.
- [ ] **Task 4: Cascade Purge Runner (5 Existing Handlers + 2 Fail-Closed Handlers)**
  - Tệp: `apps/chat-api/src/services/slack/slack-cascade-purge-runner.ts` & 7 handlers
  - [Proposed: NOT_RUN] Test `tests/services/slack/slack-cascade-purge.test.ts`: Xóa sạch sentinels trong `messages`, working memory (`__labels`, `__gather*`, `members`), `plans`, `execution_steps`; bảo toàn `schedules.request` và cập nhật pause; run status sang `discarded`; fail-closed 2 handler tương lai; crash mid-handler (3/7) restart không trùng.
- [ ] **Task 5: Production Writers Integration Test**
  - Tệp: `apps/chat-api/tests/integration/slack-derived-writers-integration.test.ts`
  - [Proposed: NOT_RUN] Test toàn diện các writer thật: `ChatService`, `PlanRepo`, `ScheduleService`, `StepRepo` với PostgreSQL thật.
- [ ] **Task 6: Verification & Review Gates**
  - [Proposed: NOT_RUN] `git diff --check e9088d5e..HEAD`, xác nhận ngân sách dòng `<= 350 lines`, UTF-8 sạch không mojibake.
