# 29/10/2026 · SLACK-03B1 — Hoàn Thiện Bản Kế Hoạch Kho Nguồn & Vô Hiệu Hóa (Final Bounded Plan Correction PR #196)

**Tác giả:** Backend Planning Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền:** Điều phối viên trưởng chỉ định qua Orca task `task_831d6da65d68`, dispatch `ctx_0b1305c28c8f`.
**Nhánh công việc:** `docs/slack-03b1-source-plan` (Draft PR #196, base: `integration/slack-personal-20261029`).
**Tài liệu sở hữu duy nhất:**
1. Task card: [`docs/handoff/tasks/SLACK-03B1-source-store-and-invalidation.md`](../tasks/SLACK-03B1-source-store-and-invalidation.md)
2. Implementation plan: [`docs/superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md`](../../superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md)
3. Handoff log: [`docs/handoff/log/2026-10-29-slack-03b1-source-plan.md`](2026-10-29-slack-03b1-source-plan.md)
**Phụ thuộc & Staging:**
- **Remote Integration (`7c6c65d8`):** Đã tích hợp và chấp thuận backend 02B và UI 02C; backend independent check 3.161, joint 3.176.
- **Shared 03A (PR #194, commit `bc8d6b69`):** Schema Owner đã chấp thuận và triển khai scope thứ 6 `policy_epoch_invalidated` cùng `SlackPolicyEpoch` và helpers. Đang trong giai đoạn independent final review, chưa chấp thuận thi công.
- **Ranh giới Thực thi:** Phiên này thuần túy tài liệu kế hoạch (DOCS-ONLY); giữ nguyên toàn bộ thay đổi của các agent khác; không thi công mã runtime mới, không gọi native Slack API, không gọi model AI hay bật cờ tính năng.

---

## 1. Chấp Thuận Chính Thức Giao Diện Scope Thứ 6 Từ Schema Owner

Backend Planning Owner **chính thức chấp thuận** giao diện scope thứ 6 được Schema Owner triển khai tại `@wap/tool-schemas` (`bc8d6b69`):
```ts
export interface SlackPolicyEpoch {
  binding: SlackBinding;
  providerProfileId: string;
  configFingerprint: string;
  policyVersion: string;
  consentRevision: string;
  providerRevision: string;
}

// Scope thứ 6 trong SlackPurgeTarget:
| {
    scope: 'policy_epoch_invalidated';
    epoch: SlackPolicyEpoch;
    cascadeTargetKinds: SlackDerivedTargetKind[];
    tombstoneReason: 'policy_changed';
  }
```
- **Chuẩn hóa định danh Epoch:** Định danh chính xác của epoch loại trừ `purpose` và `requestedRetentionDays`, bao gồm toàn bộ 5 trường `binding`, `providerProfileId`, `configFingerprint`, `policyVersion`, và các số sửa đổi `consentRevision`, `providerRevision` dưới dạng chuỗi thập phân chuẩn tắc. Tương thích với các hàm trợ giúp `slackPolicyRefToEpoch` và `sameSlackPolicyEpoch`.
- **Loại bỏ đề xuất cũ:** Thay thế hoàn toàn tag đề xuất cũ `provider_profile_revocation` trong toàn bộ tài liệu; lý do tombstone chuẩn xác là `'policy_changed'` (loại bỏ lý do bịa đặt `provider_unverified`).
- **Ngữ nghĩa mở rộng Epoch:** Giữ nguyên ngữ nghĩa so sánh của `workspace_consent_revocation` (so khớp chính xác `consentRevision`). Khi nhận sự kiện sau thay đổi (after-change event, ví dụ Revoke 2 với `consent_revision = '2'`), bộ tiêu thụ mở rộng sự kiện theo giao dịch tới các exact old epochs đang lưu trữ trong `slack_sources`, bảo tồn nguyên vẹn các bản ghi được cấp quyền lại sau đó (ví dụ Regrant 3 / reconnect).

---

## 2. Khắc Phục Toàn Diện 6 Điểm Khuyết Tật Kế Hoạch (Plan Defects Resolution)

### 1. Trật Tự Khóa Dòng Nhất Quán Tránh Deadlock Với 02B:
- **Phân tích:** Kế hoạch cũ đề xuất khóa `connection` -> `consent` -> `provider`. Tuy nhiên, 02B `grantConsent` thực hiện khóa provider (`FOR UPDATE`) trước rồi mới khóa consent (`FOR UPDATE`). Việc khóa consent trước provider sẽ gây nguy cơ deadlock AB-BA khi 03B1 chạy đồng thời với 02B.
- **Khắc phục:** Chuẩn hóa một trật tự khóa dòng duy nhất trên mọi tác vụ:
  `slack_connections` -> `slack_trusted_providers` -> `slack_processing_consents`.
  Trong `saveSourceAtomic`: Khóa `slack_connections` (FOR SHARE) -> `slack_trusted_providers` (FOR SHARE) -> `slack_processing_consents` (FOR SHARE).
  Khóa toàn bộ các dòng thẩm quyền (ALL authority rows) để loại trừ race lọt bản ghi insert sau khi revoke. Thiết kế test tích hợp với 2 client PostgreSQL thật chứng minh tính tuần tự hóa.

### 2. Tham Chiếu Chính Sách 8 Trường & Phân Tách Trần TTL Máy Chủ:
- **Phân tích:** Bản ghi nguồn phải lưu đầy đủ 8 trường canonical policy evidence, với trường canonical là `requestedRetentionDays` (không dùng trường legacy `retentionDays`). Nếu yêu cầu ủy quyền gốc là 30 ngày, việc đặt DB constraint `<= 7` lên trường canonical issued ref sẽ làm sai lệch bản ghi ủy quyền.
- **Khắc phục:** Lưu nguyên giá trị ủy quyền gốc (ví dụ 30 ngày) trong `policyRef.requestedRetentionDays` và cột `policy_requested_retention_days INT NOT NULL CHECK (policy_requested_retention_days > 0)`.
  Trần cứng `<= 7 ngày` chỉ áp đặt lên thời hạn lưu trữ thô thực tế qua `retention_days INT NOT NULL CHECK (retention_days > 0 AND retention_days <= 7 AND retention_days <= policy_requested_retention_days)` và `expires_at <= captured_at + INTERVAL '7 days'`.

### 3. Định Danh Capture Vật Lý Bất Biến & Tái Thu Thập Sau Regrant:
- **Phân tích:** `owner_source_key` (`formatSlackOwnerSourceKey(sourceRef)`) chỉ đại diện cho tài nguyên và revision của chủ sở hữu, KHÔNG đại diện cho capture vật lý duy nhất. Nếu cùng một tin nhắn Slack không đổi nội dung được thu thập lại sau khi regrant (Grant 1 -> Revoke 2 -> Regrant 3), việc dùng `owner_source_key` làm khóa chính sẽ làm hỏng dữ liệu hoặc xung đột.
- **Khắc phục:** Mỗi capture vật lý mang `id UUID PRIMARY KEY` riêng biệt. Ràng buộc active epoch: `UNIQUE (owner_source_key, policy_epoch_hash) WHERE purged_at IS NULL`.
  Cho phép thu thập hợp lệ cùng một tin nhắn Slack dưới epoch mới mà không làm sống lại hoặc ghi đè capture cũ đã purge. Tuyệt đối không tự bịa ra Slack revision để phân biệt capture. `getSource` bắt buộc yêu cầu định danh capture vật lý (`expectedCaptureId`) hoặc `(sourceRef, expectedPolicyEpoch)`, cấm tái liên kết mù vào latest capture.

### 4. Đọc Nguồn 2 Pha: Thẩm Định Lưu Trữ Tách Biệt Với Ủy Quyền Tiêu Thụ:
- **Phân tích:** Bản ghi nguồn mang `policyRef.purpose = 'storage'` bất biến. Khi consumer đọc nguồn cho mục đích khác (như `'triage'`), không được dán nhãn lại (relabel) purpose của bản ghi lưu trữ hoặc truyền storage ref làm expected ref cho triage.
- **Khắc phục:** `getSource` thi công 2 pha rõ rệt:
  - Pha 1: Thẩm định `policyRef` bất biến của bản ghi dưới mục đích `'storage'`, kiểm tra TTL và rào chắn `slack_invalidation_barriers` (nếu pending hoặc purge-failed -> chặn đọc ngay lập tức).
  - Pha 2: Ủy quyền mục đích tiêu thụ riêng biệt của caller qua `resolveSlackModelPolicy` với fresh consumer context.
  - Thực hiện kiểm tra post-await trước khi trả plaintext để ngăn chặn rào chắn commit trong khi đang await I/O.

### 5. Tiêu Thụ Sự Kiện Chính Sách: Mở Rộng Đa Intent & Chống Starvation:
- **Phân tích:** Một sự kiện chính sách (như `consent_revoked` hoặc `provider_updated`) có thể vô hiệu hóa nhiều epoch cũ đang lưu trữ. Nếu đặt `policy_event_id UNIQUE` trên bảng intent, một sự kiện chỉ tạo được 1 intent, gây thiếu sót khi mở rộng.
- **Khắc phục:** Tách biệt bảng biên nhận `slack_processed_policy_events (event_id UUID PRIMARY KEY)` khỏi bảng intent. Khóa duy nhất intent là composite `(policy_event_id, epoch_hash, target_kind)`.
  Một sự kiện mở rộng thành NHIỀU intents cho các exact old epochs lưu trữ, commit cùng rào chắn đọc trong cùng transaction.
  Chống starvation bằng anti-join có trật tự thời gian. Xử lý đủ 4 loại sự kiện 02B. Thao tác disconnect bắt buộc capture binding CŨ dưới lock.
  Runner khởi động độc lập với cờ tự động hóa (F4 invariant).

### 6. Giao Diện Liên Kết Giao Dịch Cho Ingress 04A & Điều Kiện Tiên Quyết F3:
- **Phân tích:** 04A Ingress cần một giao diện transaction-bound dùng chung `pg.PoolClient` để commit receipt + rào chắn trước khi gửi HTTP 200 ACK cho Slack.
- **Khắc phục:** Công bố giao diện `stageInTransaction(client: pg.PoolClient, input: StageLifecycleInvalidationInput): Promise<void>` với stable key `(eventId, targetScopeKey)`. Không có quyền notification tùy chọn.
  Công bố DTOs đọc/ghi chính xác cho 03C consumer (`SaveSourceInput`, `GetSourceInput`, `GetSourceResult`).
  Khẳng định rõ: 03B1 chỉ quản lý raw sources; toàn bộ 7 nhóm bản sao phái sinh (03B2) và kiểm tra executor (03B3) là điều kiện tiên quyết bắt buộc trước khi đóng F3. Không tuyên bố đóng sớm F3.

---

## 3. Thu Gọn Bản Kế Hoạch Đạt Chuẩn (Target <= 450 Dòng)

- Loại bỏ hàng trăm dòng mã giả định và boilerplate triển khai đầu cơ trong file plan.
- Kế hoạch [`docs/superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md`](../../superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md) được cô đọng hoàn toàn thành **243 dòng** (thỏa mãn mục tiêu `<= 450 dòng`), tập trung vào các contracts, invariants, DDL, published interfaces và real test matrix.

---

## 4. Bằng Chứng Xác Minh Cơ Học

| Tiêu chí kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| **Ranh giới Sở hữu (Module Ownership)** | `git status --porcelain` | Chỉ chỉnh sửa đúng 3 file tài liệu SLACK-03B1 (`card`, `plan`, `log`); không có bất kỳ file source hay config nào bị chạm |
| **Kiểm tra Cú pháp & Khoảng trắng** | `git diff --check ce9380e9..HEAD` | **EXIT 0**; không có trailing whitespace hay formatting issue |
| **Tính Hợp Lệ Của Đường Dẫn & Liên Kết** | Node script kiểm tra path nội bộ | Toàn bộ liên kết chéo giữa task card, plan và log đều trỏ đúng file hiện hữu trên workspace |
| **Độ Dài Bản Kế Hoạch (Line Budget)** | `(Get-Content <plan-path>).Count` | **243 dòng** (Thỏa mãn yêu cầu `<= 450 dòng`) |
| **Kiểm Thử Mã Nguồn (Test Run Status)** | Docs-only scope | **NOT_RUN** (Tuân thủ nghiêm ngặt chỉ đạo DOCS-ONLY, không thi công sớm trước khi giao diện được duyệt) |

---

## 5. Trạng Thái Hoàn Thành & Bàn Giao

1. Cập nhật nhất quán cả 3 file tài liệu SLACK-03B1.
2. Commit và push lên nhánh `docs/slack-03b1-source-plan` (PR #196) không dùng `--force`.
3. Kiểm tra hòm thư điều phối viên (`orca orchestration check`) và gửi báo cáo `worker_done` kèm thông báo chấp thuận chính thức giao diện scope thứ 6.
