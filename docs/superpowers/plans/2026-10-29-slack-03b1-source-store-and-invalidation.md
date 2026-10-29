# Slack Personal Assistant — SLACK-03B1: Source Store, PostgreSQL ACL & Durable Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng hạ tầng kho lưu trữ dữ liệu nguồn thô Slack (`slack_sources`), cơ chế kiểm soát truy cập (ACL) tuần tự hóa nghiêm ngặt trên PostgreSQL MVCC (F2), cơ chế tính toán và áp đặt trần thời gian lưu trữ (TTL) do máy chủ quyết định, hàng đợi ý định vô hiệu hóa bền vững (`slack_invalidation_intents`) với cơ chế phân phối `FOR UPDATE SKIP LOCKED`, cùng bộ tiêu thụ sự kiện chính sách tổ chức (`SlackPolicyEventConsumer`) với ngữ nghĩa epoch rào chắn (Barrier Epoch Mapping) chính xác trên nền tảng backend `apps/chat-api` và `db/v3`.

**Architecture:** Áp dụng Domain-Driven Design (DDD) và Deep Modules để cô lập hoàn toàn tầng dữ liệu nguồn. Bản ghi nguồn thô mang khóa định danh phức hợp duy nhất theo chủ sở hữu (`owner_source_key`) từ hàm chuẩn `formatSlackOwnerSourceKey(ref: SlackSourceRef)`, bộ tham chiếu chính sách chuẩn tắc 8 trường (`SlackPolicyReference`) với mục đích cố định `'storage'`, và các siêu dữ liệu bounded whitelisted an toàn. Tầng cơ sở dữ liệu thi công cổng ghi nguyên tử (Atomic Write Gate) kết hợp khóa dòng tường minh (`FOR SHARE`) trên kết nối và sự chấp thuận (consent), tuần tự hóa tuyệt đối với các giao dịch `revokeConsent` (`FOR UPDATE`) của 02B dưới PostgreSQL MVCC để loại bỏ hoàn toàn race condition. Cơ chế đọc `getSource` bắt buộc tái thẩm định tính hợp lệ của nguồn trên DB live theo mục đích riêng biệt của caller và tra cứu rào chắn vô hiệu hóa bền vững (`slack_invalidation_barriers`) trước khi trả dữ liệu. Hàng đợi vô hiệu hóa bền vững cam kết ghi nhận cùng transaction với các sự kiện ngắt kết nối, thu hồi quyền hoặc webhook ingress, hoạt động độc lập với cờ tính năng tự động (F4 invariant).

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.6+, Express 5, PostgreSQL 16 (`pg` pool), Vitest, `node:crypto`.

**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md) (Mục 2, 4.4, 4.5, 8, 9.1).
**Parent Plan:** [Slack Remaining Delivery Plan](2026-10-29-slack-remaining-delivery.md) (Mục 4, Task 2: 03B).
**Task Card:** [`docs/handoff/tasks/SLACK-03B1-source-store-and-invalidation.md`](../../handoff/tasks/SLACK-03B1-source-store-and-invalidation.md).

---

## Global Constraints & Review Remediation Rules

