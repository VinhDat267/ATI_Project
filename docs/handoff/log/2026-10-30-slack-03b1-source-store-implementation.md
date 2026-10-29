# 30/10/2026 · Nghiệm Thu SLACK-03B1: Kho Nguồn Thô Slack, Kiểm Soát Truy Cập MVCC & Hàng Đợi Vô Hiệu Hóa Bền Vững

**Tác giả:** Backend Implementation Owner (Antigravity gemini-3.8-flash-high).  
**Ủy quyền điều phối:** Điều phối viên trưởng (Coordinator `term_c4dfa448-7670-4256-8dac-d0a1c9157a1d`) phân công thực thi Task `task_d01c3a8596e8`, Dispatch `ctx_29765fc6b1b7`.  
**Nhánh Git:** `feat/slack-03b1-source-store` (nền `f67c0b166219b93b9e336866997bfdd4c703d062` từ `integration/slack-personal-20261029`).  
**Task card:** [`docs/handoff/tasks/SLACK-03B1-source-store-and-invalidation.md`](../tasks/SLACK-03B1-source-store-and-invalidation.md).  
**Kế hoạch triển khai:** [`docs/superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md`](../../superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md).  
**Văn bản quyết định hợp đồng thống nhất:** [`docs/handoff/decisions/2026-10-29-slack-source-ingress-contracts.md`](../decisions/2026-10-29-slack-source-ingress-contracts.md).  

---

## 1. Tóm Tắt Thực Thi & Thỏa Thuận Giao Diện Liên Tác Vụ

Triển khai trọn vẹn và kiểm thử nghiêm ngặt kho nguồn thô Slack, cơ chế kiểm soát truy cập phân cấp MVCC trên PostgreSQL thật, và hệ thống hàng đợi vô hiệu hóa bền vững theo đúng thỏa thuận hợp đồng với Ingress 04A và Consumer 03C:

### 1.1. Chấp thuận Checkpoint 03C1 Hooks:
- Đã gửi thông báo chấp thuận chính thức giao diện hook tin cậy tới Coordinator (`msg_150cb7b10000`, ack `delivery_4abbe30d9daf`):
  - `getAccessToken(binding: SlackBinding): Promise<string>`
  - `authorizeRead(input: { binding: SlackBinding, purpose: Exclude<SlackPolicyPurpose, 'storage'>, requestedRetentionDays: 0, expectedPolicyReference?: SlackPolicyReference }): Promise<{ allowed: true, policyReference: SlackPolicyReference } | { allowed: false, reason: string }>`

### 1.2. Thống nhất Hợp đồng Ingress 04A (`stageInTransaction`):
- Đạt đồng thuận chính thức với Ingress Owner 04A (`ctx_6e0e5e1be2ce`, `msg_fc28933865a4`, ack `delivery_0cc38846860a`) về giao diện staging nguyên tử:
  ```ts
  stageInTransaction(
    client: pg.PoolClient,
    input: { sourceEventKey: string; effects: InvalidationEffect[] }
  ): Promise<{ receiptId: string; barrierIds: string[]; intentIds: string[] }>;
  ```
- Khóa biên nhận `source_event_key` và cặp `(source_event_key, effect_key)` đều `NOT NULL UNIQUE`. Idempotent fan-out nhiều mục tiêu atomic trong cùng transaction. Rào chắn provisional auth được ghi nhận và xóa chính xác theo CAS validation.

---

## 2. Chi Tiết Các Hạng Mục Kỹ Thuật Đã Triển Khai

### 2.1. Migration Cơ sở dữ liệu (`db/v3/0017_slack_source_store.sql`):
- `slack_sources`: Bảng lưu trữ nguồn thô với các ràng buộc cứng:
  - `chk_slack_sources_requested_retention`: `policy_requested_retention_days > 0`
  - `chk_slack_sources_retention_days`: `retention_days > 0 AND retention_days <= 7 AND retention_days <= policy_requested_retention_days`
  - `chk_slack_sources_raw_retention`: `expires_at > captured_at AND expires_at <= captured_at + make_interval(days => retention_days)`
  - Unique active epoch: `UNIQUE (owner_source_key, policy_epoch_hash) WHERE purged_at IS NULL`
- `slack_invalidation_receipts`: Bảng biên nhận xử lý sự kiện idempotent (`source_event_key TEXT UNIQUE NOT NULL`, `payload_hash TEXT NOT NULL`).
- `slack_invalidation_barriers`: Bảng rào chắn đọc tức thì đa chiều (`binding`, `channel`, `epoch`, `resource`, `provisional_auth`), lưu trữ đầy đủ 5 trường binding kèm `identity_version`.
- `slack_invalidation_intents`: Hàng đợi ý định dọn dẹp phân tán đa mục tiêu với cơ chế lease concurrency (`SKIP LOCKED`).

