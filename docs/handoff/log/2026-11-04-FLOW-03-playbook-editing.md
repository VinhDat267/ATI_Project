# 2026-11-04 · FLOW-03 — Giữ đúng chỉnh sửa mẫu và giá trị biến, đóng khiếm khuyết F3

## 1. Bối cảnh & Mục tiêu
- **Khiếm khuyết F3 (P1):** Trải nghiệm chỉnh sửa Playbook có biến trước đây bị xung đột giữa template gốc và draft đã điền giá trị. Khi người dùng chỉnh sửa văn bản trong ô nhập (textarea), hệ thống không phân biệt rõ đang sửa template hay sửa giá trị điền sẵn, dẫn đến việc mất các token biến (`{{biến_số}}`) khi lưu mẫu mới, hoặc khi lưu mẫu thì mất các câu chỉ dẫn riêng vừa gõ thêm. Ngoài ra, việc gửi form khi chưa điền đủ biến số vẫn bị lọt qua.
- **Mục tiêu của FLOW-03:**
  1. Tách bạch hoàn toàn 3 khái niệm trạng thái trong bộ soạn thảo Cockpit:
     - `templateText`: Chuỗi mẫu chứa các placeholder token `{{tên_biến}}` và các câu ghi chú tuỳ biến của người dùng.
     - `variableValues`: Bảng ánh xạ giá trị biến `Record<string, string>`.
     - `renderedDraft`: Chuỗi văn bản thành phẩm được tính toán bằng cách thay thế các biến đã điền vào `templateText`.
  2. Cung cấp hai chế độ xem trực quan qua tab: "Mẫu" (cho phép sửa nguyên bản nội dung kèm token) và "Nội dung sẽ gửi" (cho phép xem trước kết quả đã thế biến).
  3. Hành vi Lưu Playbook luôn luôn lưu `templateText`, bảo toàn trọn vẹn cả cấu trúc biến lẫn các câu ghi chú/sửa đổi của người dùng.
  4. Chặn gửi yêu cầu khi còn biến số chưa điền, hiển thị cảnh báo đỏ và làm nổi bật các trường biến còn thiếu.
  5. Đặt lại mẫu gốc (Reset) là hành vi người dùng bấm nút rõ ràng, không tự ý kích hoạt ngầm khi sửa biến hay khi lưu.

## 2. Các file đã thay đổi
- `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`: Cài đặt phân tách 3 trạng thái, tab chế độ xem, bộ kiểm tra biến chưa điền, và logic lưu/gửi chuẩn hóa.
- `apps/chat-web/tests/services/playbook-variables-and-catalog.test.tsx`: Bổ sung bài test xác thực bảo toàn chỉnh sửa mẫu và chặn gửi khi thiếu biến.
- `docs/handoff/tasks/FLOW-03-playbook-editing.md`: Cập nhật checklist và kết quả nghiệm thu.

## 3. Bằng chứng kiểm thử thực tế
- **Kiểm thử Playbook Variables & Editing (`apps/chat-web/tests/services/playbook-variables-and-catalog.test.tsx`):**
  - Chạy `npm test -w @wap/chat-web -- tests/services/playbook-variables-and-catalog.test.tsx`: **8/8 passed** (1045ms).
  - Chọn mẫu hệ sinh thái Google Workspace có biến.
  - Người dùng nhập thêm ghi chú tuỳ chỉnh `CHỈ GỬI HẠNH, KHÔNG GỬI KHÁCH`.
  - Bấm lưu Playbook mới `Mẫu riêng của Hạnh` -> Mẫu đã lưu giữ nguyên vẹn cả các token biến và ghi chú tuỳ chỉnh.
  - Thử submit form khi chưa điền biến -> Bị chặn, `onSend` không được gọi.
  - Điền đầy đủ biến `tên_dự_án` và `email_khách` -> Submit thành công với nội dung chứa cả biến đã điền và câu ghi chú tuỳ chỉnh.
- **Toàn bộ Test Suite `@wap/chat-web`:**
  - **109 files / 1.161 tests passed** (69.57s).
- **TypeScript Typecheck:**
  - `npm run typecheck:v3`: **exit code 0**.
