# Slack Personal Assistant — SLACK-03B1: Source Store, PostgreSQL ACL & Durable Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Triển khai kho dữ liệu nguồn thô Slack (`slack_sources`), cơ chế kiểm soát truy cập PostgreSQL MVCC tuần tự hóa tuyệt đối với 02B, trần TTL máy chủ <= 7 ngày, hàng đợi ý định vô hiệu hóa bền vững (`slack_invalidation_intents`), giao diện transaction-bound thống nhất `commitLifecycleInvalidation` cho 04A ingress, và bộ tiêu thụ sự kiện chính sách tổ chức hỗ trợ đầy đủ 6 purge scopes (bao gồm scope `policy_epoch_invalidated` đã được chấp thuận).

**Architecture:** Domain-Driven Design (DDD) & Deep Modules cô lập kho nguồn thô tại `apps/chat-api` và `db/v3`. Định danh capture vật lý bất biến bằng UUID (`SlackSourceEntity.id`), phân biệt với khóa tài nguyên nguồn `owner_source_key`. Tham chiếu chính sách 8 trường chuẩn tắc. Khóa dòng chống deadlock: `slack_connections` -> `slack_trusted_providers` -> `slack_processing_consents`. Thẩm định bất biến epoch thu thập (`acquisitionPolicyRef`) khớp `sameSlackPolicyEpoch` với `storagePolicyRef`. Đọc nguồn an toàn 2 pha (lưu trữ + tiêu thụ). Giao diện `ISlackInvalidationCoordinator` nguyên tử cho 04A ingress.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.6+, Express 5, PostgreSQL 16 (`pg` pool), Vitest.
**Spec:** `docs/superpowers/specs/2026-10-28-slack-personal-oauth-design.md` (Mục 2, 4.4, 4.5, 8, 9.1).
**Task Card:** [`docs/handoff/tasks/SLACK-03B1-source-store-and-invalidation.md`](../../handoff/tasks/SLACK-03B1-source-store-and-invalidation.md).

---

## 1. Bounded Scope & Core Engineering Invariants

1. **Ranh giới Bounded Scope & Điều kiện Tiên quyết F3:**
   - 03B1 chỉ quản lý dữ liệu nguồn thô (raw-only <= 7 ngày), kiểm soát truy cập DB, và hàng đợi vô hiệu hóa.
   - Toàn bộ cơ chế cascade purge vào 7 nhóm bản sao phái sinh (`SLACK_DERIVED_TARGET_KINDS`) thuộc phạm vi bắt buộc của **SLACK-03B2**.
   - Cơ chế gắn kết binding và kiểm tra hash trước dispatch của Executor thuộc phạm vi **SLACK-03B3**.
   - 03B2 và 03B3 là điều kiện tiên quyết (prerequisites) bắt buộc để nghiệm thu F3 và bật công cụ đọc nội dung công khai. Tuyệt đối không tuyên bố đóng sớm F3 tại 03B1.
2. **Thứ tự Khóa Dòng Nhất Quán (Lock Ordering Hierarchy):**
   - Khắc phục nguy cơ deadlock bằng thứ tự khóa dòng thống nhất trên mọi tác vụ:
     `slack_connections` -> `slack_trusted_providers` -> `slack_processing_consents`.
   - Trong `saveSourceAtomic`: Khóa `slack_connections` (FOR SHARE) -> `slack_trusted_providers` (FOR SHARE) -> `slack_processing_consents` (FOR SHARE).
   - Tương thích tuyệt đối với 02B: `grantConsent` khóa provider FOR UPDATE rồi consent FOR UPDATE; `revokeConsent` khóa consent FOR UPDATE. Không bao giờ đảo ngược thứ tự (provider trước consent). Khóa toàn bộ authority rows để loại trừ race lọt bản ghi insert sau khi revoke.
