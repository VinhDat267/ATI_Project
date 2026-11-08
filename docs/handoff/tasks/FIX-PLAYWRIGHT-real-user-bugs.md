# FIX-PLAYWRIGHT · Đóng gói các lỗi trải nghiệm workflow

**Trạng thái:** Đang kiểm tra trước PR · **Nhánh:** `fix/playwright-real-user-bugs` · **Ngày:** 07/11/2026.

## Phạm vi

Chủ dự án yêu cầu commit, push và tạo PR cho các thay đổi đang có trên nhánh này. Nhánh bắt đầu từ `caa6cc5652dcb651a72061329efa1f54bdf80886`; base PR là `main`. Đây là phần sửa hồi quy trong quá trình hoàn thiện [FLOW-07](FLOW-07-live-acceptance.md), không chứng nhận đủ nghiệm thu live của FLOW-07.

- GitHub: bỏ refresh token cũ khi access token đang dùng thuộc loại `gho_`/`ghp_`.
- Trello: phân biệt grant không còn hợp lệ với lỗi cấu hình client; giữ nguyên phân loại lỗi mạng/server và không đưa provider payload vào thông báo lỗi.
- Cockpit/Playbook: ưu tiên dịch vụ cá nhân đã cấu hình, tên dịch vụ dễ đọc, phân biệt cấp lại quyền và chọn tài nguyên; Gmail tắt thì ẩn quy trình dùng Gmail, Gmail bật nhưng chưa nối vẫn có hướng dẫn kết nối.
- Router: tên Slack/GitHub trong một đoạn nội dung Docs được đặt trong dấu ngoặc kép không làm phát sinh yêu cầu dùng hai dịch vụ đó.
- DeepSeek: kiểm tra model `deepseek-flash` được gửi đúng như cấu hình ở cả endpoint mặc định và gateway tùy chỉnh.

## Tiêu chí bàn giao

- [x] Giữ snapshot 10 file ban đầu và kiểm tra trong worktree riêng không có `.env` live.
- [x] Chạy ca hồi quy, typecheck và sửa lỗi đã tái hiện trước khi commit.
- [x] Review độc lập không còn P1/P2 cụ thể trong phạm vi đã sửa.
- [ ] Chạy đầy đủ `npm run check` và Chromium phù hợp; ghi output/exit code.
- [ ] Commit đúng file, push đúng nhánh, mở PR theo template và ghi SHA/CI.

## Kết quả

Đang chạy kiểm tra tổng; chưa merge và chưa chứng nhận native OAuth/provider/model. Bằng chứng cuối được ghi ở [log bàn giao](../log/2026-11-07-FIX-PLAYWRIGHT-publish.md).
