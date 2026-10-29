# 29/10/2026 · SLACK-03B1 — Khắc Phục Đánh Giá Độc Lập PR 196 (Kế Hoạch Kho Nguồn & Vô Hiệu Hóa)

**Tác giả:** Backend Planning Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền:** Điều phối viên trưởng chỉ định qua Orca task `task_bb864fcaee47`, dispatch `ctx_528be0135df6`.
**Nhánh công việc:** `docs/slack-03b1-source-plan` (PR #196, base: `integration/slack-personal-20261029` commit `ce9380e9`).
**Tài liệu cập nhật:**
1. Task card: [`docs/handoff/tasks/SLACK-03B1-source-store-and-invalidation.md`](../tasks/SLACK-03B1-source-store-and-invalidation.md)
2. Implementation plan: [`docs/superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md`](../../superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md)
3. Handoff log: [`docs/handoff/log/2026-10-29-slack-03b1-source-plan.md`](2026-10-29-slack-03b1-source-plan.md)
**Phụ thuộc & Tình trạng Staging:**
- **Staging Base:** Commit tích hợp `630eade5` chứa `192` (`4e038967`) và `193` (`8ed24c1b`); joint `npm run check` đã pass.
- **SLACK-03A (Schema Contracts, PR #194):** Schema Owner đang khắc phục review findings dưới `ctx_3c64f98e0373`.
- **SLACK-04A (Ingress Plan, PR #195):** Đang được hiệu chỉnh kế hoạch dưới `ctx_2f967703f46f`.
- **Ranh giới Thực thi:** Phiên này thuần túy tài liệu kế hoạch (DOCS-ONLY); tuyệt đối không viết mã runtime mới hay gọi API Slack native / mô hình AI.

---

## 1. Tóm tắt Khắc phục 7 Điểm Đánh giá Độc lập (Review Remediation)

Sau khi nhận kết luận "NEEDS WORK before runtime" từ reviewer độc lập đối với PR #196 tại commit `e961dd4a`, Backend Planning Owner đã rà soát toàn diện và chỉnh sửa nhất quán cả task card và implementation plan theo 7 điểm kỹ thuật cụ thể:

### 1. Khóa dòng Tuần tự hóa PostgreSQL MVCC (Row Locks & Serialization):
- **Phản biện Reviewer:** `INSERT SELECT WHERE` không tự động tuần tự hóa với các giao dịch revoke đồng thời dưới PostgreSQL MVCC; thiếu khóa dòng và tuyên bố thái quá về loại trừ race condition.
- **Giải pháp Khắc phục:**
  - Định nghĩa thứ tự khóa dòng tường minh trong transaction của `saveSourceAtomic`:
    1. Khóa connection: `SELECT ... FROM slack_connections WHERE id = $1 AND user_id = $2 FOR SHARE`.
    2. Khóa consent: `SELECT ... FROM slack_processing_consents WHERE workspace_id = $1 AND provider_id = $2 FOR SHARE`.
  - Khóa `FOR SHARE` tuần tự hóa trực tiếp với `SELECT ... FOR UPDATE` trong `SlackConsentRepo.revokeConsent` của 02B: nếu revoke đang chạy, insert phải đợi; nếu insert giữ khóa trước, revoke phải đợi và sau khi commit sẽ invalidate ngay bản ghi vừa tạo.
  - Cổng thẩm định kiểm tra đầy đủ 5 trường binding, quyền mục đích `'storage'`, giới hạn retention và số thứ tự sửa đổi (revision) hiện hành.
  - Thiết kế kịch bản kiểm thử xen kẽ 2 client PostgreSQL thật (Two-client PG interleaving test) chứng minh không bao giờ để lọt nguồn stale hoặc late insert sau revoke.

### 2. Cơ chế Đọc An toàn `getSource` & Rào chắn Đọc Tức thì:
- **Phản biện Reviewer:** `getSource` trả về plaintext chỉ sau khi kiểm tra tombstone/expiry; thiếu revalidation binding, revision, live DB policy và barrier guard.
- **Giải pháp Khắc phục:**
  - Yêu cầu caller cung cấp đầy đủ 5 trường binding, định danh capture/revision chính xác, và mục đích tiêu thụ riêng biệt (`'manual_lookup' | 'triage' | 'planning' | 'digest'`). Tuyệt đối không chọn "latest resource" để bind mù vào artifact cũ.
  - Tra cứu rào chắn vô hiệu hóa bền vững `slack_invalidation_barriers` trước khi trả dữ liệu. Nếu có active barrier, chặn đọc ngay lập tức (`status: 'blocked_by_invalidation_barrier'`) trước khi worker purge vật lý chạy.
  - Tái thẩm định live DB qua `SlackPolicyService.resolveSlackModelPolicy`. Khẳng định rõ bảo vệ hậu mô hình (post-model / prepublication guard) là nghĩa vụ của 03B2/03B3.

### 3. Trần TTL Kho Nguồn Thô `<= 7 ngày` (Raw-Only TTL):
- **Phản biện Reviewer:** Cờ `metadata.isExcerpt` do caller kiểm soát và `OR NULL` làm lọt CHECK constraint; 03B1 cần trần cứng 7 ngày cho mọi loại tài nguyên thô.
- **Giải pháp Khắc phục:**
  - Loại bỏ hoàn toàn đường dẫn `isExcerpt` và trần 30 ngày khỏi bảng nguồn thô 03B1.
  - Áp đặt trần cứng `<= 7 ngày` cho toàn bộ tài nguyên thô:
    `CONSTRAINT chk_slack_sources_raw_retention CHECK (expires_at > captured_at AND expires_at <= captured_at + INTERVAL '7 days')`.
  - Trích đoạn 30 ngày được chuyển giao cho 03B2 với lớp lưu trữ có kiểu riêng biệt (`slack_excerpts`).
  - Đồng hồ và thời hạn hết hạn do máy chủ sở hữu; cấm upsert làm mới TTL hoặc ghi đè lên bản ghi đã tombstoned/purged. Refetch dữ liệu hợp lệ mới tạo capture revision độc lập.

### 4. Đầy đủ 8 Trường Tham Chiếu & Khớp Chữ Ký Hàm Thật:
- **Phản biện Reviewer:** Thiếu cột DB cho `requestedRetentionDays`; dùng nhầm legacy `retentionDays`; `formatSlackOwnerSourceKey` bị gọi sai chữ ký; purge target kinds dùng alias thay vì literal chuẩn.
- **Giải pháp Khắc phục:**
  - Thêm cột riêng `requested_retention_days INTEGER NOT NULL CHECK (requested_retention_days > 0 AND requested_retention_days <= 7)` vào bảng `slack_sources`. Reconstruct đầy đủ 8 trường canonical policy evidence.
  - Sửa chữ ký gọi `formatSlackOwnerSourceKey(ref: SlackSourceRef)` nhận đúng 1 tham số theo hợp đồng `@wap/tool-schemas`.
  - Thay thế toàn bộ alias bằng đúng 7 literal chuẩn tắc từ `SLACK_DERIVED_TARGET_KINDS`:
    `'chat_history_message' | 'working_memory_entity' | 'plan_step_arg' | 'proposal_excerpt' | 'daily_digest_entry' | 'scheduled_workflow_arg' | 'audit_log_entry'`.

### 5. Tiêu Thụ Sự Kiện Chính Sách Lũy Thừa (Idempotent Event Consumption):
- **Phản biện Reviewer:** `consumePendingPolicyEvents` đọc mãi 50 dòng đầu và gây trùng lặp; thiếu xử lý 4 loại sự kiện 02B.
- **Giải pháp Khắc phục:**
  - Bảng `slack_invalidation_intents` lưu cột `policy_event_id UUID UNIQUE REFERENCES slack_policy_events(id)`.
  - Bộ quét sự kiện dùng anti-join `WHERE NOT EXISTS`, loại bỏ đọc trùng lặp và starvation.
  - Xử lý đủ 4 loại sự kiện 02B: `consent_granted`, `consent_revoked`, `provider_attested`, `provider_updated`.
  - Revalidation khi đọc bảo đảm nguồn cũ trở nên unconsumable ngay lập tức khi sự kiện commit.

### 6. Mở Rộng Rào Chắn Epoch & Đề Xuất Hợp Đồng Cho Schema Owner:
- **Phản biện Reviewer:** Tag `workspace_consent_revocation` của 03A có nghĩa là exact old grant revision, trong khi worker dùng `< after-change barrier`. Thiếu tag cho provider revision mutation.
- **Giải pháp Khắc phục:**
  - Khi nhận sự kiện sau thay đổi (`consent_revision = R_{event}`), mở rộng rào chắn thành các exact old grant targets (`exactConsentRevision = String(oldRev)`) đồng thời ghi nhận barrier `before_consent_revision = R_{event}`.
  - Bảo đảm kịch bản Grant 1 -> Revoke 2 -> Regrant 3: nguồn 1 bị xóa, nguồn 3 tồn tại nguyên vẹn.
  - Đề xuất bổ sung tag thứ 6 `provider_profile_revocation` cho Schema Owner. Trong 03B1 nội bộ, lý do tombstone được ghi nhận chính xác là `'policy_changed'` hoặc `'provider_unverified'`, tuyệt đối không ghi sai thành `'source_deleted'`.

### 7. Giao Diện Vô Hiệu Hóa Liên Kết Giao Dịch Cho 04A Ingress & Disconnect:
- **Phản biện Reviewer:** Cần cam kết receipt + rào chắn commit nguyên tử trước khi ACK cho Slack; disconnect cần bắt binding cũ dưới lock; runner phải độc lập với flags.
- **Giải pháp Khắc phục:**
  - Cung cấp hàm chuẩn tắc `commitLifecycleInvalidation(client: pg.PoolClient, intent: SlackPurgeTarget, barrier?: InvalidationBarrier)`.
  - Webhook ingress 04A commit receipt + barrier trong cùng transaction trước khi gửi HTTP 200 ACK cho Slack.
  - Disconnect bắt binding CŨ trong transaction dưới lock, commit barrier và intent rồi mới đổi trạng thái disconnected.
  - Đưa `SlackInvalidationRunner` vào app startup, chạy độc lập với cờ tự động (F4 invariant).
  - Quy chuẩn ranh giới phân đoạn provenance: `DerivedCopyRef` đại diện cho 1 segment; multi-workspace targets bắt buộc aggregate all segments và revalidate mọi dependencies.

---

## 2. Bằng chứng Xác Minh Cơ Học

| Tiêu chí kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| **Ranh giới Sở hữu (Module Ownership)** | `git status --porcelain` | Chỉ chỉnh sửa đúng 3 file tài liệu trong `docs/handoff/tasks/`, `docs/superpowers/plans/`, và `docs/handoff/log/`; không có bất kỳ file source hay config nào bị chạm |
| **Kiểm tra Cú pháp & Khoảng trắng** | `git diff --check ce9380e9..HEAD` | **EXIT 0**; không có trailing whitespace hay cảnh báo định dạng |
| **Tính Hợp lệ của Liên kết** | Node script kiểm tra path nội bộ | Tất cả các liên kết chéo giữa task card, plan và log đều trỏ đúng file vật lý hiện hữu |
| **Không Thi công Sớm (Zero Runtime Mutation)** | Kiểm tra git diff | Không có bất kỳ dòng mã TypeScript/SQL runtime nào được thi công; tuân thủ nguyên tắc chờ review và chỉ đạo tiếp theo từ điều phối viên |

---

## 3. Kế hoạch Tiếp theo

1. Commit và push các thay đổi tài liệu lên nhánh `docs/slack-03b1-source-plan` (PR #196).
2. Báo cáo trạng thái hoàn tất cho Điều phối viên trưởng qua lệnh `orca orchestration send --type worker_done`.
3. Chuyển sang trạng thái nhàn rỗi (idle prompt) chờ đánh giá độc lập từ Reviewer.
