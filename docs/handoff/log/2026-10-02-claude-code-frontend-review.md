# 2026-10-02 · Claude Code · Review frontend `apps/chat-web`

- **Phạm vi:**
  - đọc code `apps/chat-web/src` trên `main` `2ae2a16` (4.636 dòng; lớn nhất là `LandingPageView` 611, `App` 542, `MissionControlLaunchpad` 365, `use-sse` 343);
  - chạy app ở chế độ sandbox (PostgreSQL thật, planner mock, adapter giả) trong trình duyệt: trang giới thiệu, đăng nhập, gửi yêu cầu, xem trước plan, duyệt, thực thi, tải lại trang, cài đặt dịch vụ, màn hình điện thoại 375 px;
  - build thật bằng `vite build`;
  - quét accessibility bằng script trong trình duyệt.
- **Lỗi nghiêm trọng (đã xác nhận):**
  1. Trong hộp thoại lỗi thực thi, Esc / bấm ra ngoài / ✕ gọi `onClose={handleStop}`, tức **dừng hẳn quy trình**. Test `partial-failure-modal.test.tsx:42` đang khóa hành vi này.
  2. `vite build` với `.env` hiện tại **đóng gói mật khẩu admin thật** vào JS (`vite.config.ts` gán `VITE_DEFAULT_ADMIN_PASSWORD` khi không phải live). Chỉ kiểm tra có/không, không in giá trị; bản build thử đã xóa.
  3. Launchpad viết cứng "LIVE INTEGRATIONS STATUS ✓ 4/4 Dịch vụ hoạt động tốt", có cả Google Sheets. Cùng phiên đó, màn hình "Cài đặt dịch vụ" hiện Trello/Slack "Chưa cấu hình". Quy trình mẫu hứa đồng bộ pull request, chuyển card sang Done, ghi Sheets: không có tool nào làm được.
  4. Sandbox luôn trả cùng một plan soạn sẵn. Hỏi về GitHub issue thì nhận plan Trello sửa CSS; giao diện không báo đang ở chế độ thử nghiệm.
  5. Trang giới thiệu có số liệu chưa đo ("< 10s", "80%", "95%", "loại bỏ 100% sai sót") và liệt kê Gmail/Jira/Notion như đã có.
- **Lỗi trung bình:**
  - plan preview chỉ hiện ID, không có nhãn Đọc/Ghi;
  - kết quả thực thi là JSON thô, link không bấm được;
  - SSE gặp 401 khi mở lại kết nối (tab ẩn quá 15 phút) thì chết im lặng; kết luận từ đọc code, chưa tái hiện;
  - nút Back không đổi màn hình (không có `popstate`); tải lại trang mất hội thoại đang mở;
  - lịch sử toàn "Hội thoại mới" (API không có `title`), giới hạn cứng 50, không phân trang;
  - màn hình trống bị cuộn xuống đáy;
  - ID giả khi API lỗi (`conv-<timestamp>`, `plan_default`); hủy plan lỗi vẫn ẩn plan;
  - chuỗi tiếng Anh ("Failed to fetch", "I could not find Frontend…");
  - khôi phục phiên xóa token khi gặp bất kỳ lỗi nào.
- **Điểm tốt (đã kiểm):**
  - form đăng nhập gắn nhãn đúng, có `autocomplete`;
  - không có `dangerouslySetInnerHTML`;
  - tham số `$ref`/`$template` được hiển thị dễ đọc;
  - SSE chống trùng sự kiện theo `seq`;
  - không tràn ngang ở 375 px;
  - bundle 342 KB (gzip 98 KB).
- **Lỗi kế hoạch phát hiện thêm:** W4-03 cho phép đo "tỉ lệ plan dùng được" ở sandbox, nhưng sandbox dùng planner mock nên phép đo vô nghĩa. Đã sửa W4-03 sang live với model thật, mặc định bấm Hủy.
- **Đã làm:**
  - viết FE-01 (an toàn và nội dung sai sự thật), FE-02 (điều hướng, tách `App.tsx`, lịch sử), FE-03 (plan và kết quả dễ đọc, SSE, tiếng Việt, accessibility);
  - cập nhật `ROADMAP.md`;
  - AUTH-common và W3-00b: phần giao diện chờ FE-02 (W3-00b chờ cả FE-01).
- **Việc tiếp theo đề xuất:** giao FE-01 và FE-02 ngay, song song với W3-00 và AUTH-01. FE-01 cần xong trước mọi buổi demo.
