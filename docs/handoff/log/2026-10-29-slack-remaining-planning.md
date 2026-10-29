# 29/10/2026 · Lập Kế hoạch và Soạn thảo Task Cards SLACK-03–07

**Ủy quyền:** Chủ dự án chỉ định Trưởng nhóm điều phối / Reviewer (Coordinator) và Antigravity builder xây dựng lộ trình chi tiết bằng tài liệu cho toàn bộ các task Slack còn lại (SLACK-03, 04, 05, 06, 07).
**Phạm vi phiên:** **CHỈ TÀI LIỆU KẾ HOẠCH (Documentation Planning Only)**. Không sửa mã nguồn sản phẩm, không sửa `CURRENT-STATE.md`, `ROADMAP.md`, `SLACK-01B` hoặc `SLACK-02`. Không gọi mô hình thật, không cài ứng dụng Slack live, không bật cờ và không merge PR.
**Nhánh làm việc:** `VinhDat267/docs-slack-remaining-roadmap` · **Base commit:** `fc12e3fb` (sau merge SLACK-01 #183).

---

## 1. Kết quả Bàn giao Tài liệu

Phiên làm việc đã tạo mới 7 tài liệu chuẩn mực đáp ứng đầy đủ quy chuẩn Superpowers `writing-plans` và giao thức bàn giao đa agent `AGENTS.md`:

### A. Năm Task Cards Chi tiết tại `docs/handoff/tasks/`:
1. [`SLACK-03-tool-catalog-and-source-lifecycle.md`](../tasks/SLACK-03-tool-catalog-and-source-lifecycle.md):
   - Phân rã 5 giai đoạn bounded PRs: 03A (Schemas & Contracts), 03B (Source Store & Purge Runner), 03C (Core Conversations & Chat & Users), 03D (Content & Collaboration Families), 03E (Advanced Families & Inventory Reconciliation).
   - Kiểm soát toàn diện 343 method đã đóng băng: 97 method loại trừ có lý do xác đáng, 246 method cần probe; tuyệt đối không tạo generic dispatcher `method + args`.
   - Bảo toàn bất biến F2 (Workspace binding bất biến) và F3 (Tombstone tức thì và cascade purge khi ngắt kết nối hoặc xóa tin).
   - Mở khóa sớm: Cho phép SLACK-04 khởi động ngay sau giai đoạn 03C.
2. [`SLACK-04-ingress-lifecycle-and-execution-safety.md`](../tasks/SLACK-04-ingress-lifecycle-and-execution-safety.md):
   - Ingress ký số HMAC-SHA256 trên raw buffer trong bộ nhớ; chống replay với cửa sổ timestamp 300s; ACK nhanh < 3s.
   - Bảo toàn bất biến F4: Khi cờ automation tắt hoặc workspace tạm dừng, tin nhắn thường được ACK và bỏ qua trong bộ nhớ (không lưu body, không tạo job AI); nhưng sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`) vẫn được xử lý để purge dữ liệu nguồn.
   - Phân giải quyền (Authorizations Fanout) qua app token `apps.event.authorizations.list`; cô lập hoàn toàn nội dung DM giữa các thành viên.
   - An toàn thực thi: Echo Guard đối soát outbox ledger để chặn lặp đệ quy mà không lọc bỏ tin nhắn người dùng tự gõ; trạng thái UNKNOWN khi mạng ngắt quãng sau commit tuyệt đối không tự retry ghi mù.
3. [`SLACK-05-workspace-modes-and-triage-engine.md`](../tasks/SLACK-05-workspace-modes-and-triage-engine.md):
   - Ba chế độ độc lập per `(ATI user, connection)`: Luật, AI, và Kết hợp (Hybrid - mặc định).
   - Ranh giới liên quan cá nhân chuẩn tắc (do chủ dự án phê duyệt): Chỉ tạo đề xuất việc cho tin nhắn mention cá nhân, DM trực tiếp, tự nhận việc, hoặc thread được chủ động theo dõi (`followed_threads`); tin nhắn chung `@here`/`@channel` trả về `no_action`.
   - Cổng kiểm soát F1 Model Policy: Xác minh consent tổ chức và provider không dùng dữ liệu huấn luyện trước MỌI lời gọi mô hình.
   - CAS configuration versioning (`configVersion`), gom tin cùng thread 30s (debounce), giới hạn ngữ cảnh 20 tin / 20k ký tự, và bảo tồn hàng đợi khi chạm trần ngân sách (`paused_budget_exceeded`).
4. [`SLACK-06-inbox-workflows-and-approvals.md`](../tasks/SLACK-06-inbox-workflows-and-approvals.md):
   - Giao diện Hộp đề xuất (Proposal Inbox) trong ATI Cockpit, phân chia theo workspace và danh tính người đại diện, hỗ trợ responsive 1440px / 375px và dark mode.
   - Cổng phê duyệt bắt buộc trước MỌI thao tác ghi (Explicit Approval Gate); xem trước preview chi tiết; chỉnh sửa tham số trong chat tự động sinh kế hoạch và `planHash` mới.
   - Workflows liên dịch vụ thực tế: Slack mention → Trello card + Slack thread reply; bug report → Jira; update → Sheets.
   - Bản tổng hợp hàng ngày (Daily Digest lúc 09:00) tích hợp scheduler (gated by `SCHEDULES_ENABLED`), không tự ý ghi.
   - Thực thi F3 UI Masking: Che hoặc xóa trích đoạn nguồn ngay khi tin nhắn bị xóa hoặc kết nối bị thu hồi.
5. [`SLACK-07-evaluations-and-live-acceptance.md`](../tasks/SLACK-07-evaluations-and-live-acceptance.md):
   - Đóng băng bộ dữ liệu đo (ground truth labels) TRƯỚC lời gọi model đầu tiên; 3 lượt đo / mode (9 runs benchmark).
   - Ngưỡng đạt chuẩn: Precision ≥ 90%, Recall ≥ 85%, 0 unapproved writes (Hard Gate), 0 cross-user leaks (Hard Gate).
   - Nghiệm thu thực tế (P-LIVE) trên cả Free và Pro, 2 người dùng trong cùng workspace, và readback độc lập cho từng nhóm phương thức.
   - Quy trình bật cờ chuẩn tắc: Tách riêng một PR kích hoạt `MYSLACK_ENABLED` và `MYSLACK_AUTOMATION_ENABLED` chỉ sau khi toàn bộ suite đã được nghiệm thu.

### B. Kế hoạch Triển khai Tổng thể:
- [`docs/superpowers/plans/2026-10-29-slack-remaining-delivery.md`](../../superpowers/plans/2026-10-29-slack-remaining-delivery.md):
  - Kế hoạch đầy đủ theo chuẩn `writing-plans`: Header, Global Constraints, Review Focus (5 failure modes chí mạng), Phân rã 18 Tasks chi tiết từ 03A đến 07D.
  - Mỗi task có đầy đủ danh mục files tạo/sửa, interface tiêu chuẩn, và chu trình TDD (Step 1 Red → Step 3 Green → Step 5 Commit).
  - Phân định rõ 3 cấp độ bằng chứng: Offline Fixture Verification (CI xanh không cần secret), External Prerequisites (điều kiện môi trường thật cần người vận hành), và True Release Gates.

---

## 2. Xử lý Cổng Phụ thuộc SLACK-02 (Explicit Review Gate)

SLACK-02 (OAuth cá nhân và multi-workspace repository) đang được lập kế hoạch song song. Để tránh giả lập pass giả:
- Kế hoạch xác định rõ giao diện yêu cầu: `getSlackConnection()`, `getActiveConnectionsForUser()`, `getSlackConsent()`, và interface `SlackConnectionRecord`.
- Thiết lập Review Gate độc lập: Reviewer phải thẩm định interface kết nối trước khi chạy integration test cho các module tiêu thụ ở backend.
- Các task của SLACK-03 có thể thi công tầng schema (03A) và mock adapter contract độc lập mà không cần chờ đợi toàn bộ code SLACK-02 được merge.

---

## 3. Kiểm tra Tự thân (Self-Review & Evidence Gates)

| Hạng mục kiểm tra | Kết quả thực tế |
|---|---|
| Không sửa product code | `git status --porcelain` xác nhận chỉ có file mới trong `docs/` |
| Không sửa `CURRENT-STATE.md` & `ROADMAP.md` | Giữ nguyên 100% theo đúng phân quyền `AGENTS.md` |
| Không sửa file `SLACK-01B` / `SLACK-02` | Không có file nào bị tác động |
| Kiểm tra cú pháp Whitespace / Diff | `git diff --check` sạch sẽ, exit code 0 |
| Mã hóa UTF-8 | Toàn bộ 7 files lưu định dạng UTF-8 không BOM |
| Tính toàn vẹn của liên kết tương đối | Mọi markdown link trỏ đúng cấu trúc thư mục repo |

---

## 4. Bàn giao và Bước tiếp theo

1. Toàn bộ tài liệu được commit vào nhánh `VinhDat267/docs-slack-remaining-roadmap` dưới dạng bản thảo roadmap.
2. Không thực hiện push/PR hay merge trước khi Trưởng nhóm điều phối (Coordinator / Reviewer) kiểm tra độc lập.
3. Gửi thông báo `worker_done` về terminal điều phối và chuyển sang trạng thái chờ chỉ đạo tiếp theo.