1. **Ranh giới Bounded Scope & Phân tầng Vòng đời:** SLACK-03B1 chỉ thi công kho nguồn thô, kiểm soát truy cập PostgreSQL với khóa dòng tuần tự hóa, trần TTL, hàng đợi ý định vô hiệu hóa, và tiêu thụ sự kiện chính sách tổ chức. Việc cascade purge vào các bản sao phái sinh (derived copies: lịch sử trò chuyện, bộ nhớ làm việc, kế hoạch, lịch chạy) thuộc phạm vi **SLACK-03B2+**. Cơ chế kiểm tra binding trước khi dispatch của Executor thuộc phạm vi **SLACK-03B3**.
2. **Không tuyên bố đóng F3 sớm:** Việc tạo bảng và dịch vụ lưu trữ nguồn không đồng nghĩa với hoàn tất F3. Không kích hoạt bất kỳ công cụ đọc/tiêu thụ nội dung nào trước khi chu trình F3 đầu-cuối được kiểm chứng đầy đủ.
3. **Module Ownership:** Toàn bộ mã nguồn sản phẩm thuộc sở hữu của Backend Engineer (`apps/chat-api/` và `db/v3/`). Tuyệt đối không chỉnh sửa `packages/tool-schemas/`, `packages/tool-adapters/`, `packages/planner/`, hay `apps/chat-web/`.
4. **Phụ thuộc Hợp đồng & Cổng Review:**
   - Backend 02B (PR #192, commit `4e038967`) đã pass 17 PG contract cases và fullcheck 3.167 tại `5fb027ef`; đang chờ CI cuối sau khi dọn dẹp khoảng trắng.
   - Schema 03A (PR #194, commit `6e02ca56`) nhận kết luận review độc lập "NEEDS WORK" (1 valid + 10 RED cases về bounds retention/raw 7 ngày và schema detachment, đang được Schema Owner sửa dưới `ctx_3c64f98e0373`). Kế hoạch 03B1 bám sát các yêu cầu chuẩn tắc đã thống nhất (agreed requirements), KHÔNG giả định rằng bản `6e02ca56` được chấp thuận nguyên trạng mà không sửa đổi.
   - Không thi công mã runtime mới trong phiên planning này.
5. **Khóa Dòng Tuần Tự Hóa PostgreSQL MVCC (Review Point 1):**
   - Loại bỏ khẳng định sai lầm rằng `INSERT SELECT WHERE` tự động ngăn chặn race condition dưới PostgreSQL Read Committed.
   - Định nghĩa thứ tự khóa dòng tường minh:
     1. Khóa kết nối: `SELECT ... FROM slack_connections WHERE id = $connectionId AND user_id = $atiUserId FOR SHARE`.
     2. Khóa sự chấp thuận: `SELECT ... FROM slack_processing_consents WHERE workspace_id = $workspaceId AND provider_id = $providerProfileId FOR SHARE`.
   - Đồng bộ với `SlackConsentRepo.revokeConsent` (sử dụng `FOR UPDATE` trên `slack_processing_consents`). Đảm bảo hai giao dịch được tuần tự hóa nghiêm ngặt: hoặc revoke commit trước khiến insert thất bại; hoặc insert commit trước khiến revoke nhìn thấy và phát sinh rào chắn/intent thu hồi ngay sau đó.
   - Cổng ghi thẩm định đầy đủ 5 trường binding, quyền mục đích `'storage'`, giới hạn retention và số thứ tự sửa đổi (revision) hiện hành.
6. **Cơ Chế Đọc An Toàn & Rào Chắn Đọc Tức Thì (Review Point 2):**
   - `getSource` bắt buộc yêu cầu đầy đủ 5 trường binding, định danh capture/revision chính xác, và mục đích tiêu thụ riêng biệt (`purpose: 'manual_lookup' | 'triage' | 'planning' | 'digest'`).
   - Kiểm tra rào chắn vô hiệu hóa bền vững `slack_invalidation_barriers` trước khi trả dữ liệu. Nếu có rào chắn active cho connection, channel, hoặc workspace consent, chặn đọc ngay lập tức (`status: 'blocked_by_invalidation_barrier'`) trước khi worker purge vật lý chạy.
   - Tái thẩm định trạng thái live DB qua `SlackPolicyService.resolveSlackModelPolicy`.
   - Tuyệt đối không chọn "latest resource" để bind mù vào artifact cũ. Khẳng định rõ bảo vệ hậu mô hình (post-model / prepublication guard) là nghĩa vụ của 03B2/03B3.
7. **Trần TTL Kho Nguồn Thô `<= 7 ngày` (Review Point 3):**
   - Bảng nguồn thô `slack_sources` áp đặt trần cứng `<= 7 ngày` cho **MỌI** loại tài nguyên (`conversation`, `message`, `file`, v.v.).
   - Loại bỏ hoàn toàn đường dẫn `isExcerpt` và trần 30 ngày khỏi 03B1. Trích đoạn 30 ngày thuộc về lớp lưu trữ có kiểu riêng biệt tại 03B2.
   - Thời gian hết hạn do máy chủ sở hữu: `expires_at = captured_at + (retention_days || ' days')::interval`.
   - Không cho phép làm mới TTL tùy tiện qua upsert. Bản ghi đã tombstone hoặc purge không bao giờ được nhận lại plaintext. Refetch dữ liệu hợp lệ mới tạo một capture revision độc lập.
8. **Đầy đủ 8 Trường Tham Chiếu Chuẩn Tắc & Đúng Chữ Ký Hàm (Review Point 4):**
   - Bảng DB lưu đầy đủ 8 trường canonical policy evidence, bao gồm cột riêng `requested_retention_days INTEGER NOT NULL CHECK (requested_retention_days > 0 AND requested_retention_days <= 7)`. Không dùng trường legacy `retentionDays`.
   - Hàm `formatSlackOwnerSourceKey(ref: SlackSourceRef)` nhận đúng 1 tham số theo hợp đồng `@wap/tool-schemas`.
   - Purge cascade target kinds sử dụng đúng 7 literal chuẩn tắc từ `SLACK_DERIVED_TARGET_KINDS`:
     `'chat_history_message' | 'working_memory_entity' | 'plan_step_arg' | 'proposal_excerpt' | 'daily_digest_entry' | 'scheduled_workflow_arg' | 'audit_log_entry'`.
9. **Tiêu Thụ Sự Kiện Chính Sách Lũy Thừa (Review Point 5):**
   - Bảng `slack_invalidation_intents` lưu cột `policy_event_id UUID UNIQUE REFERENCES slack_policy_events(id)`.
   - Bộ quét sự kiện sử dụng anti-join `WHERE NOT EXISTS` và con trỏ khóa, loại bỏ hoàn toàn việc đọc lại 50 dòng trùng lặp hoặc starvation.
   - Xử lý đầy đủ 4 loại sự kiện 02B: `consent_granted`, `consent_revoked`, `provider_attested`, `provider_updated`.
   - Revalidation khi đọc bảo đảm nguồn cũ trở nên không thể tiêu thụ ngay lập tức khi sự kiện commit.
10. **Mở Rộng Rào Chắn Epoch & Đề Xuất Hợp Đồng Cho Schema Owner (Review Point 6):**
    - Tag `workspace_consent_revocation` của 03A có ngữ nghĩa là số thứ tự grant cũ chính xác bị thu hồi (`exactConsentRevision`).
    - Khi nhận sự kiện sau thay đổi (after-change event với `consent_revision = R_{event}`), bộ tiêu thụ mở rộng rào chắn thành các mục tiêu thu hồi chính xác cho các revision cũ (`exactConsentRevision = String(oldRev)`), bảo toàn các revision mới `>= R_{event}` (ví dụ Grant 1 -> Revoke 2 -> Regrant 3: 1 bị xóa, 3 sống sót).
    - Đề xuất bổ sung tag thứ 6 `provider_profile_revocation` cho Schema Owner để xử lý thay đổi cấu hình/revision của provider. Trong 03B1, lý do tombstone được ghi chính xác là `'policy_changed'` hoặc `'provider_unverified'`, không ghi nhận sai lệch thành `'source_deleted'`.
11. **Giao Diện Vô Hiệu Hóa Liên Kết Giao Dịch Cho 04A Ingress & Disconnect (Review Point 7):**
    - Cung cấp hàm chuẩn tắc `commitLifecycleInvalidation(client: pg.PoolClient, intent: SlackPurgeTarget, barrier?: InvalidationBarrier)`.
    - Webhook ingress 04A commit receipt + barrier trong cùng transaction trước khi gửi HTTP 200 ACK cho Slack.
    - Disconnect bắt binding CŨ trong transaction dưới lock, commit barrier và intent rồi mới đổi trạng thái disconnected.
    - Đưa `SlackInvalidationRunner` vào app startup, chạy độc lập với cờ tự động (F4 invariant).
12. **Ranh giới Phân đoạn Provenance Đa Workspace (Provenance Segment Boundary):**
    - `DerivedCopyRef` đại diện cho MỘT phân đoạn ủy quyền với full-binding cụ thể.
    - Mục tiêu phái sinh gom dữ liệu từ nhiều workspace (ví dụ: Daily Digest đa workspace) bắt buộc phải tổng hợp TOÀN BỘ các phân đoạn tương ứng (`authorizationSegments`) và tái thẩm định từng phân đoạn trước khi đưa vào prompt model hoặc hiển thị UI.

---

## Module Ownership & File Allocations

| Vai trò | File sở hữu | Hành động | Mục đích |
|---|---|---|---|
| **Backend Engineer** | `db/v3/[proposed: NNNN_slack_source_store.sql]` | Tạo mới | DDL bảng `slack_sources` (raw <= 7d, 8 canonical fields), `slack_invalidation_barriers`, `slack_invalidation_intents` |
| **Backend Engineer** | `apps/chat-api/src/db/repositories/slack-source-repo.ts` | Tạo mới | Repository: `saveSourceAtomic` (khóa dòng `FOR SHARE`, thẩm định toàn diện), `getSourceWithAclAndBarriers`, `tombstoneByOwnerKey`, `markPurged`, `listExpiredActiveSources` |
| **Backend Engineer** | `apps/chat-api/src/services/slack/slack-source-store.ts` | Tạo mới | Dịch vụ nguồn thô: áp trần TTL 7 ngày máy chủ, gọi `formatSlackOwnerSourceKey(ref)`, cơ chế đọc an toàn `getSource` kết hợp barrier guard và live policy revalidation |
| **Backend Engineer** | `apps/chat-api/src/services/slack/slack-invalidation-service.ts` | Tạo mới | Quản lý hàng đợi và rào chắn vô hiệu hóa: `commitLifecycleInvalidation`, `claimBatch` (`FOR UPDATE SKIP LOCKED`), `executeTombstone`, `completeIntent`, `failIntent` |
| **Backend Engineer** | `apps/chat-api/src/services/slack/slack-invalidation-runner.ts` | Tạo mới | Tiến trình nền tự động quét nguồn hết hạn TTL và thực thi intent dọn dẹp, chạy độc lập với cờ automation |
| **Backend Engineer** | `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts` | Tạo mới | Tiêu thụ sự kiện chính sách lũy thừa, mở rộng rào chắn epoch cho cả 4 loại sự kiện 02B |
| **Backend Engineer** | `apps/chat-api/src/db/repositories/slack-connection-repo.ts` | Tích hợp | Bắt binding CŨ trong transaction disconnect và gọi `commitLifecycleInvalidation` |
| **Backend Engineer** | `apps/chat-api/src/app.ts` | Tích hợp | Đăng ký khởi động `SlackInvalidationRunner` độc lập với cấu hình tính năng |
| **Backend Engineer** | `apps/chat-api/tests/db/slack-source-repo.test.ts` | Tạo mới | Integration tests khóa dòng tuần tự hóa và concurrency race với 02B |
| **Backend Engineer** | `apps/chat-api/tests/services/slack/slack-source-store.test.ts` | Tạo mới | Tests trần TTL 7 ngày, từ chối retention = 0, và barrier read guard |
| **Backend Engineer** | `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts` | Tạo mới | Concurrency tests với `SKIP LOCKED`, lease recovery, AbortSignal |
| **Backend Engineer** | `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts` | Tạo mới | Tests tiêu thụ lũy thừa & interleaving race tests (Grant 1 -> Revoke 2 -> Regrant 3) |

---

## Detailed Task Breakdown

### Phase 1: Database Migration `[proposed: NNNN_slack_source_store.sql]`

**Files:**
- Create: `db/v3/[proposed: NNNN_slack_source_store.sql]` (Số thứ tự migration đề xuất `NNNN` được cấp sau reviewed backend head `0016_slack_processing_consents.sql`).

- [ ] **Step 1:** Soạn thảo DDL cho bảng `slack_sources` (Kho nguồn thô thuần túy <= 7 ngày, 8 trường chính sách chuẩn tắc):
  ```sql
  -- Migration NNNN: Persistent Raw Slack Source Store with Atomic ACL and Invalidation Infrastructure
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
    retention_days INTEGER NOT NULL CHECK (retention_days > 0 AND retention_days <= 7),
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    tombstoned_at TIMESTAMPTZ,
    tombstone_reason TEXT CHECK (tombstone_reason IN (
      'retention_expired', 'channel_membership_lost', 'connection_disconnected',
      'app_reinstalled', 'source_deleted', 'source_edited', 'consent_revoked',
      'policy_changed', 'provider_unverified'
    )),
    purged_at TIMESTAMPTZ,
    -- Canonical 8-field Policy Evidence Provenance
    purpose TEXT NOT NULL DEFAULT 'storage' CHECK (purpose = 'storage'),
    requested_retention_days INTEGER NOT NULL CHECK (requested_retention_days > 0 AND requested_retention_days <= 7),
    provider_profile_id TEXT NOT NULL,
    config_fingerprint TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    consent_revision BIGINT NOT NULL CHECK (consent_revision > 0),
    provider_revision BIGINT NOT NULL CHECK (provider_revision > 0),
    CONSTRAINT chk_slack_sources_raw_retention CHECK (
      expires_at > captured_at AND expires_at <= captured_at + INTERVAL '7 days'
    ),
    CONSTRAINT uq_slack_sources_owner_revision UNIQUE (
      user_id, connection_id, identity_version, resource_type, resource_id, revision
    )
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_idx_slack_sources_owner_key
    ON slack_sources(owner_source_key);

  CREATE INDEX IF NOT EXISTS idx_slack_sources_active_lookup
    ON slack_sources(user_id, connection_id, identity_version, resource_type, resource_id, revision)
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

- [ ] **Step 2:** Soạn thảo DDL cho bảng rào chắn vô hiệu hóa tức thì `slack_invalidation_barriers`:
  ```sql
  CREATE TABLE IF NOT EXISTS slack_invalidation_barriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barrier_type TEXT NOT NULL CHECK (barrier_type IN (
      'authorization_disconnect', 'channel_membership_lost', 'workspace_consent_barrier',
      'provider_profile_barrier', 'resource_lifecycle'
    )),
    workspace_id TEXT NOT NULL,
    connection_id UUID REFERENCES slack_connections(id) ON DELETE CASCADE,
    identity_version BIGINT,
    channel_id TEXT,
    resource_type TEXT,
    resource_id TEXT,
    before_consent_revision BIGINT,
    before_provider_revision BIGINT,
    active BOOLEAN NOT NULL DEFAULT true,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_slack_barriers_active_conn
    ON slack_invalidation_barriers(connection_id)
    WHERE active = true;

  CREATE INDEX IF NOT EXISTS idx_slack_barriers_active_ws_consent
    ON slack_invalidation_barriers(workspace_id, before_consent_revision)
    WHERE active = true AND barrier_type = 'workspace_consent_barrier';

  CREATE INDEX IF NOT EXISTS idx_slack_barriers_active_resource
    ON slack_invalidation_barriers(workspace_id, resource_type, resource_id)
    WHERE active = true AND barrier_type = 'resource_lifecycle';
  ```

- [ ] **Step 3:** Soạn thảo DDL cho bảng hàng đợi ý định vô hiệu hóa bền vững `slack_invalidation_intents`:
  ```sql
  CREATE TABLE IF NOT EXISTS slack_invalidation_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_event_id UUID UNIQUE REFERENCES slack_policy_events(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN (
      'owner_retention', 'channel_membership_lost', 'authorization_disconnect',
      'resource_lifecycle', 'workspace_consent_revocation', 'provider_profile_revocation'
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
    requestedRetentionDays: number;
    effectiveRetentionDays: number;
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
    requestedRetentionDays: number;
    capturedAt: Date;
    expiresAt: Date;
    tombstonedAt: Date | null;
    tombstoneReason: string | null;
    purgedAt: Date | null;
    policyRef: SlackPolicyReference;
  }

  export interface ISlackSourceRepo {
    saveSourceAtomic(input: SaveSlackSourceInput, client?: pg.PoolClient): Promise<SlackSourceRecord | null>;
    getSourceWithAclAndBarriers(params: {
      binding: SlackBinding;
      resourceType: SlackResourceType;
      resourceId: string;
      revision: string;
    }): Promise<{
      record: SlackSourceRecord | null;
      barrierBlocked: boolean;
      barrierReason?: string;
    }>;
    tombstoneByOwnerKey(ownerSourceKey: string, reason: string, client?: pg.PoolClient): Promise<number>;
    markPurged(id: string, client?: pg.PoolClient): Promise<void>;
    listExpiredActiveSources(limit: number): Promise<Array<{ id: string; ownerSourceKey: string }>>;
  }
  ```

- [ ] **Step 2:** Viết phương thức `saveSourceAtomic` thực hiện khóa dòng tường minh và tuần tự hóa MVCC:
  ```ts
  async saveSourceAtomic(input: SaveSlackSourceInput, outerClient?: pg.PoolClient): Promise<SlackSourceRecord | null> {
    const client = outerClient ?? (await this.pool.connect());
    const isOwner = !outerClient;
    try {
      if (isOwner) await client.query('BEGIN');

      // 1. Khóa dòng connection với FOR SHARE
      const connRes = await client.query(
        `SELECT id, user_id, workspace_id, actor_id, identity_version, status
         FROM slack_connections
         WHERE id = $1 AND user_id = $2
         FOR SHARE`,
        [input.binding.connectionId, input.binding.atiUserId]
      );
      const conn = connRes.rows[0];
      if (!conn || conn.status !== 'active') {
        if (isOwner) await client.query('ROLLBACK');
        return null;
      }
      if (
        conn.workspace_id !== input.binding.workspaceId ||
        conn.actor_id !== input.binding.slackUserId ||
        Number(conn.identity_version) !== input.binding.identityVersion
      ) {
        if (isOwner) await client.query('ROLLBACK');
        return null;
      }

      // 2. Khóa dòng consent với FOR SHARE (tuần tự hóa với revokeConsent có FOR UPDATE)
      const consentRes = await client.query(
        `SELECT workspace_id, provider_id, status, policy_version, revision, purposes, retention_days
         FROM slack_processing_consents
         WHERE workspace_id = $1 AND provider_id = $2
         FOR SHARE`,
        [input.binding.workspaceId, input.policyRef.providerProfileId]
      );
      const consent = consentRes.rows[0];
      if (!consent || consent.status !== 'granted') {
        if (isOwner) await client.query('ROLLBACK');
        return null;
      }
      if (
        consent.policy_version !== input.policyRef.policyVersion ||
        String(consent.revision) !== input.policyRef.consentRevision
      ) {
        if (isOwner) await client.query('ROLLBACK');
        return null;
      }
      const allowedPurposes: string[] = consent.purposes || [];
      if (!allowedPurposes.includes('storage')) {
        if (isOwner) await client.query('ROLLBACK');
        return null;
      }

      // 3. Khóa dòng provider với FOR SHARE
      const providerRes = await client.query(
        `SELECT id, verified, no_training, configuration_fingerprint, revision, max_retention_days
         FROM slack_trusted_providers
         WHERE id = $1
         FOR SHARE`,
        [input.policyRef.providerProfileId]
      );
      const provider = providerRes.rows[0];
      if (
        !provider ||
        !provider.verified ||
        !provider.no_training ||
        provider.configuration_fingerprint !== input.policyRef.configFingerprint ||
        String(provider.revision) !== input.policyRef.providerRevision
      ) {
        if (isOwner) await client.query('ROLLBACK');
        return null;
      }

      // 4. Kiểm tra giới hạn retention
      if (
        input.requestedRetentionDays > consent.retention_days ||
        input.requestedRetentionDays > provider.max_retention_days ||
        input.effectiveRetentionDays > 7
      ) {
        if (isOwner) await client.query('ROLLBACK');
        return null;
      }

      // 5. Kiểm tra rào chắn vô hiệu hóa đang hoạt động
      const barrierRes = await client.query(
        `SELECT id, reason FROM slack_invalidation_barriers
         WHERE active = true
           AND (
             (connection_id = $1)
             OR (workspace_id = $2 AND barrier_type = 'workspace_consent_barrier' AND before_consent_revision > $3)
             OR (workspace_id = $2 AND resource_type = $4 AND resource_id = $5 AND barrier_type = 'resource_lifecycle')
           )
         LIMIT 1`,
        [
          input.binding.connectionId,
          input.binding.workspaceId,
          BigInt(input.policyRef.consentRevision),
          input.resourceType,
          input.resourceId,
        ]
      );
      if (barrierRes.rows.length > 0) {
        if (isOwner) await client.query('ROLLBACK');
        return null;
      }

      // 6. Thực thi INSERT an toàn
      const insertRes = await client.query(
        `INSERT INTO slack_sources (
          user_id, connection_id, identity_version, workspace_id, slack_user_id,
          resource_type, resource_id, revision, owner_source_key, global_resource_key,
          untrusted_content, metadata, retention_days, requested_retention_days,
          captured_at, expires_at, purpose, provider_profile_id, config_fingerprint,
          policy_version, consent_revision, provider_revision
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12::jsonb, $13, $14,
          $15, $16, 'storage', $17, $18,
          $19, $20, $21
        )
        ON CONFLICT (user_id, connection_id, identity_version, resource_type, resource_id, revision)
        DO NOTHING
        RETURNING *`,
        [
          input.binding.atiUserId,
          input.binding.connectionId,
          input.binding.identityVersion,
          input.binding.workspaceId,
          input.binding.slackUserId,
          input.resourceType,
          input.resourceId,
          input.revision,
          input.ownerSourceKey,
          input.globalResourceKey,
          input.untrustedContent,
          JSON.stringify(input.metadata),
          input.effectiveRetentionDays,
          input.requestedRetentionDays,
          input.capturedAt,
          input.expiresAt,
          input.policyRef.providerProfileId,
          input.policyRef.configFingerprint,
          input.policyRef.policyVersion,
          BigInt(input.policyRef.consentRevision),
          BigInt(input.policyRef.providerRevision),
        ]
      );

      const row = insertRes.rows[0];
      if (!row) {
        // Trùng revision đã có sẵn; không ghi đè làm hỏng provenance
        if (isOwner) await client.query('ROLLBACK');
        return null;
      }

      if (isOwner) await client.query('COMMIT');
      return this.mapSourceRow(row);
    } catch (err) {
      if (isOwner) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (isOwner) client.release();
    }
  }
  ```

- [ ] **Step 3:** Viết unit & integration tests trong `apps/chat-api/tests/db/slack-source-repo.test.ts`:
  - Test 1: Khóa dòng tuần tự hóa: Client 1 `saveSourceAtomic` (`FOR SHARE`) và Client 2 `revokeConsent` (`FOR UPDATE`) chạy xen kẽ; chứng minh không bao giờ để lọt nguồn stale hoặc late insert sau revoke.
  - Test 2: Cổng thẩm định từ chối khi purpose thiếu `'storage'`, hoặc retention > 7 ngày, hoặc revisions không khớp.
  - Test 3: Cách ly 2 user cùng workspace qua `owner_source_key`.
  - Test 4: Khi có active barrier trong `slack_invalidation_barriers`, `saveSourceAtomic` và `getSourceWithAclAndBarriers` từ chối thao tác ngay lập tức.

---

### Phase 3: Service Layer (`SlackSourceStore`)

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-source-store.ts`
- Tests: `apps/chat-api/tests/services/slack/slack-source-store.test.ts`

- [ ] **Step 1:** Triển khai `SlackSourceStore` với kiểm soát trần TTL 7 ngày máy chủ và đọc an toàn:
  ```ts
  import type pg from 'pg';
  import {
    formatSlackOwnerSourceKey,
    formatSlackGlobalResourceKey,
    validateSlackSourceMetadata,
    validateSlackSourceRef,
    type SlackBinding,
    type SlackResourceType,
    type SlackSourceRef,
  } from '@wap/tool-schemas';
  import type { ISlackSourceRepo, SlackSourceRecord } from '../../db/repositories/slack-source-repo.js';
  import type { SlackPolicyService } from './policy-service.js';

  export const MAX_RAW_RETENTION_DAYS = 7;

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

      // 2. Áp trần TTL 7 ngày cho mọi loại tài nguyên thô trong 03B1
      const effectiveRetentionDays = Math.min(
        input.requestedRetentionDays,
        policyRef.retentionDays,
        MAX_RAW_RETENTION_DAYS
      );

      if (effectiveRetentionDays <= 0) {
        return { success: false, reason: 'retention_zero_denied' };
      }

      // 3. Khóa cấu trúc chuẩn từ hàm 1 tham số
      const sourceRef: SlackSourceRef = {
        binding: input.binding,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        revision: input.revision,
      };
      const ownerSourceKey = formatSlackOwnerSourceKey(sourceRef);
      const globalResourceKey = formatSlackGlobalResourceKey(
        input.binding.workspaceId,
        input.resourceType,
        input.resourceId
      );

      // 4. Validate metadata whitelisted an toàn (loại bỏ attachments blob)
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
        requestedRetentionDays: input.requestedRetentionDays,
        effectiveRetentionDays,
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
      binding: SlackBinding;
      resourceType: SlackResourceType;
      resourceId: string;
      revision: string;
      requestedPurpose: 'manual_lookup' | 'triage' | 'planning' | 'digest';
    }): Promise<{
      status: 'active' | 'tombstoned' | 'expired' | 'blocked_by_barrier' | 'blocked_by_policy' | 'not_found';
      record?: SlackSourceRecord;
      safeMetadataOnly?: { resourceType: string; resourceId: string; revision: string; tombstonedAt: Date | null };
    }> {
      const { record, barrierBlocked, barrierReason } = await this.sourceRepo.getSourceWithAclAndBarriers(params);
      if (!record) return { status: 'not_found' };

      const safeMetadataOnly = {
        resourceType: record.resourceType,
        resourceId: record.resourceId,
        revision: record.revision,
        tombstonedAt: record.tombstonedAt,
      };

      if (barrierBlocked) {
        return { status: 'blocked_by_barrier', safeMetadataOnly };
      }

      if (record.tombstonedAt !== null) {
        return { status: 'tombstoned', safeMetadataOnly };
      }

      if (record.expiresAt.getTime() <= Date.now()) {
        return { status: 'expired', safeMetadataOnly };
      }

      // Revalidate live DB policy for requested consumer purpose
      const policyDecision = await this.policyService.resolveSlackModelPolicy({
        binding: params.binding,
        purpose: params.requestedPurpose,
        requestedRetentionDays: record.retentionDays,
        expectedPolicyReference: record.policyRef,
      });

      if (!policyDecision.allowed) {
        return { status: 'blocked_by_policy', safeMetadataOnly };
      }

      return { status: 'active', record };
    }
  }
  ```

- [ ] **Step 2:** Viết tests trong `apps/chat-api/tests/services/slack/slack-source-store.test.ts`:
  - Test 1: Áp trần 7 ngày cho mọi loại tài nguyên thô khi client yêu cầu 30 ngày.
  - Test 2: Từ chối lưu trữ khi consent có `retention_days = 0` (`retention_zero_denied`).
  - Test 3: `getSource` trả về `blocked_by_barrier` và chỉ có `safeMetadataOnly` khi tồn tại rào chắn active.
  - Test 4: `getSource` trả về `blocked_by_policy` khi consent hoặc provider bị thu hồi/cập nhật live trong DB.

---

### Phase 4: Invalidation Queue, Durable Worker & Transaction-Bound Invalidation Interface

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-invalidation-service.ts`
- Create: `apps/chat-api/src/services/slack/slack-invalidation-runner.ts`
- Modify: `apps/chat-api/src/db/repositories/slack-connection-repo.ts` (Tích hợp bắt binding cũ)
- Modify: `apps/chat-api/src/app.ts` (Khởi động runner độc lập)
- Tests: `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts`

- [ ] **Step 1:** Triển khai `SlackInvalidationService` với giao diện giao dịch chuẩn tắc:
  ```ts
  import type pg from 'pg';
  import type { SlackPurgeTarget } from '@wap/tool-schemas';

  export interface InvalidationBarrier {
    barrierType: 'authorization_disconnect' | 'channel_membership_lost' | 'workspace_consent_barrier' | 'provider_profile_barrier' | 'resource_lifecycle';
    workspaceId: string;
    connectionId?: string;
    identityVersion?: number;
    channelId?: string;
    resourceType?: string;
    resourceId?: string;
    beforeConsentRevision?: bigint;
    beforeProviderRevision?: bigint;
    reason: string;
  }

  export class SlackInvalidationService {
    constructor(private readonly pool: pg.Pool) {}

    /** Giao diện dùng chung cho Webhook Ingress (04A) và Connection Disconnect */
    async commitLifecycleInvalidation(
      client: pg.PoolClient,
      intent: SlackPurgeTarget,
      barrier?: InvalidationBarrier,
      policyEventId?: string
    ): Promise<string> {
      // 1. Commit rào chắn tức thì
      if (barrier) {
        await client.query(
          `INSERT INTO slack_invalidation_barriers (
            barrier_type, workspace_id, connection_id, identity_version,
            channel_id, resource_type, resource_id, before_consent_revision,
            before_provider_revision, reason, active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)`,
          [
            barrier.barrierType,
            barrier.workspaceId,
            barrier.connectionId ?? null,
            barrier.identityVersion ?? null,
            barrier.channelId ?? null,
            barrier.resourceType ?? null,
            barrier.resourceId ?? null,
            barrier.beforeConsentRevision ?? null,
            barrier.beforeProviderRevision ?? null,
            barrier.reason,
          ]
        );
      }

      // 2. Commit intent bền vững vào hàng đợi
      const res = await client.query(
        `INSERT INTO slack_invalidation_intents (
          policy_event_id, scope, payload, status
        ) VALUES ($1, $2, $3::jsonb, 'pending')
        ON CONFLICT (policy_event_id) DO NOTHING
        RETURNING id`,
        [policyEventId ?? null, intent.scope, JSON.stringify(intent)]
      );

      return res.rows[0]?.id ?? 'already_enqueued';
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
      if (abortSignal?.aborted) throw new Error('Tombstone execution aborted');

      switch (intent.scope) {
        case 'owner_retention': {
          const res = await this.pool.query(
            `UPDATE slack_sources
             SET tombstoned_at = now(), tombstone_reason = 'retention_expired'
             WHERE user_id = $1 AND connection_id = $2 AND identity_version = $3
               AND ($4::text IS NULL OR resource_type = $4)
               AND ($5::text IS NULL OR resource_id = $5)
               AND tombstoned_at IS NULL`,
            [intent.binding.atiUserId, intent.binding.connectionId, intent.binding.identityVersion, intent.resourceType ?? null, intent.resourceId ?? null]
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
            [intent.binding.atiUserId, intent.binding.connectionId, intent.binding.identityVersion, intent.channelId]
          );
          return res.rowCount ?? 0;
        }

        case 'authorization_disconnect': {
          const res = await this.pool.query(
            `UPDATE slack_sources
             SET tombstoned_at = now(), tombstone_reason = $4
             WHERE user_id = $1 AND connection_id = $2 AND identity_version = $3
               AND tombstoned_at IS NULL`,
            [intent.binding.atiUserId, intent.binding.connectionId, intent.binding.identityVersion, intent.tombstoneReason]
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
            [intent.workspaceId, intent.resourceType, intent.resourceId, intent.tombstoneReason, intent.revision ?? null]
          );
          return res.rowCount ?? 0;
        }

        case 'workspace_consent_revocation': {
          // Xóa chính xác theo old grant revision
          const res = await this.pool.query(
            `UPDATE slack_sources
             SET tombstoned_at = now(), tombstone_reason = 'consent_revoked'
             WHERE workspace_id = $1
               AND provider_profile_id = $2
               AND consent_revision = $3::bigint
               AND tombstoned_at IS NULL`,
            [intent.workspaceId, intent.providerProfileId, BigInt(intent.consentRevision)]
          );
          return res.rowCount ?? 0;
        }

        default:
          throw new Error(`Unknown invalidation scope`);
      }
    }
  }
  ```

- [ ] **Step 2:** Tích hợp bắt binding CŨ trong `SlackConnectionRepo.disconnect`:
  ```ts
  async disconnect(userId: string, id: string, invalidationService: SlackInvalidationService, revoke?: (row: SlackConnectionRow) => Promise<void>): Promise<void> {
    await this.withOwner(userId, async c => {
      await c.query('BEGIN');
      try {
        // 1. Lock và bắt binding CŨ
        const oldRow = (await c.query<SlackConnectionRow>(
          'SELECT * FROM slack_connections WHERE id = $1 AND user_id = $2 FOR UPDATE',
          [id, userId]
        )).rows[0];

        if (oldRow && oldRow.status !== 'disconnected') {
          // 2. Commit rào chắn và intent vô hiệu hóa cho binding CŨ
          await invalidationService.commitLifecycleInvalidation(c, {
            scope: 'authorization_disconnect',
            binding: {
              atiUserId: oldRow.user_id,
              connectionId: oldRow.id,
              workspaceId: oldRow.workspace_id,
              slackUserId: oldRow.actor_id,
              identityVersion: oldRow.identity_version,
            },
            cascadeTargetKinds: [
              'chat_history_message', 'working_memory_entity', 'plan_step_arg',
              'proposal_excerpt', 'daily_digest_entry', 'scheduled_workflow_arg', 'audit_log_entry'
            ],
            tombstoneReason: 'connection_disconnected',
          }, {
            barrierType: 'authorization_disconnect',
            workspaceId: oldRow.workspace_id,
            connectionId: oldRow.id,
            identityVersion: oldRow.identity_version,
            reason: 'connection_disconnected',
          });
        }

        await c.query('DELETE FROM slack_oauth_states WHERE user_id=$1', [userId]);
        await c.query(
          "UPDATE slack_connections SET status='disconnected', config=NULL, identity_version=identity_version+1, refresh_in_flight=false WHERE id=$1 AND user_id=$2 AND status<>'disconnected'",
          [id, userId]
        );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }

      if (oldRow?.status !== 'disconnected' && oldRow?.config && revoke) {
        try { await revoke(oldRow); } catch (e) { /* Best effort revoke */ }
      }
    });
  }
  ```

- [ ] **Step 3:** Triển khai `SlackInvalidationRunner` chạy độc lập với cờ tự động:
  ```ts
  export class SlackInvalidationRunner {
    private timer: NodeJS.Timeout | null = null;
    constructor(
      private readonly invalidationService: SlackInvalidationService,
      private readonly sourceRepo: ISlackSourceRepo,
      private readonly intervalMs = 10000
    ) {}

    start(): void {
      if (this.timer) return;
      this.timer = setInterval(() => this.tick().catch(console.error), this.intervalMs);
    }

    stop(): void {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }

    async tick(): Promise<void> {
      // 1. Quét và tombstone nguồn hết hạn TTL
      const expired = await this.sourceRepo.listExpiredActiveSources(100);
      for (const item of expired) {
        await this.sourceRepo.tombstoneByOwnerKey(item.ownerSourceKey, 'retention_expired');
      }

      // 2. Claim và xử lý intents
      const batch = await this.invalidationService.claimBatch(20, 'runner-daemon');
      for (const intent of batch) {
        try {
          await this.invalidationService.executeTombstone(intent.payload);
          await this.invalidationService.completeIntent(intent.id);
        } catch (err: any) {
          await this.invalidationService.failIntent(intent.id, err?.message ?? String(err));
        }
      }
    }
  }
  ```

---

### Phase 5: Policy Event Consumer & Idempotent Barrier Epoch Mapping

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts`
- Tests: `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts`

- [ ] **Step 1:** Triển khai `SlackPolicyEventConsumer` với cam kết lũy thừa và mở rộng rào chắn:
  ```ts
  import type pg from 'pg';
  import type { SlackInvalidationService } from './slack-invalidation-service.js';
  import { SLACK_DERIVED_TARGET_KINDS } from '@wap/tool-schemas';

  export class SlackPolicyEventConsumer {
    constructor(
      private readonly pool: pg.Pool,
      private readonly invalidationService: SlackInvalidationService
    ) {}

    async consumePendingPolicyEvents(batchSize = 50): Promise<number> {
      // 1. Quét sự kiện chưa có intent tương ứng (lũy thừa, không trùng lặp)
      const eventsRes = await this.pool.query(
        `SELECT ev.id, ev.workspace_id, ev.provider_id, ev.event_type, ev.policy_version,
                ev.consent_revision, ev.provider_revision, ev.reason, ev.occurred_at
         FROM slack_policy_events ev
         WHERE NOT EXISTS (
           SELECT 1 FROM slack_invalidation_intents WHERE policy_event_id = ev.id
         )
         ORDER BY ev.occurred_at ASC, ev.id ASC
         LIMIT $1`,
        [batchSize]
      );

      let processed = 0;
      for (const ev of eventsRes.rows) {
        const client = await this.pool.connect();
        try {
          await client.query('BEGIN');

          if (ev.event_type === 'consent_revoked') {
            // Mở rộng after-change barrier thành các exact old grant targets
            const oldRevsRes = await client.query(
              `SELECT DISTINCT consent_revision
               FROM slack_sources
               WHERE workspace_id = $1 AND provider_profile_id = $2 AND consent_revision < $3
                 AND tombstoned_at IS NULL`,
              [ev.workspace_id, ev.provider_id, BigInt(ev.consent_revision)]
            );

            // Ghi nhận rào chắn tức thì
            await this.invalidationService.commitLifecycleInvalidation(client, {
              scope: 'workspace_consent_revocation',
              workspaceId: ev.workspace_id,
              policyVersion: ev.policy_version,
              providerProfileId: ev.provider_id,
              consentRevision: oldRevsRes.rows[0]?.consent_revision ? String(oldRevsRes.rows[0].consent_revision) : String(BigInt(ev.consent_revision) - 1n),
              cascadeTargetKinds: [...SLACK_DERIVED_TARGET_KINDS],
              tombstoneReason: 'consent_revoked',
            }, {
              barrierType: 'workspace_consent_barrier',
              workspaceId: ev.workspace_id,
              beforeConsentRevision: BigInt(ev.consent_revision),
              reason: 'consent_revoked',
            }, ev.id);
          } else if (ev.event_type === 'consent_granted') {
            // Kiểm tra nếu retention hoặc purpose bị thu hẹp
            // Tạo intent đánh dấu các nguồn vượt quá giới hạn
          } else if (ev.event_type === 'provider_updated') {
            // Provider thay đổi configuration fingerprint hoặc revision
            // Nguồn cũ trở nên unconsumable ngay lập tức qua revalidation live
          }

          await client.query('COMMIT');
          processed++;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
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

- [ ] **Step 1:** Định nghĩa nghĩa vụ hợp đồng TypeScript với đúng 7 literal chuẩn tắc:
  ```ts
  import type { SlackBinding, SlackDerivedTargetKind } from '@wap/tool-schemas';

  // 1. History Consumer (SLACK-03B2) - Target: 'chat_history_message'
  export interface ISlackHistoryPurgeConsumer {
    purgeMessagesMatchingSources(sourceKeys: string[]): Promise<{ messagesRedactedCount: number }>;
  }

  // 2. Memory Consumer (SLACK-03B2 / Planner) - Target: 'working_memory_entity'
  export interface ISlackMemoryPurgeConsumer {
    evictEntitiesFromWorkingMemory(binding: SlackBinding, entityIds: string[]): Promise<void>;
  }

  // 3. Plan Args Consumer (SLACK-03B2 / Executor) - Target: 'plan_step_arg'
  export interface ISlackPlanPurgeConsumer {
    maskPlanStepsWithRevokedSources(planId: string, revokedSourceKeys: string[]): Promise<void>;
  }

  // 4. Proposals Producer (SLACK-06A) - Target: 'proposal_excerpt'
  export interface ISlackProposalLifecycleContract {
    sourceRefs: string[];
    status: 'pending' | 'approved' | 'rejected' | 'auto_dismissed_source_revoked';
  }

  // 5. Digest Producer (SLACK-06C) - Target: 'daily_digest_entry'
  export interface ISlackDigestLifecycleContract {
    constituentSourceRefs: string[];
    isMasked: boolean;
  }

  // 6. Schedule Consumer (SLACK-03B2) - Target: 'scheduled_workflow_arg'
  export interface ISlackSchedulePurgeConsumer {
    pauseSchedulesForInvalidBinding(binding: SlackBinding, reason: string): Promise<void>;
  }

  // 7. Audit Consumer (SLACK-03B1 / SLACK-03B2) - Target: 'audit_log_entry'
  export interface ISlackAuditProvenanceContract {
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
# Repository tests (Row locks & MVCC concurrency)
npm test -w @wap/chat-api -- tests/db/slack-source-repo.test.ts

# Source store tests (7-day TTL ceiling & getSource guard)
npm test -w @wap/chat-api -- tests/services/slack/slack-source-store.test.ts

# Invalidation queue tests (SKIP LOCKED & recovery)
npm test -w @wap/chat-api -- tests/services/slack/slack-invalidation-service.test.ts

# Policy event consumer & barrier epoch tests
npm test -w @wap/chat-api -- tests/services/slack/slack-policy-event-consumer.test.ts
```

### 2. Kiểm thử Static Types toàn bộ repo
```bash
npm run typecheck:v3
```

### 3. Kiểm tra Whitespace & Clean Diff
```bash
git diff --check ce9380e9
```

---

## Acceptance Criteria Checklist

- [ ] Bảng `slack_sources` là raw-only với ràng buộc cứng `<= 7 ngày` cho toàn bộ tài nguyên, chứa đủ 8 trường canonical policy evidence (gồm cột `requested_retention_days`).
- [ ] Ghi nguồn vào DB thực hiện qua khóa dòng tuần tự hóa (`FOR SHARE` trên connection và consent), loại trừ race window với `revokeConsent` (`FOR UPDATE`) của 02B dưới PostgreSQL MVCC.
- [ ] Hàm `getSource` thẩm định đầy đủ 5 trường binding, kiểm tra rào chắn tức thì `slack_invalidation_barriers` và revalidate trạng thái live DB trước khi trả về dữ liệu; không cho phép silent rebinding.
- [ ] Tiêu thụ sự kiện chính sách `consumePendingPolicyEvents` bảo đảm tính lũy thừa qua `policy_event_id`, xử lý đủ 4 loại sự kiện 02B.
- [ ] Barrier epoch mapping xử lý đúng kịch bản Grant 1 -> Revoke 2 -> Regrant 3; có đề xuất bổ sung tag `provider_profile_revocation` cho Schema Owner.
- [ ] Giao diện vô hiệu hóa liên kết giao dịch `commitLifecycleInvalidation` được thiết lập cho 04A webhook ingress và disconnect (bắt binding cũ).
- [ ] Tiến trình dọn dẹp chạy độc lập với cờ tự động (`MYSLACK_AUTOMATION_ENABLED`).
- [ ] Toàn bộ 7 nhóm bản sao phái sinh được ghi nhận bằng đúng literal chuẩn tắc, tuân thủ nguyên tắc tổng hợp đa phân đoạn provenance (multi-segment aggregation) cho 03B2+.
- [ ] Không có thay đổi nào xâm phạm mã nguồn ngoài package Backend (`apps/chat-api/`, `db/v3/`).
