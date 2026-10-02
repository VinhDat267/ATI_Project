# 2026-10-03 · Codex · UI-01 bóng và nhịp float hero

## Phạm vi

Chủ dự án yêu cầu thêm một chút bóng và motion lên xuống nhanh hơn. Tiếp tục UI-01 trên nhánh `codex/ati-ui-b`, HEAD `c6d6e89`; thay đổi chưa commit đều của cùng phiên UI. Đã đọc CURRENT-STATE, README, ba log mới nhất và kiểm tra git trước khi sửa. Không sửa phần khác của trang hay logic Pointer Events.

## Thay đổi

- `apps/chat-web/src/motion.css`: hai mặt dùng bóng `0 6px 16px #2e382d08, 0 22px 42px -16px #2e382d24`; float5s→4s, ease-in-out, biên độ vẫn0→−6px→0.
- Cập nhật `apps/chat-web/DESIGN.md` và kết quả UI-01. Không thêm thư viện, không gọi API ghi, không commit/deploy.

## Kiểm chứng

- `npm run build -w @wap/chat-web`: exit0, TypeScript/Vite PASS;1913 modules, CSS69.76kB/gzip15.19, main304.34kB/gzip94.89.
- CUA desktop1440×900 và mobile390×844: computed animation-duration4s; bóng thực rgba(46,56,45,0.03) và rgba(46,56,45,0.14); document không tràn ngang. Desktop đã xem và lưu ảnh preview. Reset viewport sau kiểm tra.
- Không chạy lại test hành vi vì lượt này chỉ sửa CSS bóng/chu kỳ. Bằng chứng155 tests và tương tác drag/click/reduced-motion của lượt trước nằm trong `2026-10-03-codex-ui01-hero-3d.md`, không coi đó là lần chạy mới.
- `git diff --check`: PASS.

Preview: `http://127.0.0.1:5175/?view=landing`.

Ảnh: `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/hero-shadow-desktop.jpg`.

UI-01 tiếp tục chờ chủ dự án xem và review độc lập; không đóng các task roadmap.
