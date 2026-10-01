# 2026-10-01 · Claude Code · Lập kế hoạch tuần 3 và tuần 4

- **Đã làm:** viết 7 task card (W3-01 → W3-03, W4-01 → W4-04) và cập nhật `ROADMAP.md`. Trước khi viết đã đọc mã nguồn trên `main` `2ae2a16` để task card khớp với code.
- **Phát hiện khi đọc code (đã ghi vào task card):**
  - `scopeKey` bị viết cố định thành `'boards' | 'channels' | 'repos'` ở `tool-schemas/types.ts`, `registered-services.ts`, `adapter-factory.ts` và `live-execution/harness.ts`, nên thêm Google Sheets phải sửa cả những chỗ này (W3-02).
  - Ô nhập credentials chỉ có một dòng, nên key của service account được nhập với `\n` dạng chữ (W3-01).
  - Từ "bảng" đang là từ khóa của Trello; Sheets không được dùng "bảng" đơn lẻ làm từ khóa (W3-02).
  - `golden-v2/run.ts` chỉ chạy câu hỏi một lượt; đo "Sửa qua Chat" cần mở rộng runner (W4-02).
- **Quyết định thiết kế:** Google Sheets xác thực bằng service account, tự ký JWT bằng `node:crypto`, không thêm dependency; bốn tool (`list_spreadsheets`, `list_sheets`, `read_range`, `append_rows`); không có tool xóa/sửa ô.
- **Việc của con người cần bắt đầu sớm:** tạo Google service account và spreadsheet thử nghiệm (W3-03); các thành viên viết ≥ 30 câu hỏi đánh giá (W4-01); hẹn ≥ 5 người tham gia buổi thử (W4-03).
- **Việc tiếp theo đề xuất:** giao W3-01 trước; song song có thể giao W4-02 và W4-04.
