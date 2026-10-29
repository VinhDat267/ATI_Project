# SLACK-03B2 · Phả Hệ Nguồn Bản Sao Phái Sinh & Cascade Purge Bền Vững

**Trạng thái:** DỰ THẢO KẾ HOẠCH — THẨM ĐỊNH BỞI ĐIỀU PHỐI VIÊN (DOCS ONLY, chưa thực thi code runtime).
**Nhánh công việc dự kiến:** `docs/slack-03b2-derived-plan` (Draft PR vào `integration/slack-personal-20261029`).
**Nền đối chiếu:** `e9088d5e76e95fa65e3be019226835371e40908d` (trên `integration/slack-personal-20261029`).
**Vai trò sở hữu:** Backend Engineer (sở hữu độc quyền `apps/chat-api/` và `db/v3/`).
**Phụ thuộc:**
- **SLACK-01** (Foundation contracts `SlackBinding`, `SlackSourceRef`, `SlackModelPolicy`, fixture HTTP, probe offline) — ĐÃ HOÀN TẤT (`fc12e3fb`).
- **SLACK-02** (OAuth, connections, processing consents) — Đang tích hợp qua PR #184/#192.
- **SLACK-03A** (Schema contracts `SlackPolicyEpoch`, `SlackDerivedCopyRef`, `SlackSourceLineage`, `SlackPurgeTarget` với 6 scopes bao gồm `policy_epoch_invalidated`, PR #194, head `bc8d6b69`) — ĐÃ CHẤP THUẬN.
- **SLACK-03B1** (Raw source store, durable barriers, queue, policy consumer — sibling `feat/slack-03b1-source-store`, `ctx_29765fc6b1b7`, PR #196) — CHƯA ĐƯỢC CHẤP THUẬN RUNTIME; giao diện consumer được xây dựng dựa trên hợp đồng đóng băng (`frozen interfaces` `e9088d5e`).
- **SLACK-03C1** (Read adapters — sibling `feat/slack-03c1-read-adapters`, `ctx_89198a2a3d9d`) — CHƯA ĐƯỢC CHẤP THUẬN RUNTIME.
- **SLACK-04A** (Ingress contracts — `2026-10-29-slack-source-ingress-contracts.md` / `msg_150cb7b10000`) — ĐÃ CHẤP THUẬN GIAO ƯỚC.

**Task cha:** [`docs/handoff/tasks/SLACK-03-tool-catalog-and-source-lifecycle.md`](SLACK-03-tool-catalog-and-source-lifecycle.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md`](../../superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md).

---

## 1. Mục Tiêu & Ranh Giới Phạm Vi Bounded

Card này thiết kế cơ chế đăng ký phả hệ chuẩn hóa bền vững (`slack_derived_copies` và `slack_derived_provenance_segments`) cho mọi bản sao phái sinh mang dữ liệu Slack, gắn kết nguyên tử với thao tác ghi thực tế trong một giao dịch PostgreSQL, rào chắn kiểm tra toàn diện trước mọi thao tác đọc/render/model-use/SSE/lịch trình, và bộ chạy cascade purge (`SlackCascadePurgeRunner`) cho đúng **7 nhóm bản sao phái sinh** chuẩn tắc theo tiêu chuẩn nghiệm thu F3.

### 1.1. Ranh Giới Phân Tầng Bounded Scope:
1. **03B1 (Nguồn Thô) vs 03B2 (Bản Sao Phái Sinh - Card này):**
   - 03B1 chỉ quản lý bảng dữ liệu nguồn thô `slack_sources` (trần TTL cứng `<= 7 ngày`), rào chắn tức thời `slack_invalidation_barriers`, hàng đợi `slack_invalidation_intents`, và xóa dòng nguồn thô. Hoàn thành 03B1 KHÔNG đồng nghĩa hoàn tất cascade purge F3.
   - 03B2 sở hữu sổ bộ chuẩn hóa của mọi bản sao phái sinh (`SLACK_DERIVED_TARGET_KINDS`), quản lý trích đoạn (trần TTL `<= 30 ngày`), mở rộng bộ quét fanout sự kiện chính sách để bao gồm cả các epoch chỉ tồn tại ở bản sao phái sinh, và điều phối cascade purge thực sự xóa sạch nội dung/trích đoạn khỏi database và bộ nhớ.
2. **03B2 vs 03B3 (Executor):**
   - 03B2 cung cấp giao diện thẩm định `IExecutorSlackLineageGuard` để kiểm tra rào chắn trước khi phân giải tham số và serialize kết quả. 03B3 độc quyền sở hữu logic kiểm tra binding và tính toàn vẹn hash trước dispatch trong `packages/executor/`.
3. **03B2 vs 03C (Adapters) & 04A (Ingress):**
   - 03C sở hữu adapter đọc và thu thập transient (`retentionDays: 0`). Quyền đọc tạm thời không phải quyền lưu trữ; việc chuyển hóa sang bản sao phái sinh đòi hỏi tham chiếu chính sách mục đích `'storage'` riêng biệt dưới cùng epoch thu thập.
   - 04A sở hữu webhook ingress và gọi `stageInTransaction` của 03B1. 03B2 tiêu thụ hàng đợi intent từ 03B1 để thực thi cascade purge.
4. **03B2 vs 06 (Inbox & Digest):**
   - Các thực thể `proposal_excerpt` và `daily_digest_entry` thuộc về các module Inbox/Digest tương lai của SLACK-06. 03B2 thiết lập rào chắn fail-closed: từ chối lưu trữ trích đoạn nếu chưa đăng ký hợp đồng phả hệ.

### 1.2. Định Danh Observation Capture Identity & Derived-Only Epochs:
- Định danh quan sát capture (`ObservationCaptureIdentity`) không phụ thuộc vào sự tồn tại lâu dài của bản ghi raw text trong `slack_sources`. Định danh bao gồm: `captureHash` (mã băm SHA-256 của nội dung quan sát), `capturedAt` (thời điểm thu thập ISO UTC), `sourceRef` (định danh tài nguyên và phiên bản Slack bất biến), và `targetOwnership` (`atiUserId`, `connectionId`, `workspaceId`).
- Khi quét sự kiện chính sách (`policy_epoch_invalidated`, `consent_revoked`), bộ quét fanout truy vấn trực tiếp bảng `slack_derived_provenance_segments`, bảo đảm các bản sao phái sinh vẫn được cascade purge sạch sẽ ngay cả khi dữ liệu nguồn thô đã hết hạn (trần 7 ngày) hoặc vốn chỉ được đọc transient mà không lưu raw source.

### 1.3. Chuẩn Hóa 8 Thuộc Tính storagePolicyRef & Phân Cấp TTL:
- Bảng `slack_derived_provenance_segments` lưu đầy đủ 8 trường canonical của `storagePolicyRef`: `binding` (gồm 5 trường: `ati_user_id`, `connection_id`, `workspace_id`, `slack_user_id`, `identity_version`), `policy_purpose = 'storage'`, `storage_requested_retention_days` (1-30), `provider_profile_id`, `config_fingerprint`, `policy_version`, `consent_revision`, `provider_revision`. Đồng thời lưu bằng chứng thu thập: `acquisition_purpose` và `acquisition_requested_retention_days`.
- Phân cấp TTL nghiêm ngặt: `expiry <= effectiveTTL <= issuedTTL <= currentauthority` và trần tối đa `<= 30 ngày`. Ràng buộc DB:
  `storage_requested_retention_days INT NOT NULL CHECK (storage_requested_retention_days > 0 AND storage_requested_retention_days <= 30)`
  `effective_retention_days INT NOT NULL CHECK (effective_retention_days > 0 AND effective_retention_days <= storage_requested_retention_days)`
  `CONSTRAINT chk_slack_derived_provenance_ttl CHECK (expires_at > captured_at AND expires_at <= captured_at + make_interval(days => effective_retention_days) AND expires_at <= captured_at + INTERVAL '30 days')`
  Điều này triệt tiêu hoàn toàn lỗ hổng cho phép khai báo 1 ngày nhưng lưu thực tế 30 ngày, và ngăn chặn việc dùng metadata `isExcerpt` để lách trần 7 ngày của nguồn thô.

### 1.4. Ngữ Cảnh Chủ Sở Hữu Artifact & Chống Tái Gắn Phiên Bản:
- Bảng `slack_derived_copies` bắt buộc lưu `ati_user_id UUID NOT NULL REFERENCES users(id)`.
- Hàm thẩm định `assertDerivedCopyAllowed` yêu cầu đầy đủ ngữ cảnh: `callerAtiUserId`, `consumerPurpose` (mục đích của người đọc hiện tại), `targetKind`, `targetId`, `targetSubId`, và `expectedTargetVersion`.
- Nguyên tắc bảo vệ:
  1. Người gọi phải được xác thực: `callerAtiUserId === derivedCopy.atiUserId`. Nghiêm cấm hoàn toàn truy cập chéo giữa các người dùng ATI (`cross-ATI user`).
  2. Nguồn đa workspace cho MỘT người dùng ATI (`multi-workspace for ONE ATI user`) là hợp lệ và được lưu đầy đủ từng phân đoạn; tuy nhiên không được phép tổng hợp chéo giữa các người dùng ATI khác nhau.
  3. Danh sách phân đoạn rỗng hoặc thiếu KHÔNG THỂ cấp quyền đọc (fail-closed).
  4. Chống tái gắn phiên bản: nếu caller cung cấp `expectedTargetVersion`, version đó phải khớp với version của artifact đích (ngăn chặn việc dùng ID cũ để truy cập nội dung đã bị thay đổi).
  5. Thẩm định lưu trữ là độc lập với mục đích tiêu thụ hiện tại: dữ liệu được ghi dưới mục đích `storage`, nhưng khi đọc, người gọi phải có `consumerPurpose` hợp lệ và không bị chặn bởi rào chắn.

---

## 2. Phân Chia Module & Quyền Sở Hữu (Module Ownership)

Tuân thủ nghiêm ngặt quy chuẩn tại [`docs/team-workflow.md`](../../team-workflow.md):
- **Backend Engineer (Sở hữu độc quyền card này):**
  - Cơ sở dữ liệu: `db/v3/0018_slack_derived_lineage_and_purge.sql` (Dự kiến số 0018 sau 0017 của 03B1).
  - Repositories: `apps/chat-api/src/db/repositories/slack-derived-lineage-repo.ts`.
  - Dịch vụ phả hệ & kiểm tra: `apps/chat-api/src/services/slack/slack-derived-lineage-store.ts`.
  - Bộ chạy cascade purge: `apps/chat-api/src/services/slack/slack-cascade-purge-runner.ts`.
  - Giao diện bảo vệ: `apps/chat-api/src/services/slack/slack-lineage-guards.ts`.
  - Handlers xử lý purge (`apps/chat-api/src/services/slack/purge-handlers/`):
    - `chat-history-message-purge-handler.ts` (hiện hữu)
    - `working-memory-entity-purge-handler.ts` (hiện hữu)
    - `plan-step-arg-purge-handler.ts` (hiện hữu)
    - `scheduled-workflow-arg-purge-handler.ts` (hiện hữu)
    - `execution-audit-purge-handler.ts` (hiện hữu)
    - `proposal-excerpt-purge-handler.ts` (fail-closed tương lai)
    - `daily-digest-entry-purge-handler.ts` (fail-closed tương lai)
  - Điểm tích hợp writer thực tế:
    - `apps/chat-api/src/services/chat-service.ts`
    - `apps/chat-api/src/db/repositories/plan-repo.ts`
    - `apps/chat-api/src/services/schedule-service.ts`
    - `apps/chat-api/src/services/execution-service.ts`
  - Điểm tích hợp reader guard:
    - `apps/chat-api/src/routes/conversation-routes.ts`
    - `apps/chat-api/src/routes/schedule-routes.ts`
    - `apps/chat-api/src/services/schedule-runner.ts`
  - Kiểm thử:
    - `apps/chat-api/tests/db/slack-derived-lineage-repo.test.ts`
    - `apps/chat-api/tests/services/slack/slack-cascade-purge.test.ts`
    - `apps/chat-api/tests/services/slack/slack-derived-guards.test.ts`
    - `apps/chat-api/tests/integration/slack-derived-writers-integration.test.ts`
- **Không xâm phạm vùng sở hữu của vai trò khác:**
  - AI Engineer (`packages/planner/`, `packages/tool-schemas/`, `prompts/`): Chỉ đề xuất giao diện `IPlannerSlackLineageGuard`, không trực tiếp sửa mã planner.
  - Integration Engineer (`packages/tool-adapters/`): Chỉ tiêu thụ frozen types từ `@wap/tool-schemas`.
  - Frontend Engineer (`apps/chat-web/`): Không sửa mã frontend; cung cấp DTOs an toàn đã được che/redact sạch.

---

## 3. Bảng Ánh Xạ Độ Bao Phủ 7 Nhóm Bản Sao Phái Sinh (Coverage Table)

| Target Kind | Bảng & Cột Lưu Trữ Thực Tế | Tác Giả Ghi (File + Symbol) | Tác Giả Đọc (File + Symbol) | Hợp Đồng Bản Sao Phái Sinh | Bộ Xử Lý Purge & Bảo Toàn Ràng Buộc DB | Thành Phần Tương Lai & Cổng Fail-Closed |
|---|---|---|---|---|---|---|
| `chat_history_message` | `messages.content`, `messages.metadata` (`plan`, `proposal`, `resource_labels`) | `MessageRepo.createMessage`, `ChatService.prepareResponse` / `write` | `MessageRepo.listMessages`, `ChatService` (lines 499-512 prompt hydration), `GET /api/conversations/:id/messages` | `targetKind: 'chat_history_message'`, `targetId: messages.id`, toàn bộ phân đoạn nguồn gốc trong `slack_derived_provenance_segments` | `ChatHistoryMessagePurgeHandler`: Redact nội dung tin nhắn thành `[Nội dung nguồn Slack đã bị thu hồi/xóa]`, tẩy sạch snippet Slack trong `metadata.plan`, `metadata.proposal`, `metadata.resource_labels`; nếu tin trợ lý tổng hợp từ nguồn bị thu hồi và không thể tách rời, redact toàn bộ tin trợ lý đó nhưng BẢO TOÀN tin nhắn người dùng gõ. | Hiện hữu trong `apps/chat-api`. |
| `working_memory_entity` | `messages` (`role = 'system'`, `metadata->>'type' = 'working_memory'`, `metadata->'state'`) | `ChatService.processMessage` (ghi dòng system snapshot bộ nhớ) | `ChatService.processMessage` (lines 516-519 đọc `lastMemory` khôi phục `memory.fromJSON`) | `targetKind: 'working_memory_entity'`, `targetId: messages.id`, `targetSubId: entityKey` | `WorkingMemoryEntityPurgeHandler`: Xóa triệt để các trường Slack khỏi state JSON: `__labels`, `__gatherPending`, `__gatherIntent`, `__gatherBindings`, `__gatherMissing`, `members`, và các entities phái sinh; chặn model tái sử dụng dữ liệu cũ. | Hiện hữu trong `apps/chat-api`. |
| `plan_step_arg` | `plans.plan_json`, `plans.plan_text`, `plans.resource_labels`, `execution_steps.args_json`, `execution_steps.output_json`, `execution_steps.error_json` | `PlanRepo.createPlan`, `ChatService`, `StepRepo.createStep`, `StepRepo.updateStepStatus` | `PlanRepo.getPlan`, `PlanRepo.getPendingPlan`, `ExecutionService.runExecution`, `GET /api/conversations/:id/plan` | `targetKind: 'plan_step_arg'`, `targetId: plans.id` / `execution_steps.id`, `targetSubId: stepId` | `PlanStepArgPurgeHandler`: Nếu kế hoạch đang `pending`, chuyển ngay sang `superseded` (thỏa mãn ràng buộc `ux_plans_one_pending_per_conversation`); nếu kế hoạch đã thực thi, scrub sạch `resource_labels`, args/output/error JSON và `plan_text`. | Hiện hữu trong `apps/chat-api` & `packages/executor`. |
| `scheduled_workflow_arg` | `schedules.request`, `schedules.recurrence`, `schedules.status`, `schedules.pause_reason`, `schedule_runs.plan_id`, `schedule_runs.status`, `schedule_runs.error` | `ScheduleService.createSchedule` / `saveFields`, `ScheduleRunner.createRun` | `ScheduleRunner.runDue`, `ScheduleRepo.ownedSchedule`, `GET /api/schedules` | `targetKind: 'scheduled_workflow_arg'`, `targetId: schedules.id` / `schedule_runs.id` | `ScheduledWorkflowArgPurgeHandler`: BẢO TOÀN `schedules.request` gốc của người dùng (bảo đảm ràng buộc `CHECK (char_length(request) BETWEEN 1 AND 1000)`). Tạm dừng lịch (`status = 'paused'`, `pause_reason = 'slack_source_invalidated'`, `next_run_at = NULL` thỏa mãn `schedules_next_run_check`). Khi hủy plan liên kết, chuyển trạng thái `schedule_runs` sang `discarded` (bảo đảm ràng buộc `schedule_runs_plan_check CHECK ((status = 'planned') = (plan_id IS NOT NULL))`). Scrub `schedule_runs.error`. | Hiện hữu trong `apps/chat-api`. |
| `audit_log_entry` | `execution_steps.output_json`, `execution_steps.error_json` (bản ghi audit thực thi) | `StepRepo.updateStepStatus`, `StartupReconciliationService` | `ExecutionService.getExecution`, admin audit query | `targetKind: 'audit_log_entry'`, `targetId: execution_steps.id` | `ExecutionAuditPurgeHandler`: Tẩy sạch Slack raw payload/output khỏi execution steps; chỉ lưu biên nhận tombstone `(purged_at, reason, tombstone_id)` trong metadata. (Lưu ý: Không có bảng SQL `audit_logs` riêng biệt trong migrations `db/v3/`). | Hiện hữu trong `apps/chat-api`. |
| `proposal_excerpt` | Chưa có bảng (Thuộc SLACK-06 Inbox Proposals) | Chưa có (Dịch vụ Inbox tương lai ở SLACK-06) | Chưa có (Màn duyệt đề xuất tương lai ở SLACK-06) | `targetKind: 'proposal_excerpt'`, `targetId: proposal.id`, mọi phân đoạn provenance | `ProposalExcerptPurgeHandler`: Đánh dấu đề xuất `revoked_by_source_purge`, tẩy sạch trích đoạn khỏi payload đề xuất. | **Cổng Fail-Closed:** Thành phần Inbox tương lai BẮT BUỘC phải đăng ký vào `SlackDerivedLineageStore` trước khi persist. Nếu chưa đăng ký, ném lỗi từ chối lưu trữ trích đoạn. Nghiêm cấm đóng F3 sớm khi chưa hoàn thành component này. |
| `daily_digest_entry` | Chưa có bảng (Thuộc SLACK-06 Daily Digest) | Chưa có (Worker sinh digest tương lai ở SLACK-06) | Chưa có (API/UI xem digest tương lai ở SLACK-06) | `targetKind: 'daily_digest_entry'`, `targetId: digest.id`, `targetSubId: entryId` | `DailyDigestEntryPurgeHandler`: Tẩy sạch mục digest chứa trích đoạn hoặc đánh dấu toàn bộ entry là `purged`. | **Cổng Fail-Closed:** Dịch vụ Daily Digest tương lai BẮT BUỘC đăng ký phả hệ trước khi lưu trữ trích đoạn. Nếu chưa đăng ký, ném lỗi từ chối lưu trữ. |

---

## 4. Thiết Kế Cơ Sở Dữ Liệu & Hợp Đồng Giao Diện Chuẩn Tắc

### 4.1. Migration DDL: `db/v3/0018_slack_derived_lineage_and_purge.sql`
```sql
-- Migration 0018: Normalized Registry for Slack-Derived Lineage & Cascade Purge Tracking
-- (Dự kiến số 0018 sau 0017 của 03B1; ingress sẽ dùng số tiếp theo)
CREATE TABLE IF NOT EXISTS slack_derived_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ati_user_id UUID NOT NULL REFERENCES users(id),
  target_kind TEXT NOT NULL CHECK (target_kind IN (
    'chat_history_message',
    'working_memory_entity',
    'plan_step_arg',
    'proposal_excerpt',
    'daily_digest_entry',
    'scheduled_workflow_arg',
    'audit_log_entry'
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

CREATE INDEX IF NOT EXISTS idx_slack_derived_copies_active
  ON slack_derived_copies(target_kind, target_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_slack_derived_copies_user
  ON slack_derived_copies(ati_user_id);

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

CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_lookup
  ON slack_derived_provenance_segments(workspace_id, resource_type, resource_id, revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_binding
  ON slack_derived_provenance_segments(ati_user_id, connection_id, identity_version);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_epoch
  ON slack_derived_provenance_segments(provider_profile_id, policy_version, consent_revision, provider_revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_provenance_expires
  ON slack_derived_provenance_segments(expires_at);
```

### 4.2. Hợp Đồng Đăng Ký Phả Hệ Chuẩn Hóa (`SlackDerivedLineageStore`)
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
  segments: ProvenanceSegmentInput[]; // Danh sách phân đoạn thu thập từ server acquisition context
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
  /**
   * Đăng ký phả hệ nguyên tử cùng client transaction với thao tác ghi thực tế.
   */
  registerDerivedCopyInTransaction(
    client: pg.PoolClient,
    input: RegisterDerivedCopyInput
  ): Promise<{ derivedCopyId: string }>;

  /**
   * Thẩm định an toàn trước khi đọc/render/trả DTO/truyền stream.
   * Kiểm tra:
   * 1. Xác thực caller: callerAtiUserId === derivedCopy.atiUserId.
   * 2. TẤT CẢ phân đoạn: không có barrier pending/provisional, cùng policy epoch, chưa hết TTL.
   * 3. Khớp phiên bản expectedTargetVersion (chống tái gắn revision cũ).
   * 4. Hỗ trợ tín hiệu hủy AbortSignal.
   */
  assertDerivedCopyAllowed(
    input: AssertDerivedCopyAllowedInput
  ): Promise<
    | { allowed: true }
    | { allowed: false; reason: 'blocked_by_barrier' | 'epoch_invalidated' | 'retention_expired' | 'unauthorized_caller' | 'version_mismatch' | 'not_found'; safeTombstoneOnly?: string }
  >;
}
```

### 4.3. Hợp Đồng Cascade Purge Runner (`SlackCascadePurgeRunner`)
```ts
export interface ISlackCascadePurgeHandler {
  readonly targetKind: SlackDerivedTargetKind;
  purgeTarget(client: pg.PoolClient, targetId: string, targetSubId: string, reason: SlackTombstoneReason): Promise<void>;
}

export interface ISlackCascadePurgeRunner {
  /**
   * Xử lý một invalidation intent từ hàng đợi slack_invalidation_intents.
   * Intent chỉ hoàn tất khi CẢ raw source lẫn TẤT CẢ 7 target kinds derived copies đã được purge sạch sẽ.
   */
  processInvalidationIntent(intentId: string): Promise<{ rawPurged: number; derivedPurged: number }>;
}
```

### 4.4. Giao Diện Bảo Vệ Riêng Biệt Cho Planner & Executor
```ts
// Đề xuất cho AI Engineer (Planner Owner - packages/planner/)
export interface IPlannerSlackLineageGuard {
  filterHydratedHistory(callerAtiUserId: string, messages: ChatMessage[], signal?: AbortSignal): Promise<ChatMessage[]>;
  sanitizeWorkingMemory(callerAtiUserId: string, state: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

// Đề xuất cho Backend Engineer (Executor Owner - packages/executor/)
export interface IExecutorSlackLineageGuard {
  assertPlanStepsExecutable(callerAtiUserId: string, planId: string, steps: PlanStep[], signal?: AbortSignal): Promise<void>;
  sanitizeStepOutputForStorage(callerAtiUserId: string, stepId: string, output: unknown): Promise<unknown>;
}
```

---

## 5. Giao Thức Khóa Dòng, Tính Nguyên Tử & Bằng Chứng Chống Deadlock

Để loại trừ triệt để nguy cơ deadlock giữa các tác vụ ghi phả hệ, đọc dữ liệu, duyệt kế hoạch và thu hồi sự kiện, toàn bộ hệ thống tuân thủ nghiêm ngặt **thứ tự khóa dòng một chiều**:

```
[1. conversations (FOR UPDATE, ORDER BY id ASC)]
       ↓
[2. schedules (FOR UPDATE, ORDER BY id ASC)]
       ↓
[3. plans (FOR UPDATE, ORDER BY id ASC)]
       ↓
[4. slack_connections (FOR SHARE, ORDER BY id ASC)]
       ↓
[5. slack_trusted_providers (FOR SHARE, ORDER BY id ASC)]
       ↓
[6. slack_processing_consents (FOR SHARE, ORDER BY id ASC)]
       ↓
[7. slack_invalidation_barriers (SELECT check / lock)]
       ↓
[8. slack_derived_copies & slack_derived_provenance_segments (INSERT/UPDATE/FOR UPDATE)]
       ↓
[9. Target Artifact Writes (messages, execution_steps, etc.)]
```

### 5.1. Bằng Chứng Xen Kẽ Hai Tiến Trình Đồng Thời (Two-Client Held-Lock Interleaving Proof):
Giả sử có 2 tiến trình đồng thời trên PostgreSQL:
- **Client 1 (Writer ghi lineage và artifact):**
  1. `BEGIN;`
  2. Khóa hội thoại: `SELECT * FROM conversations WHERE id = $1 FOR UPDATE;` (thành công).
  3. Khóa quyền Slack: `SELECT * FROM slack_processing_consents WHERE id = $2 FOR SHARE;`
- **Client 2 (Revoker thu hồi sự kiện chính sách trong 02B/03B1):**
  1. `BEGIN;`
  2. Khóa quyền Slack: `SELECT * FROM slack_processing_consents WHERE id = $2 FOR UPDATE;`
  3. Đặt barrier vào `slack_invalidation_barriers`.

**Phân tích 2 trường hợp xen kẽ:**
- *Trường hợp A (Client 1 lấy khóa FOR SHARE trước):*
  Client 2 bị block tại bước 2 chờ Client 1 commit. Client 1 tiếp tục kiểm tra barrier, ghi lineage, ghi target artifact và commit. Client 2 được đánh thức, lấy được khóa FOR UPDATE, ghi nhận thu hồi và kích hoạt intent cascade purge. Artifact vừa ghi sẽ được purge sạch sẽ.
- *Trường hợp B (Client 2 lấy khóa FOR UPDATE trước):*
  Client 1 bị block tại bước 3 chờ Client 2 commit. Client 2 ghi nhận thu hồi, stage barrier và commit. Client 1 được đánh thức, lấy khóa FOR SHARE, tiến hành bước kiểm tra barrier: phát hiện barrier pending/revoked -> Client 1 ROLLBACK và từ chối ghi.
- **Kết luận:** Cả hai trường hợp đều được tuần tự hóa an toàn dưới PostgreSQL MVCC; hoàn toàn không có chu trình chờ đợi lẫn nhau (circular wait) -> **KHÔNG THỂ XẢY RA DEADLOCK**.

### 5.2. Chống Deadlock "Ledger-First vs Conversation-First":
- Bộ chạy cascade purge (`SlackCascadePurgeRunner`) tuyệt đối không khóa bảng ledger `slack_derived_copies` trước khi khóa hội thoại.
- Quy trình purger:
  1. Query danh sách các copy cần purge ở chế độ snapshot read thông thường.
  2. Với mỗi target copy, mở transaction con: Khóa hàng mục tiêu trước (`conversations` / `schedules` / `plans` FOR UPDATE) -> sau đó mới khóa `slack_derived_copies` FOR UPDATE -> thực thi handler tẩy sạch -> cập nhật status `'purged'` -> COMMIT.
  3. Quy trình này trùng khớp hoàn toàn với trật tự khóa của writer, triệt tiêu mọi khả năng deadlock.

### 5.3. Mối Nối Giao Tiếp với 03B1 (Handoff Seams):
- 03B1 ghi nhận intent vào `slack_invalidation_intents`.
- Khi 03B1 xóa xong raw sources, 03B1 KHÔNG ĐƯỢC đánh dấu intent là completed. 03B1 chỉ đánh dấu trạng thái `raw_purged`.
- 03B2 `SlackCascadePurgeRunner` quét các intent có `status IN ('pending', 'raw_purged')`. Sau khi hoàn thành purge toàn bộ các derived copies trên cả 7 target kinds, 03B2 mới cập nhật intent thành `completed`.
- Nếu có bất kỳ purge handler nào gặp lỗi hoặc bị thiếu, lỗi được ném ra và intent giữ nguyên trạng thái pending để retry.

---

## 6. Xử Lý Phân Đoạn Đa Workspace/User, Fanout & Chính Sách Redaction

1. **Phân Đoạn Đa Workspace Bắt Buộc Cho 1 Người Dùng ATI:**
   - Mỗi `SlackDerivedCopyRef` đại diện cho một phân đoạn ủy quyền.
   - Một artifact tổng hợp đa workspace của cùng một người dùng ATI phải lưu đầy đủ TẤT CẢ các phân đoạn trong `slack_derived_provenance_segments`. Nghiêm cấm "last source wins" hoặc "first workspace wins".
   - Nghiêm cấm tổng hợp dữ liệu giữa các người dùng ATI khác nhau.
2. **Quét Fanout Sự Kiện Chính Sách (Derived-Only Epochs):**
   - Quét sự kiện chính sách (`policy_epoch_invalidated`, `consent_revoked`) thu thập đầy đủ các epoch từ bảng `slack_derived_provenance_segments`, ngay cả khi nguồn thô trong `slack_sources` đã bị xóa trước đó.
3. **Chính Sách Xóa Phân Đoạn vs Toàn Bộ Artifact:**
   - Nếu dữ liệu Slack có thể tách rời (metadata JSON, argument cụ thể), scrub trường cụ thể đó.
   - Nếu nội dung sinh bởi model là hỗn hợp (mixed text) không thể bóc tách an toàn giữa các nguồn: **Redact toàn bộ phần văn bản do model sinh**, thay bằng thông báo vô hiệu hóa, đồng thời bảo tồn nguyên vẹn tin nhắn gốc do người dùng viết.
4. **Biên Nhận Audit Bất Biến Tối Thiểu:**
   - Khi purge `audit_log_entry`, lưu giữ biên nhận gồm `(purged_at, reason, target_kind, target_id, tombstone_id)` để phục vụ kiểm toán; xóa bỏ hoàn toàn chuỗi văn bản hoặc JSON payload của Slack. Không bao giờ phục hồi lại dữ liệu Slack đã xóa khi người dùng kết nối lại (regrant).

---

## 7. Tiêu Chí Nghiệm Thu Cụ Thể (Acceptance Criteria)

- [ ] **AC1 (Durable Normalized Registry):** Bảng `slack_derived_copies` và `slack_derived_provenance_segments` được tạo thành công qua migration `0018`, lưu trữ `ati_user_id`, đầy đủ 8 trường canonical của `storagePolicyRef`, bằng chứng thu thập, và trần TTL `<= 30 ngày` theo ràng buộc `effective_retention_days <= storage_requested_retention_days`.
- [ ] **AC2 (Atomic Lineage & Artifact Write):** Mọi thao tác ghi bản sao phái sinh của Slack được thực thi trong cùng 1 giao dịch PostgreSQL với trật tự khóa dòng một chiều chống deadlock.
- [ ] **AC3 (Pre-Read Provenance & Authenticated Guard):** Trước khi trả DTO qua HTTP, SSE stream, hoặc nạp vào context của model/planner, hàm `assertDerivedCopyAllowed` kiểm tra caller ATI, phân đoạn hợp lệ, rào chắn, và phiên bản artifact; ngắt truyền tải với `AbortSignal`.
- [ ] **AC4 (Full 7 Kinds Cascade Purge Coverage):** Bộ chạy cascade purge có đầy đủ handler cho đúng 7 kinds: `chat_history_message`, `working_memory_entity`, `plan_step_arg`, `proposal_excerpt`, `daily_digest_entry`, `scheduled_workflow_arg`, `audit_log_entry`.
- [ ] **AC5 (Database Invariants Preservation):** Quá trình purge bảo toàn nguyên vẹn `schedules.request` (thỏa `CHECK (char_length(request) BETWEEN 1 AND 1000)`), cập nhật trạng thái `schedules` và `schedule_runs` đúng các check constraint của PostgreSQL.
- [ ] **AC6 (Fail-Closed Gates for Future Components):** Các thực thể `proposal_excerpt` và `daily_digest_entry` của SLACK-06 được thiết lập rào chắn fail-closed rõ ràng; ném lỗi từ chối lưu trữ trích đoạn nếu chưa tích hợp handler hoàn chỉnh.
- [ ] **AC7 (Crash Mid-Handler Resilience & Idempotency):** Nếu tiến trình purge bị crash khi đang xử lý giữa chừng (ví dụ xong 3/7 handlers), khi khởi động lại phải tiếp tục xử lý các handlers còn lại mà không gây trùng lặp hay lỗi.
- [ ] **AC8 (Policy Event Fanout with Derived-Only Epochs):** Quét sự kiện chính sách thu thập đầy đủ các epoch từ `slack_derived_provenance_segments` ngay cả khi dữ liệu nguồn thô trong `slack_sources` đã bị xóa trước đó.
- [ ] **AC9 (No Scope Creep & Clean Boundaries):** Chỉ bổ sung 3 tài liệu tài liệu hoạch định; không sửa đổi mã nguồn sản phẩm, không sửa `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 8. Lệnh Kiểm Tra & Cổng Bằng Chứng (Command & Evidence Gates)

> Toàn bộ các lệnh dưới đây là kiểm tra dự kiến cho giai đoạn thi công mã nguồn, sử dụng PostgreSQL 16 thật. Trong phiên lập kế hoạch này, toàn bộ được đánh dấu `[Proposed: NOT_RUN]`.

```powershell
# 1. [Proposed: NOT_RUN] Kiểm tra Migration DDL 0018 trên PG16 thật
# npm run migrate:v3

# 2. [Proposed: NOT_RUN] Kiểm tra Repository & Atomic Lock Order Concurrency (2 PG clients)
# npm test -w @wap/chat-api -- tests/db/slack-derived-lineage-repo.test.ts

# 3. [Proposed: NOT_RUN] Kiểm tra Cascade Purge Runner cho cả 7 Target Kinds & Crash Recovery
# npm test -w @wap/chat-api -- tests/services/slack/slack-cascade-purge.test.ts

# 4. [Proposed: NOT_RUN] Kiểm tra Rào Chắn Pre-Read, SSE & Memory Sanitize
# npm test -w @wap/chat-api -- tests/services/slack/slack-derived-guards.test.ts

# 5. [Proposed: NOT_RUN] Kiểm tra Tích Hợp Real Writers Với PostgreSQL Thật
# npm test -w @wap/chat-api -- tests/integration/slack-derived-writers-integration.test.ts

# 6. [Proposed: NOT_RUN] Kiểm tra Toàn Diện Typecheck Toàn Repo
# npm run typecheck:v3

# 7. Kiểm tra Quy chuẩn Khoảng Trắng và Git Diff (DOCS ONLY)
git diff --check e9088d5e..HEAD
```

---

## 9. Kết Quả Thực Thi (Dành Cho Agent Thi Công)

*(Phần này được để trống cho agent thi công ghi lại kết quả RED→GREEN, commit hashes và log kiểm thử thực tế sau khi được phân công thực hiện mã nguồn).*
