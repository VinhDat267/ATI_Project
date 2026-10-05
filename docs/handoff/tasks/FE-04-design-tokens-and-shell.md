# FE-04 · Token Agentic, font, chế độ tối và khung trang mới

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-04-design-tokens-shell` · **Phụ thuộc:** không · **Mốc:** 10/10/2026
**Đặc tả:** [UI redesign](../../superpowers/specs/2026-10-05-ui-redesign-agentic-design.md) mục 3, 4, 7, 8 · **Bản mẫu:** `app-stage.html` (thanh trên, menu người dùng, dải thử nghiệm), `theme.js` (hành vi Sáng/Tối)

## Vì sao quan trọng

Mọi task FE-05 → FE-10 dựng trên token và khung trang này. Làm token trước giúp các task sau không tự đặt màu/cỡ chữ riêng, và chế độ tối có sẵn cho mọi màn hình thay vì vá từng trang như ở bản mẫu.

## Hiện trạng

- `apps/chat-web/src/index.css` dùng font Space Grotesk, nền trắng `#ffffff`, chữ `#1d1d1f`; không có token màu, không có chế độ tối.
- Màu viết thẳng trong component (`bg-[#0071e3]`, `text-zinc-…`), lệch design system Agentic.
- `UserNavMenu` nằm cuối sidebar; chữ viết tắt avatar lấy hai ký tự đầu của tên ("Lan Nguyễn" → "LA").
- Dải "Chế độ thử nghiệm" là một dòng chữ trong `Workspace`.

## Việc cần làm

1. **Token** (đặc tả 3.1, 3.3) khai báo bằng CSS variable trong `index.css`, cho cả sáng và tối; tạo class Tailwind v4 qua `@theme`. Không viết thẳng mã màu trong component mới.
2. **Font:** Be Vietnam Pro (chữ thường), Playfair Display (tiêu đề), JetBrains Mono (mã/ID). Thang chữ 14/16/18/24/32/40, không dùng cỡ nhỏ hơn 14px.
3. **Chế độ tối** (đặc tả mục 8):
   - `@custom-variant dark` theo class;
   - script inline trong `index.html` đặt class trước khi React chạy;
   - hook `useTheme()` đọc/ghi `ati-theme` trong `try/catch`, theo hệ điều hành khi chưa chọn, đồng bộ giữa tab qua sự kiện `storage`;
   - nút Sáng/Tối có `aria-label` đổi theo trạng thái và `aria-pressed`.
4. **Khung trang đã đăng nhập** (`AppShell`):
   - thanh trên: logo, nút lịch sử, nút Sáng/Tối, avatar mở menu người dùng;
   - menu người dùng theo đặc tả mục 4 (`role="menu"`, phím mũi tên, Esc trả focus về avatar, bấm ra ngoài thì đóng); mục "Quản lý người dùng" chỉ cho quản trị viên;
   - chữ viết tắt avatar: chữ đầu của từ đầu và từ cuối;
   - dải "Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật" khi `runtimeMode === 'sandbox'`, có nút "Là gì?" mở một dòng giải thích, không có nút tắt; dưới 640px hiện bản ngắn "Thử nghiệm · không gọi dịch vụ thật";
   - không còn dòng "Chưa xác định được chế độ chạy" nhấp nháy khi đang tải.
5. **Route mới** `/settings`, `/history`, `/guide`, `/privacy`: tạm hiển thị nội dung hiện có (`/settings` mở nội dung `SettingsModal` dạng trang) hoặc trang trống có tiêu đề, để FE-07/09/10 điền sau. `/guide`, `/privacy` xem được khi chưa đăng nhập.
6. Áp token cho các thành phần dùng chung đang có (nút, ô nhập, thẻ) để app không lẫn hai phong cách trong thời gian chờ các task sau.

## Tiêu chí nghiệm thu

- [ ] Test: `useTheme` đọc lựa chọn đã lưu, theo hệ điều hành khi chưa chọn, không lỗi khi `localStorage` ném lỗi, đổi theo sự kiện `storage`.
- [ ] Test: chữ viết tắt avatar ("Lan Nguyễn" → "LN", "an" → "A", tên rỗng thì lấy email).
- [ ] Test: menu người dùng ẩn "Quản lý người dùng" với thành viên; phím mũi tên/Esc/bấm ra ngoài hoạt động; Esc trả focus về avatar.
- [ ] Test tương phản: mọi cặp chữ/nền khai báo trong token đạt ≥ 4,5:1 ở cả hai chế độ, trừ danh sách ngoại lệ đặc tả 3.2.1.
- [ ] Browser: tải trang ở chế độ tối không thấy nền sáng trước khi React chạy (chụp màn hình ngay sau `load`).
- [ ] Route mới truy cập được; `/guide`, `/privacy` không cần đăng nhập.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0; browser spec bị ảnh hưởng được cập nhật trong cùng PR.

## Ngoài phạm vi

Nội dung cockpit (FE-05/06), trang Kết nối dịch vụ (FE-07), các trang auth/tài khoản/lịch sử (FE-08/09), Cẩm nang/Chính sách (FE-10).

## Kết quả

- Đã triển khai trên `vinhdat/feat-fe-04-shell`, từ `0d279a9`; code được nghiệm thu tại `189417e48053815078b6468548db2f86b83fcb83`. Token/font sáng-tối, theme bootstrap và đồng bộ tab, AppShell/menu/banner, bốn route và Settings page dùng lại logic hiện có; cấu trúc cockpit và các màn hình thuộc FE-05→FE-10 giữ phạm vi riêng.
- RED trước tính năng và regression được ghi nhận thật. Review độc lập đầu phát hiện bốn P2: locator AUTH-05, weight nút cam, tương phản chữ dark, kích thước vùng chạm. Đã sửa đủ bốn; reviewer kiểm lại delta và các gate, kết luận Đạt.
- Reviewer chạy `npm run check`: exit 0, **1.270 v3** (47 schema + 340 adapter + 188 planner + 25 executor + 331 API + 339 web), **165 evaluation offline**, typecheck/build/scan bundle/launcher/guards đạt.
- Reviewer chạy nguyên lệnh `npm run test:browser:v3`: exit 0, **39/39**, đủ **11 scenario**. Giữ các assertion logout/DB rename/Google link-unlink/refresh; bổ sung bảy test FE-04, gồm năm ca CSS thực tế cho weight, contrast và vùng chạm. Kết quả browser cũ 32 pass/2 fail là bằng chứng lỗi trước sửa, không tính là đạt.
- Ảnh desktop 1440/mobile 375 sáng-tối và menu/Settings đã được xem trực tiếp. Weight nút 600, vùng chạm ≥40×40, đoạn cảnh báo dark đạt 9,5665:1; Settings đúng một main/một h1, không thấy overflow ở các trạng thái kiểm. Bằng chứng chi tiết lưu riêng.
- PR/CI remote và merge còn chờ tại thời điểm bàn giao này. Model/dịch vụ thật và screen reader **NOT_RUN**; browser dùng sandbox/OIDC fixture, không đụng DB dev 15433. Xem [nhật ký FE-04](../log/2026-10-05-codex-FE-04.md).
