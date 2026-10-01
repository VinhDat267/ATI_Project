# 2026-10-02 · Claude Code · Lập lại kế hoạch tuần 3: thêm năm service

- **Bối cảnh:** chủ dự án chốt thêm Google Sheets, Google Calendar, Notion, Telegram, Jira (thay vì chỉ Sheets). Kế hoạch tuần 3 cũ (W3-01 → W3-03 chỉ cho Sheets, cùng PR #25, chưa merge) được thay bằng W3-00 → W3-07 và file yêu cầu chung `tasks/W3-service-common.md`. Tuần 4 giữ nguyên, chỉ sửa phụ thuộc của W4-01 và bộ câu của W4-04.
- **Đọc mã nguồn trên `main` `2ae2a16` trước khi viết. Phát hiện (đã đưa vào W3-00):**
  - Viết cố định theo service ở `tool-schemas/types.ts` (`scopeKey`, `AllowedScope`), `base-adapter.ts` (`assertAllowedScope`), `registered-services.ts` (`normalizeAllowedScope`, regex repo), `server.ts` (adapter giả sandbox bằng chuỗi `if (tool === …)`), `live-execution/harness.ts`, `ReconciliationNotice.tsx` (bảng tên hiển thị), `MissionControlLaunchpad.tsx` (placeholder).
  - `classifyIntent` chạy trên toàn bộ tin nhắn người dùng trong hội thoại và trả `[]` khi câu khớp từ khóa của service đã đăng ký nhưng chưa cấu hình; planner từ chối bằng câu chung không nêu tên service. Với 8 service, một từ khóa rộng (ví dụ `lịch` khớp "lịch sử", "du lịch"; `sprint` có trong câu mẫu Trello; `tin nhắn` của Slack) sẽ làm câu của service khác bị từ chối. Biện pháp: test bất biến từ khóa (không trùng giữa service, danh sách từ cấm), từ chung đưa vào `fallbackIntentKeywords`, câu từ chối nêu tên service thiếu, test định tuyến với service mới chưa cấu hình.
- **Quyết định thiết kế:**
  - Sheets và Calendar dùng chung module service account (JWT tự ký bằng `node:crypto`).
  - Notion và Jira: agent phải đọc tài liệu API hiện hành (Notion đổi mô hình database/data source; Jira đổi endpoint tìm kiếm JQL).
  - Telegram: token nằm trong URL nên có test riêng chống lộ token.
  - Jira: `siteUrl` kiểm chặt để chống SSRF; JQL do adapter dựng.
  - Không service nào có tool xóa hay mời người ngoài.
- **Lịch:** tuần 1–2 xong sớm nên tuần 3 bắt đầu ngay. Mốc chốt catalog 20/10/2026; service chưa merge đạt review trước mốc thì bỏ khỏi phạm vi. Thứ tự bỏ khi thiếu thời gian: Telegram, Jira, Notion, Calendar, Sheets; không bỏ W3-00.
- **Đặc tả:** thêm một đoạn cập nhật 02/10 vào mục 1.4 của đặc tả v3, ghi danh sách năm service và trỏ tới ROADMAP.
- **Việc tiếp theo đề xuất:** giao W3-00 ngay; song song giao W4-02 và phần công cụ của W4-04. Người dùng bắt đầu tạo tài khoản thử nghiệm theo W3-07.
