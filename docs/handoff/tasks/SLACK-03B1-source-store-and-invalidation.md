# SLACK-03B1 · Kho Lưu Trữ Nguồn, Kiểm Soát Truy Cập PostgreSQL & Hàng Đợi Vô Hiệu Hóa Bền Vững

**Trạng thái:** DỰ THẢO KẾ HOẠCH — ĐÃ HOÀN THIỆN ĐẦY ĐỦ THEO ĐÁNH GIÁ ĐỘC LẬP (Sẵn sàng cho Reviewer & Nhóm trưởng duyệt; DOCS ONLY, chưa thực thi code runtime).
**Nhánh công việc dự kiến:** `docs/slack-03b1-source-plan` (PR #196)
**Nền đối chiếu:** `ce9380e9` (từ `integration/slack-personal-20261029`).
**Vai trò sở hữu:** Backend Engineer (sở hữu `apps/chat-api/` và `db/v3/`).
**Phụ thuộc:**
- **SLACK-01** (Foundation contracts `SlackBinding`, `SlackSourceRef`, `SlackModelPolicy`, fixture HTTP, probe offline) — ĐÃ HOÀN TẤT (`fc12e3fb`).
- **SLACK-02A** (`myslack-connection.ts` tại `6871087`) — ĐÃ HOÀN TẤT.
- **SLACK-02R** (Sửa cô lập callback tại PR #190) — ĐÃ HOÀN TẤT & ĐƯỢC CHẤP THUẬN.
- **SLACK-02B (Ứng viên PR #192, commit `4e038967`):** Đã hoàn tất 17 contract cases, `0016_slack_processing_consents.sql`, `SlackPolicyService`, `SlackConsentRepo`, CLI `slack-consent`. Đang ở cổng CI cuối sau khi dọn dẹp khoảng trắng; root fullcheck 3.167 tại `5fb027ef` và 17 cases tại `4e038967` đã pass.
- **SLACK-03A (Ứng viên PR #194, commit `bc8d6b69`):** Schema Owner đã chấp thuận và triển khai scope thứ 6 `policy_epoch_invalidated` cùng `SlackPolicyEpoch`. Đang chờ independent final review.
- **Cổng Xếp Chồng & Triển Khai (Prerequisite Review Gate):** Lập kế hoạch (Planning) tiến hành độc lập; việc thi công mã runtime bắt buộc chờ các giao diện 02B và 03A được chấp thuận (accepted interfaces) và staging base được review. Tuyệt đối không viết mã runtime mới trong phiên planning này.
**Task cha:** [`docs/handoff/tasks/SLACK-03-tool-catalog-and-source-lifecycle.md`](SLACK-03-tool-catalog-and-source-lifecycle.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md`](../../superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md).

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ

Card này thiết lập hạ tầng kho lưu trữ dữ liệu nguồn thô (`slack_sources`), cơ chế kiểm soát truy cập (ACL) tuần tự hóa nghiêm ngặt trên PostgreSQL MVCC (F2), cơ chế tính toán và áp đặt trần thời gian lưu trữ (TTL) do máy chủ quyết định, hàng đợi vô hiệu hóa và thu hồi bền vững (`slack_invalidation_intents`), cùng cơ chế xử lý sự kiện chính sách (policy events consumption) với mở rộng rào chắn epoch chính xác.

### 1.1. Ranh giới Phân tầng Bounded Scope (03B1 vs 03B2/03B3):
1. **Phạm vi của SLACK-03B1 (Card này):**
   - Bảng lưu trữ nguồn thô `slack_sources` chỉ lưu trữ dữ liệu nguồn nguyên bản (raw data), áp đặt trần cứng `<= 7 ngày` cho **MỌI** loại tài nguyên thô (`conversation`, `message`, `file`, v.v.). Loại bỏ hoàn toàn cờ `isExcerpt` khỏi kho nguồn thô; trích đoạn 30 ngày thuộc về lớp lưu trữ có kiểu riêng biệt tại **SLACK-03B2**.
   - Cổng ghi nguyên tử (Atomic Write Gate) kết hợp khóa dòng tường minh theo đúng trật tự chống deadlock (`slack_connections` -> `slack_trusted_providers` -> `slack_processing_consents` FOR SHARE), tuần tự hóa tuyệt đối với các giao dịch `revokeConsent` / `grantConsent` / `attestProvider` của 02B dưới PostgreSQL MVCC; khóa toàn bộ các dòng thẩm quyền để loại trừ race lọt bản ghi insert sau khi revoke.
   - Định danh capture vật lý bất biến bằng UUID (`SlackSourceEntity.id`), phân biệt với khóa tài nguyên nguồn `owner_source_key`. Hỗ trợ recapturing cùng một tin nhắn Slack không đổi nội dung dưới epoch mới (Grant 1 -> Revoke 2 -> Regrant 3) mà không làm sống lại hoặc ghi đè bản ghi cũ đã purge.
   - Bảo toàn provenance epoch thu thập: `saveSource` bắt buộc kiểm tra `sameSlackPolicyEpoch` giữa `acquisitionPolicyRef` từ thao tác đọc và `storagePolicyRef` được cấp; từ chối lưu trữ các quan sát bị trễ từ grant cũ sang grant mới.
   - Cơ chế đọc an toàn `getSource` 2 pha: thẩm định bản ghi dưới mục đích `'storage'`, kiểm tra rào chắn tức thì `slack_invalidation_barriers` (nếu pending hoặc purge-failed thì chặn đọc ngay lập tức), sau đó mới ủy quyền mục đích tiêu thụ riêng biệt của caller với context fresh.
   - Hàng đợi ý định vô hiệu hóa bền vững (`slack_invalidation_intents`) ghi nhận ngay trong cùng transaction với thay đổi kết nối/chính sách/ingress, hỗ trợ phân phối khóa hàng đợi `FOR UPDATE SKIP LOCKED`, gia hạn lease và phục hồi sau sự cố sập tiến trình.
   - Tiêu thụ sự kiện chính sách tổ chức từ 02B (`slack_policy_events`) bảo đảm tính lũy thừa (idempotency) qua bảng biên nhận riêng biệt (`slack_processed_policy_events`), cho phép 1 sự kiện mở rộng thành NHIỀU intents cho các epoch cũ mà không gây starvation, xử lý đầy đủ 4 loại sự kiện và mở rộng rào chắn sau thay đổi thành các mục tiêu thu hồi cũ chính xác mà không làm ảnh hưởng đến các bản ghi được cấp quyền lại (regrant) về sau.
   - Giao diện vô hiệu hóa liên kết giao dịch thống nhất `ISlackInvalidationCoordinator.commitLifecycleInvalidation` cho webhook ingress 04A: cam kết receipt + rào chắn được commit nguyên tử qua cùng `pg.PoolClient`, chặn đọc trước khi gửi HTTP 200 ACK cho Slack.
2. **Không tuyên bố hoàn thành F3 ở 03B1:**
   - Việc tạo bảng và dịch vụ lưu trữ nguồn **KHÔNG ĐỒNG NGHĨA** với việc hoàn tất F3.
   - Toàn bộ cơ chế cascade purge vào các bản sao phái sinh (derived copies) trong lịch sử trò chuyện (`messages`), bộ nhớ làm việc (`working_memory`), tham số kế hoạch (`plan_json`, `execution_steps`), và lịch chạy tự động (`schedules`, `schedule_runs`) là phạm vi yêu cầu tường minh của **SLACK-03B2+**.
   - Cơ chế gắn kết binding và kiểm tra hash trước khi dispatch của Executor thuộc phạm vi **SLACK-03B3**.
   - 03B2 và 03B3 là điều kiện tiên quyết bắt buộc để hoàn tất F3 và kích hoạt công cụ đọc nội dung công khai.

---

## 2. Ranh giới Sở hữu Module & Điểm Tích Hợp (Module Ownership)

Tuân thủ nghiêm ngặt ranh giới tại [`docs/team-workflow.md`](../../team-workflow.md):
- **Backend Engineer sở hữu độc quyền:**
  - `apps/chat-api/src/db/repositories/slack-source-repo.ts` (Tạo mới: Atomic Write Gate với trật tự khóa dòng nhất quán, getSource 2 pha, tombstone, purge)
  - `apps/chat-api/src/services/slack/slack-source-store.ts` (Tạo mới: Dịch vụ lưu trữ nguồn thô, áp trần TTL 7 ngày máy chủ, getSource kết hợp barrier guard và live policy revalidation, kiểm tra acquisition epoch match)
  - `apps/chat-api/src/services/slack/slack-invalidation-service.ts` (Tạo mới: Hàng đợi ý định vô hiệu hóa, rào chắn đọc tức thì, `commitLifecycleInvalidation` cho 04A, claim worker `SKIP LOCKED`, crash recovery)
  - `apps/chat-api/src/services/slack/slack-invalidation-runner.ts` (Tạo mới: Tiến trình nền định kỳ quét expiration & barrier purge, chạy độc lập với cờ automation)
  - `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts` (Tạo mới: Bộ tiêu thụ sự kiện chính sách lũy thừa, mở rộng đa intent cho exact old epochs)
  - `apps/chat-api/src/db/repositories/slack-connection-repo.ts` (Tích hợp: Bắt binding CŨ trong transaction disconnect và ghi nhận ý định vô hiệu hóa)
  - `apps/chat-api/src/app.ts` (Tích hợp: Khởi động runner dọn dẹp nguồn thô độc lập với cờ tính năng)
  - `db/v3/0017_slack_source_store.sql` (Tạo mới: DDL bảng `slack_sources`, `slack_invalidation_barriers`, `slack_processed_policy_events`, `slack_invalidation_intents`)
  - Các file kiểm thử tương ứng tại `apps/chat-api/tests/`
- **Không sửa đổi chéo (Cross-Editing Prohibited):**
  - Không sửa đổi files ngoài package Backend. Giao diện scope thứ 6 `policy_epoch_invalidated` đã được Schema Owner hoàn tất tại `packages/tool-schemas` (`bc8d6b69`).

---

## 3. Điều Tra Thực Tế: 7 Nhóm Bản Sao Dữ Liệu Nguồn & Trách Nhiệm Tiêu Thụ

Đối chiếu trực tiếp mã nguồn và cơ sở dữ liệu hiện hữu (`db/v3/0001_v3_core.sql`, `0010_schedules.sql`, `chat-service.ts`), hệ thống nhận diện chính xác 7 nhóm mục tiêu (Target Kinds) chứa dữ liệu nguồn hoặc bản sao phái sinh theo đúng 7 literal chuẩn tắc từ `SLACK_DERIVED_TARGET_KINDS`:

| Nhóm mục tiêu (`SlackDerivedTargetKind`) | Vị trí lưu trữ hiện hữu trong DB / Bộ nhớ | Bản chất dữ liệu nguồn lưu giữ | Trách nhiệm của bên tiêu thụ (Consumer Obligations) | Bên sở hữu module |
|---|---|---|---|---|
| **1. `chat_history_message`** | Bảng `messages` (`role IN ('user', 'assistant', 'system', 'summary')`, cột `content`, `metadata`) | Trích đoạn tin nhắn, danh sách kênh, kết quả tra cứu Slack được hiển thị cho người dùng | Lưu giữ `sourceRefs` và `policyRef` trong `metadata`. Khi nguồn bị tombstone/purge, consumer phải ẩn/redact toàn bộ khối nội dung không thể bóc tách an toàn | Backend (`apps/chat-api`) |
| **2. `working_memory_entity`** | Bảng `messages` với `metadata->>'type' = 'working_memory'`, cột `metadata->'state'` | Trạng thái bộ nhớ làm việc qua các lượt hội thoại (chứa `__observed` IDs, thread participants, nhãn tin nhắn) | Ghi nhận provenance nguồn vào cấu trúc state. Khi nguồn bị thu hồi, bộ lọc memory của planner phải loại bỏ entity khỏi prompt | AI Planner (`packages/planner`) & Backend |
| **3. `plan_step_arg`** | Bảng `plans` (`plan_json`, `plan_text`) và `execution_steps` (`args_json`, `output_json`) | Tham số các bước thực thi workflow chứa nội dung tin nhắn, ID kênh, dữ liệu Slack | Bắt buộc đối chiếu `sameSlackBinding` và kiểm tra tính hợp lệ của nguồn trước khi dispatch; đánh dấu `skipped`/`purged` nếu nguồn bị vô hiệu | Backend & Executor (`packages/executor`) |
| **4. `proposal_excerpt`** | *Chưa có bảng vật lý* (Kế hoạch SLACK-06A tại `slack_proposals`) | Đề xuất hành động chờ người dùng duyệt trong cockpit | Không viết SQL purge giả tạo cho bảng chưa tồn tại; đặc tả nghĩa vụ schema tương lai: mọi proposal phải mang `sourceRefs` và bị hủy tự động nếu nguồn bị tombstone | Backend & Frontend (SLACK-06) |
| **5. `daily_digest_entry`** | *Chưa có bảng vật lý* (Kế hoạch SLACK-06C tại `slack_digests` / cache) | Bản tin tóm tắt tổng hợp từ nhiều kênh/tin nhắn Slack | Ghi nhận danh sách `sourceRefs` cấu thành; khi 1 nguồn thành phần bị purge do vi phạm chính quyền/consent, toàn bộ digest liên quan phải bị ẩn hoặc tái lập | Backend & AI Planner (SLACK-06) |
| **6. `scheduled_workflow_arg`** | Bảng `schedules` (`request`, `recurrence`, `services`) và `schedule_runs` (`plan_id`, `status`) | Yêu cầu định kỳ có thể trích dẫn nội dung Slack hoặc phụ thuộc kênh Slack | Khi mất quyền kênh (`channel_membership_lost`) hoặc ngắt kết nối, schedule chuyển `paused` kèm `pause_reason = 'slack_binding_invalid'` | Backend (`apps/chat-api/src/services/schedules/`) |
| **7. `audit_log_entry`** | Bảng `execution_steps` (`error_json`, `duration_ms`), audit logs | Nhật ký kiểm toán kỹ thuật và đối soát bảo mật | Nhật ký kiểm toán chỉ lưu metadata an toàn (IDs, timestamp, status), tuyệt đối không lưu nội dung thô PII | Backend (`apps/chat-api`) |

---

## 4. Thiết Kế Kỹ Thuật Chi Tiết (SLACK-03B1)

### 4.1. Thứ Tự Khóa Dòng Chống Deadlock & Khóa Toàn Bộ Authority Rows
- Để tương thích tuyệt đối với các thao tác của 02B (`grantConsent`, `revokeConsent`, `attestProvider`), thứ tự khóa dòng trong toàn hệ thống được chuẩn hóa cố định:
  `slack_connections` -> `slack_trusted_providers` -> `slack_processing_consents`.
- Trong `saveSourceAtomic`:
  1. `SELECT ... FROM slack_connections WHERE id = $1 AND user_id = $2 FOR SHARE`
  2. `SELECT ... FROM slack_trusted_providers WHERE id = $1 FOR SHARE`
  3. `SELECT ... FROM slack_processing_consents WHERE workspace_id = $1 AND provider_id = $2 FOR SHARE`
- Do `grantConsent` khóa provider FOR UPDATE rồi consent FOR UPDATE, thứ tự này hoàn toàn nhất quán và loại trừ deadlock AB-BA.
- Việc khóa FOR SHARE toàn bộ authority rows bảo đảm không xảy ra race lọt bản ghi insert sau khi revoke: Nếu revoke chạy trước, insert đợi và sau đó phát hiện `status = 'revoked'` -> rollback; nếu insert chạy trước, revoke đợi và sau khi commit sẽ phát sinh sự kiện vô hiệu hóa và rào chắn thu hồi nguồn vừa tạo.

### 4.2. Tham Chiếu Chính Sách 8 Trường & Phân Tách Trần TTL Raw <= 7 Ngày
- Lưu trữ đầy đủ 8 trường canonical policy evidence: `binding`, `purpose` (`'storage'`), `requestedRetentionDays`, `providerProfileId`, `configFingerprint`, `policyVersion`, `consentRevision`, `providerRevision`.
- Cột `policy_requested_retention_days INT NOT NULL CHECK (policy_requested_retention_days > 0)` lưu giữ chính xác giá trị đã được ủy quyền (có thể lên tới 30 ngày). Không áp constraint `<= 7` lên trường canonical issued ref.
- Cột `retention_days INT NOT NULL CHECK (retention_days > 0 AND retention_days <= 7 AND retention_days <= policy_requested_retention_days)` và `CONSTRAINT chk_slack_sources_raw_retention CHECK (expires_at > captured_at AND expires_at <= captured_at + INTERVAL '7 days')` áp đặt trần TTL thực tế của máy chủ cho kho nguồn thô.

### 4.3. Định Danh Capture Bất Biến & Recapturing Sau Regrant
- `owner_source_key` (`formatSlackOwnerSourceKey(sourceRef)`) nhận diện tài nguyên nguồn của chủ sở hữu (`[atiUserId, connectionId, workspaceId, slackUserId, identityVersion, resourceType, resourceId, revision]`).
- Khóa chính vật lý là `SlackSourceEntity.id` (UUID). Ràng buộc duy nhất active epoch: `UNIQUE (owner_source_key, policy_epoch_hash) WHERE purged_at IS NULL`.
- Khi người dùng thu hồi consent rồi cấp lại (Grant 1 -> Revoke 2 -> Regrant 3), cùng một tin nhắn Slack có revision không đổi được thu thập hợp lệ thành capture mới mang UUID mới và `policy_epoch_hash` mới mà không xung đột hay ghi đè lên bản ghi cũ đã purge. Tuyệt đối không tự bịa ra Slack revision để phân biệt capture.
- **Bảo toàn Epoch Thu Thập:** `saveSource` nhận `acquisitionPolicyRef` từ thao tác đọc và `storagePolicyRef` được cấp phát. Bắt buộc kiểm tra `sameSlackPolicyEpoch(slackPolicyRefToEpoch(acquisitionPolicyRef), slackPolicyRefToEpoch(storagePolicyRef))`. Quan sát cũ từ Grant 1 không thể lưu trữ dưới Grant 3.
- `getSource` yêu cầu định danh capture vật lý (`expectedCaptureId`) hoặc `(sourceRef, expectedPolicyEpoch)`. Cấm tái liên kết mù vào latest capture.

### 4.4. Cơ Chế Đọc Nguồn An Toàn 2 Pha (Dual Purpose Validation)
- Pha 1: Thẩm định bản ghi lưu trữ với mục đích `'storage'`, kiểm tra TTL và tra cứu `slack_invalidation_barriers`. Nếu có barrier pending hoặc purge thất bại -> chặn đọc ngay lập tức (`status: 'blocked_by_invalidation_barrier'`).
- Pha 2: Ủy quyền mục đích tiêu thụ riêng biệt của caller (ví dụ `'triage'`) qua `resolveSlackModelPolicy` với fresh consumer context. Không truyền storage ref làm expected ref cho consumer purpose và không dán nhãn lại `policyRef.purpose`.
- Kiểm tra post-await trước khi trả plaintext để chặn race rào chắn commit trong khi đang await I/O.

### 4.5. Hàng Đợi Ý Định Vô Hiệu Hóa Bền Vững & Mở Rộng Đa Intent
- Bảng biên nhận `slack_processed_policy_events (event_id UUID PRIMARY KEY)` tách biệt việc ghi nhận sự kiện khỏi bảng intent `slack_invalidation_intents`.
- Khóa duy nhất intent là composite `UNIQUE(policy_event_id, epoch_hash, target_kind)`.
- Một sự kiện chính sách (ví dụ `consent_revoked` hoặc `provider_updated`) mở rộng thành các intents tương ứng với toàn bộ các old epochs đang lưu trữ trong `slack_sources`, cam kết commit cùng rào chắn đọc trong cùng một transaction.
- Chống starvation bằng anti-join có trật tự thời gian. Xử lý đủ 4 loại sự kiện 02B.
- `SlackConnectionRepo.disconnect` bắt buộc capture binding CŨ dưới lock và ghi nhận vô hiệu hóa trước khi cập nhật disconnected.
- `SlackInvalidationRunner` khởi động độc lập với cờ tự động hóa (F4 invariant).

### 4.6. Chấp Thuận Hợp Đồng Purge Scope Thứ 6 Của Schema Owner
- Backend chấp thuận chính thức scope thứ 6 từ `@wap/tool-schemas`:
  ```ts
  export interface SlackPolicyEpoch {
    binding: SlackBinding;
    providerProfileId: string;
    configFingerprint: string;
    policyVersion: string;
    consentRevision: string;
    providerRevision: string;
  }

  // Purge target scope 6:
  | {
      scope: 'policy_epoch_invalidated';
      epoch: SlackPolicyEpoch;
      cascadeTargetKinds: SlackDerivedTargetKind[];
      tombstoneReason: 'policy_changed';
    }
  ```
- Thay thế toàn bộ tag đề xuất `provider_profile_revocation` bằng `policy_epoch_invalidated`.
- Lý do tombstone chuẩn xác là `'policy_changed'` (loại bỏ `provider_unverified`).

---

## 5. Published Interfaces Cho Consumers

### 5.1. Transaction-Bound Interface Cho Ingress 04A (Thống Nhất `stageInTransaction`)
Tham chiếu: [`docs/handoff/decisions/2026-10-29-slack-source-ingress-contracts.md`](../decisions/2026-10-29-slack-source-ingress-contracts.md).
```ts
export type SlackInvalidationBarrier =
  | {
      barrierType: 'binding';
      binding: SlackBinding;
      reason: string;
    }
  | {
      barrierType: 'channel';
      binding: SlackBinding;
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
  sourceEventKey: string;
  effects: InvalidationEffect[];
}

export interface StageInTransactionResult {
  receiptId: string;
  barrierIds: string[];
  intentIds: string[];
}

export interface ISlackInvalidationCoordinator {
  stageInTransaction(
    client: pg.PoolClient,
    input: StageInTransactionInput
  ): Promise<StageInTransactionResult>;
}
```

### 5.2. Exact Source Read/Write DTOs Cho 03C & Downstream
```ts
export interface SaveSourceInput {
  sourceRef: SlackSourceRef;
  acquisitionPolicyRef: SlackPolicyReference; // Tham chiếu ủy quyền từ thao tác đọc ban đầu
  storagePolicyRef: SlackPolicyReference;     // Tham chiếu mục đích 'storage' được cấp phát
  untrustedContent: string;
  metadata?: SlackSourceMetadata;
  capturedAt?: string;
}

export interface GetSourceInput {
  expectedCaptureId?: string;                 // Định danh vật lý UUID (SlackSourceEntity.id)
  sourceRef: SlackSourceRef;
  expectedPolicyEpoch?: SlackPolicyEpoch;     // Đối chiếu epoch lưu trữ chính xác
  consumerPurpose: SlackPolicyPurpose;        // 'manual_lookup' | 'triage' | 'planning' | 'digest'
}

export type GetSourceResult =
  | { status: 'ok'; entity: SlackSourceEntity }
  | { status: 'blocked_by_invalidation_barrier'; reason: string; safeMetadataOnly?: SlackSourceMetadata }
  | { status: 'blocked_by_policy_change'; reason: SlackModelBlockReason; safeMetadataOnly?: SlackSourceMetadata }
  | { status: 'tombstoned_or_expired'; reason: SlackTombstoneReason; safeMetadataOnly?: SlackSourceMetadata }
  | { status: 'not_found' };
```

---

## 6. Kế Hoạch Chạy Kiểm Thử TDD (RED → GREEN)

```bash
# 1. Chạy suite kiểm thử repository DB (Khóa dòng & concurrency race)
npm test -w @wap/chat-api -- tests/db/slack-source-repo.test.ts

# 2. Chạy suite kiểm thử dịch vụ lưu trữ nguồn (TTL clamping, acquisition epoch match, dual validation)
npm test -w @wap/chat-api -- tests/services/slack/slack-source-store.test.ts

# 3. Chạy suite kiểm thử hàng đợi vô hiệu hóa & commitLifecycleInvalidation 04A
npm test -w @wap/chat-api -- tests/services/slack/slack-invalidation-service.test.ts

# 4. Chạy suite kiểm thử tiêu thụ sự kiện chính sách & multi-intent epoch mapping
npm test -w @wap/chat-api -- tests/services/slack/slack-policy-event-consumer.test.ts

# 5. Kiểm tra typecheck toàn bộ dự án
npm run typecheck:v3

# 6. Kiểm tra quy chuẩn khoảng trắng và diff
git diff --check ce9380e9
```

---

## 7. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [x] Thứ tự khóa dòng nhất quán: `users` -> `slack_connections` -> `slack_trusted_providers` -> `slack_processing_consents` (FOR SHARE), khóa toàn bộ authority rows, loại trừ race lọt bản ghi insert sau khi revoke (chứng minh qua test thực tế T2.2a & T2.2b).
- [x] Bảng `slack_sources` là raw-only với ràng buộc cứng `<= 7 ngày`, lưu đầy đủ 8 trường canonical policy evidence với `policy_requested_retention_days` không bị giới hạn `<= 7`.
- [x] Phân biệt rõ capture vật lý UUID (`SlackSourceEntity.id`) với `owner_source_key`; hỗ trợ recapturing cùng revision Slack dưới epoch mới sau regrant mà không ghi đè capture cũ (chứng minh qua T2.5).
- [x] Bắt buộc kiểm tra `sameSlackPolicyEpoch` giữa `acquisitionPolicyRef` và `storagePolicyRef` trong `saveSource`; từ chối stale acquisition từ grant cũ sang grant mới (chứng minh qua T4.3).
- [x] Hàm `getSource` thực thi thẩm định 2 pha (lưu trữ `'storage'` + ủy quyền consumer purpose riêng biệt); kiểm tra rào chắn tức thì và revalidation live DB; có post-await check (chứng minh qua T4.1, T4.2, T4.4, T4.5).
- [x] Tiêu thụ sự kiện chính sách tách biệt receipt store khỏi intent table; 1 sự kiện mở rộng thành nhiều intents cho exact old epochs; không starvation; xử lý đủ 4 loại sự kiện 02B (chứng minh qua T5.1, T5.2, T5.3).
- [x] Chấp thuận chính thức scope thứ 6 `policy_epoch_invalidated` với `SlackPolicyEpoch` và lý do tombstone `'policy_changed'`. Thay thế hoàn toàn tag cũ `provider_profile_revocation`.
- [x] Công bố giao diện transaction-bound thống nhất `stageInTransaction(client, input)` cho 04A ingress và DTOs cho 03C consumer (chứng minh qua T3.1-T3.6).
- [x] Tiến trình dọn dẹp runner khởi động độc lập với cờ tự động (`MYSLACK_AUTOMATION_ENABLED`) trong `server.ts` (chứng minh qua T6.1, T6.2, T6.3).
- [x] Khẳng định rõ 03B1 chỉ quản lý raw sources; toàn bộ 7 nhóm bản sao phái sinh (03B2) và kiểm tra executor (03B3) là điều kiện tiên quyết bắt buộc trước khi đóng F3.
- [x] Phạm vi tệp được giới hạn nghiêm ngặt theo phân quyền backend và handoff protocol.

---

## 8. Kết Quả Thực Thi (Execution Results)

- **Trạng thái:** Đã triển khai phạm vi SLACK-03B1 (raw-only source store, ACL PostgreSQL thật, TTL máy chủ, hàng đợi vô hiệu hóa bền vững, consumer 4 loại sự kiện) và đã xử lý vòng independent review NEEDS_WORK trên PR #200. Không tuyên bố hoàn tất F3, không tuyên bố native Slack end-to-end.
- **Phạm vi chưa chạy (NOT_RUN):** native Slack ingress, model content calls, cascade 7 nhóm bản sao phái sinh (vẫn `pending` cho 03B2), kiểm tra binding/hash trước dispatch của Executor (03B3), UI/browser.
- **Nhánh làm việc:** `feat/slack-03b1-source-store`
- **Tệp sửa đổi và thêm mới:**
  - `db/v3/0017_slack_source_store.sql`: Migration 4 bảng PostgreSQL chuẩn ACID (`slack_sources`, `slack_invalidation_receipts`, `slack_invalidation_barriers`, `slack_invalidation_intents`).
  - `apps/chat-api/src/db/repositories/slack-source-repo.ts`: Repository lưu trữ raw source với phân cấp khóa nghiêm ngặt `users -> slack_connections -> slack_trusted_providers -> slack_processing_consents` (FOR SHARE), suy diễn nội bộ `retentionDays`, `policyRequestedRetentionDays`, và `policyEpochHash` từ `policyRef`.
  - `apps/chat-api/src/db/repositories/slack-connection-repo.ts`: Tích hợp staging barrier/intent `authorization_disconnect` nguyên tử trong phương thức `disconnect()`.
  - `apps/chat-api/src/services/slack/slack-invalidation-service.ts`: Dịch vụ staging barrier và intent với giao diện `stageInTransaction(client, input)`, kiểm tra rào chắn đa chiều, so sánh revision số thập phân lớn tùy ý không dùng float (`compareSlackRevisions`), quản lý intent lease (`SKIP LOCKED`).
  - `apps/chat-api/src/services/slack/slack-source-store.ts`: Dịch vụ `saveSource` và `getSource` thẩm định 2 pha (pha 1: storage validation + read barriers; pha 2: consumer context authorization via `resolveSlackModelPolicy` + post-await check).
  - `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts`: Tiêu thụ sự kiện chính sách từ 02B (`slack_policy_events`) sử dụng anti-join chống starvation, mở rộng sự kiện sang exact old epochs đã lưu.
  - `apps/chat-api/src/services/slack/slack-invalidation-runner.ts`: Background periodic worker quét xóa TTL hết hạn (raw-only không cần live token), xử lý intents `slack_source_raw`, phục hồi stale lease.
  - `apps/chat-api/src/app.ts` & `apps/chat-api/src/server.ts`: Tích hợp khởi động và dọn dẹp runner trong vòng đời máy chủ Express.
  - `apps/chat-api/tests/db/slack-source-repo.test.ts`: 12 test cases (thêm T2.8/T2.9 chứng minh khóa advisory hai client thật cho resource-delete-before-save và source-write-before-delete; T2.10 biên nội dung/metadata/capturedAt; T2.11 primitive ghi caller-managed từ chối khi không có transaction).
  - `apps/chat-api/tests/db/slack-connection-repo.test.ts`: 9 test cases (thêm kiểm chứng thứ tự khóa: `disconnect` lấy advisory lock trước row lock, cùng phân cấp với source writer).
  - `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts`: 11 test cases (thêm T3.7 concurrent duplicate dưới event lock, T3.8 payload conflict, T3.9 full 5-field binding matching, T3.10 purge target mismatch, T3.11 provisional sourceEventKey persistence).
  - `apps/chat-api/tests/services/slack/slack-source-store.test.ts`: 12 test cases (thêm T4.6 full capture identity, T4.7 runtime policy denial, T4.8 regrant race, T4.9 metadata DB inspection, T4.10 future capturedAt, T4.11 acquisition purpose denial, T4.12 expectedPolicyEpoch).
  - `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts`: 6 test cases (thêm T5.4 consent_granted exact old epoch, T5.5 provider_updated exact old epoch, T5.6 no-source revocation không tạo wildcard barrier và regrant mới không bị chặn).
  - `apps/chat-api/tests/services/slack/slack-invalidation-runner.test.ts`: 4 test cases (thêm T6.4 last_error chỉ lưu mã thô, không lộ raw body/token).

### Bằng Chứng Kiểm Thử Thực Tế (Exit Code 0):
```text
 RUN  v4.1.11 C:/Users/VinhDat/orca/workspaces/ATI_Project/feat-slack-03b1-source-store/apps/chat-api

 Test Files  6 passed (6)
      Tests  54 passed (54)
   Start at  01:22:45
   Duration  5.97s (transform 2.56s, setup 0ms, import 4.36s, tests 25.15s, environment 1ms)
```
Gồm 45 test của 5 tệp SLACK-03B1 và 9 test của `slack-connection-repo.test.ts` bị ảnh hưởng bởi thay đổi thứ tự khóa. Toàn bộ package `chat-api`: 110 tệp / 799 test PASS.

### Bằng Chứng Vòng Independent Review:
- Baseline review harness (`.superpowers/review-source/red.log`): 1 PASS / 7 RED trước khi sửa.
- Sau khi sửa: `npx tsx .superpowers/review-source/review.mts` trả EXIT=0, toàn bộ 8/8 assertion PASS (log `.superpowers/review-source/after-core-run.log`; chạy lại trên mã sau rà soát an toàn tại `.superpowers/review-source/final-security-run.log`, vẫn 8/8 PASS).
- Các sửa đổi chính: `saveSource` ủy quyền lại policy hiện tại cho cả acquisition và storage với epoch chính xác, barrier guard + advisory lock trong cùng transaction ghi; `getSource` khóa đầy đủ 5 trường binding + resource type/id/revision + epoch bất biến và đọc lại dòng mới nhất trước khi trả plaintext; metadata whitelist/bound trước DB write; capturedAt tương lai bị từ chối; consumer xử lý đủ 4 loại sự kiện, chỉ mở rộng exact old epochs, không fallback `conversation:*`; runner chỉ ghi mã lỗi thô.
- Vòng rà soát an toàn bổ sung sau commit `a38267d1`: `disconnect` lấy advisory lock của invalidation trước khi UPDATE row (cùng phân cấp advisory → row với source writer, có test hai client); `saveSourceInTransaction` fail-closed bằng SAVEPOINT probe khi thiếu transaction; migration 0017 thêm `ALTER TABLE ... ADD COLUMN IF NOT EXISTS provisional_source_event_key` để không lệch schema đã migrate; nhánh không có nguồn cũ vẫn chỉ ghi receipt, không tạo wildcard barrier, và receipt không intent là seam rõ ràng để 03B2 tái dựng nghĩa vụ bản sao phái sinh từ `slack_policy_events`. Không mở rộng sang F3/native Slack.

### Typecheck & Git Diff Check:
- `npm run typecheck:v3`: Exit code 0 (Hoàn toàn sạch types trên toàn bộ monorepo).
- `git diff --check 62f7a7bb`: Exit code 0 (Không lỗi khoảng trắng, không xung đột).
- `npm run check`: PASS trên mã cuối cùng, EXIT=0 (log `.superpowers/review-source/final-security-npm-check.log`; tool-schemas 266, tool-adapters 443, planner 381, executor 42, chat-api 799, chat-web 901, evaluations 406; build/security/launcher PASS).
