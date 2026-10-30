# SLACK-03B2 · Phả Hệ Bản Sao Phái Sinh & Cascade Purge Bền Vững

**Trạng thái hiện tại:** ĐANG TRIỂN KHAI MỘT PHẦN qua03B2A/B/C/D; registry/consumer `messages.content` và derived-policy fanout03B2D (#209) đã accepted staging. Xem [ma trận hiện tại](../SLACK-DELIVERY.md). Bốn core kind khác, selector/writer/read integration/backfill và fullF3 vẫn mở.
**Phạm vi bằng chứng:** Nội dung thiết kế và `[Proposed: NOT_RUN]` bên dưới là snapshot kế hoạch PR198; bằng chứng đã chạy nằm ở card/log con liên kết trong ma trận. Không có kết luận fullF3, native Slack hay model-use từ việc merge các slice này.
**Nhánh:** `docs/slack-03b2-derived-plan` (PR #198).
**Nền đối chiếu:** `e9088d5e76e95fa65e3be019226835371e40908d`.
**Vai trò:** Backend Planning Owner. Chỉ sở hữu 3 tài liệu trong card này.
**Task cha:** [`SLACK-03-tool-catalog-and-source-lifecycle.md`](SLACK-03-tool-catalog-and-source-lifecycle.md).
**Kế hoạch:** [`2026-10-30-slack-03b2-derived-lineage-and-purge.md`](../../superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md).
**Giao ước giao diện đóng băng:** [`2026-10-29-slack-source-ingress-contracts.md`](../decisions/2026-10-29-slack-source-ingress-contracts.md).

**Phụ thuộc thực tế:**
- SLACK-03A: PR #194, head `bc8d6b69`, đã chấp thuận contracts.
- SLACK-03B1: sibling `feat/slack-03b1-source-store`, PR #200; plan #196; **accepted head `23544be96cf848cc5d4ff8c3feafe6e50319c399`**, integration commit `612ac427152fcfcf8a0f1bff3158088d8f393a5d`. Migration `db/v3/0017_slack_source_store.sql` thuộc 03B1. Thứ tự khóa 03B1 trong card là snapshot của head này, không phải runtime 03B2.
- SLACK-03C1: PR #199; plan #197; **accepted head `390b1c54b50a61d7412f20e928476d55eee4decb`** cho 8 read method tạm thời.
- SLACK-04A ingress: PR #195; giao ước đã đóng băng tại `e9088d5e`.
- Migration 03B2 dự kiến `0018`; số cuối cùng do integration quyết định sau 0017. Không sửa 0017.

---

## 1. Mục Tiêu Bounded

03B2 thiết kế:

1. Sổ phả hệ chuẩn hóa `slack_derived_copies` + `slack_derived_provenance_segments`, ghi **cùng transaction** với artifact đích.
2. Phiên bản đích do server cấp, bắt buộc và bền vững; read guard và purge handler dùng cùng một identity.
3. Read guard trước HTTP, SSE, planner hydration, schedule run và executor.
4. Cascade purge cho **5 nhóm artifact đang tồn tại thật** và **2 cổng fail-closed** cho `proposal_excerpt` / `daily_digest_entry` của SLACK-06.
5. Xóa vật lý đúng trường/path; không xóa toàn bộ dictionary chung; không coi pause là đã xóa.

Không thuộc phạm vi: viết mã runtime, chạy migration, gọi Slack API, gọi model, chấp nhận native provider, sửa `CURRENT-STATE.md` / `ROADMAP.md`, đóng F3.

**Tuyên bố đúng:** 03B2 runtime (khi được thi công) chỉ có thể đạt "5 handler hiện hữu + từ chối 2 thành phần tương lai". Bảy nhóm đầy đủ và F3 chỉ đóng sau khi SLACK-06 có bảng/service/handler thật và test tích hợp thật.

---

## 2. Bảng Bao Phủ Theo Mã Nguồn Thực Tế

| Target kind | Nơi lưu thật | Writer thật (file + symbol) | Reader thật (file + symbol) | Xử lý purge | Trạng thái |
|---|---|---|---|---|---|
| `chat_history_message` | `messages.content`; `messages.metadata` tại `plan`, `proposal`, `previous.name/request/recurrence`, `schedule.name/request/recurrence`, `schedule.lastRun.error`, `resourceLabels`, `name` (message `type='schedule_run'`), `lookups`, `clarification.options/context/reason`, `refusal.reason/suggestion` | `apps/chat-api/src/services/chat-service.ts` → `prepareResponse.write`; `apps/chat-api/src/db/repositories/message-repo.ts` → `createMessage`; `apps/chat-api/src/services/schedules/schedule-runner.ts` → `planOne`; `apps/chat-api/src/services/schedules/schedule-service.ts` → `recordState` (state message `metadata.schedule`) | `apps/chat-api/src/db/repositories/message-repo.ts` → `listMessages`; `apps/chat-api/src/services/chat-service.ts` `executePlannerPipeline` dòng 499-512 (history) và 516-519 (memory restore); `apps/chat-api/src/routes/conversation-routes.ts` → `createConversationRoutes` (GET `/:id/messages/latest`, GET `/:id`); `apps/chat-api/src/routes/stream-routes.ts` → `createStreamRoutes` (GET `/:id/stream`) | Tombstone `content`; xóa đúng path metadata; proposal bị thay `type` để `confirmProposal` không áp dụng lại; giữ message người dùng không có copy | Có artifact thật; handler phải thi công |
| `working_memory_entity` | `messages.metadata.state` (message `role='system'`, `metadata.type='working_memory'`) | `apps/chat-api/src/services/chat-service.ts` `prepareResponse.write` (khi `target.memoryState` được truyền, dòng 428) và `executePlannerPipeline` dòng 528, từ `WorkingMemory.toJSON()` | `apps/chat-api/src/services/chat-service.ts` dòng 516-519 → `WorkingMemory.fromJSON`; `packages/planner/src/planner.ts` đọc `__observed`, `__labels`, `__gather*` | Xóa đúng selector/path Slack; giữ entry Trello/dịch vụ khác; không xóa cả `__observed`, `__labels`, `members` | Có artifact thật; handler phải thi công |
| `plan_step_arg` | `plans.plan_json`, `plans.plan_text`, `plans.plan_hash`, `plans.resource_labels`; `execution_steps.args_json` | `apps/chat-api/src/db/repositories/plan-repo.ts` → `createPlan`; `apps/chat-api/src/services/chat-service.ts` `prepareResponse.write`; `apps/chat-api/src/db/repositories/step-repo.ts` → `createStep` | `apps/chat-api/src/db/repositories/plan-repo.ts` → `getPlan`, `getPendingPlan`, `getLatestExecutedPlan`; `apps/chat-api/src/services/execution-service.ts` → `approveAndStart`, `getLatestExecutionSnapshot`; `apps/chat-api/src/routes/conversation-routes.ts` → `createConversationRoutes` (GET `/:id/plans/active`); `apps/chat-api/src/routes/execution-routes.ts` → `createExecutionRoutes` (POST `/plans/:id/approve`, GET `/conversations/:convId/executions/latest`) | Thay `plan_json`/`plan_text` bằng tombstone hợp lệ; `plan_hash` băm lại tombstone; xóa đúng key Slack trong `resource_labels`; `args_json` thành tombstone JSON; plan `pending` → `superseded`, plan đang chạy → `failed` | Có artifact thật; handler phải thi công |
| `proposal_excerpt` | Không có bảng/service trong `db/v3` và `apps/chat-api` hiện tại; schedule proposal hiện có nằm ở `messages.metadata.proposal` và thuộc `chat_history_message` | Không có | Không có | Không có handler; runner fail-closed `MISSING_HANDLER`, intent không completed | **Tương lai SLACK-06** |
| `daily_digest_entry` | Không có bảng/service hiện tại | Không có | Không có | Không có handler; runner fail-closed, intent không completed | **Tương lai SLACK-06** |
| `scheduled_workflow_arg` | `schedules.name`, `request`, `recurrence`, `services`, `status`, `pause_reason`, `next_run_at`; `schedule_runs.error`; `conversations.title` của run conversation | `apps/chat-api/src/services/schedules/schedule-service.ts` → `confirmProposal`, `saveFields` (row `schedules`), `recordState` (chỉ state message, thuộc `chat_history_message`); `apps/chat-api/src/services/schedules/schedule-runner.ts` → `planOne` (title + message) | `apps/chat-api/src/services/schedules/schedule-service.ts` → `list`, `listRuns`; `apps/chat-api/src/db/repositories/schedule-repo.ts` → `getByConversation`, `listForUser`, `listRuns`; `apps/chat-api/src/routes/schedule-routes.ts` → `createScheduleRoutes` (GET `/schedules`, GET `/schedules/:id/runs`); `apps/chat-api/src/services/chat-service.ts` dòng 513; `apps/chat-api/src/services/schedules/schedule-runner.ts` → `planOne` | Xóa từng trường có copy bằng tombstone không rỗng; `recurrence` thành `{}`; pause + `pause_reason='slack_source_invalidated'` + `next_run_at=NULL`; title thành tombstone; `services` chỉ là định danh dịch vụ nên giữ nguyên; không đụng trường không có copy | Có artifact thật; handler phải thi công |
| `audit_log_entry` | `execution_steps.output_json`, `error_json` | `apps/chat-api/src/db/repositories/step-repo.ts` → `updateStepStatus`; `apps/chat-api/src/services/execution-service.ts` dòng 169; `apps/chat-api/src/services/startup-reconciliation.ts` → `reconcileInterruptedExecutions` (chỉ lỗi server cố định) | `apps/chat-api/src/services/execution-service.ts` → `getLatestExecutionSnapshot`, `getExecutionStatusDurable`; `apps/chat-api/src/db/repositories/step-repo.ts` → `listSteps`; `apps/chat-api/src/routes/execution-routes.ts` → `createExecutionRoutes` | Tombstone JSON output/error; không có bảng `audit_logs` riêng và không có admin query | Có artifact thật (execution steps); handler phải thi công |

`ScheduleRepo.stateText` chỉ dựng nội dung state message do `recordState` ghi; không phải writer độc lập.

**Không được dùng** các đường dẫn/symbol không tồn tại: `schedule-runner.ts` ở thư mục `services/` (đúng: `services/schedules/schedule-runner.ts`), `ScheduleRunner.runDue` (đúng: `tick`, `planNow`, `planOne`), `ExecutionService.getExecution` (đúng: `getLatestExecutionSnapshot`, `getExecutionStatusDurable`), `StartupReconciliationService` (đúng: hàm `reconcileInterruptedExecutions`), `apps/chat-api/src/routes/conversation-routes.ts` là đúng nhưng không có route admin audit.

---

## 3. Định Danh Copy, Phiên Bản Bắt Buộc & Chống Tái Gắn

### 3.1. Khóa logic

Mỗi copy là một **trường/path cụ thể** của artifact:

- `target_id`: UUID artifact (`messages.id`, `plans.id`, `execution_steps.id`, `schedules.id`, `conversations.id`).
- `target_sub_id`: selector chuẩn do server sinh:
  - `content`, `metadata.plan`, `metadata.proposal`, `metadata.previous.name`, `metadata.previous.request`, `metadata.previous.recurrence`, `metadata.schedule.name`, `metadata.schedule.request`, `metadata.schedule.recurrence`, `metadata.schedule.lastRun.error`, `metadata.resourceLabels/<key>`, `metadata.lookups`, `metadata.clarification.options`, `metadata.clarification.context`, `metadata.clarification.reason`, `metadata.refusal.reason`, `metadata.refusal.suggestion`, `metadata.name` (chỉ message `type='schedule_run'`).
  - `metadata.usedDirectory` chỉ chứa service id do `listDirectory` trả về; không đăng ký copy và giữ nguyên.
  - `plan_json`, `plan_text`, `plan_hash`, `resource_labels/<key>`, `args_json`, `output_json`, `error_json`.
  - `name`, `request`, `recurrence`, `error`, `title`.
  - Working memory: `state:/__observed/<resourceType>#id=<encodeURIComponent(id)>`, `state:/__labels/<key>`, `state:/__gatherPending/candidates#id=<id>`, `state:/__gatherBindings/<entityKey>`, `state:/__gatherIntent`, `state:/__gatherMissing`, `state:/members#id=<id>`, `state:/<entityKey>#id=<id>`.
- `target_version`: `BIGINT NOT NULL DEFAULT nextval('slack_derived_target_version_seq')`, server cấp lúc INSERT. Không có trong input từ model/client/HTTP. Trong TypeScript, giá trị này là **string thập phân canonical** (`^[1-9][0-9]*$`), không phải `number`: BIGINT vượt `Number.MAX_SAFE_INTEGER` sẽ mất chính xác nếu ép số. `identity_version` (INT) vẫn là `number`; `consent_revision`/`provider_revision` vẫn là string như hiện có.
- `target_fingerprint`: SHA-256 canonical của đúng giá trị tại selector tại thời điểm đăng ký, do server tính. Canonical = JSON UTF-8 với key object sắp xếp, không whitespace thừa; field text băm đúng bytes UTF-8; `null`/absent có sentinel riêng. Read guard và purge handler tính lại từ dòng artifact thật rồi so sánh.

`target_version` là **thế hệ đăng ký** do server cấp, không phải số do model/client chọn. Mỗi lần writer ghi một trường phái sinh mới, writer phải retire copy active cũ (`retired_reason='superseded'`) và insert copy mới trong cùng transaction; vì vậy một văn bản giống hệt được ghi lại dưới grant mới vẫn có version mới và segments mới. Purge cũ không được phép dùng ID cũ để xóa/rebind bản mới. Version mới không tự chứng minh quyền: writer phải tái cấp quyền **toàn bộ segment** theo authority hiện tại và kiểm tra barrier bền vững khớp, dưới cùng bộ advisory lock sorted, trước khi insert. Không được ghi version mới với epoch/nguồn cũ đã revoke/xóa chỉ vì nó được tạo sau một intent.

### 3.2. DDL bắt buộc (0018)

```sql
CREATE SEQUENCE IF NOT EXISTS slack_derived_target_version_seq AS BIGINT START 1;

CREATE TABLE IF NOT EXISTS slack_derived_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ati_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN (
    'chat_history_message','working_memory_entity','plan_step_arg',
    'proposal_excerpt','daily_digest_entry','scheduled_workflow_arg','audit_log_entry')),
  target_id TEXT NOT NULL CHECK (target_id <> ''),
  target_sub_id TEXT NOT NULL CHECK (target_sub_id <> ''),
  target_version BIGINT NOT NULL DEFAULT nextval('slack_derived_target_version_seq'),
  target_fingerprint TEXT NOT NULL CHECK (target_fingerprint ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','purged')),
  retired_at TIMESTAMPTZ,
  retired_reason TEXT CHECK (retired_reason IS NULL OR retired_reason IN (
    'superseded','fingerprint_mismatch','manual')),
  purged_at TIMESTAMPTZ,
  purge_reason TEXT CHECK (purge_reason IS NULL OR purge_reason IN (
    'source_deleted','source_edited','channel_membership_lost','connection_disconnected',
    'app_reinstalled','consent_revoked','retention_expired','policy_changed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT uq_slack_derived_copy_version
    UNIQUE (ati_user_id, target_kind, target_id, target_sub_id, target_version),
  CONSTRAINT chk_slack_derived_copy_terminal CHECK (
    (status='active' AND retired_at IS NULL AND retired_reason IS NULL AND purged_at IS NULL AND purge_reason IS NULL) OR
    (status='retired' AND retired_at IS NOT NULL AND retired_reason IS NOT NULL AND purged_at IS NULL AND purge_reason IS NULL) OR
    (status='purged' AND purged_at IS NOT NULL AND purge_reason IS NOT NULL AND retired_at IS NULL AND retired_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_derived_copy_active
  ON slack_derived_copies(ati_user_id, target_kind, target_id, target_sub_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_slack_derived_copy_lookup
  ON slack_derived_copies(target_kind, target_id, target_sub_id, status);
CREATE INDEX IF NOT EXISTS idx_slack_derived_copy_user
  ON slack_derived_copies(ati_user_id);

CREATE TABLE IF NOT EXISTS slack_derived_provenance_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  derived_copy_id UUID NOT NULL REFERENCES slack_derived_copies(id) ON DELETE CASCADE,
  segment_index INT NOT NULL CHECK (segment_index >= 0),
  capture_hash TEXT NOT NULL CHECK (capture_hash ~ '^[0-9a-f]{64}$'),
  raw_source_id UUID,
  owner_source_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  channel_id TEXT,
  ati_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL, -- no FK: provenance must survive connection deletion so purge can run
  workspace_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  identity_version INT NOT NULL CHECK (identity_version > 0),
  provider_profile_id TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  consent_revision TEXT NOT NULL CHECK (consent_revision ~ '^[1-9][0-9]*$'),
  provider_revision TEXT NOT NULL CHECK (provider_revision ~ '^[1-9][0-9]*$'),
  acquisition_purpose TEXT NOT NULL CHECK (acquisition_purpose IN ('manual_lookup','triage','planning','digest')),
  acquisition_requested_retention_days INT NOT NULL CHECK (acquisition_requested_retention_days >= 0),
  policy_purpose TEXT NOT NULL DEFAULT 'storage' CHECK (policy_purpose = 'storage'),
  storage_requested_retention_days INT NOT NULL
    CHECK (storage_requested_retention_days > 0 AND storage_requested_retention_days <= 30),
  effective_retention_days INT NOT NULL
    CHECK (effective_retention_days > 0 AND effective_retention_days <= storage_requested_retention_days),
  captured_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT uq_slack_derived_segment UNIQUE (derived_copy_id, segment_index),
  CONSTRAINT chk_slack_derived_segment_ttl CHECK (
    expires_at > captured_at AND
    expires_at <= captured_at + make_interval(days => effective_retention_days) AND
    expires_at <= captured_at + INTERVAL '30 days')
);
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_lookup
  ON slack_derived_provenance_segments(workspace_id, resource_type, resource_id, revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_binding
  ON slack_derived_provenance_segments(ati_user_id, connection_id, identity_version);
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_epoch
  ON slack_derived_provenance_segments(provider_profile_id, policy_version, consent_revision, provider_revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_channel
  ON slack_derived_provenance_segments(workspace_id, channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_expires
  ON slack_derived_provenance_segments(expires_at);
```

Không có cột version/trạng thái do caller chọn. Không có `ON CONFLICT DO NOTHING` che giấu xung đột active: writer phải retire copy cũ trước khi insert version mới, hoặc transaction fail.

### 3.3. Registration, read guard, purge CAS

```ts
export interface RegisterDerivedCopyInput {
  atiUserId: string;
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  targetSubId: string;
  // Không có targetVersion: server tự lấy từ sequence.
  segments: ProvenanceSegmentInput[]; // chỉ từ server acquisition context
}

export interface AssertDerivedCopyAllowedInput {
  callerAtiUserId: string;
  consumerPurpose: Exclude<SlackPolicyPurpose, 'storage'>;
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  targetSubId: string;
  expectedTargetVersion: string; // chuỗi BIGINT canonical, bắt buộc; lấy từ bản ghi server-side, không từ HTTP/model
  signal?: AbortSignal;
}
```

`targetVersion` trong kết quả register/getActive, `expectedTargetVersion` và tham số CAS của purge đều là `string` canonical. Không dùng `Number()`, `parseInt()`, `parseFloat()`, unary `+`, hay ép qua JSON number ở bất kỳ tầng nào. Kiểm tra `^[1-9][0-9]*$`; nếu dài 19 ký tự, so sánh từ điển với `9223372036854775807` (PG BIGINT max) và từ chối nếu lớn hơn. So sánh version bằng equality chuỗi canonical, không so sánh số; hai giá trị kề nhau phải không collapse.

`expectedTargetVersion` là bắt buộc; không có dấu `?`. Caller lấy version từ `getActiveCopyInTransaction(client, target)` (repo `SlackDerivedLineageRepo`) trong cùng transaction server, không lấy từ body/model metadata. Read guard chạy trong transaction theo thứ tự: advisory sorted → conversation `FOR SHARE` → authority `FOR SHARE` (user/connection/provider/consent) → barrier check → artifact `FOR SHARE` parent-first → đọc copy/segment → **kiểm tra lại version/fingerprint và authority/barrier sau khi đọc artifact** trước commit. Purge handler dùng `FOR UPDATE` trên cùng artifact nên hai bên xếp hàng trên cùng row. Việc này phải được kiểm chứng bằng hai client thật (M1-M11), không suy luận từ đọc mã.

Luồng purge một copy:

1. Runner đọc intent đã claim, gồm `created_at` và `purge_target`; chỉ chọn copy `status='active'`, có segment khớp `SlackPurgeTarget`, và `created_at <= intent.created_at`. Cutoff này **chỉ khoanh phạm vi phiên bản artifact** mà intent cũ được phép CAS; nó không chứng minh copy đăng ký sau cutoff là mới, hợp lệ hay đã được cấp quyền. Mọi version mới vẫn phải tái cấp quyền **toàn bộ segment** theo authority hiện tại và kiểm tra barrier bền vững khớp, dưới cùng bộ advisory lock sorted; không được ghi version mới bằng epoch/nguồn cũ đã revoke/xóa chỉ vì `created_at` sau intent.
2. Mở transaction; lấy khóa advisory sorted từ segment của copy, trùng bộ khóa `slackSourceWriteLockKeys` / `acquireSlackInvalidationLocks` của 03B1.
3. Khóa parent artifact trước theo thứ tự thực tế (`conversations` → `messages`; `conversations` → `plans`; `conversations` → `schedules`; `conversations` → `plans` → `execution_steps`), rồi `SELECT ... FOR UPDATE` dòng copy; kiểm tra lại `created_at <= intent.created_at` sau khi khóa (cutoff chỉ khoanh version của intent cũ).
4. Nếu copy không còn `active`: no-op.
5. Tính lại `target_fingerprint` từ artifact hiện tại. Nếu khác: `UPDATE ... SET status='retired', retired_reason='fingerprint_mismatch', retired_at=now() WHERE id=$1 AND target_version=$2 AND status='active'`; **không sửa artifact**; commit. Đây là đường "old intent gặp artifact đã đổi"; trường hợp này **không** được tính là F3 đã xóa — ghi nhận retired để backfill/review, read guard chặn, và runner **không** complete intent (`failIntent('code:STALE_LINEAGE')`).
6. Nếu khớp: handler xóa đúng trường/path bằng tombstone hợp lệ.
7. `UPDATE ... SET status='purged', purged_at=now(), purge_reason=$3 WHERE id=$1 AND target_version=$2 AND target_fingerprint=$4 AND status='active'`, truyền `$2` là chuỗi canonical (không ép số). Nếu rowCount = 0: rollback phần artifact hoặc reload và xử lý lại; không được ghi đè bản mới.
8. Commit.

Một intent cũ không bao giờ được quét mù theo `target_id`; nó chỉ chọn copy active khớp đúng `SlackPurgeTarget` **và** có `created_at <= intent.created_at`. Target epoch/revision (`policy_epoch_invalidated`, `workspace_consent_revocation`, `owner_retention`) tiếp tục loại bản mới theo epoch; với target không mang epoch (`resource_lifecycle`, `channel_membership_lost`), cutoff `created_at` là hàng rào bắt buộc để không xóa copy được đăng ký sau intent. Nếu writer quên đăng ký lại và fingerprint đổi, bước 5 retire thay vì xóa; read guard fail-closed.

Cutoff không phải chứng nhận freshness. Nếu một legacy writer bỏ qua writer gate 03B2 và ghi copy sau cutoff với segment khớp nguồn cũ đã bị vô hiệu hóa, copy đó **không** được coi là sạch: read guard kiểm tra authority/barrier hiện tại và chặn (`stale_lineage`/`policy_changed`), F3 không được tuyên bố cho copy đó; nó phải được purge bởi intent hiện hành hoặc đưa vào repair/backfill review. Không thêm trạng thái hay epoch protocol mới.

---

## 4. schedules: Xóa Đúng Trường, Không Bảo Toàn Mù

### 4.1. Hành vi thực tế

- `schedules.name` CHECK 1..80; `request` CHECK 1..1000; `recurrence` JSONB NOT NULL; `services TEXT[] NOT NULL`; `status` chỉ active/paused/cancelled/completed; `schedules_next_run_check` buộc `(status='active') = (next_run_at IS NOT NULL)`.
- `schedules.name/request/recurrence/services` được ghi từ `proposal.name/request/recurrence` (output model) và `metadata.services` (router chọn, không phải model) tại `ScheduleService.confirmProposal` → `saveFields`. `pause`/`resume`/`cancel` cũng gọi `saveFields` và tăng `version`.
- `ScheduleRepo.view` chỉ tính `nextRuns` khi `status='active'` và `next_run_at` khác NULL; vì vậy schedule paused đã purge không gọi `nextRuns({})`.
- `ScheduleService.transition('resume')` gọi `this.next(row, now)`; `nextOccurrence({})` sẽ ném lỗi. Phải có guard typed trước lời gọi này.
- `schedule_runs.error` hiện chỉ nhận hằng số lỗi server cố định (`BLOCKED`, `UNAPPROVED`, `DISCARDED`, `FAILED`, `TIMED_OUT`, `STOPPED`, `INTERRUPTED`; giá trị lưu là chuỗi tiếng Việt) từ `apps/chat-api/src/services/schedules/schedule-runner.ts` và `reconcileScheduleRuns`; chưa có Slack excerpt thực tế. Handler vẫn phải hỗ trợ `error` nếu writer tương lai đăng ký copy.
- `schedule_runs_plan_check CHECK ((status='planned') = (plan_id IS NOT NULL))`.

### 4.2. Quy tắc xóa

- Field có active copy: thay bằng tombstone **không rỗng**:
  - `name`: `Lịch đã thu hồi nguồn Slack` (độ dài hợp lệ).
  - `request`: `Yêu cầu đã bị thu hồi do nguồn Slack bị vô hiệu hóa. Vui lòng tạo lịch mới.`
  - `recurrence`: `'{}'::jsonb`.
- Nếu bất kỳ trường nào của schedule bị purge: nếu schedule đang `active`, đặt `status='paused'`, `pause_reason='slack_source_invalidated'`, `next_run_at=NULL`; nếu đã `paused`/`cancelled`/`completed`, giữ nguyên status nhưng vẫn tombstone các trường có copy. Pause chỉ là biện pháp phụ; **không thay thế việc xóa**. Cùng transaction tăng `schedules.version=version+1` để proposal đang giữ `baseVersion` cũ bị `STALE_PROPOSAL`.
- Field **không có copy** được giữ nguyên. Không có quy tắc "luôn giữ request". Request do model sinh trong lượt có nguồn Slack là mixed/model-derived và phải bị tombstone nếu có copy. `services TEXT[]` chỉ là định danh dịch vụ, không phải nội dung Slack, nên giữ nguyên.
- Không cố tách văn bản model bị trộn; tombstone toàn bộ field đã đăng ký. Không xóa các trường người dùng nhập không có copy.
- `resume`/`update` phải kiểm tra `recurrence` hợp lệ và không phải `{}` trước `nextOccurrence`; nếu không, ném `ScheduleConflict('SCHEDULE_SOURCE_PURGED')` (typed, fail-closed; thêm mã vào `SCHEDULE_CONFLICTS`). Schedule đã purge không nhận proposal update mới trên cùng row; người dùng phải tạo lịch mới. Proposal cũ có `baseVersion` lệch sau purge phải bị `STALE_PROPOSAL`.
- `schedule_runs.error`: nếu có active copy (writer tương lai), thay bằng tombstone không rỗng; hiện `planOne`/`reconcileScheduleRuns` chỉ ghi hằng số lỗi server nên chưa có copy Slack. State message do `recordState` ghi chứa `metadata.schedule.lastRun.error`; nếu writer tương lai đăng ký `error` thì path này cũng phải có copy và bị tombstone theo cùng selector.
- Plan bị purge đang được `schedule_runs` tham chiếu: `UPDATE schedule_runs SET status='discarded', plan_id=NULL, error=COALESCE(error, $tombstone) WHERE plan_id=$planId AND status='planned'` để thỏa check.
- `conversations.title` của run conversation: nếu có copy active, thay bằng tombstone **không rỗng** (không dùng NULL: `MessageRepo.createMessage` điền title từ message `user` đầu tiên khi title NULL); nếu người dùng đã rename, fingerprint lệch → retire, không ghi đè. `renameConversation` phải retire copy title cũ trong cùng transaction.
- `messages` của run (`runMessage` chứa `request` + `name`) và `metadata.name` (message `type='schedule_run'`) do `apps/chat-api/src/services/schedules/schedule-runner.ts` ghi; các copy này thuộc `chat_history_message` và được chat handler xóa. `schedule` chỉ xử lý row `schedules`, `schedule_runs.error`, `conversations.title`.

---

## 5. Working Memory: Path Cụ Thể, Giữ Dịch Vụ Khác

### 5.1. Hành vi thực tế

- `packages/planner/src/working-memory.ts`: `toJSON()` trải `entities` và `members`; `fromJSON()` khôi phục mọi key không phải `members`. `addMember` hiện không có producer trong code đang đọc.
- `planner.ts` `lookup()` gọi `recordObserved(memory.getEntity('__observed'), tool.discovers, stamped, tool.observedFields)`; chỉ Gmail thread ghi `__labels.thread`; `listDirectory` đọc `__observed`; `gather()` dùng `__gatherPending.candidates`, `__gatherIntent`, `__gatherBindings`, `__gatherMissing`; entity key đã chọn nằm ở top-level.
- Slack tool hiện có `slack.search_channels` discovers `channel`; các tool `myslack.*` mẫu chưa khai báo `discovers`. Không được bịa key `user`/`message` là đã có; chỉ đăng ký path khi tool thật khai báo service/discovers.
- `WorkingMemory` in-memory chỉ sống trong request; artifact bền vững là `messages.metadata.state`. Purge/read guard áp lên snapshot đọc từ DB trước `fromJSON`; không có bản in-memory bền vững nào khác để xóa.

### 5.2. Quy tắc purge

- Mỗi path Slack là một copy riêng với selector ở mục 3.1. Xóa đúng phần tử theo `#id=` hoặc đúng object key; không `delete state.__observed`, không `delete state.__labels`, không xóa cả `members`.
- `__observed.<resourceType>`: xóa phần tử có `id` khớp; giữ phần tử Trello/Google/dịch vụ khác trong cùng mảng.
- `__labels.<key>`: xóa đúng key Slack; giữ `__labels.thread` của Gmail nếu không có segment Slack.
- `__gatherPending.candidates`: xóa từng candidate Slack; giữ candidate dịch vụ khác. Nếu không còn candidate nào, xóa key `__gatherPending` (state tạm rỗng; câu hỏi người dùng đã nằm trong message, không giữ pending rỗng). `__gatherIntent` mặc định là text người dùng; `__gatherMissing` là `{key}`; chỉ xóa khi chính giá trị đó được đăng ký là Slack.
- `__gatherBindings.<entityKey>`: xóa nếu value là tên Slack đã copy; không xóa toàn bộ map.
- `members`: xóa phần tử theo `id`; giữ member Trello.
- Entity top-level đã resolve: xóa đúng key/selector; không xóa toàn bộ entity dictionary.
- Provenance chỉ đến từ server planner lookup context (`tool.service`, `tool.discovers`, `observedFields`, stamped parent). Không nhận danh sách segment/path do model hoặc client cung cấp. Nếu một output là model-mixed và server không chứng minh được đầy đủ các segment, fail-closed: **không ghi copy "một phần" và không ghi artifact**; toàn bộ output bị từ chối tại writer, nên không có bản ghi để read guard phục vụ. Không có quy tắc "không có copy = human-original" cho output mới chưa được chứng minh.
- Artifact đã tồn tại trước khi bật 03B2 không được coi là human-original chỉ vì không có copy. Chúng thuộc phạm vi backfill lineage riêng; 03B2 không tuyên bố F3 cho dữ liệu legacy chưa đăng ký và không mở read guard cho chúng khi chưa có chứng cứ.
- Không có copy **không tự động** là human-original. `assertDerivedCopyAllowed` không bao giờ trả `allowed` khi thiếu copy/version; thiếu copy là `blocked/not_found`. Absence chỉ được chấp nhận ở **writer gate 03B2** khi artifact được tạo sau cutover và mọi writer đã đi qua gate chứng nhận selector không có segment Slack; legacy bị deployment gate/backfill chặn. Nếu không có cutover marker rõ ràng, gate fail-closed.
- Read guard cho working memory kiểm tra từng path; path bị chặn bị bỏ khỏi state trước khi `fromJSON`, không đưa Slack cũ vào model. Nếu không thể xác định path, bỏ toàn bộ snapshot và bắt đầu memory rỗng (fail-closed), không âm thầm dùng dữ liệu cũ.

---

## 6. Handoff 03B1: Đúng Hàng Đợi Thực Tế

- `slack_invalidation_intents.status` chỉ có `pending`, `processing`, `completed`, `failed`. **Không có `raw_purged`**.
- `stageInTransaction` tạo 1 intent `slack_source_raw` + 1 intent cho mỗi kind trong `cascadeTargetKinds` (03B1 dùng đủ 7), tất cả `pending`, unique `(source_event_key, effect_key, target_kind)`.
- `SlackInvalidationRunner` của 03B1 chỉ claim `target_kind='slack_source_raw'`; sau `purgeSourcesByTarget` nó **được phép** `completeIntent` cho raw. Bảy intent derived vẫn `pending` cho 03B2. Không yêu cầu raw phải pending đến khi cả 7 xong.
- 03B2 runner chỉ claim 7 kind derived (không claim raw), theo lease/`SKIP LOCKED`, rồi `completeIntent` từng kind sau khi không còn active copy khớp target **và** `created_at <= intent.created_at`, **và** không còn copy `retired` lý do `fingerprint_mismatch` khớp target/cutoff (copy đó chưa được xử lý). Copy `retired` do fingerprint mismatch không được coi là đã xử lý: handler trả `retired` thì runner `failIntent('code:STALE_LINEAGE')`, receipt còn mở chờ backfill/review. Lỗi/không handler → `failIntent` với mã đã sanitize; intent **không** completed. Cutoff chỉ khoanh nghĩa vụ của intent cũ trên version artifact đã tồn tại; completion của intent cũ không chứng minh F3 cho copy đăng ký sau cutoff. Copy sau cutoff khớp segment nguồn cũ đã vô hiệu hóa bị read guard chặn và phải purge/repair theo intent hiện hành; không đổi trạng thái intent, không thêm epoch protocol.
- "Receipt closure" là predicate: receipt `source_event_key` chỉ đóng khi **tất cả** intent cùng key (raw + mọi derived kind) đều `completed`. Không thêm cột trạng thái receipt, không sửa 0017.
- Đóng tổng thể một invalidation không chỉ là receipt `policy:<eventId>`: phải gồm mọi receipt fanout `derived-policy:<eventId>:<epochHash>` áp dụng. Một receipt không có effect/intent không chứng minh derived đã purge; nếu segment còn epoch chưa có fanout receipt, invalidation vẫn mở.
- `proposal_excerpt` và `daily_digest_entry` chưa có handler: intent của chúng không bao giờ completed; receipt còn mở; đây là hành vi đúng, không phải lỗi che giấu. Full F3 chờ SLACK-06.
- Fanout epoch chỉ tồn tại ở derived: 03B1 chỉ dựng effect từ `slack_sources`, nên 03B2 cần dịch vụ riêng quét `slack_policy_events` + `slack_derived_provenance_segments`. Với mỗi epoch cũ chưa có intent dưới receipt `policy:<eventId>`, gọi `stageInTransaction` với **sourceEventKey riêng** `derived-policy:<eventId>:<epochHash>`, effect key `derived_policy_epoch_invalidated:<epochHash>`, barrier epoch và purge target 7 kind. Không gọi lại cùng `policy:<eventId>`: `stageInTransaction` là all-or-nothing theo receipt và sẽ trả receipt cũ mà không thêm effect. Receipt riêng này idempotent; raw intent phụ do 03B1 hoàn tất vô hại.
- Retry dùng đúng schema hiện có: `attempts`, `leased_until`, `worker_id`, `last_error`, `completed_at`; không thêm trạng thái mới.

---

## 7. Khóa, Cạnh Tranh & Ma Trận NOT_RUN

### 7.1. Chuỗi khóa thực tế

Đây là snapshot của 03B1 đã chấp thuận tại head `23544be9` (integration `612ac427`); nó không phải bằng chứng runtime cho giao thức khóa 03B2.

- 03B1 `saveSourceAtomic`: `acquireSlackInvalidationLocks(sorted)` → barrier check → `users FOR SHARE` → `slack_connections FOR SHARE` → `slack_trusted_providers FOR SHARE` → `slack_processing_consents FOR SHARE` → insert source.
- 03B1 `SlackConnectionRepo.disconnect`: `stageInTransaction` lấy advisory sorted trước, ghi barrier/intent, rồi `UPDATE slack_connections`; advisory trước connection row, cùng phân cấp với source writer. Bộ 6 suite PostgreSQL thật (55/55) tại head `23544be9` kiểm chứng cả hai thứ tự save-vs-disconnect; đây là bằng chứng 03B1, không phải 03B2.
- 03B1 `stageInTransaction`: advisory locks cho event key + barrier keys, sorted; insert receipt/barrier/intents. Không khóa artifact.
- 02B `SlackConsentRepo.revokeConsent`: `BEGIN` → `SELECT consent FOR UPDATE` → CAS revision → `UPDATE status='revoked'` → `INSERT slack_policy_events('consent_revoked')` → `COMMIT`. **Không stage barrier trong transaction này**; barrier do 03B1 sweep sau, tối đa chu kỳ 5 giây.
- `ScheduleRepo.ownedSchedule(lock=true)`: conversation `FOR UPDATE` → schedule `FOR UPDATE`.
- `PlanRepo.createPlan` / `MessageRepo.createMessage`: conversation `FOR UPDATE` trước insert.
- 03B2 writer phải theo: advisory sorted → conversation → authority `FOR SHARE` (user/connection/provider/consent) → barrier check → artifact → **barrier/authority post-check trước commit** → registry, giữ advisory đến hết transaction.
- 03B2 read guard: advisory sorted → conversation `FOR SHARE` → authority `FOR SHARE` → barrier check → artifact `FOR SHARE` parent-first → đọc copy/segment → **post-check version/fingerprint + authority/barrier trước commit**.
- 03B2 purger: advisory sorted → conversation → artifact → registry; không lấy consent.

Ba đường 03B2 dùng cùng thứ tự parent-first (conversation trước artifact; `execution_steps` đi qua `plans.conv_id` nên `plans` trước `execution_steps`). Không có kết luận deadlock hay deadlock-proof; toàn bộ ma trận M1-M11 vẫn `[Proposed: NOT_RUN]`.

### 7.2. Ma trận `[Proposed: NOT_RUN]`

| Mã | Hai tác vụ và thứ tự giữ khóa thật | Kỳ vọng phải kiểm chứng bằng 2 client PostgreSQL thật | Trạng thái |
|---|---|---|---|
| M1 | Writer giữ `consent FOR SHARE` sau conversation; 02B revoke giữ `consent FOR UPDATE` rồi insert event, commit trước barrier | Writer trước: revoke chờ; writer commit; revoke commit event; 03B1 stage barrier sau; 03B2 purge. Revoke trước: writer thấy revoked và rollback. Trong cửa sổ event-đã-commit/barrier-chưa-stage, reader phải thấy consent revoked và chặn; barrier vắng mặt không phải consent | NOT_RUN |
| M2 | 03B1 `stageInTransaction` giữ advisory event+barrier; writer giữ cùng bộ advisory rồi barrier check | Writer trước: stage chờ, sau đó barrier commit; artifact đã commit sẽ bị purge. Stage trước: writer thấy barrier và rollback. Không dựa vào thứ tự insert | NOT_RUN |
| M3 | Purger giữ conversation→artifact; writer giữ conversation→authority→artifact→registry | Cùng thứ tự parent-first; một bên chờ, không có cycle. Purger không lấy consent nên không tạo cycle với revoke. Test dùng `lock_timeout` thật, không chỉ đọc code | NOT_RUN |
| M4 | Revoke/grant/provider update (02B) vs writer đang giữ `FOR SHARE` | Grant/provider update commit event rồi barrier sau; writer cũ commit trước event thì artifact bị purge; writer sau event thấy revision mới và từ chối epoch cũ. Stale read phải fail-closed | NOT_RUN |
| M5 | Purger target-first (sai) vs writer conversation-first (đúng) | Chỉ dùng để phát hiện cycle nếu ai đó đảo thứ tự; test phải thấy lỗi/khóa chờ và không được coi là bằng chứng deadlock-proof | NOT_RUN |
| M6 | Crash giữa handler sau khi đã purge một số copy; lease hết hạn; runner khác claim lại | Copy đã purge không bị xử lý lại; copy còn active được xử lý; intent chỉ complete khi không còn active copy khớp; `attempts` tăng, không trùng tombstone | NOT_RUN |
| M7 | Stale version: copy v1 bị thay bởi copy v2 dưới grant/epoch mới; intent cũ xử lý v1 | v1 retire, artifact mới không bị sửa; v2 tạo sau intent chỉ nằm ngoài cutoff của intent cũ, **không** đương nhiên hợp lệ: read guard và writer vẫn phải tái cấp quyền toàn bộ segment + barrier hiện tại; v2 dưới epoch cũ bị từ chối; v2 dưới grant mới chỉ sống nếu authority/barrier hiện tại cho phép. Writer quên đăng ký lại → fingerprint lệch → retire, guard chặn, intent `STALE_LINEAGE` không complete | NOT_RUN |
| M8 | Hai runner cùng claim; một handler thiếu cho `proposal_excerpt` | `SKIP LOCKED` chỉ cho một claim; handler thiếu → `failIntent(MISSING_HANDLER)`, intent không completed, receipt mở; không tự bịa kết quả thành công | NOT_RUN |
| M9 | Canonical BIGINT string: register trả `9007199254740993`; `getActiveCopyInTransaction`, read guard và purge CAS dùng cùng chuỗi; so sánh với `9007199254740992`/`9007199254740994` | Roundtrip qua PG BIGINT giữ đúng `9007199254740993`; không `Number`/`parseInt`; fingerprint artifact không đổi; so sánh version không collapse hai giá trị kề nhau; CAS lệch một đơn vị trả 0 row, không purge nhầm | NOT_RUN |
| M10 | Register version mới vs policy event/barrier, cả hai thứ tự: (a) event/stage trước, (b) register trước rồi event/stage; kèm nỗ lực đăng ký lại segment cũ sau intent | (a) Register sau barrier/event bị từ chối nếu segment mang epoch/nguồn cũ đã revoke/xóa; (b) register trước commit thì artifact bị purge bởi barrier/event; sau cutoff, nỗ lực tái dùng segment cũ vẫn bị authority/barrier hiện tại từ chối. Regrant/revision mới hợp lệ chỉ sống nếu mọi segment được tái cấp quyền và barrier khớp; không dùng `created_at` làm bằng chứng freshness | NOT_RUN |
| M11 | Legacy writer bỏ qua gate 03B2, ghi copy sau cutoff với segment khớp nguồn cũ đã vô hiệu hóa | Read guard chặn (`stale_lineage`/`policy_changed`); F3 không được tuyên bố cho copy đó; copy phải được purge bởi intent hiện hành hoặc repair/backfill review; không thêm trạng thái/epoch mới, không coi là sạch | NOT_RUN |

Không có dòng nào ở trên là bằng chứng đã chạy. Chỉ sau khi có log lệnh thật, exit code và output mới được đổi trạng thái.

---

## 8. Điểm Tích Hợp Thực Tế & Đề Xuất

### 8.1. File hiện hữu sẽ phải sửa khi thi công

- `apps/chat-api/src/services/chat-service.ts`: `prepareResponse.write`, `executePlannerPipeline`, `planScheduledRun`; mở transaction chung cho artifact + registry; guard history/memory; SSE emit guard.
- `apps/chat-api/src/services/schedules/schedule-service.ts`: `confirmProposal`, `saveFields`, `recordState`, `setStatus` (resume guard).
- `apps/chat-api/src/services/schedules/schedule-runner.ts`: `planOne`, `runMessage`, `reconcileScheduleRuns`.
- `apps/chat-api/src/db/repositories/plan-repo.ts`, `apps/chat-api/src/db/repositories/message-repo.ts`, `apps/chat-api/src/db/repositories/step-repo.ts`, `apps/chat-api/src/db/repositories/schedule-repo.ts`, `apps/chat-api/src/db/repositories/conversation-repo.ts`: nhận `client` + lineage draft, hoặc guard đọc; writer `updateStepStatus` khóa `conversations` → `plans` → `execution_steps`.
- `apps/chat-api/src/services/execution-service.ts`: `getLatestExecutionSnapshot`, `approveAndStart`, `retryStep`, `continueExecution`.
- `apps/chat-api/src/services/startup-reconciliation.ts`: `reconcileInterruptedExecutions`.
- `apps/chat-api/src/routes/conversation-routes.ts`, `apps/chat-api/src/routes/stream-routes.ts`, `apps/chat-api/src/routes/schedule-routes.ts`, `apps/chat-api/src/routes/execution-routes.ts`.

### 8.2. Module mới đề xuất (chưa tồn tại)

- `db/v3/0018_slack_derived_lineage_and_purge.sql`.
- `apps/chat-api/src/db/repositories/slack-derived-lineage-repo.ts`.
- `apps/chat-api/src/services/slack/slack-derived-lineage-store.ts`.
- `apps/chat-api/src/services/slack/slack-cascade-purge-runner.ts`.
- `apps/chat-api/src/services/slack/slack-lineage-guards.ts`.
- `apps/chat-api/src/services/slack/slack-derived-policy-fanout.ts`.
- `apps/chat-api/src/services/slack/purge-handlers/` với 5 handler thật và 2 module "missing-handler" (không phải handler giả hoàn tất).

### 8.3. AbortSignal thực tế

- `ChatService.planScheduledRun` nhận `AbortSignal` và `signal.throwIfAborted()` trước planning; `ScheduleRunner` có `AbortController`.
- Chat thường/SSE hiện chưa có controller xuyên suốt trong `executePlannerPipeline`; đề xuất bổ sung controller gắn với request/response close và kiểm tra trước mỗi emit. Đây là thay đổi runtime **NOT_RUN**, không được mô tả như đã có.

### 8.4. Điểm ghi thực tế cần đăng ký copy

- `ChatService.prepareResponse.write`: working memory state, plan row + assistant plan message, proposal message (gồm `metadata.previous.*`), answer/clarification/refusal message (`metadata.lookups`, `metadata.clarification.options/context/reason`, `metadata.refusal.reason/suggestion`), `resourceLabels`.
- `ChatService.executePlannerPipeline`: system working memory message. Hiện dòng 528 ghi snapshot **trước** `prepareResponse.write`; khi thi công phải gộp snapshot + response + registry vào cùng transaction, không để snapshot không copy nếu response fail.
- `ScheduleService.confirmProposal`/`saveFields` ghi row `schedules`; `recordState` ghi state message `metadata.schedule.name/request/recurrence/lastRun.error`.
- `ScheduleRunner.planOne`: conversation title + first user message + `schedule_run` metadata.
- `StepRepo.createStep`/`updateStepStatus`: args/output/error.
- `reconcileInterruptedExecutions`: error JSON cố định; chỉ đăng ký nếu sau này có Slack excerpt.
- `MessageRepo.createMessage` title fallback từ message đầu tiên: nếu message đó là run message chứa Slack, title cũng phải có copy hoặc được ghi từ title tombstone.

---

## 9. Tiêu Chí Nghiệm Thu (PLAN_ONLY)

- [ ] **AC1 — Phạm vi:** Chỉ 3 tài liệu SLACK-03B2 thay đổi; không sửa mã, `CURRENT-STATE.md`, `ROADMAP.md`, migration.
- [ ] **AC2 — Registry & purge identity:** DDL có `target_version BIGINT NOT NULL` server-default, `target_fingerprint`, `retired_reason`, unique `(ati_user_id,target_kind,target_id,target_sub_id,target_version)`, partial unique active, trạng thái active/retired/purged. `target_version` là string canonical ở mọi interface TS; không ép số. Purge chỉ chọn copy active khớp target **và** `created_at <= intent.created_at`; cutoff chỉ khoanh version artifact của intent cũ, **không phải chứng nhận freshness**; CAS theo version chuỗi + fingerprint; mismatch thì retire, không sửa artifact mới, **không tuyên bố F3 cho copy đó** và không complete intent (`STALE_LINEAGE`). Copy đăng ký sau cutoff với segment cũ đã vô hiệu hóa không được coi là sạch.
- [ ] **AC3 — Atomic write:** Mọi writer thật liệt kê ở mục 8.4 ghi artifact + copy trong cùng transaction; retire copy cũ trước khi insert version mới; mỗi version mới tái cấp quyền toàn bộ segment + barrier dưới cùng advisory locks; không có version từ model/client.
- [ ] **AC4 — Read guard:** `expectedTargetVersion: string` canonical bắt buộc; kiểm tra caller, nonempty segments, 8-field storage policy ref, TTL, **authority consent/provider hiện tại**, barrier pre/post, fingerprint, current version; advisory sorted + conversation + authority `FOR SHARE` + khóa artifact `FOR SHARE` parent-first và kiểm tra lại version/fingerprint + authority/barrier sau khi đọc; `AbortSignal` thật; nguồn multi-workspace cùng một ATI user chỉ.
- [ ] **AC5 — schedules:** Xóa đúng từng trường có copy bằng tombstone không rỗng; `recurrence={}`, active-only pause + reason + `next_run_at` NULL; resume fail-closed; không bảo toàn mù `request`; xử lý `schedule_runs`/title đúng constraint.
- [ ] **AC6 — Working memory:** Xóa đúng `__observed`, `__labels`, `__gather*`, `members`, entity key theo selector; giữ entry dịch vụ khác; provenance chỉ từ server; fail-closed nếu không đủ segment.
- [ ] **AC7 — Handoff:** Raw intent có thể completed sau raw purge; 7 derived intent còn pending; không có `raw_purged`; closure là predicate tất cả intent completed; missing handler fail-closed.
- [ ] **AC8 — Phạm vi runtime trung thực:** Chỉ 5 handler artifact thật + 2 cổng tương lai; không tuyên bố 7-kind runtime/F3; full F3 phụ thuộc SLACK-06 và test tích hợp thật.
- [ ] **AC9 — Bằng chứng:** Mọi test runtime trong card, gồm M1-M11, là `[Proposed: NOT_RUN]`; không có tuyên bố tuyệt đối, không có kết luận deadlock hay F3 khi chưa có log lệnh thật. Bộ 55 test PostgreSQL của 03B1 là bằng chứng 03B1, không phải 03B2.
- [ ] **AC10 — Tài liệu:** Liên kết tồn tại; UTF-8 không U+FFFD; plan ≤350 dòng; `git diff --check` sạch; chỉ 3 file thuộc sở hữu.

---

## 10. Cổng Kiểm Tra

```powershell
# Runtime — toàn bộ [Proposed: NOT_RUN]
# npm run migrate:v3
# npm test -w @wap/chat-api -- tests/db/slack-derived-lineage-repo.test.ts
# npm test -w @wap/chat-api -- tests/services/slack/slack-cascade-purge.test.ts
# npm test -w @wap/chat-api -- tests/services/slack/slack-derived-guards.test.ts
# npm test -w @wap/chat-api -- tests/integration/slack-derived-writers-integration.test.ts
# npm run typecheck:v3

# Tài liệu — chạy thật trong phiên này, ghi ở log
git diff --check e9088d5e..HEAD
git diff --name-only e9088d5e..HEAD
```

---

## 11. Kết Quả Thi Công

**Phiên này:** PLAN_ONLY — chỉ sửa 3 tài liệu thuộc sở hữu; không có mã runtime, migration, gọi native Slack/model/provider, chấp nhận native provider, hay đóng F3. Ba hiệu chỉnh của phiên: (1) `target_version` BIGINT là string canonical ở register/getActive/read guard/purge CAS, có ma trận roundtrip `9007199254740993`; (2) cutoff `created_at` chỉ khoanh version của intent cũ, mọi version mới phải tái cấp quyền toàn bộ segment + barrier hiện tại, legacy slip sau cutoff bị chặn/không F3-clean; (3) cập nhật tham chiếu khóa 03B1 accepted `23544be9` / integration `612ac427` / read `390b1c54`, thêm `disconnect` advisory trước connection row và nêu thứ tự guard/writer/purger nhất quán. Mọi kiểm thử runtime trong card/plan giữ `[Proposed: NOT_RUN]`; kiểm chứng thật chỉ là kiểm tra tài liệu, ghi ở `docs/handoff/log/2026-10-30-slack-03b2-derived-plan.md`.

*(Phần kết quả runtime chỉ được điền sau khi có mã runtime và log lệnh thật. Không dùng phần này để tuyên bố F3 đã đóng.)*