3. **Tham Chiếu Chính Sách 8 Trường & Trần TTL Máy Chủ:**
   - Lưu trữ đầy đủ 8 trường canonical policy evidence: `binding`, `purpose` (`'storage'`), `requestedRetentionDays`, `providerProfileId`, `configFingerprint`, `policyVersion`, `consentRevision`, `providerRevision`.
   - Trường canonical là `requestedRetentionDays` (không dùng trường legacy `retentionDays`).
   - Nếu yêu cầu ủy quyền gốc là 30 ngày, lưu nguyên giá trị 30 trong `policyRef.requestedRetentionDays` và cột `policy_requested_retention_days INT NOT NULL CHECK (policy_requested_retention_days > 0)`. Không áp constraint `<= 7` lên trường canonical issued ref.
   - Áp đặt trần TTL thực tế máy chủ `<= 7 ngày` lên bản ghi thô qua `retention_days INT NOT NULL CHECK (retention_days > 0 AND retention_days <= 7 AND retention_days <= policy_requested_retention_days)` và `CONSTRAINT chk_slack_sources_raw_retention CHECK (expires_at > captured_at AND expires_at <= captured_at + INTERVAL '7 days')`.
4. **Định Danh Capture Bất Biến, Epoch Recapturing & Provenance Thu Thập:**
   - `owner_source_key` (`formatSlackOwnerSourceKey(sourceRef)`) chỉ định danh tài nguyên và revision của chủ sở hữu, KHÔNG đại diện cho capture vật lý duy nhất.
   - Khóa chính capture vật lý là `SlackSourceEntity.id` (UUID). Ràng buộc active epoch: `UNIQUE (owner_source_key, policy_epoch_hash) WHERE purged_at IS NULL`. Không tự tạo Slack revision giả mạo.
   - Khi regrant/epoch mới (Grant 1 -> Revoke 2 -> Regrant 3), cùng một tin nhắn Slack không đổi nội dung được recaptured hợp lệ thành capture mới mang UUID mới mà không làm sống lại bản ghi cũ đã purge.
   - **Bảo toàn Epoch Thu Thập (Acquisition Epoch Provenance):** `saveSource` bắt buộc nhận `acquisitionPolicyRef` từ thao tác đọc trước đó và `storagePolicyRef` được cấp cho lưu trữ. Bắt buộc kiểm tra `sameSlackPolicyEpoch(slackPolicyRefToEpoch(acquisitionPolicyRef), slackPolicyRefToEpoch(storagePolicyRef))`. Một quan sát bị trễ từ Grant 1 cũ không thể lưu trữ hợp lệ dưới Grant 3 mới.
   - `getSource` yêu cầu định danh capture vật lý (`expectedCaptureId`) hoặc `(sourceRef, expectedPolicyEpoch)`; cấm tái liên kết mù (không query latest capture).
5. **Cơ Chế Đọc Nguồn 2 Pha (Dual Validation in `getSource`):**
   - Pha 1 (Lưu trữ): Thẩm định `policyRef` bất biến của bản ghi dưới mục đích `'storage'`, kiểm tra chưa hết hạn, chưa tombstone/purge, và tra cứu `slack_invalidation_barriers` (nếu có rào chắn pending hoặc purge thất bại -> lập tức chặn đọc với `status: 'blocked_by_invalidation_barrier'`).
   - Pha 2 (Tiêu thụ): Tách biệt ủy quyền mục đích sử dụng hiện tại của caller (ví dụ `'triage'`, `'planning'`, `'digest'`, `'manual_lookup'`) qua `SlackPolicyService.resolveSlackModelPolicy` với fresh consumer context. Tuyệt đối không truyền storage ref vào resolve mục đích triage như là expected ref, và không dán nhãn lại `policyRef.purpose`.
   - Kiểm tra post-await trước khi trả dữ liệu plaintext nhằm ngăn chặn rào chắn commit trong lúc đang chờ I/O.
