# Slack Personal Assistant — SLACK-03B2: Derived-Source Lineage & Cascade Purge (PLAN_ONLY)

> **Trạng thái:** PLAN_ONLY. Không có mã runtime, migration hay test runtime nào được chạy trong tài liệu này. Mọi kiểm thử runtime là `[Proposed: NOT_RUN]`.
> **Task card:** [`docs/handoff/tasks/SLACK-03B2-derived-lineage-and-purge.md`](../../handoff/tasks/SLACK-03B2-derived-lineage-and-purge.md).
> **Nền tài liệu:** `e9088d5e76e95fa65e3be019226835371e40908d`; nhánh `docs/slack-03b2-derived-plan`, PR #198.
> **Tham chiếu 03B1/03C1:** 03B1 accepted head `23544be96cf848cc5d4ff8c3feafe6e50319c399`, integration `612ac427152fcfcf8a0f1bff3158088d8f393a5d`; 03C1 accepted head `390b1c54b50a61d7412f20e928476d55eee4decb`. Thứ tự khóa 03B1 là snapshot của các head này; runtime 03B2 vẫn NOT_RUN.

**Mục tiêu:** Thiết kế sổ phả hệ bản sao Slack phái sinh, ghi nguyên tử với artifact, read guard theo từng trường/path, và cascade purge cho 5 artifact đang tồn tại thật. Hai kind `proposal_excerpt`/`daily_digest_entry` chỉ có cổng fail-closed; chúng không phải là runtime coverage.

**Kiến trúc:** PostgreSQL 16, `pg` transaction, Express 5, Node 22, TypeScript 5.6, Vitest. Registry do 03B2 sở hữu; hàng đợi/barrier do 03B1 sở hữu. Không sửa `db/v3/0017_slack_source_store.sql`.

---

## 1. Ranh Giới & Bất Biến

1. **03B1 → 03B2:** 03B1 xóa raw `slack_sources` (TTL ≤7 ngày) và **được phép** complete intent `slack_source_raw` sau khi xóa. Bảy intent derived còn `pending` cho 03B2. Không có trạng thái `raw_purged`; không bắt raw chờ cả 7.
2. **03B2 → SLACK-06:** `proposal_excerpt` và `daily_digest_entry` chưa có bảng/service. Không tạo handler giả. Runner không complete hai kind này; receipt còn mở.
3. **F3:** Chỉ đóng sau khi SLACK-06 có handler thật + test tích hợp thật cho đủ 7 kind. 03B2 runtime (khi thi công) chỉ đạt 5 handler artifact thật + 2 cổng từ chối.
4. **Người dùng:** Một `ati_user_id` có thể có nhiều workspace; mọi segment phải cùng `ati_user_id`. Cấm tổng hợp chéo ATI user.
5. **Nguồn cấp version:** Chỉ server. `target_version` lấy từ sequence BIGINT; `target_fingerprint` server băm từ artifact thật. Mọi interface TS giữ `targetVersion`/`expectedTargetVersion` là string thập phân canonical, không ép `number`; `identity_version` INT vẫn là number. Không nhận version/fingerprint/segment list từ model hay client.
6. **Không xóa mù:** Chỉ xóa đúng selector/path đã đăng ký. Không xóa cả `__observed`, `__labels`, `members`, không xóa mọi `schedules.request`.
7. **Cutoff không phải freshness:** `copy.created_at <= intent.created_at` chỉ khoanh version artifact của intent cũ. Mọi version mới phải tái cấp quyền toàn bộ segment + barrier bền vững dưới cùng advisory locks; không được dùng epoch/nguồn cũ đã revoke/xóa chỉ vì tạo sau intent. Legacy slip sau cutoff không được coi là F3-clean; read guard chặn và phải purge/repair.

---

## 2. Bảng Bao Phủ Thực Tế

