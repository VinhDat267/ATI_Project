# Slack Personal Assistant — SLACK-03B1: Source Store, PostgreSQL ACL & Durable Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng hạ tầng kho lưu trữ dữ liệu nguồn thô Slack (`slack_sources`), cơ chế kiểm soát truy cập (ACL) nghiêm ngặt tại mức PostgreSQL (F2), cơ chế tính toán và áp đặt trần thời gian lưu trữ (TTL) do máy chủ quyết định, hàng đợi ý định vô hiệu hóa bền vững (`slack_invalidation_intents`) với cơ chế phân phối `FOR UPDATE SKIP LOCKED`, cùng bộ tiêu thụ sự kiện chính sách tổ chức (`SlackPolicyEventConsumer`) với ngữ nghĩa epoch rào chắn (Barrier Epoch Mapping) chính xác trên nền tảng backend `apps/chat-api` và `db/v3`.

**Architecture:** Áp dụng Domain-Driven Design (DDD) và Deep Modules để cô lập hoàn toàn tầng dữ liệu nguồn. Bản ghi nguồn mang khóa định danh phức hợp duy nhất theo chủ sở hữu (`owner_source_key`), bộ tham chiếu chính sách chuẩn tắc 8 trường (`SlackPolicyReference`) với mục đích cố định `'storage'`, và các siêu dữ liệu bounded whitelisted an toàn. Tầng cơ sở dữ liệu thi công cổng ghi nguyên tử (Atomic Write Gate) kết hợp kiểm tra đồng thời trạng thái kết nối, sự chấp thuận (consent) và số thứ tự sửa đổi (revision) trong một câu lệnh SQL để loại bỏ hoàn toàn race condition. Hàng đợi vô hiệu hóa bền vững cam kết ghi nhận cùng transaction với các sự kiện ngắt kết nối hoặc thu hồi quyền, hoạt động độc lập với cờ tính năng tự động (F4 invariant).

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.6+, Express 5, PostgreSQL 16 (`pg` pool), Vitest, `node:crypto`.

**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md) (Mục 2, 4.4, 4.5, 8, 9.1).
**Parent Plan:** [Slack Remaining Delivery Plan](2026-10-29-slack-remaining-delivery.md) (Mục 4, Task 2: 03B).
**Task Card:** [`docs/handoff/tasks/SLACK-03B1-source-store-and-invalidation.md`](../../handoff/tasks/SLACK-03B1-source-store-and-invalidation.md).

---

## Global Constraints & Invariants