6. **Tiêu Thụ Sự Kiện Chính Sách Lũy Thừa & Mở Rộng Đa Intent:**
   - Tách biệt biên nhận sự kiện (`slack_processed_policy_events`) khỏi tính duy nhất của intent. Khóa duy nhất intent là composite `(policy_event_id, epoch_hash, target_kind)`.
   - Một sự kiện chính sách có thể mở rộng thành NHIỀU intents tương ứng với các epoch cũ đang lưu trữ.
   - Đánh dấu sự kiện đã xử lý chỉ khi toàn bộ intents và rào chắn đọc bền vững được commit trong CÙNG một transaction. Chống starvation bằng anti-join có trật tự thời gian.
   - Xử lý đủ 4 loại sự kiện 02B: `consent_granted`, `consent_revoked`, `provider_attested`, `provider_updated`.
   - Thao tác ngắt kết nối (disconnect) bắt buộc capture binding CŨ dưới lock và ghi nhận vô hiệu hóa trước khi đổi trạng thái.
   - `SlackInvalidationRunner` khởi động độc lập với cờ tự động (`MYSLACK_AUTOMATION_ENABLED`) để bảo đảm dọn dẹp an ninh (F4 invariant).
7. **Chấp Thuận Hợp Đồng Purge Scope Thứ 6 Của Schema Owner:**
   - Backend chấp thuận chính thức hợp đồng scope thứ 6 từ `@wap/tool-schemas`:
     `SlackPolicyEpoch { binding: SlackBinding, providerProfileId: string, configFingerprint: string, policyVersion: string, consentRevision: string, providerRevision: string }`.
     `{ scope: 'policy_epoch_invalidated', epoch: SlackPolicyEpoch, cascadeTargetKinds: SlackDerivedTargetKind[], tombstoneReason: 'policy_changed' }`.
   - Thay thế toàn bộ tag đề xuất cũ `provider_profile_revocation` bằng `policy_epoch_invalidated`; lý do tombstone chuẩn xác là `'policy_changed'` (loại bỏ `provider_unverified`).
   - Mở rộng sự kiện sau thay đổi thành các exact old epochs lưu trữ, giữ nguyên ngữ nghĩa so sánh của `workspace_consent_revocation` và không chuyển barrier sau thay đổi thành grant cũ giả định.

---

## 2. Published Interfaces

### 2.1. Transaction-Bound Ingress Interface (Thống Nhất `stageInTransaction` Cho Consumer SLACK-04A & 03B1)
Tham chiếu quyết định chuẩn tắc: [`docs/handoff/decisions/2026-10-29-slack-source-ingress-contracts.md`](../../handoff/decisions/2026-10-29-slack-source-ingress-contracts.md).
```ts
export type SlackInvalidationBarrier =
  | {
      barrierType: 'binding';
      binding: SlackBinding; // đầy đủ 5 trường
      reason: string;
    }
  | {
      barrierType: 'channel';
      binding: SlackBinding; // đầy đủ 5 trường
      channelId: string;
      reason: string;
    }
  | {
      barrierType: 'epoch';
      epoch: SlackPolicyEpoch;
      reason: string;
    }
  | {
      barrierType: 'resource';
      workspaceId: string;
      resourceType: SlackResourceType;
      resourceId: string;
      minValidRevision?: string;
      deleted?: boolean;
      reason: string;
    }
  | {
      barrierType: 'provisional_auth';
      binding: SlackBinding;
      sourceEventKey: string;
      credentialFingerprint?: string;
      provisionalAction: string;
      reason: string;
    };

export interface InvalidationEffect {
  effectKey: string;
  barrier: SlackInvalidationBarrier;
  purgeTarget?: SlackPurgeTarget;
}

export interface StageInTransactionInput {
  sourceEventKey: string; // namespaced e.g. "slack:app:evt" hoặc "policy:evt"
  effects: InvalidationEffect[];
}

export interface StageInTransactionResult {
  receiptId: string;
  barrierIds: string[];
  intentIds: string[];
}

export interface ISlackInvalidationCoordinator {
  /**
   * Chạy trong transaction pg.PoolClient của 04A Ingress hoặc Policy Event Consumer.
   * Tạo receipt, effects, read barriers và purge intents nguyên tử trước ACK / commit.
   * Receipt UNIQUE(source_event_key) và Barrier/Intent UNIQUE(source_event_key, effect_key) đều NON-NULL.
   */
  stageInTransaction(
    client: pg.PoolClient,
    input: StageInTransactionInput
  ): Promise<StageInTransactionResult>;
}
```

