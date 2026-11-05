# 2026-11-05 · gemini · PL-06 · Refactor PL-06 theo Design Brief v2.0 & Business-First UX

- **Đã làm:**
  - **Refactor `PlanMoment.tsx` (Mẫu 4 — Chuẩn D5 & D8):**
    - Xóa bỏ hoàn toàn accordion "Chi tiết kỹ thuật" và khối `<pre>{JSON.stringify(plan, null, 2)}</pre>` (loại bỏ dứt điểm `UX-F1`).
    - Xóa bỏ hiển thị raw hash code `plan_hash` trên UI; giữ thuộc tính `data-plan-hash` và `data-plan-id` ngầm trên container ẩn để bảo toàn verification binding.
    - Busy locking (chống click đúp): Khi người dùng bấm duyệt, nút lập tức chuyển sang trạng thái bận (`isApproving = true`, `disabled = true`, hiển thị spinner + "Đang xử lý..."), ngăn chặn tuyệt đối phát sinh 2 request đồng thời.
    - Vòng đời Kế hoạch (Chuẩn D5): Khi bấm "Sửa qua Chat" (`onEdit`), khóa thẻ kế hoạch cũ với độ mờ nhẹ (`opacity-70`), gắn huy hiệu trạng thái: *"Đã thay thế bằng đề xuất mới trong cuộc trò chuyện"*, vô hiệu hóa nút duyệt để chống bấm nhầm vào đề xuất cũ.
    - Action Bar: Với kế hoạch 1 bước, sử dụng động từ cụ thể (*"Gửi tin nhắn Slack ngay"*, *"Lưu vào bảng tính"*...); từ 2 bước trở lên dùng *"Duyệt và thực hiện X việc"*.
    - Màu tương phản chuẩn D8: Cập nhật token `--planora-on-primary: #171c18` trong dark mode của `tokens.css`, đảm bảo nút Primary Dark `#8fb68e` kết hợp chữ Than tối `#171c18` đạt tỷ lệ tương phản 7.61:1 (chuẩn WCAG AA ≥ 4.5:1).
  - **Refactor `PlanoraWorkflowSteps.tsx` (Loại bỏ triệt để Orbital Flow cũ — UX-F2 & Chuẩn D1):**
    - Xóa bỏ toàn bộ đồ họa orbital flow engine cũ: `OrbitalNodeButton`, `orbitalAssets`, `getOrbitalMeta`, `DottedConnector`, `showStatusBubble`, Make.com Router và các hoạt họa SVG chấm kết nối quỹ đạo.
    - Thay thế bằng Chuỗi Thẻ Công việc Trực quan (Step Cards) tuần tự thanh lịch theo bản sắc Planora (nền kem/dark, viền mộc, Be Vietnam Pro).
    - Phân định trung thực dữ liệu (Chuẩn D1):
      - Bước đọc (`mysheets.read_range`, `trello.list_cards`, v.v.) trong kế hoạch hiển thị nhãn: *"Sẽ đọc khi bạn duyệt kế hoạch"*. Tuyệt đối không bịa số lượng nhiệm vụ giả.
      - Bước tiếp theo có tham số phụ thuộc kết quả bước đọc (`$ref`, `$template`): Bản xem trước hiển thị placeholder thanh lịch: `‹danh sách công việc đọc ở bước 1›` (hoặc bước X tương ứng).
      - Hiển thị đầy đủ tham số nghiệp vụ thực tế (người gửi, kênh đích, tiêu đề) mà không dump JSON thô.
    - Thanh điều hướng dịch vụ dạng badge/pill tinh tế, bảo toàn các selector `workflow-node-${svc}` và cơ chế highlight card tương ứng khi chọn.
  - **Refactor `ReceiptMoment.tsx` & `ExecutionMoment.tsx`:**
    - Xóa bỏ raw JSON dump trong `<pre>` của ReceiptMoment.
    - Hiển thị biên nhận kết quả thanh lịch với permalink thực tế (*"Xem tin nhắn vừa gửi trên Slack"*, *"Mở bảng tính Google Sheets"*...).
    - Giữ nguyên tiến trình thực thi thời gian thực theo SSE của server, không dùng thanh % giả.
  - **Refactor `PreviewContents.tsx`:**
    - Bổ sung `formatBusinessArgValue`: hiển thị placeholder `‹danh sách công việc đọc ở bước 1›` khi tham chiếu kết quả bước đọc.
  - **Cập nhật & bổ sung unit tests trong `planora-workflow-steps.test.tsx`:**
    - 16 tests chuyên sâu kiểm chứng đầy đủ các tiêu chuẩn nghiệm thu mới (không còn raw JSON/`plan_hash`, bước đọc có nhãn D1, placeholder D1, busy locking, badge thay thế D5, tương phản WCAG AA dark mode ≥ 4.5:1).

- **PR / commit:**
  - Nhánh: `longnguyen005/feat-planora-pl-06` (target `codex/planora-ui`).
  - Worktree: `C:\Users\Admin\orca\workspaces\ATI_Project\feat-planora-pl-06`.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).

- **Kiểm tra đã chạy (lệnh và kết quả thật):**
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm test -w @wap/chat-web`: PASS (101/101 test files, 1131/1131 tests, exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).

- **Trạng thái:** `STATUS: READY_FOR_REVIEW`.
