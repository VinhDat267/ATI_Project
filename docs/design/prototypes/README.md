# Bản mẫu giao diện ATI (05/10/2026)

Mười hai trang HTML tự chứa, làm bằng OpenDesign và review qua nhiều vòng ngày 05/10/2026. Bản mẫu làm theo design system **Agentic** của Open Design. Từ 07/10/2026 bản React của các trang này được **đưa thẳng vào app** (task FE-04b → FE-10, đặc tả mục 1, 1.1, 1.2 bản 07/10). Design system mà bản mẫu thật sự dùng (màu sáng/tối, chữ, bo góc, bóng, thành phần, chỗ lệch giữa các trang và giá trị chuẩn cho màn mới) ghi ở [`../design-system.md`](../design-system.md).

Thư mục [`react/`](react/README.md) chứa bản React của các trang này (cùng công nghệ với `apps/chat-web`, giữ nguyên design system), kèm script so từng phần tử và từng pixel với bản HTML. Đây là nguồn để chép trang sang `apps/chat-web`.

Đặc tả đi kèm: [`docs/superpowers/specs/2026-10-05-ui-redesign-agentic-design.md`](../../superpowers/specs/2026-10-05-ui-redesign-agentic-design.md). Khi bản mẫu và đặc tả khác nhau, theo bản mẫu, trừ các điểm ở đặc tả mục 1.1 (bản 07/10), nhất là mục 6 quy tắc trung thực. Các điều chỉnh riêng cho app trước đây (chữ tối thiểu 14px, nền `#F6F6F1`, mục 3.2 điểm 3–4) không còn áp dụng.

## Cách xem

Mở trực tiếp file `.html` bằng trình duyệt (cần mạng để tải Tailwind CDN và Google Fonts). Các trang liên kết với nhau bằng đường dẫn tương đối; bắt đầu từ `index.html` (khách) hoặc `app-stage.html` (đã đăng nhập).

| File | Nội dung |
|---|---|
| `index.html` | Trang giới thiệu, modal đăng nhập/đăng ký/quên mật khẩu/Google, mô phỏng email duyệt |
| `app-stage.html` | Cockpit 9 khoảnh khắc (phím 1–9 hoặc nút "Kịch bản demo"), ngăn lịch sử, ngăn hội thoại, menu người dùng, dải thử nghiệm |
| `responses.html` | Từ chối và hỏi lại: dịch vụ chưa kết nối, việc chưa làm được, yêu cầu chỉ để xem, không thấy nơi cần ghi |
| `settings.html` | Kết nối dịch vụ (`settings.html#notion` mở thẳng ngăn Notion) |
| `account.html` | Tài khoản: hồ sơ, đổi mật khẩu, phiên đăng nhập, liên kết Google |
| `users.html` | Quản lý người dùng: chờ duyệt, thành viên, khoá/mở khoá, vai trò |
| `history.html` | Lịch sử hội thoại: tìm kiếm, đổi tên, tải thêm |
| `auth-action.html` | Xác minh email, đặt lại mật khẩu, đăng nhập Google, chờ duyệt, bị khoá, sai mật khẩu quá nhiều |
| `errors.html` | Mất mạng khi đang ghi, mất mạng, hết phiên, lập kế hoạch lâu, lỗi máy chủ, 404 |
| `guide.html` | Hướng dẫn lấy khoá 8 dịch vụ, mẫu câu lệnh, việc làm được/chưa làm được |
| `privacy.html` | Chính sách an toàn và dữ liệu |
| `404.html` | Không tìm thấy trang |
| `theme.css`, `theme.js` | Chế độ Sáng/Tối cho bản mẫu (ghi đè class Tailwind v3, khoá `localStorage` là `ati-theme`). App làm bằng token theo đặc tả mục 8, không dùng hai file này |

## Những thứ chỉ có trong bản mẫu

- Nút "Kịch bản demo", "Xem như: Quản trị viên / Thành viên", "Máy chủ: Thử nghiệm / Thật", "Thử biến thể", dữ liệu mẫu và mọi thao tác giả lập (lưu, kiểm tra kết nối, gửi email) đều là công cụ trình diễn.
- Tên người, email (`@congty.vn`, `@example.com`), ID dịch vụ trong bản mẫu là dữ liệu bịa để minh hoạ.
- Bản mẫu dùng Tailwind v3 CDN và nhiều chữ 10–12px; app dùng Tailwind v4 và cỡ chữ tối thiểu 14px.