### 2.2. Exact Source Read/Write DTOs (Cho Consumer SLACK-03C & Downstream)
```ts
export interface SaveSourceInput {
  sourceRef: SlackSourceRef;
  acquisitionPolicyRef: SlackPolicyReference; // Tham chiếu ủy quyền từ thao tác đọc ban đầu
  storagePolicyRef: SlackPolicyReference;     // Tham chiếu mục đích 'storage' được cấp phát
  untrustedContent: string;
  metadata?: SlackSourceMetadata;
  capturedAt?: string; // ISO UTC, mặc định server now()
}

export interface GetSourceInput {
  expectedCaptureId?: string;       // Định danh vật lý UUID (SlackSourceEntity.id)
  sourceRef: SlackSourceRef;
  expectedPolicyEpoch?: SlackPolicyEpoch; // Đối chiếu epoch lưu trữ chính xác
  consumerPurpose: SlackPolicyPurpose;    // 'manual_lookup' | 'triage' | 'planning' | 'digest'
}

export type GetSourceResult =
  | { status: 'ok'; entity: SlackSourceEntity }
  | { status: 'blocked_by_invalidation_barrier'; reason: string; safeMetadataOnly?: SlackSourceMetadata }
  | { status: 'blocked_by_policy_change'; reason: SlackModelBlockReason; safeMetadataOnly?: SlackSourceMetadata }
  | { status: 'tombstoned_or_expired'; reason: SlackTombstoneReason; safeMetadataOnly?: SlackSourceMetadata }
  | { status: 'not_found' };
```

---

## 3. Database Schema Specification (`db/v3/0017_slack_source_store.sql`)

```sql
-- 1. Bảng lưu trữ nguồn thô (Raw-only <= 7 ngày, khóa capture vật lý UUID)
CREATE TABLE IF NOT EXISTS slack_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_source_key TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES slack_connections(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  identity_version INT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  policy_epoch_hash TEXT NOT NULL,
  policy_requested_retention_days INT NOT NULL CHECK (policy_requested_retention_days > 0),
  retention_days INT NOT NULL CHECK (retention_days > 0 AND retention_days <= 7 AND retention_days <= policy_requested_retention_days),
  policy_ref JSONB NOT NULL,
  untrusted_content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  tombstoned_at TIMESTAMPTZ,
  tombstone_reason TEXT,
  purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_slack_sources_raw_retention CHECK (expires_at > captured_at AND expires_at <= captured_at + INTERVAL '7 days')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_sources_active_epoch
  ON slack_sources(owner_source_key, policy_epoch_hash) WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_slack_sources_expiration
  ON slack_sources(expires_at) WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_slack_sources_lookup
  ON slack_sources(user_id, connection_id, resource_type, resource_id);

-- 2. Bảng biên nhận sự kiện vô hiệu hóa (Idempotent Event Receipt Store)
CREATE TABLE IF NOT EXISTS slack_invalidation_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Bảng rào chắn đọc tức thì (Durable Read Barriers)
CREATE TABLE IF NOT EXISTS slack_invalidation_barriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_key TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  barrier_type TEXT NOT NULL CHECK (barrier_type IN ('binding', 'channel', 'epoch', 'resource', 'provisional_auth')),
  workspace_id TEXT NOT NULL,
  connection_id UUID REFERENCES slack_connections(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  slack_user_id TEXT,
  identity_version INT,
  channel_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  min_valid_revision TEXT,
  deleted BOOLEAN NOT NULL DEFAULT false,
  epoch_hash TEXT,
  epoch_json JSONB,
  provisional BOOLEAN NOT NULL DEFAULT false,
  provisional_action TEXT,
  credential_fingerprint TEXT,
  reason TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_slack_barriers_source_effect UNIQUE(source_event_key, effect_key)
);
CREATE INDEX IF NOT EXISTS idx_slack_barriers_active
  ON slack_invalidation_barriers(workspace_id, barrier_type) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_slack_barriers_connection
  ON slack_invalidation_barriers(connection_id, identity_version) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_slack_barriers_resource
  ON slack_invalidation_barriers(workspace_id, resource_type, resource_id) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_slack_barriers_epoch
  ON slack_invalidation_barriers(epoch_hash) WHERE active = true;

-- 4. Hàng đợi ý định vô hiệu hóa bền vững (Durable Invalidation Queue)
CREATE TABLE IF NOT EXISTS slack_invalidation_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_key TEXT NOT NULL,
  effect_key TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  purge_target JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  leased_until TIMESTAMPTZ,
  worker_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_slack_intents_source_effect_target UNIQUE(source_event_key, effect_key, target_kind)
);
CREATE INDEX IF NOT EXISTS idx_slack_intents_claim
  ON slack_invalidation_intents(status, leased_until) WHERE status IN ('pending', 'failed');
```