### 2.2. Kho Nguồn Thô & Kiểm Soát Khóa MVCC (`SlackSourceRepo`):
- **Phân cấp khóa nhất quán chống AB-BA Deadlock:**  
  `users (FOR SHARE) -> slack_connections (FOR SHARE) -> slack_trusted_providers (FOR SHARE) -> slack_processing_consents (FOR SHARE)`.
- **Suy diễn nội bộ có căn cứ (Zero Caller Spoofing):**  
  `retentionDays`, `policyRequestedRetentionDays`, và `policyEpochHash` được tính toán trực tiếp từ `cleanPolicyRef` dưới các khóa authority đã xác thực, không tiếp nhận tham số trần retention từ caller.
- **Bảo toàn định dạng số thập phân siêu chính xác:**  
  Cột `revision TEXT` hỗ trợ các số thập phân lớn tùy ý (ví dụ `9007199254740993.123456789`), so sánh phiên bản không dùng float (`compareSlackRevisions`).

### 2.3. Dịch Vụ Vô Hiệu Hóa & Staging Nguyên Tử (`SlackInvalidationService`):
- Thực thi `stageInTransaction(client, input)` với kiểm tra payload hash chống ghi đè dữ liệu xung đột trên cùng một khóa `source_event_key`.
- Kiểm tra rào chắn đa chiều (`checkBarriers`) bảo đảm fail-closed ngay lập tức khi phát hiện rào chắn hiệu lực.
- Cơ chế `claimIntents`, `completeIntent`, `failIntent`, và `recoverStaleLeases` vận hành phân tán với PostgreSQL row locks `FOR UPDATE SKIP LOCKED`.
- Tích hợp `disconnect()` trong `SlackConnectionRepo`: capture binding cũ dưới advisory lock và stage barrier/intent `authorization_disconnect` nguyên tử trong cùng transaction.

### 2.4. Cửa Ngõ Truy Cập Nguồn Thẩm Định 2 Pha (`SlackSourceStore`):
- `saveSource`: Thẩm định hợp đồng storage policy, kiểm tra tính trùng khớp epoch giữa acquisition và storage, ghi nhận nguồn thô kèm server-derived TTL.
- `getSource`:
  - **Pha 1 (Storage Validation):** Kiểm tra trạng thái lưu trữ của bản ghi với mục đích `'storage'`, soát rào chắn đọc tức thì và revalidate trạng thái live DB.
  - **Pha 2 (Consumer Context Authorization):** Gọi `resolveSlackModelPolicy` với fresh consumer context (mục đích riêng biệt, ví dụ `'triage'`).
  - **Post-Await Race Check:** Kiểm tra lại rào chắn đọc ngay trước khi trả dữ liệu nhạy cảm để chặn triệt để race condition rào chắn commit trong khi đang await I/O.
  - Khi bị chặn bởi barrier hoặc tombstone, trả về `safeMetadata` và xóa trắng nội dung plaintext.

### 2.5. Tiêu Thụ Sự Kiện Chính Sách Chống Starvation (`SlackPolicyEventConsumer`):
- Sử dụng câu truy vấn Anti-Join (`slack_policy_events LEFT JOIN slack_invalidation_receipts WHERE r.id IS NULL ORDER BY occurred_at, id LIMIT $1`).
- Xử lý đủ 4 loại sự kiện 02B: `consent_granted`, `consent_revoked`, `provider_attested`, `provider_updated`.
- Mở rộng sự kiện `consent_revoked` và `provider_updated` sang toàn bộ các kỷ nguyên cũ (exact old epochs) đang lưu trữ trong cơ sở dữ liệu.
- Bảo toàn tuyệt đối regrant mới: Khi một consent mới được cấp lại, các nguồn được ghi nhận dưới epoch mới không bị ảnh hưởng bởi barrier của epoch cũ.

### 2.6. Tiến Trình Nền Tự Động Quét Xóa & Dọn Dẹp (`SlackInvalidationRunner`):
- Vận hành định kỳ độc lập với cờ `MYSLACK_AUTOMATION_ENABLED`.
- Quét xóa TTL hết hạn cho nguồn thô mà không cần live Slack token.
- **Nguyên tắc Raw-Only Cascade:** 03B1 chỉ claim và hoàn tất các intent thuộc nhóm `target_kind = 'slack_source_raw'`, bảo toàn toàn bộ 7 nhóm mục tiêu phái sinh (`chat_history_message`, `working_memory_entity`, `plan_step_arg`, `proposal_excerpt`, `daily_digest_entry`, `scheduled_workflow_arg`, `audit_log_entry`) ở trạng thái `pending` cho 03B2 tiếp quản.
- Tích hợp vòng đời server sạch sẽ (`server.ts` & `app.ts`): khởi động khi listen và dừng giải phóng tài nguyên khi nhận SIGTERM/SIGINT.

