# 2026-10-08 · Claude Code · Ghi kết quả chạy thử lập kế hoạch live sau #113

- **Đã làm:**
  - Ghi vào CURRENT-STATE (mục 3 và hàng gateway ở mục 5) kết quả Codex chạy thử lập kế hoạch ở chế độ live sau #113. Người dùng chuyển báo cáo cho Claude Code; báo cáo gốc ở máy nhóm trưởng, không commit.
  - Tóm tắt kết quả (Codex chạy trên `main` `ca7bc26`, `RUNTIME_MODE=live`, PostgreSQL tmpfs riêng ở cổng 55471):
    - một yêu cầu tạo GitHub issue qua trình duyệt, đúng 1 lần gọi model;
    - gateway HTTP 200: yêu cầu `ag/gemini-3.8-flash`, phản hồi `gemini-3.8-flash-n`, provider chấp nhận;
    - gọi model 7,6 s; kế hoạch lưu sau 9,1 s tính từ lúc bấm gửi;
    - kế hoạch 1 bước `github.create_issue`, đúng repo/tiêu đề/nội dung, trạng thái `pending`; SSE báo `planning`, `plan_preview`, `waiting_for_approval`; tải lại trang vẫn hiện bản xem trước;
    - không bấm duyệt: 0 bước thực thi, không tạo issue thật.
  - Codex ghi lại cả các lần script hỗ trợ của chính nó lỗi (selector nút gửi, coi 404 của execution là lỗi). Các lỗi này không phải lỗi app và không gọi thêm model.
- **PR / commit:** nhánh `docs/live-planning-smoke`.
- **Kiểm tra đã chạy (lệnh và kết quả):** Claude Code đọc báo cáo và danh sách bằng chứng (`request.json`, `model-calls.jsonl`, `plan.json`, `result.json`, `preview.png`, `no-execution.json`, `app.log`); không chạy lại live. Chỉ sửa tài liệu.
- **Chưa làm / vấn đề phát hiện:**
  - Đây chỉ là kiểm tra lập kế hoạch, chưa phải nghiệm thu thực thi live hay W3-11.
  - 9,1 s không phải phép đo latency sản phẩm.
- **Việc tiếp theo đề xuất:**
  - W3-10 (#102), giờ đo được với model này;
  - W3-11 (năm service mới qua frontend live).