---

## 4. Component Architecture & Implementation Breakdown

```
apps/chat-api/src/
├── db/repositories/
│   ├── slack-source-repo.ts         # Atomic Write Gate (Lock hierarchy FOR SHARE), getSource, tombstone, purge
│   └── slack-connection-repo.ts     # Tích hợp: Bắt binding CŨ trong transaction disconnect và ghi nhận invalidation
├── services/slack/
│   ├── slack-source-store.ts        # Áp trần TTL 7 ngày, kiểm tra acquisition epoch match, điều phối getSource 2 pha
│   ├── slack-invalidation-service.ts# commitLifecycleInvalidation (04A), hàng đợi intents SKIP LOCKED, lease recovery
│   ├── slack-invalidation-runner.ts # Tiến trình nền quét TTL và dọn dẹp intents, chạy độc lập cờ automation
│   └── slack-policy-event-consumer.ts# Tiêu thụ sự kiện 02B, mở rộng after-change barrier thành exact old epochs
└── app.ts                           # Khởi động runner độc lập với cờ tự động hóa (F4 invariant)
```

---

## 5. Execution Tasks & Real Test Matrix

### Phase 1: Database Migration
- [ ] **Task 1.1:** Tạo file migration `db/v3/0017_slack_source_store.sql` theo đúng DDL mục 3.
- [ ] **Task 1.2:** Chạy kiểm tra cú pháp và tích hợp DB: `npm run migrate:v3`.

### Phase 2: Repository & Concurrency Lock Layer
- [ ] **Task 2.1:** Viết kiểm thử RED trong `apps/chat-api/tests/db/slack-source-repo.test.ts`:
  - *Test 2.1.1 (Lock Order Concurrency):* Khởi chạy 2 client PostgreSQL thật. Client 1 gọi `saveSourceAtomic` (giữ khóa FOR SHARE theo thứ tự `connection` -> `provider` -> `consent`). Client 2 đồng thời gọi `SlackConsentRepo.revokeConsent` (yêu cầu FOR UPDATE trên consent). Xác minh không xảy ra deadlock (AB-BA) và không có kịch bản lọt dữ liệu nguồn sau revoke.
  - *Test 2.1.2 (All Authority Rows Locked):* Kiểm tra insert bị từ chối nếu bất kỳ hàng thẩm quyền nào (connection active, provider verified, consent granted) không thỏa mãn.
  - *Test 2.1.3 (Physical Capture vs Owner Key):* Cùng một `owner_source_key` có thể lưu trữ thành công 2 capture vật lý với 2 UUID khác nhau dưới 2 epoch khác nhau sau khi epoch 1 đã purge.
- [ ] **Task 2.2:** Triển khai `SlackSourceRepo` thỏa mãn toàn bộ tests Phase 2 (GREEN).

### Phase 3: Service Layer & 2-Phase Safe Read Guard
- [ ] **Task 3.1:** Viết kiểm thử RED trong `apps/chat-api/tests/services/slack/slack-source-store.test.ts`:
  - *Test 3.1.1 (Server TTL Clamping):* Caller truyền `requestedRetentionDays = 30` vào policyRef; `policy_requested_retention_days` lưu đúng 30; `retention_days` bị áp trần cứng `<= 7`; `expires_at` đúng bằng 7 ngày từ `captured_at`.
  - *Test 3.1.2 (Acquisition Epoch Provenance Match):* `saveSource` từ chối lưu trữ nếu `acquisitionPolicyRef` thuộc Grant 1 cũ trong khi `storagePolicyRef` thuộc Grant 3 mới (`sameSlackPolicyEpoch` trả về false).
  - *Test 3.1.3 (Immediate Read Barrier):* Đưa một barrier active vào `slack_invalidation_barriers`; gọi `getSource` ngay lập tức trả về `blocked_by_invalidation_barrier` mà không để lộ untrusted content.
  - *Test 3.1.4 (Dual Purpose Validation):* Gọi `getSource` với `consumerPurpose: 'triage'`. Thẩm định lưu trữ dùng mục đích `'storage'`, sau đó ủy quyền tiêu thụ qua `resolveSlackModelPolicy` với `'triage'`. Không thay đổi mục đích lưu trữ gốc.