---

## 3. Bằng Chứng Kiểm Thử Thực Tế (Exit Code 0)

Toàn bộ 25 test cases trên 5 test files PostgreSQL thật đều đạt kết quả tuyệt đối:

```text
> @wap/chat-api@0.1.0 test
> vitest run tests/db/slack-source-repo.test.ts tests/services/slack/slack-invalidation-service.test.ts tests/services/slack/slack-source-store.test.ts tests/services/slack/slack-policy-event-consumer.test.ts tests/services/slack/slack-invalidation-runner.test.ts

 RUN  v4.1.11 C:/Users/VinhDat/orca/workspaces/ATI_Project/feat-slack-03b1-source-store/apps/chat-api

 ✓ tests/services/slack/slack-invalidation-service.test.ts (6 tests) 2335ms
 ✓ tests/services/slack/slack-invalidation-runner.test.ts (3 tests) 2326ms
 ✓ tests/services/slack/slack-source-store.test.ts (5 tests) 2527ms
 ✓ tests/db/slack-source-repo.test.ts (8 tests) 3011ms
 ✓ tests/services/slack/slack-policy-event-consumer.test.ts (3 tests) 3324ms
     ✓ T5.3: anti-join prevents starvation across batches (> 50 events)  1044ms

 Test Files  5 passed (5)
      Tests  25 passed (25)
   Start at  00:19:29
   Duration  4.28s
```

Kiểm tra toàn bộ test suite Slack (bao gồm các bộ kiểm thử OAuth và Consent từ 02):
```text
 ✓ tests/db/slack-consent-repo.test.ts (10 tests) 1194ms
 ✓ tests/services/slack/slack-invalidation-service.test.ts (6 tests) 1568ms
 ✓ tests/services/slack/slack-invalidation-runner.test.ts (3 tests) 1268ms
 ✓ tests/services/slack/slack-source-store.test.ts (5 tests) 1445ms
 ✓ tests/db/slack-source-repo.test.ts (8 tests) 1862ms
 ✓ tests/services/slack/slack-policy-event-consumer.test.ts (3 tests) 1953ms
 ✓ tests/routes/slack-connections.test.ts (9 tests) 1854ms

 Test Files  7 passed (7)
      Tests  44 passed (44)
```

Kiểm tra Static Typecheck và Quy Chuẩn Mã Nguồn:
- `npm run typecheck:v3`: **PASS** (Exit code 0, không có bất kỳ lỗi TypeScript nào).
- `git diff --check f67c0b16`: **PASS** (Exit code 0, không có lỗi định dạng hay khoảng trắng thừa).

---

## 4. Danh Sách Tệp Đã Sửa Đổi & Thêm Mới

Chỉ thao tác trong các tệp thuộc thẩm quyền backend và tài liệu handoff:
- `db/v3/0017_slack_source_store.sql`
- `apps/chat-api/src/db/repositories/slack-source-repo.ts`
- `apps/chat-api/src/db/repositories/slack-connection-repo.ts`
- `apps/chat-api/src/services/slack/slack-invalidation-service.ts`
- `apps/chat-api/src/services/slack/slack-source-store.ts`
- `apps/chat-api/src/services/slack/slack-policy-event-consumer.ts`
- `apps/chat-api/src/services/slack/slack-invalidation-runner.ts`
- `apps/chat-api/src/app.ts`
- `apps/chat-api/src/server.ts`
- `apps/chat-api/tests/db/slack-source-repo.test.ts`
- `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts`
- `apps/chat-api/tests/services/slack/slack-source-store.test.ts`
- `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts`
- `apps/chat-api/tests/services/slack/slack-invalidation-runner.test.ts`
- `docs/handoff/tasks/SLACK-03B1-source-store-and-invalidation.md`
- `docs/superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md`
- `docs/handoff/log/2026-10-30-slack-03b1-source-store-implementation.md`

Không sửa đổi bất kỳ tệp nào trong `packages/tool-schemas`, `packages/tool-adapters`, `packages/planner`, `packages/executor`, `apps/chat-web`, `scripts`, `CURRENT-STATE.md`, hay `ROADMAP.md`.
