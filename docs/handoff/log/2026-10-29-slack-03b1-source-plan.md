# 29/10/2026 · SLACK-03B1 — Lập Kế Hoạch Kho Nguồn, PostgreSQL ACL & Hàng Đợi Vô Hiệu Hóa Bền Vững

**Tác giả:** Backend Planning Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền:** Điều phối viên trưởng chỉ định qua Orca task `task_a6ff9ffdd23c`, dispatch `ctx_334c44d822cb`.
**Nhánh công việc:** `docs/slack-03b1-source-plan` (base: `integration/slack-personal-20261029` commit `ce9380e9`).
**Tài liệu sở hữu & tạo mới:**
1. Task card: [`docs/handoff/tasks/SLACK-03B1-source-store-and-invalidation.md`](../tasks/SLACK-03B1-source-store-and-invalidation.md)
2. Implementation plan: [`docs/superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md`](../../superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md)
3. Handoff log: [`docs/handoff/log/2026-10-29-slack-03b1-source-plan.md`](2026-10-29-slack-03b1-source-plan.md)
**Phụ thuộc & Tình trạng Song song:**
- **SLACK-01 / SLACK-02A / SLACK-02R:** Đã hoàn tất và tích hợp vào base.
- **SLACK-02C (Frontend UI, PR #193):** Đã hoàn tất, tích hợp tại commit `ce9380e9`, CI #40896650904 SUCCESS.
- **SLACK-02B (Backend Consent, PR #192, commit `4e038967`):** Đã hoàn tất 17 contract cases, root fullcheck 3.167 tại `5fb027ef` đã pass, dọn dẹp khoảng trắng tại `4e038967` đang chờ kết quả CI cuối.
- **SLACK-03A (Schema Contracts, PR #194, commit `6e02ca56`):** Nhận kết luận review độc lập "NEEDS WORK" (10 RED cases về bounds retention, raw 7 ngày, lineage epoch mismatches và argument detachment; đang được Schema Owner sửa đổi dưới context `ctx_3c64f98e0373`). Kế hoạch SLACK-03B1 bám sát các yêu cầu chuẩn tắc đã thống nhất (agreed requirements), KHÔNG giả định rằng bản `6e02ca56` được chấp thuận nguyên trạng mà không sửa đổi.
- **Ranh giới Thực thi:** Phiên này thuần túy tài liệu kế hoạch (DOCS-ONLY); tuyệt đối không viết mã runtime mới hay gọi API Slack native / mô hình AI.

---

## 1. Tóm tắt Nội dung Kế hoạch SLACK-03B1

Backend Planning Owner đã phân rã toàn diện giai đoạn 03B thành các ranh giới độc lập và xác lập kế hoạch chi tiết cho sub-task **SLACK-03B1**:

### 1.1. Ranh giới Bounded Scope & Phân tầng Vòng đời (03B1 vs 03B2/03B3):
- **Phạm vi của 03B1:**
  - Bảng lưu trữ nguồn `slack_sources` có kiểm soát truy cập (ACL) đa cột, khóa phức hợp theo chủ sở hữu (`owner_source_key`), và các ràng buộc toàn vẹn PostgreSQL.
  - Cổng ghi nguyên tử (Atomic Write Gate) kết hợp kiểm tra đồng thời trạng thái active của kết nối, sự chấp thuận (consent) của tổ chức, trạng thái xác thực của provider, và khớp số thứ tự sửa đổi (revision matching) trong cùng một câu lệnh SQL/transaction để loại bỏ hoàn toàn race condition.
  - Cơ chế đọc có điều kiện (Conditional Read Guard) chỉ trả về siêu dữ liệu an toàn (`safeMetadataOnly`) khi nguồn bị tombstone hoặc hết hạn, ngăn chặn tuyệt đối rò rỉ nội dung thô (`untrusted_content`).
  - Trần thời gian lưu trữ do máy chủ áp đặt (Server-Enforced TTL): tối đa 7 ngày cho nội dung thô (raw bodies), tối đa 30 ngày cho trích đoạn (excerpts); từ chối lưu trữ bền vững khi chính sách quy định `retentionDays === 0`.
  - Hàng đợi ý định vô hiệu hóa bền vững (`slack_invalidation_intents`) cam kết ghi nhận cùng transaction với các sự kiện ngắt kết nối cục bộ hoặc thu hồi quyền; phân phối khóa hàng đợi bằng `FOR UPDATE SKIP LOCKED`, có lease timeout và retry giới hạn, hỗ trợ tự phục hồi khi tiến trình sập (crash recovery).
  - Tiêu thụ sự kiện chính sách tổ chức từ 02B (`slack_policy_events`) với ngữ nghĩa ánh xạ epoch rào chắn (Barrier Epoch Mapping).
- **Ranh giới Nghiêm ngặt với 03B2 & 03B3:**
  - Tuyệt đối không tuyên bố rằng việc tạo bảng nguồn đóng F3.
  - Cơ chế cascade purge vào các bản sao phái sinh (derived copies: lịch sử trò chuyện, bộ nhớ làm việc, kế hoạch, lịch chạy tự động) là phạm vi yêu cầu tường minh của **SLACK-03B2+**.
  - Cơ chế thẩm định binding trước khi dispatch và tích hợp phê duyệt của Executor thuộc phạm vi **SLACK-03B3**.
  - Các công cụ đọc nội dung và tiêu thụ nguồn tuyệt đối không được kích hoạt live khi luồng F3 đầu-cuối chưa hoàn tất.

### 1.2. Ranh giới Phân đoạn Provenance Đa Workspace (Provenance Segment Boundary):
- `DerivedCopyRef` chỉ đại diện cho một phân đoạn ủy quyền với một full-binding duy nhất (`atiUserId`, `connectionId`, `workspaceId`, `slackUserId`, `identityVersion`).
- Khi một mục tiêu phái sinh gom dữ liệu từ nhiều workspace (ví dụ: Daily Digest đa workspace), bên tiêu thụ 03B2/06C bắt buộc phải lưu trữ và tổng hợp toàn bộ các phân đoạn tương ứng (`authorizationSegments`), đồng thời tái thẩm định (revalidate) từng phân đoạn qua `SlackPolicyService` trước khi hiển thị hoặc gửi vào prompt mô hình. Tuyệt đối không dùng một phân đoạn hợp lệ duy nhất để hợp thức hóa dữ liệu của toàn bộ artifact.

### 1.3. Ngữ nghĩa Ánh xạ Epoch Rào Chắn (Barrier Epoch Mapping):
- Trong bảng `slack_policy_events` của SLACK-02B, giá trị `consent_revision` đại diện cho số thứ tự sửa đổi **SAU** khi trạng thái thay đổi.
- Kịch bản thực tế: Grant 1 (`revision = 1`) -> Revoke Event 2 (`revision = 2`) -> Regrant 3 (`revision = 3`).
- Khi poller xử lý sự kiện Revoke Event 2 chậm trễ, nếu so khớp theo workspace thuần túy sẽ xóa oan dữ liệu của Regrant 3; nếu so khớp bằng (`consent_revision = 2`) sẽ không xóa được nguồn nào vì nguồn cũ mang revision 1.
- Kế hoạch 03B1 thiết lập rào chắn chuẩn tắc:
  `WHERE workspace_id = event.workspace_id AND provider_profile_id = event.provider_id AND consent_revision < event.consent_revision`
  Các bản ghi nguồn mới được cấp quyền lại mang `consent_revision >= event.consent_revision` được bảo toàn nguyên vẹn 100%.

### 1.4. Điều tra Thực tế 7 Nhóm Bản Sao Dữ Liệu Nguồn Hiện Hữu:
1. **History:** Bảng `messages` (`role IN ('user', 'assistant', 'system', 'summary')`, `content`, `metadata`). Consumer phải lưu giữ `sourceRefs` và ẩn/redact toàn bộ khối nội dung không thể tách rời khi nguồn bị purge.
2. **Memory:** Bảng `messages` với `metadata->>'type' = 'working_memory'`, lưu JSON snapshot trong `metadata->'state'`. Bộ lọc memory của planner phải loại bỏ entity khi nguồn bị thu hồi.
3. **Plan Args:** Bảng `plans` (`plan_json`, `plan_text`) và `execution_steps` (`args_json`, `output_json`). Executor phải đối chiếu binding trước khi dispatch.
4. **Proposals:** Bảng tương lai `slack_proposals` (SLACK-06A). Proposal phải mang `sourceRefs` và bị tự động hủy (`auto_dismissed_source_revoked`) nếu nguồn bị tombstone.
5. **Digest:** Bảng tương lai `slack_digests` (SLACK-06C). Toàn bộ digest bị ẩn nếu 1 nguồn thành phần bị thu hồi quyền.
6. **Schedules:** Bảng `schedules` (`request`, `recurrence`, `services`) và `schedule_runs`. Chuyển sang `paused` kèm `pause_reason = 'slack_binding_invalid'` khi mất quyền kênh hoặc ngắt kết nối.
7. **Audit:** Bảng `execution_steps` và audit logs. Chỉ lưu metadata an toàn (IDs, timestamp, status), tuyệt đối không lưu nội dung thô PII.

---

## 2. Danh mục File Tài liệu Đã Hoàn Thành

| STT | Đường dẫn file | Nội dung & Mục đích |
|---|---|---|
| 1 | [`docs/handoff/tasks/SLACK-03B1-source-store-and-invalidation.md`](../tasks/SLACK-03B1-source-store-and-invalidation.md) | Task card chính thức cho SLACK-03B1 với mục tiêu, ranh giới module, điều tra 7 target kinds, DDL schema, tiêu chí nghiệm thu và quy trình TDD |
| 2 | [`docs/superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md`](../../superpowers/plans/2026-10-29-slack-03b1-source-store-and-invalidation.md) | Kế hoạch triển khai kỹ thuật chi tiết theo định dạng Superpowers, gồm 7 Phase: DDL, Repo, Store Service, Invalidation Queue, Policy Event Consumer, Multi-Segment Aggregation, và kịch bản TDD |
| 3 | [`docs/handoff/log/2026-10-29-slack-03b1-source-plan.md`](2026-10-29-slack-03b1-source-plan.md) | Nhật ký bàn giao ghi nhận đầy đủ bối cảnh, các quyết định kiến trúc, đối chiếu PR phụ thuộc và cam kết ranh giới |

---

## 3. Bằng chứng Xác Minh Cơ Học

| Tiêu chí kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| **Ranh giới Sở hữu (Module Ownership)** | `git status --porcelain` | Chỉ tạo đúng 3 file tài liệu mới trong `docs/handoff/tasks/`, `docs/superpowers/plans/`, và `docs/handoff/log/`; không có bất kỳ file source hay config nào bị chạm |
| **Kiểm tra Cú pháp & Khoảng trắng** | `git diff --check ce9380e9` | **EXIT 0**; không có trailing whitespace hay cảnh báo định dạng |
| **Tính Hợp lệ của Liên kết** | Node script kiểm tra path nội bộ | Tất cả các liên kết chéo giữa task card, plan và log đều trỏ đúng file vật lý hiện hữu |
| **Không Thi công Sớm (Zero Runtime Mutation)** | Kiểm tra git diff | Không có bất kỳ dòng mã TypeScript/SQL runtime nào được thi công; tuân thủ nguyên tắc chờ review và chỉ đạo tiếp theo từ điều phối viên |

---

## 4. Kế hoạch Tiếp theo

1. Mở Draft PR trên GitHub với nhánh `docs/slack-03b1-source-plan` nhắm vào nhánh tích hợp `integration/slack-personal-20261029`.
2. Báo cáo trạng thái hoàn tất cho Điều phối viên trưởng qua lệnh `orca orchestration send --type worker_done`.
3. Chuyển sang trạng thái nhàn rỗi (idle prompt) chờ đánh giá độc lập từ Reviewer và chỉ đạo tiếp theo từ Nhóm trưởng.