- [ ] **Task 3.2:** Triển khai `SlackSourceStore` thỏa mãn toàn bộ tests Phase 3 (GREEN).

### Phase 4: Durable Invalidation & Transaction-Bound Ingress
- [ ] **Task 4.1:** Viết kiểm thử RED trong `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts`:
  - *Test 4.1.1 (Transaction-bound 04A Ingress):* Dùng chung 1 `pg.PoolClient`, gọi `commitLifecycleInvalidation` cam kết barrier + intent được ghi nhận trong transaction trước khi commit. Rollback transaction nếu có lỗi.
  - *Test 4.1.2 (Concurrency SKIP LOCKED & Lease Recovery):* 2 worker nhận intent song song không tranh chấp; worker bị crash quá 60s lease được phục hồi tự động.
  - *Test 4.1.3 (Disconnect Old Binding Capture):* `SlackConnectionRepo.disconnect` bắt chính xác binding cũ và ghi intent vô hiệu hóa trước khi đổi status sang disconnected.
- [ ] **Task 4.2:** Triển khai `SlackInvalidationService` và cập nhật `SlackConnectionRepo.disconnect` (GREEN).

### Phase 5: Policy Event Consumer & Epoch Mapping
- [ ] **Task 5.1:** Viết kiểm thử RED trong `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts`:
  - *Test 5.1.1 (Idempotent Multi-Intent Expansion):* 1 sự kiện `consent_revoked` mở rộng thành các intent cho toàn bộ các old epochs trong `slack_sources`. Chạy lại consumer không sinh trùng lặp intent nhờ receipt store.
  - *Test 5.1.2 (Grant 1 -> Revoke 2 -> Regrant 3):* Nguồn thuộc Epoch 1 bị vô hiệu hóa bởi barrier `before_consent_revision = '2'`; nguồn thuộc Epoch 3 thu thập sau đó vẫn đọc bình thường và không bị purge nhầm.
  - *Test 5.1.3 (Sixth Scope policy_epoch_invalidated):* Xử lý chính xác scope `policy_epoch_invalidated` với reason `'policy_changed'`, giải phóng đúng cascade target kinds.
- [ ] **Task 5.2:** Triển khai `SlackPolicyEventConsumer` và tích hợp runner nền trong `app.ts` (GREEN).

### Phase 6: Code Hygiene, Verification & Review Gates
- [ ] **Task 6.1:** Kiểm tra toàn bộ link markdown và đường dẫn tương đối trong card, plan, log.
- [ ] **Task 6.2:** Chạy kiểm tra quy chuẩn git diff: `git diff --check base..HEAD`.
- [ ] **Task 6.3:** Xác nhận không có file mã nguồn hoặc file ngoài 3 docs SLACK-03B1 bị thay đổi.

---

## 7. Trạng Thái Triển Khai (bounded evidence, 30/10/2026)

- Đã triển khai Phase 1-5 trong phạm vi raw-only trên nhánh `feat/slack-03b1-source-store` (base `62f7a7bb`), gồm migration `db/v3/0017_slack_source_store.sql`, repository/store/invalidation/consumer/runner và các test PostgreSQL thật.
- Vòng independent review NEEDS_WORK trên PR #200 đã được xử lý: root harness 8/8 PASS (EXIT=0), 44/44 test cases của 5 file 03B1 PASS, `npm run check` PASS trên mã cuối cùng.
- Phạm vi NOT_RUN: native Slack ingress, model content calls, cascade 7 nhóm bản sao phái sinh (03B2), kiểm tra binding/hash trước dispatch của Executor (03B3), UI/browser. Kế hoạch này không tuyên bố hoàn tất F3.