| Kind | Artifact & trường thật | Writer thật | Reader thật | Purge |
|---|---|---|---|---|
| `chat_history_message` | `messages.content`; `metadata.plan`, `proposal`, `previous.name/request/recurrence`, `schedule.name/request/recurrence`, `schedule.lastRun.error`, `resourceLabels`, `name` (message `type='schedule_run'`), `lookups`, `clarification.options/context/reason`, `refusal.reason/suggestion` | `apps/chat-api/src/services/chat-service.ts` `prepareResponse.write`; `apps/chat-api/src/db/repositories/message-repo.ts` `createMessage`; `apps/chat-api/src/services/schedules/schedule-runner.ts` `planOne`; `apps/chat-api/src/services/schedules/schedule-service.ts` `recordState` (state message `metadata.schedule`) | `apps/chat-api/src/db/repositories/message-repo.ts` `listMessages`; `apps/chat-api/src/services/chat-service.ts` dòng 499-512, 516-519; `apps/chat-api/src/routes/conversation-routes.ts` `createConversationRoutes`; `apps/chat-api/src/routes/stream-routes.ts` `createStreamRoutes` | Tombstone content; xóa path metadata; proposal đổi `type` để không confirm lại |
| `working_memory_entity` | `messages.metadata.state` | `apps/chat-api/src/services/chat-service.ts` `prepareResponse.write`; `apps/chat-api/src/services/chat-service.ts` dòng 528 | `apps/chat-api/src/services/chat-service.ts` dòng 516-519; `packages/planner/src/working-memory.ts` | Xóa selector Slack; giữ entry dịch vụ khác |
| `plan_step_arg` | `plans.plan_json/plan_text/plan_hash/resource_labels`; `execution_steps.args_json` | `apps/chat-api/src/db/repositories/plan-repo.ts` `createPlan`; `apps/chat-api/src/db/repositories/step-repo.ts` `createStep`; `apps/chat-api/src/services/chat-service.ts` `prepareResponse.write` | `apps/chat-api/src/db/repositories/plan-repo.ts` `getPlan/getPendingPlan/getLatestExecutedPlan`; `apps/chat-api/src/services/execution-service.ts` `approveAndStart/getLatestExecutionSnapshot`; `apps/chat-api/src/routes/conversation-routes.ts` `createConversationRoutes`; `apps/chat-api/src/routes/execution-routes.ts` `createExecutionRoutes` | `plan_json/plan_text` tombstone; hash lại; xóa key label Slack; args tombstone; plan pending→superseded, running→failed |
| `scheduled_workflow_arg` | `schedules.name/request/recurrence/services/status/pause_reason/next_run_at`; `schedule_runs.error`; run `conversations.title` | `apps/chat-api/src/services/schedules/schedule-service.ts` `confirmProposal/saveFields` (row `schedules`), `recordState` (chỉ state message, thuộc `chat_history_message`); `apps/chat-api/src/services/schedules/schedule-runner.ts` `planOne` (title + message) | `apps/chat-api/src/services/schedules/schedule-service.ts` `list/listRuns`; `apps/chat-api/src/db/repositories/schedule-repo.ts` `getByConversation/listForUser/listRuns`; `apps/chat-api/src/routes/schedule-routes.ts` `createScheduleRoutes`; `apps/chat-api/src/services/chat-service.ts` dòng 513 | Tombstone từng field có copy; recurrence `{}`; pause; title tombstone; `services` là định danh dịch vụ nên giữ |
| `audit_log_entry` | `execution_steps.output_json`, `error_json` | `apps/chat-api/src/db/repositories/step-repo.ts` `updateStepStatus`; `apps/chat-api/src/services/execution-service.ts` dòng 169; `apps/chat-api/src/services/startup-reconciliation.ts` `reconcileInterruptedExecutions` | `apps/chat-api/src/services/execution-service.ts` `getLatestExecutionSnapshot/getExecutionStatusDurable`; `apps/chat-api/src/db/repositories/step-repo.ts` `listSteps`; `apps/chat-api/src/routes/execution-routes.ts` `createExecutionRoutes` | Tombstone JSON; không có bảng `audit_logs`, không có admin query |
| `proposal_excerpt` | Không có bảng/service; `messages.metadata.proposal` hiện có là schedule proposal, thuộc `chat_history_message` | Không có | Không có | `MISSING_HANDLER`, intent không completed |
| `daily_digest_entry` | Không có bảng/service | Không có | Không có | `MISSING_HANDLER`, intent không completed |

**Không dùng đường dẫn sai:** `services/schedule-runner.ts` (đúng `services/schedules/schedule-runner.ts`), `ScheduleRunner.runDue` (đúng `tick/planNow/planOne`), `ExecutionService.getExecution` (đúng `getLatestExecutionSnapshot/getExecutionStatusDurable`), `StartupReconciliationService` (đúng `reconcileInterruptedExecutions`). `ScheduleRepo.stateText` chỉ dựng nội dung state message cho `recordState`, không phải writer độc lập.

---