1. **Ranh giới Bounded Scope:** SLACK-03B1 chỉ thi công kho nguồn thô, kiểm soát truy cập PostgreSQL, trần TTL, hàng đợi ý định vô hiệu hóa, và tiêu thụ sự kiện chính sách tổ chức. Việc cascade purge vào các bản sao phái sinh (derived copies: lịch sử trò chuyện, bộ nhớ làm việc, kế hoạch, lịch chạy) thuộc phạm vi **SLACK-03B2+**. Cơ chế kiểm tra binding trước khi dispatch của Executor thuộc phạm vi **SLACK-03B3**.
2. **Không tuyên bố đóng F3 sớm:** Việc tạo bảng và dịch vụ lưu trữ nguồn không đồng nghĩa với hoàn tất F3. Không kích hoạt bất kỳ công cụ đọc/tiêu thụ nội dung nào trước khi chu trình F3 đầu-cuối được kiểm chứng đầy đủ.
3. **Module Ownership:** Toàn bộ mã nguồn sản phẩm thuộc sở hữu của Backend Engineer (`apps/chat-api/` và `db/v3/`). Tuyệt đối không chỉnh sửa `packages/tool-schemas/`, `packages/tool-adapters/`, `packages/planner/`, hay `apps/chat-web/`.
4. **Phụ thuộc Hợp đồng & Cổng Review:**
   - Backend 02B (PR #192, commit `4e038967`) đã pass 17 PG contract cases và fullcheck 3.167 tại `5fb027ef`; đang chờ CI cuối sau khi dọn dẹp khoảng trắng.
   - Schema 03A (PR #194, commit `6e02ca56`) nhận kết luận review độc lập "NEEDS WORK" (1 valid + 10 RED cases về bounds retention/raw 7 ngày và schema detachment, đang được Schema Owner sửa dưới `ctx_3c64f98e0373`). Kế hoạch 03B1 bám sát các yêu cầu chuẩn tắc đã thống nhất (agreed requirements), KHÔNG giả định rằng bản `6e02ca56` được chấp thuận nguyên trạng mà không sửa đổi.
   - Không thi công mã runtime mới trong phiên planning này.
5. **Ranh giới Phân đoạn Provenance (Provenance Segment Boundary):**
   - Khái niệm `DerivedCopyRef` đại diện cho MỘT phân đoạn ủy quyền với full-binding cụ thể.
   - Khi một mục tiêu phái sinh trải rộng trên nhiều workspace (cross-workspace) hoặc nhiều nguồn dữ liệu (như Daily Digest tổng hợp nhiều kênh từ nhiều workspace), giai đoạn SLACK-03B2+ bắt buộc phải tổng hợp TOÀN BỘ các phân đoạn tương ứng (aggregate ALL segments) và tái thẩm định (revalidate) tính hợp lệ của từng phân đoạn trước khi đưa vào prompt model hoặc hiển thị UI; không được coi một phân đoạn đơn lẻ là bằng chứng provenance hoàn chỉnh cho toàn bộ artifact.
6. **Phân tách Mục đích Tham chiếu Bất biến (Purpose Separation):** Bản ghi lưu trữ mang tham chiếu chính sách với `purpose = 'storage'` cố định. Bất kỳ consumer nào khi trích xuất dữ liệu ra sử dụng (`manual_lookup`, `triage`, `planning`, `digest`) phải tự thực hiện một ủy quyền riêng biệt qua `SlackPolicyService`. Không bao giờ dán nhãn lại mục đích của bản ghi lưu trữ hoặc gán dữ liệu cũ vào ủy quyền mới.
7. **Cổng Ghi Nguyên tử (Atomic Write Gate):** Không dùng cơ chế "kiểm tra boolean trước rồi INSERT sau". Cổng ghi kết hợp kiểm tra trạng thái kết nối active, consent granted, provider verified, và revisions khớp nhau trong cùng một câu lệnh SQL/transaction.
8. **Cách ly Chủ sở hữu Tuyệt đối (Owner Isolation):** Hai người dùng ATI khác nhau cùng kết nối vào một workspace và truy cập cùng một tin nhắn Slack được lưu thành 2 row độc lập với `owner_source_key` riêng biệt. Sự kiện ngắt kết nối hoặc hết hạn của người dùng A tuyệt đối không ảnh hưởng tới dữ liệu hợp lệ của người dùng B.
9. **Trần TTL Do Máy Chủ Quyết Định (Server-Enforced TTL):**
   - Nội dung thô (`raw bodies`): Trần tối đa 7 ngày (`MAX_RAW_BODY_RETENTION_DAYS = 7`).
   - Trích đoạn (`excerpts`): Trần tối đa 30 ngày (`MAX_EXCERPT_RETENTION_DAYS = 30`).
   - Nếu chính sách hoặc nhà cung cấp quy định `retentionDays === 0`: Cho phép xử lý trong bộ nhớ, nghiêm cấm lưu trữ bền vững (`RETENTION_ZERO_DENIED`).
   - Máy chủ tự tính `expires_at = captured_at + interval '... days'`; client không thể tự gia hạn.
10. **Độc lập với Cờ Tính năng (F4 Invariant):** Hàng đợi ý định vô hiệu hóa và worker dọn dẹp hoạt động liên tục ngay cả khi `MYSLACK_AUTOMATION_ENABLED=off` hoặc workspace bị tạm dừng.
11. **Ngữ nghĩa Ánh xạ Epoch Rào Chắn (Barrier Epoch Mapping):** Cột `consent_revision` trong sự kiện `slack_policy_events` là trạng thái **SAU** khi thay đổi. Sự kiện thu hồi (revision $R_{event}$) chỉ vô hiệu hóa các bản ghi có `consent_revision < R_{event}`. Các bản ghi nguồn mới được cấp quyền lại mang `consent_revision >= R_{event}` phải được bảo toàn nguyên vẹn.

---

## Module Ownership & File Allocations

| Vai trò | File sở hữu | Hành động | Mục đích |
|---|---|---|---|
| **Backend Engineer** | `db/v3/[proposed: NNNN_slack_source_store.sql]` | Tạo mới | DDL bảng `slack_sources` và `slack_invalidation_intents` |
| **Backend Engineer** | `apps/chat-api/src/db/repositories/slack-source-repo.ts` | Tạo mới | Lớp truy cập DB: atomic insert, get with ACL, soft tombstone, purge, query expired |
| **Backend Engineer** | `apps/chat-api/src/services/slack/slack-source-store.ts` | Tạo mới | Dịch vụ nghiệp vụ: kiểm tra policy, áp trần TTL, sanitize metadata, che chắn nội dung |
| **Backend Engineer** | `apps/chat-api/src/services/slack/slack-invalidation-service.ts` | Tạo mới | Hàng đợi vô hiệu hóa bền vững: transactional enqueue, `SKIP LOCKED` worker, crash recovery |
| **Backend Engineer** | `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts` | Tạo mới | Tiêu thụ sự kiện chính sách tổ chức với barrier epoch mapping |
| **Backend Engineer** | `apps/chat-api/tests/db/slack-source-repo.test.ts` | Tạo mới | Integration tests repository trên PostgreSQL 16 thật |
| **Backend Engineer** | `apps/chat-api/tests/services/slack/slack-source-store.test.ts` | Tạo mới | Unit/integration tests cho service lưu trữ nguồn |
| **Backend Engineer** | `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts` | Tạo mới | Concurrency tests với `SKIP LOCKED`, lease recovery, AbortSignal |
| **Backend Engineer** | `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts` | Tạo mới | Epoch mapping race tests trên PostgreSQL 16 thật |

---

## Detailed Task Breakdown

### Phase 1: Database Migration `[proposed: NNNN_slack_source_store.sql]`

**Files:**
- Create: `db/v3/[proposed: NNNN_slack_source_store.sql]` (Số thứ tự migration đề xuất `NNNN` được cấp sau reviewed backend head `0016_slack_processing_consents.sql`).

- [ ] **Step 1:** Soạn thảo DDL cho bảng `slack_sources`:
  ```sql
  -- Migration NNNN: Persistent Slack Source Store with ACL and Invalidation Intents
  CREATE TABLE IF NOT EXISTS slack_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL REFERENCES slack_connections(id) ON DELETE CASCADE,
    identity_version BIGINT NOT NULL CHECK (identity_version > 0),
    workspace_id TEXT NOT NULL,
    slack_user_id TEXT NOT NULL,
    resource_type TEXT NOT NULL CHECK (resource_type IN (
      'conversation', 'message', 'file', 'canvas', 'list',
      'list_item', 'bookmark', 'reminder', 'user', 'usergroup', 'subteam'
    )),
    resource_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    owner_source_key TEXT NOT NULL,
    global_resource_key TEXT NOT NULL,
    untrusted_content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    retention_days INTEGER NOT NULL CHECK (retention_days > 0),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    tombstoned_at TIMESTAMPTZ,
    tombstone_reason TEXT CHECK (tombstone_reason IN (
      'retention_expired', 'channel_membership_lost', 'connection_disconnected',
      'app_reinstalled', 'source_deleted', 'source_edited', 'consent_revoked'
    )),
    purged_at TIMESTAMPTZ,
    -- Canonical 8-field Policy Evidence Provenance
    purpose TEXT NOT NULL DEFAULT 'storage' CHECK (purpose = 'storage'),
    provider_profile_id TEXT NOT NULL,
    config_fingerprint TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    consent_revision BIGINT NOT NULL CHECK (consent_revision > 0),
    provider_revision BIGINT NOT NULL CHECK (provider_revision > 0),
    CONSTRAINT chk_slack_sources_expires_at CHECK (expires_at > captured_at AND expires_at <= captured_at + INTERVAL '30 days'),
    CONSTRAINT chk_slack_sources_raw_retention CHECK (
      resource_type != 'message' OR
      expires_at <= captured_at + INTERVAL '7 days' OR
      (metadata->>'isExcerpt')::boolean = true
    ),
    CONSTRAINT uq_slack_sources_owner_revision UNIQUE (
      user_id, connection_id, identity_version, resource_type, resource_id, revision
    )
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_slack_sources_owner_key
    ON slack_sources(owner_source_key);

  CREATE INDEX IF NOT EXISTS idx_slack_sources_active_lookup
    ON slack_sources(user_id, connection_id, identity_version, resource_type, resource_id)
    WHERE tombstoned_at IS NULL AND purged_at IS NULL;

  CREATE INDEX IF NOT EXISTS idx_slack_sources_workspace_resource
    ON slack_sources(workspace_id, resource_type, resource_id);

  CREATE INDEX IF NOT EXISTS idx_slack_sources_channel_lookup
    ON slack_sources(connection_id, (metadata->>'channelId'))
    WHERE metadata->>'channelId' IS NOT NULL AND tombstoned_at IS NULL;

  CREATE INDEX IF NOT EXISTS idx_slack_sources_expiration_poller
    ON slack_sources(expires_at)
    WHERE tombstoned_at IS NULL;

  CREATE INDEX IF NOT EXISTS idx_slack_sources_consent_epoch
    ON slack_sources(workspace_id, provider_profile_id, consent_revision)
    WHERE tombstoned_at IS NULL;
  ```

- [ ] **Step 2:** Soạn thảo DDL cho bảng hàng đợi ý định vô hiệu hóa `slack_invalidation_intents`:
  ```sql
  CREATE TABLE IF NOT EXISTS slack_invalidation_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope TEXT NOT NULL CHECK (scope IN (
      'owner_retention', 'channel_membership_lost', 'authorization_disconnect',
      'resource_lifecycle', 'workspace_consent_revocation'
    )),
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'completed', 'failed')),
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries INTEGER NOT NULL DEFAULT 5 CHECK (max_retries >= 0),
    claimed_at TIMESTAMPTZ,
    claimed_by TEXT,
    lease_expires_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_slack_invalidation_intents_claim
    ON slack_invalidation_intents(created_at ASC)
    WHERE status = 'pending';

  CREATE INDEX IF NOT EXISTS idx_slack_invalidation_intents_stale_lease
    ON slack_invalidation_intents(lease_expires_at ASC)
    WHERE status = 'claimed';
  ```

---

### Phase 2: Repository Layer (`SlackSourceRepo`)

**Files:**
- Create: `apps/chat-api/src/db/repositories/slack-source-repo.ts`
- Tests: `apps/chat-api/tests/db/slack-source-repo.test.ts`

- [ ] **Step 1:** Định nghĩa interface `ISlackSourceRepo` và cấu trúc bản ghi lưu trữ:
  ```ts
  import type pg from 'pg';
  import type {
    SlackBinding,
    SlackResourceType,
    SlackSourceMetadata,
    SlackPolicyReference,
  } from '@wap/tool-schemas';

  export interface SaveSlackSourceInput {
    binding: SlackBinding;
    resourceType: SlackResourceType;
    resourceId: string;
    revision: string;
    ownerSourceKey: string;
    globalResourceKey: string;
    untrustedContent: string;
    metadata: SlackSourceMetadata;
    retentionDays: number;
    capturedAt: Date;
    expiresAt: Date;
    policyRef: SlackPolicyReference;
  }

  export interface SlackSourceRecord {
    id: string;
    userId: string;
    connectionId: string;
    identityVersion: number;
    workspaceId: string;
    slackUserId: string;
    resourceType: SlackResourceType;
    resourceId: string;
    revision: string;
    ownerSourceKey: string;
    globalResourceKey: string;
    untrustedContent: string;
    metadata: SlackSourceMetadata;
    retentionDays: number;
    capturedAt: Date;
    expiresAt: Date;
    tombstonedAt: Date | null;
    tombstoneReason: string | null;
    purgedAt: Date | null;
    policyRef: SlackPolicyReference;
  }

  export interface ISlackSourceRepo {
    saveSourceAtomic(input: SaveSlackSourceInput, client?: pg.PoolClient): Promise<SlackSourceRecord | null>;
    getSourceWithAcl(params: {
      atiUserId: string;
      connectionId: string;
      identityVersion: number;
      resourceType: SlackResourceType;
      resourceId: string;
    }): Promise<SlackSourceRecord | null>;
    tombstoneByOwnerKey(ownerSourceKey: string, reason: string, client?: pg.PoolClient): Promise<number>;
    markPurged(id: string, client?: pg.PoolClient): Promise<void>;
    listExpiredActiveSources(limit: number): Promise<Array<{ id: string; ownerSourceKey: string }>>;
  }
  ```

- [ ] **Step 2:** Viết phương thức `saveSourceAtomic` thực hiện Atomic Write Gate trực tiếp trong câu lệnh SQL:
  ```sql
  INSERT INTO slack_sources (
    user_id, connection_id, identity_version, workspace_id, slack_user_id,
    resource_type, resource_id, revision, owner_source_key, global_resource_key,
    untrusted_content, metadata, retention_days, captured_at, expires_at,
    purpose, provider_profile_id, config_fingerprint, policy_version,
    consent_revision, provider_revision
  )
  SELECT
    c.user_id, c.id, c.identity_version, c.workspace_id, c.actor_id,
    $1, $2, $3, $4, $5,
    $6, $7::jsonb, $8, $9, $10,
    'storage', $11, $12, $13,
    $14, $15
  FROM slack_connections c
  JOIN users u ON u.id = c.user_id
  JOIN slack_processing_consents spc
    ON spc.workspace_id = c.workspace_id AND spc.provider_id = $11
  JOIN slack_trusted_providers stp
    ON stp.id = $11
  WHERE c.id = $16
    AND c.user_id = $17
    AND c.status = 'active'
    AND u.status = 'active'
    AND c.identity_version = $18
    AND spc.status = 'granted'
    AND spc.policy_version = $13
    AND spc.revision = $14
    AND stp.verified = true
    AND stp.no_training = true
    AND stp.configuration_fingerprint = $12
    AND stp.revision = $15
  ON CONFLICT (user_id, connection_id, identity_version, resource_type, resource_id, revision)
  DO UPDATE SET
    untrusted_content = EXCLUDED.untrusted_content,
    metadata = EXCLUDED.metadata,
    expires_at = EXCLUDED.expires_at,
    policy_version = EXCLUDED.policy_version,
    consent_revision = EXCLUDED.consent_revision,
    provider_revision = EXCLUDED.provider_revision
  WHERE slack_sources.tombstoned_at IS NULL
  RETURNING *;
  ```
  *Bảo đảm kỹ thuật:* Nếu connection bị ngắt hoặc consent bị thu hồi ngay trước khi INSERT, câu lệnh trả về 0 rows mà không gây race condition.

- [ ] **Step 3:** Viết unit & integration tests trong `apps/chat-api/tests/db/slack-source-repo.test.ts`:
  - Test 1: INSERT thành công khi connection active và consent granted.
  - Test 2: INSERT thất bại (trả về `null`) khi connection status = 'revoked' hoặc user status != 'active'.
  - Test 3: INSERT thất bại khi consent revision trong DB khác với revision được gửi trong request.
  - Test 4: Cách ly 2 user: Alice và Bob cùng lưu cùng một message ID -> tạo 2 row độc lập, query theo Alice chỉ trả row của Alice.
  - Test 5: Soft tombstone và truy vấn có ACL: khi tombstoned, query ACL trả về `null`.

---

### Phase 3: Service Layer (`SlackSourceStore`)

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-source-store.ts`
- Tests: `apps/chat-api/tests/services/slack/slack-source-store.test.ts`

- [ ] **Step 1:** Triển khai `SlackSourceStore` với tích hợp `SlackPolicyService`:
  ```ts
  export const MAX_RAW_BODY_RETENTION_DAYS = 7;
  export const MAX_EXCERPT_RETENTION_DAYS = 30;

  export class SlackSourceStore {
    constructor(
      private readonly pool: pg.Pool,
      private readonly sourceRepo: ISlackSourceRepo,
      private readonly policyService: SlackPolicyService
    ) {}

    async storeSource(input: {
      binding: SlackBinding;
      resourceType: SlackResourceType;
      resourceId: string;
      revision: string;
      untrustedContent: string;
      metadata?: unknown;
      requestedRetentionDays: number;
    }): Promise<{ success: boolean; sourceId?: string; reason?: string }> {
      // 1. Phê duyệt chính sách lưu trữ qua SlackPolicyService với purpose cố định 'storage'
      const policyDecision = await this.policyService.resolveSlackModelPolicy({
        binding: input.binding,
        purpose: 'storage',
        requestedRetentionDays: input.requestedRetentionDays,
      });

      if (!policyDecision.allowed) {
        return { success: false, reason: policyDecision.reason };
      }

      const policyRef = policyDecision.policyReference;

      // 2. Tính toán trần TTL máy chủ
      const isRawMessage = input.resourceType === 'message' && !(input.metadata as any)?.isExcerpt;
      const ceilingDays = isRawMessage ? MAX_RAW_BODY_RETENTION_DAYS : MAX_EXCERPT_RETENTION_DAYS;
      const effectiveRetentionDays = Math.min(
        input.requestedRetentionDays,
        policyRef.retentionDays,
        ceilingDays
      );

      if (effectiveRetentionDays <= 0) {
        return { success: false, reason: 'retention_zero_denied' };
      }

      // 3. Khóa cấu trúc tuple JSON
      const ownerSourceKey = formatSlackOwnerSourceKey(input.binding, {
        workspaceId: input.binding.workspaceId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        revision: input.revision,
      });
      const globalResourceKey = formatSlackGlobalResourceKey(
        input.binding.workspaceId,
        input.resourceType,
        input.resourceId
      );

      // 4. Validate metadata whitelisted an toàn
      const cleanMetadata = validateSlackSourceMetadata(input.metadata);

      const capturedAt = new Date();
      const expiresAt = new Date(capturedAt.getTime() + effectiveRetentionDays * 86400 * 1000);

      // 5. Ghi DB nguyên tử
      const saved = await this.sourceRepo.saveSourceAtomic({
        binding: input.binding,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        revision: input.revision,
        ownerSourceKey,
        globalResourceKey,
        untrustedContent: input.untrustedContent,
        metadata: cleanMetadata,
        retentionDays: effectiveRetentionDays,
        capturedAt,
        expiresAt,
        policyRef,
      });

      if (!saved) {
        return { success: false, reason: 'atomic_gate_rejected' };
      }

      return { success: true, sourceId: saved.id };
    }

    async getSource(params: {
      atiUserId: string;
      connectionId: string;
      identityVersion: number;
      resourceType: SlackResourceType;
      resourceId: string;
    }): Promise<{
      status: 'active' | 'tombstoned' | 'expired' | 'not_found';
      record?: SlackSourceRecord;
      safeMetadataOnly?: { resourceType: string; resourceId: string; tombstonedAt: Date | null };
    }> {
      const record = await this.sourceRepo.getSourceWithAcl(params);
      if (!record) return { status: 'not_found' };

      if (record.tombstonedAt !== null) {
        return {
          status: 'tombstoned',
          safeMetadataOnly: { resourceType: record.resourceType, resourceId: record.resourceId, tombstonedAt: record.tombstonedAt },
        };
      }

      if (record.expiresAt.getTime() <= Date.now()) {
        return {
          status: 'expired',
          safeMetadataOnly: { resourceType: record.resourceType, resourceId: record.resourceId, tombstonedAt: null },
        };
      }

      return { status: 'active', record };
    }
  }
  ```

- [ ] **Step 2:** Viết tests trong `apps/chat-api/tests/services/slack/slack-source-store.test.ts`:
  - Test 1: Áp trần 7 ngày cho raw message body khi client yêu cầu 30 ngày.
  - Test 2: Áp trần 30 ngày cho excerpts khi client yêu cầu 60 ngày.
  - Test 3: Từ chối lưu trữ khi consent có `retention_days = 0` (`retention_zero_denied`).
  - Test 4: Khi record đã tombstone, `getSource` chỉ trả về `safeMetadataOnly`, không bao giờ trả về `untrustedContent`.

---

### Phase 4: Invalidation Queue & Durable Worker (`SlackInvalidationService`)

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-invalidation-service.ts`
- Tests: `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts`

- [ ] **Step 1:** Triển khai `SlackInvalidationService`:
  ```ts
  import type pg from 'pg';
  import type { SlackPurgeTarget } from '@wap/tool-schemas';

  export class SlackInvalidationService {
    constructor(private readonly pool: pg.Pool) {}

    async enqueueIntent(intent: SlackPurgeTarget, client?: pg.PoolClient): Promise<string> {
      const db = client ?? this.pool;
      const res = await db.query(
        `INSERT INTO slack_invalidation_intents (scope, payload, status)
         VALUES ($1, $2::jsonb, 'pending')
         RETURNING id`,
        [intent.scope, JSON.stringify(intent)]
      );
      return res.rows[0].id;
    }

    async claimBatch(batchSize: number, workerId: string, leaseSeconds = 60): Promise<Array<{ id: string; scope: string; payload: SlackPurgeTarget }>> {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const res = await client.query(
          `UPDATE slack_invalidation_intents
           SET status = 'claimed',
               claimed_at = now(),
               claimed_by = $1,
               lease_expires_at = now() + ($2 || ' seconds')::interval,
               updated_at = now()
           WHERE id IN (
             SELECT id FROM slack_invalidation_intents
             WHERE status = 'pending'
                OR (status = 'claimed' AND lease_expires_at < now() AND retry_count < max_retries)
             ORDER BY created_at ASC
             LIMIT $3
             FOR UPDATE SKIP LOCKED
           )
           RETURNING id, scope, payload`,
          [workerId, leaseSeconds, batchSize]
        );
        await client.query('COMMIT');
        return res.rows;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    async executeTombstone(intent: SlackPurgeTarget, abortSignal?: AbortSignal): Promise<number> {
      if (abortSignal?.aborted) {
        throw new Error('Tombstone execution aborted');
      }

      switch (intent.scope) {
        case 'owner_retention': {
          const res = await this.pool.query(
            `UPDATE slack_sources
             SET tombstoned_at = now(), tombstone_reason = 'retention_expired'
             WHERE user_id = $1 AND connection_id = $2 AND identity_version = $3
               AND ($4::text IS NULL OR resource_type = $4)
               AND ($5::text IS NULL OR resource_id = $5)
               AND tombstoned_at IS NULL`,
            [
              intent.binding.atiUserId,
              intent.binding.connectionId,
              intent.binding.identityVersion,
              intent.resourceType ?? null,
              intent.resourceId ?? null,
            ]
          );
          return res.rowCount ?? 0;
        }

        case 'channel_membership_lost': {
          const res = await this.pool.query(
            `UPDATE slack_sources
             SET tombstoned_at = now(), tombstone_reason = 'channel_membership_lost'
             WHERE user_id = $1 AND connection_id = $2 AND identity_version = $3
               AND metadata->>'channelId' = $4
               AND tombstoned_at IS NULL`,
            [
              intent.binding.atiUserId,
              intent.binding.connectionId,
              intent.binding.identityVersion,
              intent.channelId,
            ]
          );
          return res.rowCount ?? 0;
        }

        case 'authorization_disconnect': {
          const res = await this.pool.query(
            `UPDATE slack_sources
             SET tombstoned_at = now(), tombstone_reason = $4
             WHERE user_id = $1 AND connection_id = $2 AND identity_version = $3
               AND tombstoned_at IS NULL`,
            [
              intent.binding.atiUserId,
              intent.binding.connectionId,
              intent.binding.identityVersion,
              intent.tombstoneReason,
            ]
          );
          return res.rowCount ?? 0;
        }

        case 'resource_lifecycle': {
          const res = await this.pool.query(
            `UPDATE slack_sources
             SET tombstoned_at = now(), tombstone_reason = $4
             WHERE workspace_id = $1 AND resource_type = $2 AND resource_id = $3
               AND ($5::text IS NULL OR revision = $5)
               AND tombstoned_at IS NULL`,
            [
              intent.workspaceId,
              intent.resourceType,
              intent.resourceId,
              intent.tombstoneReason,
              intent.revision ?? null,
            ]
          );
          return res.rowCount ?? 0;
        }

        case 'workspace_consent_revocation': {
          // Thực thi rào chắn: xóa mọi nguồn có revision nhỏ hơn consentRevision của sự kiện thu hồi
          const res = await this.pool.query(
            `UPDATE slack_sources
             SET tombstoned_at = now(), tombstone_reason = 'consent_revoked'
             WHERE workspace_id = $1
               AND provider_profile_id = $2
               AND consent_revision < $3::bigint
               AND tombstoned_at IS NULL`,
            [
              intent.workspaceId,
              intent.providerProfileId,
              intent.consentRevision,
            ]
          );
          return res.rowCount ?? 0;
        }

        default:
          throw new Error(`Unknown invalidation scope`);
      }
    }

    async completeIntent(id: string): Promise<void> {
      await this.pool.query(
        `UPDATE slack_invalidation_intents
         SET status = 'completed', updated_at = now()
         WHERE id = $1`,
        [id]
      );
    }

    async failIntent(id: string, error: string): Promise<void> {
      await this.pool.query(
        `UPDATE slack_invalidation_intents
         SET retry_count = retry_count + 1,
             status = CASE WHEN retry_count + 1 >= max_retries THEN 'failed' ELSE 'pending' END,
             last_error = $2,
             lease_expires_at = NULL,
             updated_at = now()
         WHERE id = $1`,
        [id, error]
      );
    }
  }
  ```

- [ ] **Step 2:** Viết concurrency & lease recovery tests trong `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts`:
  - Test 1: Concurrency: 2 worker claim đồng thời 10 intents -> mỗi worker nhận chính xác 5 intents, không trùng lặp (`SKIP LOCKED`).
  - Test 2: Crash recovery: 1 intent bị claimed nhưng hết hạn lease (`lease_expires_at < now()`) -> worker khác có thể claim lại và hoàn tất.
  - Test 3: `AbortSignal`: Khi signal bị abort giữa chừng, quăng lỗi và không commit tombstone dở dang.
  - Test 4: Disconnect user A không xóa record của user B cùng workspace.

---

### Phase 5: Policy Event Consumer & Barrier Epoch Mapping (`SlackPolicyEventConsumer`)

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts`
- Tests: `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts`

- [ ] **Step 1:** Triển khai `SlackPolicyEventConsumer`:
  ```ts
  import type pg from 'pg';
  import type { SlackInvalidationService } from './slack-invalidation-service.js';

  export class SlackPolicyEventConsumer {
    constructor(
      private readonly pool: pg.Pool,
      private readonly invalidationService: SlackInvalidationService
    ) {}

    async consumePendingPolicyEvents(limit = 50): Promise<number> {
      // 1. Quét các sự kiện chính sách chưa có intent tương ứng
      const eventsRes = await this.pool.query(
        `SELECT id, workspace_id, provider_id, event_type, policy_version,
                consent_revision, provider_revision, reason, occurred_at
         FROM slack_policy_events
         WHERE event_type = 'consent_revoked'
         ORDER BY occurred_at ASC
         LIMIT $1`,
        [limit]
      );

      let processed = 0;
      for (const ev of eventsRes.rows) {
        // Enqueue intent với barrier epoch mapping
        await this.invalidationService.enqueueIntent({
          scope: 'workspace_consent_revocation',
          workspaceId: ev.workspace_id,
          policyVersion: ev.policy_version,
          providerProfileId: ev.provider_id,
          consentRevision: String(ev.consent_revision),
          cascadeTargetKinds: ['history', 'memory', 'plan_args', 'schedules'],
          tombstoneReason: 'consent_revoked',
        });
        processed++;
      }

      return processed;
    }
  }
  ```

- [ ] **Step 2:** Viết PostgreSQL race test trong `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts`:
  - Setup kịch bản:
    1. Workspace `T_EPOCH_TEST` cấp consent lần 1 (`revision = 1`).
    2. Lưu nguồn `src_1` mang `consent_revision = 1`.
    3. Tổ chức thu hồi consent: tạo event `consent_revoked` với `consent_revision = 2`.
    4. Tổ chức cấp lại consent lần 2 (`revision = 3`).
    5. Lưu nguồn `src_2` mang `consent_revision = 3`.
    6. Chạy `SlackPolicyEventConsumer` và `SlackInvalidationService` cho event 2 (chậm trễ).
  - Khẳng định (Assertions):
    - `src_1` (`consent_revision = 1 < 2`) bị tombstone với lý do `consent_revoked`.
    - `src_2` (`consent_revision = 3 >= 2`) **VẪN ACTIVE**, không bị tombstone.
    - Truy vấn PostgreSQL chứng minh barrier epoch mapping hoạt động chính xác 100%.

---

### Phase 6: Seven Target Kinds Interface Obligations

**Files:**
- Tài liệu hóa hợp đồng giao diện cho các consumer và producer trong tương lai.

- [ ] **Step 1:** Định nghĩa nghĩa vụ hợp đồng TypeScript (Future Consumer Obligations):
  ```ts
  // 1. History Consumer (SLACK-03B2)
  export interface ISlackHistoryPurgeConsumer {
    purgeMessagesMatchingSources(sourceKeys: string[]): Promise<{ messagesRedactedCount: number }>;
  }

  // 2. Memory Consumer (SLACK-03B2 / Planner)
  export interface ISlackMemoryPurgeConsumer {
    evictEntitiesFromWorkingMemory(binding: SlackBinding, entityIds: string[]): Promise<void>;
  }

  // 3. Plan Args Consumer (SLACK-03B2 / Executor)
  export interface ISlackPlanPurgeConsumer {
    maskPlanStepsWithRevokedSources(planId: string, revokedSourceKeys: string[]): Promise<void>;
  }

  // 4. Proposals Producer (SLACK-06A)
  export interface ISlackProposalLifecycleContract {
    // Producer obligation: proposal PHẢI lưu sourceRefs
    // Khi sourceRef bị tombstone -> status chuyển sang 'auto_dismissed_source_revoked'
    sourceRefs: string[];
    status: 'pending' | 'approved' | 'rejected' | 'auto_dismissed_source_revoked';
  }

  // 5. Digest Producer (SLACK-06C)
  export interface ISlackDigestLifecycleContract {
    // Producer obligation: digest PHẢI lưu danh sách sourceRefs
    // Khi 1 sourceRef bị tombstone -> toàn bộ digest bị ẩn khỏi UI
    constituentSourceRefs: string[];
    isMasked: boolean;
  }

  // 6. Schedule Consumer (SLACK-03B2)
  export interface ISlackSchedulePurgeConsumer {
    pauseSchedulesForInvalidBinding(binding: SlackBinding, reason: string): Promise<void>;
  }

  // 7. Audit Consumer (SLACK-03B1 / SLACK-03B2)
  export interface ISlackAuditProvenanceContract {
    // Audit log CHỈ lưu ID và trạng thái, tuyệt đối không lưu untrusted_content
    sourceId: string;
    action: 'stored' | 'tombstoned' | 'purged';
    timestamp: Date;
  }
  ```

- [ ] **Step 2:** Quy chuẩn ranh giới phân đoạn provenance cho các cấu trúc đa workspace (Multi-Segment Aggregation):
  - Khái niệm `DerivedCopyRef` chỉ đại diện cho một phân đoạn ủy quyền với một full-binding duy nhất (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`).
  - Khi một bản tin tóm tắt tổng hợp (Daily Digest) hoặc một kế hoạch thực thi gom nội dung từ 2 workspace khác nhau (ví dụ: Workspace X của tổ chức A và Workspace Y của tổ chức B), bên tiêu thụ 03B2/06C phải lưu giữ một tập hợp các phân đoạn (`authorizationSegments: DerivedCopyRef[]`).
  - Trước khi render ra UI hoặc gửi vào prompt mô hình, consumer bắt buộc phải vòng lặp kiểm tra từng phân đoạn qua `SlackPolicyService.resolveSlackModelPolicy`. Nếu có bất kỳ phân đoạn nào thất bại (do ngắt kết nối, mất quyền kênh, hoặc consent bị thu hồi), toàn bộ artifact hoặc phần phụ thuộc không thể tách rời phải bị che giấu (masked) hoặc tái lập hoàn toàn. Không bao giờ dùng một phân đoạn hợp lệ duy nhất để hợp thức hóa dữ liệu của các phân đoạn khác.

---

## Verification & Execution Commands (TDD Flow)

### 1. Kiểm thử Unit & Integration Tests Mới (Backend)
```bash
# Repository tests
npm test -w @wap/chat-api -- tests/db/slack-source-repo.test.ts

# Source store tests
npm test -w @wap/chat-api -- tests/services/slack/slack-source-store.test.ts

# Invalidation queue tests
npm test -w @wap/chat-api -- tests/services/slack/slack-invalidation-service.test.ts

# Policy event consumer & barrier epoch tests
npm test -w @wap/chat-api -- tests/services/slack/slack-policy-event-consumer.test.ts
```

### 2. Kiểm thử Static Types & Security
```bash
npm run typecheck:v3
```

### 3. Kiểm tra Whitespace & Clean Diff
```bash
git diff --check ce9380e9
```

---

## Acceptance Criteria Checklist

- [ ] Bảng `slack_sources` chứa đúng các cột định danh, ACL, 8 trường policy evidence, trần TTL và các ràng buộc check hợp lệ.
- [ ] Bảng `slack_invalidation_intents` hỗ trợ phân phối khóa `FOR UPDATE SKIP LOCKED`, lease timeout và max retries.
- [ ] Ghi nguồn thực hiện qua cổng nguyên tử (Atomic Write Gate), thẩm định đồng thời trạng thái connection, consent, provider và revisions trong cùng câu lệnh SQL.
- [ ] Máy chủ áp trần 7 ngày cho raw bodies và 30 ngày cho excerpts; từ chối lưu trữ khi retention = 0.
- [ ] Nguồn tombstoned hoặc hết hạn tuyệt đối không trả về `untrustedContent` khi gọi `getSource`.
- [ ] Concurrency test chứng minh 2 worker không tranh chấp hoặc bỏ sót intents.
- [ ] Barrier Epoch Mapping test chứng minh trên PostgreSQL thật: sự kiện thu hồi (revision 2) chỉ xóa nguồn cũ (revision 1), bảo toàn nguyên vẹn nguồn được cấp quyền lại (revision 3).
- [ ] Toàn bộ 7 target kinds được nhận diện và định nghĩa rõ ràng nghĩa vụ tiêu thụ, không có phát biểu SQL giả tạo trên bảng chưa tồn tại.
- [ ] Không có thay đổi nào xâm phạm mã nguồn ngoài package Backend (`apps/chat-api/`, `db/v3/`).