## 3. DDL 0018 (rút gọn; đầy đủ ở task card §3.2)

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
  retired_at TIMESTAMPTZ, retired_reason TEXT CHECK (retired_reason IS NULL OR retired_reason IN (
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
    (status='purged' AND purged_at IS NOT NULL AND purge_reason IS NOT NULL AND retired_at IS NULL AND retired_reason IS NULL)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_derived_copy_active
  ON slack_derived_copies(ati_user_id, target_kind, target_id, target_sub_id)
  WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_slack_derived_copy_lookup
  ON slack_derived_copies(target_kind, target_id, target_sub_id, status);

CREATE TABLE IF NOT EXISTS slack_derived_provenance_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  derived_copy_id UUID NOT NULL REFERENCES slack_derived_copies(id) ON DELETE CASCADE,
  segment_index INT NOT NULL CHECK (segment_index >= 0),
  capture_hash TEXT NOT NULL CHECK (capture_hash ~ '^[0-9a-f]{64}$'),
  raw_source_id UUID, owner_source_key TEXT NOT NULL,
  resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, revision TEXT NOT NULL,
  channel_id TEXT,
  ati_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL, -- no FK: survives connection deletion for cascade purge
  workspace_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL, identity_version INT NOT NULL CHECK (identity_version > 0),
  provider_profile_id TEXT NOT NULL, config_fingerprint TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  consent_revision TEXT NOT NULL CHECK (consent_revision ~ '^[1-9][0-9]*$'),
  provider_revision TEXT NOT NULL CHECK (provider_revision ~ '^[1-9][0-9]*$'),
  acquisition_purpose TEXT NOT NULL CHECK (acquisition_purpose IN ('manual_lookup','triage','planning','digest')),
  acquisition_requested_retention_days INT NOT NULL CHECK (acquisition_requested_retention_days >= 0),
  policy_purpose TEXT NOT NULL DEFAULT 'storage' CHECK (policy_purpose='storage'),
  storage_requested_retention_days INT NOT NULL
    CHECK (storage_requested_retention_days > 0 AND storage_requested_retention_days <= 30),
  effective_retention_days INT NOT NULL
    CHECK (effective_retention_days > 0 AND effective_retention_days <= storage_requested_retention_days),
  captured_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT uq_slack_derived_segment UNIQUE (derived_copy_id, segment_index),
  CONSTRAINT chk_slack_derived_segment_ttl CHECK (
    expires_at > captured_at AND
    expires_at <= captured_at + make_interval(days => effective_retention_days) AND
    expires_at <= captured_at + INTERVAL '30 days'));
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_lookup
  ON slack_derived_provenance_segments(workspace_id, resource_type, resource_id, revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_epoch
  ON slack_derived_provenance_segments(provider_profile_id, policy_version, consent_revision, provider_revision);
CREATE INDEX IF NOT EXISTS idx_slack_derived_segment_channel
  ON slack_derived_provenance_segments(workspace_id, channel_id) WHERE channel_id IS NOT NULL;
```

`target_sub_id` là selector server-side: `content`, `metadata.plan`, `metadata.proposal`, `metadata.previous.name`, `metadata.previous.request`, `metadata.previous.recurrence`, `metadata.schedule.name`, `metadata.schedule.request`, `metadata.schedule.recurrence`, `metadata.schedule.lastRun.error`, `metadata.resourceLabels/<key>`, `metadata.name` (chỉ message `type='schedule_run'`), `metadata.lookups`, `metadata.clarification.options`, `metadata.clarification.context`, `metadata.clarification.reason`, `metadata.refusal.reason`, `metadata.refusal.suggestion`, `plan_json`, `plan_text`, `plan_hash`, `resource_labels/<key>`, `args_json`, `output_json`, `error_json`, `name`, `request`, `recurrence`, `error`, `title`, `state:/__observed/<resourceType>#id=<encodeURIComponent(id)>`, `state:/__labels/<key>`, `state:/__gatherPending/candidates#id=<id>`, `state:/__gatherBindings/<entityKey>`, `state:/__gatherIntent`, `state:/__gatherMissing`, `state:/members#id=<id>`, `state:/<entityKey>#id=<id>`. Không có version từ client; mỗi lần writer ghi lại field phải retire active cũ (`retired_reason='superseded'`) rồi insert version mới trong cùng transaction. `metadata.usedDirectory` chỉ là danh sách service id, không phải copy Slack, nên giữ nguyên.

---

## 4. Interface & Ngữ Nghĩa CAS

```ts
export interface RegisterDerivedCopyInput {
  atiUserId: string;
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  targetSubId: string;
  segments: ProvenanceSegmentInput[]; // server acquisition context only
}

export interface AssertDerivedCopyAllowedInput {
  callerAtiUserId: string;
  consumerPurpose: Exclude<SlackPolicyPurpose, 'storage'>;
  targetKind: SlackDerivedTargetKind;
  targetId: string;
  targetSubId: string;
  expectedTargetVersion: string; // canonical BIGINT decimal; mandatory; never HTTP/model supplied
  signal?: AbortSignal;
}

export type DerivedAccessDecision =
  | { status: 'allowed' }
  | { status: 'tombstone_only'; tombstone: string }
  | { status: 'blocked'; reason: 'unauthorized_caller'|'empty_segments'|'blocked_by_barrier'|
      'policy_changed'|'retention_expired'|'version_mismatch'|'stale_lineage'|'not_found';
      tombstone: string };

export interface ISlackDerivedLineageStore {
  registerDerivedCopyInTransaction(client: pg.PoolClient, input: RegisterDerivedCopyInput):
    Promise<{ derivedCopyId: string; targetVersion: string; targetFingerprint: string }>;
  getActiveCopyInTransaction(client: pg.PoolClient, target: {
    atiUserId: string; targetKind: SlackDerivedTargetKind; targetId: string; targetSubId: string;
  }): Promise<{ derivedCopyId: string; targetVersion: string; targetFingerprint: string } | null>;
  assertDerivedCopyAllowed(input: AssertDerivedCopyAllowedInput): Promise<DerivedAccessDecision>;
}

export interface ISlackDerivedPurgeHandler {
  readonly targetKind: SlackDerivedTargetKind;
  /** Own transaction: verify created_at cutoff -> advisory locks -> parent artifact -> copy FOR UPDATE -> fingerprint -> scrub -> CAS with target_version kept as canonical string. */
  purgeCopy(copyId: string, reason: SlackTombstoneReason, intentCreatedAt: Date):
    Promise<'purged'|'retired'|'skipped'>;
}
```

**Registration:** server validates segments nonempty, same ATI user, 8-field storage ref, TTL, current policy/barriers; computes `target_fingerprint = sha256(canonicalJson(valueAtSelector))` (UTF-8, object keys sorted, no insignificant whitespace; text fields hash exact UTF-8; null/absent distinct sentinels); inserts copy + segments in caller transaction. It does not accept a client version. `segments` may only come from the server planner lookup context (`tool.service`, `tool.discovers`, `observedFields`, stamped parent); model/client-provided segment or path lists are rejected. If a mixed output's segments cannot all be proven, the writer fails and persists no artifact. Registration must also re-authorize every segment against current authority and matching durable barriers under the same sorted advisory locks before insert; a new version is never accepted merely because it is newer or was created after an intent.

**Version transport:** `target_version` is PostgreSQL BIGINT and every TS layer keeps it as the canonical decimal string returned by `pg`. No `Number()`, `parseInt()`, `parseFloat()`, unary `+` or JSON-number round-trip is allowed in registration results, `getActiveCopyInTransaction`, `expectedTargetVersion`, fingerprint comparison or purge CAS. Validate `^[1-9][0-9]*$`, reject more than 19 digits, and for 19 digits compare lexicographically with `9223372036854775807`; compare by canonical string equality so adjacent values such as `9007199254740992` and `9007199254740994` do not collapse. `identity_version` remains an INT number; only `target_version` is BIGINT string.

**Read guard:** `expectedTargetVersion` (canonical string) must equal the active copy's `target_version` by string equality; recompute fingerprint; validate every segment's storage ref via `SlackPolicyService.resolveSlackModelPolicy` (purpose `storage`, exact expected ref), then current consent/provider authority and consumer purpose; check barriers pre/post; TTL; same ATI user. Run in one transaction: sorted advisory locks first, conversation `FOR SHARE`, authority rows (`user`/`connection`/`provider`/`consent`) `FOR SHARE` in writer order, barrier check, then the target artifact `FOR SHARE` in parent-first order; read copy/segments, then re-read version/fingerprint and re-check authority/barrier after the artifact read; purge takes `FOR UPDATE` on the same artifact, so both order on that row and the re-read catches a change; the lock protocol itself is `[Proposed: NOT_RUN]` (M1-M11). Any failure → blocked with tombstone. A `purged` copy → `tombstone_only`; `retired` or no copy → `blocked` (`stale_lineage`/`not_found`). The guard never returns `allowed` without an active copy/version. Absence is accepted only at the 03B2 writer gate, which certifies that a writer-gated selector never had a Slack-derived segment; legacy artifacts without lineage stay behind the deployment gate/backfill and are never served as F3-clean. Guard calls `signal.throwIfAborted()` at entry, between awaits, and after post-check.

**Purge CAS:** Before locking, reject any copy with `created_at > intent.createdAt` (`skipped`). That cutoff **only scopes which artifact version the stale intent may CAS**; it is not proof that a copy created later is fresh or authorized. Every new version must re-authorize all segments against current authority and matching durable barriers under the same sorted advisory locks; a new version carrying a revoked/deleted epoch or source is never allowed merely because it was created after the intent. Then `UPDATE slack_derived_copies SET status='purged', purged_at=now(), purge_reason=$3 WHERE id=$1 AND target_version=$2 AND target_fingerprint=$4 AND status='active'` with `$2` passed as the canonical string, never coerced to a number. Zero rows → reload; if version/fingerprint changed, `retired` with `retired_reason='fingerprint_mismatch'` without touching artifact; that copy is **not** claimed as F3-purged and needs backfill/review, and the runner must `failIntent('code:STALE_LINEAGE')` rather than complete. An old intent therefore cannot erase/rebind a fresh version/regrant; a copy under a new epoch or after the intent cutoff is not selected by the old `SlackPurgeTarget`. If a legacy writer bypasses the 03B2 gate and writes a copy after the cutoff whose segments match the old invalidated source, that copy is **not clean**: the read guard blocks it (`stale_lineage`/`policy_changed`), F3 is not claimed for it, and it must be purged by the current intent or repaired via backfill/review. No new status or source-epoch protocol is introduced.

---

## 5. Chọn Copy, Xóa Đúng Path & Handoff

**Chọn copy theo target:** runner/handler query active copies `WHERE target_kind=$1 AND status='active' AND created_at <= $intentCreatedAt AND EXISTS (segment khớp target)`. Cutoff `created_at` là bắt buộc cho target không mang epoch (`resource_lifecycle`, `channel_membership_lost`); nó chỉ khoanh version artifact mà intent cũ được CAS, **không** chứng minh copy đăng ký sau intent là mới/hợp lệ. Mọi version mới phải được writer tái cấp quyền toàn bộ segment + barrier hiện tại dưới cùng advisory locks; copy legacy lọt sau cutoff với segment cũ đã vô hiệu hóa bị read guard chặn và phải purge/repair, không được coi là sạch. Predicate:

- `policy_epoch_invalidated`: khớp đủ 5 binding + `provider_profile_id` + `config_fingerprint` + `policy_version` + `consent_revision` + `provider_revision` với `target.epoch`.
- `workspace_consent_revocation`: `workspace_id` = target.workspaceId, `provider_profile_id` = target.providerProfileId, `policy_version` = target.policyVersion, `consent_revision::bigint < target.consentRevision` (epoch cũ hơn event).
- `authorization_disconnect`: 5 binding.
- `channel_membership_lost`: 5 binding + `channel_id`.
- `resource_lifecycle`: `workspace_id` + resource type/id + optional revision.
- `owner_retention`: 5 binding + resource type/id + optional revision + exact 8-field `policyRef`.

**Handler 5 kind thật:**
1. `chat_history_message`: tombstone `content`; `metadata.plan` có copy → xóa; `metadata.proposal` có copy → thay bằng `{type:'schedule_proposal_purged', reason:'slack_source_invalidated'}` để `confirmProposal` không tìm thấy; xóa `metadata.previous.*`, `metadata.schedule.*` (gồm `metadata.schedule.lastRun.error` nếu writer tương lai đăng ký `schedule_runs.error`) và `metadata.name` (message `type='schedule_run'`) theo từng field; xóa `metadata.clarification.options/context/reason` và `metadata.refusal.reason/suggestion` nếu có copy; xóa key Slack trong `resourceLabels`; lọc entry Slack trong `lookups`.
2. `working_memory_entity`: xóa đúng selector; `__observed`/`members` theo `id`; `__labels` theo key; `__gatherPending.candidates` theo id, xóa key `__gatherPending` nếu không còn candidate; `__gatherBindings` theo entity key; `__gatherIntent`/`__gatherMissing` chỉ xóa khi chính giá trị được đăng ký; giữ entry Trello/Google. Không xóa cả dictionary.
3. `plan_step_arg`: `plan_json` thành plan tombstone tối thiểu hợp lệ; `plan_text` thành tombstone; `plan_hash` băm lại; `resource_labels` xóa key Slack; `args_json` thành `{"__slack_purged":true}`; plan `pending` → `superseded`, các trạng thái in-flight thật (`approved`, `executing`, `stopping`, `partial`, `unknown`, `reconciliation_required`) → `failed` để resume không đọc tombstone.
4. `scheduled_workflow_arg`: `name` → `Lịch đã thu hồi nguồn Slack`; `request` → `Yêu cầu đã bị thu hồi do nguồn Slack bị vô hiệu hóa. Vui lòng tạo lịch mới.`; `recurrence` → `{}`; nếu đang `active` thì pause + `pause_reason='slack_source_invalidated'` + `next_run_at=NULL`, còn `paused/cancelled/completed` giữ status; title → tombstone; `schedule_runs.error` có copy → tombstone không rỗng (hiện chỉ hằng số server); `schedule_runs` liên quan plan bị purge → `discarded`, `plan_id=NULL`, `error=COALESCE(error, tombstone)`; `services` giữ nguyên vì chỉ là định danh dịch vụ; tăng `schedules.version=version+1` để proposal cũ `STALE_PROPOSAL`. Giữ field không có copy. Resume/update gặp `{}` ném `ScheduleConflict('SCHEDULE_SOURCE_PURGED')` trước `nextOccurrence` (thêm mã vào `SCHEDULE_CONFLICTS`); schedule đã purge không nhận proposal update mới trên cùng row, phải tạo lịch mới.
5. `audit_log_entry`: `output_json`/`error_json` thành tombstone JSON; không có bảng audit riêng.

**Hai cổng tương lai:** map handler thiếu → `failIntent('code:MISSING_HANDLER')`, intent vẫn `failed`/không completed; receipt chưa đóng. Không tạo bảng hay parser giả.

**03B1 handoff thực tế:** `SlackInvalidationRunner` chỉ claim `slack_source_raw`; sau `purgeSourcesByTarget` được complete raw. 03B2 claim 7 kind còn lại, lease/`SKIP LOCKED`, complete từng kind khi không còn active copy khớp **và** `created_at <= intent.createdAt`, **và** không còn copy `retired` lý do `fingerprint_mismatch` khớp target/cutoff; handler trả `retired` do fingerprint mismatch thì `failIntent('code:STALE_LINEAGE')`, không complete. Cutoff chỉ khoanh nghĩa vụ của intent cũ trên version artifact đã tồn tại; completion của intent cũ không chứng minh F3 cho copy đăng ký sau cutoff. Copy sau cutoff khớp segment nguồn cũ đã vô hiệu hóa bị read guard chặn và phải purge/repair theo intent hiện hành; không đổi trạng thái intent. "Receipt closed" = mọi intent cùng `source_event_key` đều `completed`; không thêm cột/trạng thái. Đóng tổng thể một invalidation phải gồm cả receipt `policy:<eventId>` và mọi receipt fanout `derived-policy:<eventId>:<epochHash>` áp dụng; receipt không effect/intent không chứng minh derived đã purge. `stageInTransaction` là all-or-nothing theo receipt: không gọi lại cùng `policy:<eventId>` để thêm epoch derived. 03B2 fanout epoch chỉ có trong derived bằng receipt riêng `derived-policy:<eventId>:<epochHash>` + effect `derived_policy_epoch_invalidated:<epochHash>`, barrier epoch, purge target 7 kind; idempotent theo receipt riêng.

---

## 6. Khóa, Revoke Bất Đồng Bộ & Ma Trận NOT_RUN

**Thứ tự thật (snapshot 03B1 accepted head `23544be9`, integration `612ac427`):** 03B1 `saveSourceAtomic` `advisory sorted → barrier check → users/connection/provider/consent FOR SHARE → insert`; `SlackConnectionRepo.disconnect` lấy `stageInTransaction` advisory sorted trước, ghi barrier/intent, rồi `UPDATE slack_connections`, tức advisory trước connection row như source writer. Bộ 6 suite PostgreSQL thật (55/55) tại head `23544be9` kiểm chứng cả hai thứ tự save-vs-disconnect; đây là bằng chứng 03B1, **không** phải runtime 03B2. 03B1 stage `advisory event+barrier sorted → receipt/barrier/intents`. 02B revoke `consent FOR UPDATE → update revoked → insert policy event → COMMIT`; **barrier đến sau** trong sweep 03B1 (≤5s). 03B2 writer `advisory sorted → conversation → authority FOR SHARE → barrier check → artifact → barrier/authority post-check trước commit → registry`, giữ advisory đến hết transaction. 03B2 read guard `advisory sorted → conversation FOR SHARE → authority FOR SHARE → barrier check → artifact FOR SHARE parent-first → đọc copy/segment → post-check version/fingerprint + authority/barrier`. 03B2 purger `advisory sorted → conversation → artifact → registry`, không lấy consent; với `execution_steps`, artifact là `plans` rồi `execution_steps` (qua `plans.conv_id`), và writer bước cũng phải join conversation lock theo cùng thứ tự. Ba đường 03B2 dùng cùng thứ tự parent-first; không có kết luận deadlock hay deadlock-proof.

Do revoke commit event trước barrier, writer/reader phải tự revalidate authority trong transaction; **barrier vắng mặt không phải consent**. Không có kết luận deadlock hay kết luận chứng minh nào ở đây; tất cả dưới đây là kế hoạch kiểm thử hai client PostgreSQL thật.

| Mã | Kịch bản giữ khóa thật | Kỳ vọng | Trạng thái |
|---|---|---|---|
| M1 | Writer giữ consent `FOR SHARE`; revoke giữ `FOR UPDATE` rồi insert event | Writer trước → revoke chờ; artifact commit; event commit; barrier sau; purge. Revoke trước → writer thấy revoked, rollback. Cửa sổ event-committed/barrier-chưa-có: reader revalidate consent và chặn | NOT_RUN |
| M2 | 03B1 stage barrier vs writer cùng advisory keys | Writer trước → stage chờ rồi barrier; artifact bị purge. Stage trước → writer thấy barrier, rollback | NOT_RUN |
| M3 | Purger conversation→artifact vs writer conversation→authority→artifact | Cùng parent-first; chờ tuần tự, không cycle; test `lock_timeout` thật | NOT_RUN |
| M4 | Grant/provider update vs writer đang `FOR SHARE` | Event sau commit của writer → purge; writer sau event thấy revision mới, từ chối epoch cũ | NOT_RUN |
| M5 | Purger target-first (sai) vs writer | Chỉ để phát hiện đảo thứ tự; không dùng làm bằng chứng deadlock-proof | NOT_RUN |
| M6 | Crash sau khi purge một số copy; lease hết hạn | Copy đã purge không lặp; copy còn active được xử lý; intent complete khi hết active khớp; `attempts` tăng | NOT_RUN |
| M7 | Stale version v1 bị thay bởi v2 grant/epoch mới | v1 retire; artifact mới không sửa; v2 sau intent chỉ ngoài cutoff của intent cũ, **không** đương nhiên hợp lệ: vẫn phải tái cấp quyền toàn bộ segment + barrier hiện tại; v2 epoch cũ bị từ chối; v2 grant mới chỉ sống nếu authority/barrier cho phép; fingerprint lệch thì intent `STALE_LINEAGE` không complete | NOT_RUN |
| M8 | Hai runner cùng claim; handler `proposal_excerpt` thiếu | `SKIP LOCKED` một claim; missing handler → failed, receipt mở, không complete giả | NOT_RUN |
| M9 | Canonical BIGINT string `9007199254740993` qua register/getActive/guard/purge CAS; so sánh `9007199254740992` và `9007199254740994` | Roundtrip PG BIGINT giữ đúng chuỗi; không `Number`/`parseInt`; fingerprint ổn định; version compare không collapse hai giá trị kề; CAS lệch một đơn vị trả 0 row, không purge nhầm | NOT_RUN |
| M10 | Register version mới vs policy event/barrier, cả hai thứ tự; nỗ lực tái dùng segment cũ sau intent | Event/stage trước → register sau bị từ chối nếu segment cũ đã revoke/xóa; register trước → artifact bị purge khi event/stage commit; sau cutoff, segment cũ vẫn bị authority/barrier hiện tại từ chối. Regrant/revision mới chỉ sống nếu mọi segment được tái cấp quyền và barrier khớp; `created_at` không phải freshness proof | NOT_RUN |
| M11 | Legacy writer bỏ qua gate 03B2, ghi copy sau cutoff khớp nguồn cũ đã vô hiệu hóa | Read guard chặn (`stale_lineage`/`policy_changed`); F3 không tuyên bố cho copy đó; phải purge bởi intent hiện hành hoặc repair/backfill; không thêm trạng thái/epoch mới, không coi là sạch | NOT_RUN |

---

## 7. Điểm Tích Hợp & File

**Sửa khi thi công (existing):** `apps/chat-api/src/services/chat-service.ts` (`prepareResponse.write`, `executePlannerPipeline`, `planScheduledRun`); `apps/chat-api/src/services/schedules/schedule-service.ts` (`confirmProposal/saveFields/recordState/setStatus`); `apps/chat-api/src/services/schedules/schedule-runner.ts` (`planOne`, `runMessage`, `reconcileScheduleRuns`); `apps/chat-api/src/db/repositories/plan-repo.ts`; `apps/chat-api/src/db/repositories/message-repo.ts`; `apps/chat-api/src/db/repositories/step-repo.ts`; `apps/chat-api/src/db/repositories/schedule-repo.ts`; `apps/chat-api/src/db/repositories/conversation-repo.ts`; `apps/chat-api/src/services/execution-service.ts`; `apps/chat-api/src/services/startup-reconciliation.ts`; `apps/chat-api/src/routes/conversation-routes.ts`; `apps/chat-api/src/routes/stream-routes.ts`; `apps/chat-api/src/routes/schedule-routes.ts`; `apps/chat-api/src/routes/execution-routes.ts`.

**Tạo mới:** `db/v3/0018_slack_derived_lineage_and_purge.sql`; `apps/chat-api/src/db/repositories/slack-derived-lineage-repo.ts`; `apps/chat-api/src/services/slack/slack-derived-lineage-store.ts`; `apps/chat-api/src/services/slack/slack-cascade-purge-runner.ts`; `apps/chat-api/src/services/slack/slack-lineage-guards.ts`; `apps/chat-api/src/services/slack/slack-derived-policy-fanout.ts`; `apps/chat-api/src/services/slack/purge-handlers/*` (5 thật + 2 khai báo missing-handler).

**Ghi artifact + copy cùng transaction:** `prepareResponse.write` (working memory, plan, plan message, proposal, answer/clarification/refusal gồm `metadata.lookups`, `metadata.clarification.*`, `metadata.refusal.*`, labels), `executePlannerPipeline` (working memory snapshot; hiện ghi trước `prepareResponse.write`, phải gộp cùng transaction khi thi công), `confirmProposal/saveFields` (row `schedules`), `recordState` (state message gồm `metadata.schedule.name/request/recurrence/lastRun.error`), `planOne` (title + first message + schedule_run metadata), `createStep/updateStepStatus` (args/output/error), `reconcileInterruptedExecutions` (chỉ lỗi cố định, copy nếu tương lai có Slack). `MessageRepo.createMessage` title fallback từ message đầu cũng phải được đăng ký/retire tương ứng; `ConversationRepo.renameConversation` retire title copy cũ.

**AbortSignal thật:** `planScheduledRun` nhận signal và `throwIfAborted`; `ScheduleRunner` có controller. Chat thường/SSE chưa có controller xuyên suốt — đề xuất bổ sung, `[Proposed: NOT_RUN]`.

---

## 8. Task Decomposition (tất cả runtime NOT_RUN)

- [ ] **Task 1 — Migration 0018:** sequence, copies, segments, unique active, TTL/terminal checks. `[Proposed: NOT_RUN]` migrate PG16 thật.
- [ ] **Task 2 — Repository & lock layer:** sorted advisory locks, parent-first, version/fingerprint CAS with `target_version` as canonical string, active copy lookup. `[Proposed: NOT_RUN]` test 2 client thật cho M2/M3/M7/M9.
- [ ] **Task 3 — Lineage store & guards:** mandatory `expectedTargetVersion` canonical string, segment policy/TTL/barrier pre-post, fingerprint, AbortSignal. `[Proposed: NOT_RUN]` HTTP/SSE/planner/schedule/executor guard tests.
- [ ] **Task 4 — Purge runner:** claim derived only, 5 real handlers, 2 missing-handler gates, lease/retry, receipt closure predicate. `[Proposed: NOT_RUN]` crash 3/5 + stale version + duplicate runner.
- [ ] **Task 5 — Writer integration:** all §7 writers in real PG transaction, re-register on every field write, retire old version, re-authorize every segment + barrier under the same advisory locks. `[Proposed: NOT_RUN]` integration test with real `ChatService`, `ScheduleService`, `PlanRepo`, `StepRepo`, including M10/M11.
- [ ] **Task 6 — Derived-only policy fanout:** separate `derived-policy:<eventId>:<epochHash>` receipt, no re-stage of `policy:<eventId>`, barrier+7 intents. `[Proposed: NOT_RUN]` expired-raw + derived-only epoch test.
- [ ] **Task 7 — Docs/review:** 3 files only, links, UTF-8, plan ≤350 lines, `git diff --check`. Actual doc checks in log; no runtime claim.

---

## 9. Acceptance / Evidence

- AC: mandatory server version in DDL + registration + read guard + purge CAS as canonical BIGINT string (no number coercion); unique `(user,kind,id,subid,version)` + partial active; no client/model version; purge cutoff `copy.created_at <= intent.created_at` only scopes the old intent's artifact version, not freshness; every new version re-authorizes all segments + barriers under the same advisory locks; CAS version string+fingerprint; fingerprint mismatch retires with `retired_reason='fingerprint_mismatch'`, blocks completion (`STALE_LINEAGE`); legacy post-cutoff copies with old invalidated segments are not F3-clean.
- AC: read guard mandatory `expectedTargetVersion` canonical string; current consent/provider authority, segment policy/TTL, barrier pre/post, fingerprint, advisory + conversation + authority `FOR SHARE` + artifact `FOR SHARE` parent-first then post-check.
- AC: schedules field-by-field tombstones (name/request/recurrence), active-only pause + resume guard, title/run error handling; no blanket request preservation.
- AC: working memory exact `__observed`/`__labels`/`__gather*`/`members`/entity selectors; preserve other services; trusted server provenance.
- AC: handoff raw may complete; 7 derived pending; no `raw_purged`; closure all intents; missing handler fails closed.
- AC: 5 existing runtime integrations + 2 future gates only; full 7-kind/F3 `[Proposed: NOT_RUN]` until SLACK-06.
- AC: no absolute or deadlock-proof claims, no stale dispatch IDs or AI tool names; M1-M11 all `[Proposed: NOT_RUN]`.

```text
# Runtime: toàn bộ [Proposed: NOT_RUN]
# npm run migrate:v3
# npm test -w @wap/chat-api -- tests/db/slack-derived-lineage-repo.test.ts
# npm test -w @wap/chat-api -- tests/services/slack/slack-cascade-purge.test.ts
# npm test -w @wap/chat-api -- tests/services/slack/slack-derived-guards.test.ts
# npm test -w @wap/chat-api -- tests/integration/slack-derived-writers-integration.test.ts
# npm run typecheck:v3

# Docs (chạy thật, ghi ở log)
git diff --check e9088d5e..HEAD
git diff --name-only e9088d5e..HEAD
```
