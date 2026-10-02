# 2026-10-03 · Codex · UI-01 độ dày hero

## Phạm vi và thay đổi

Chủ dự án yêu cầu thêm độ dày cho hero đang xoay. Đã đọc state/README/ba log mới nhất, kiểm tra git status/log. Tiếp tục cùng UI-01 trên `codex/ati-ui-b`, HEAD `c6d6e89`; thay đổi chưa commit đều của phiên này, không có thay đổi người khác.

- `LandingPageView.tsx`: thêm14 lớp trang trí aria-hidden trong rotator, không đổi front hoặc hook.
- `motion.css`: cạnh đặc bo góc xanh kem, lớp cách nhau dưới1px; depth14px desktop/10px mobile. Mặt trước Z=0 giữ nguyên; mặt sau Z=−depth. Các lớp và back dùng cùng rollZ−1° desktop/0° mobile. Lớp cạnh không bắt pointer, không tham gia layout. Float4s/−6px, bóng, reduced-motion và drag giữ nguyên.
- Cập nhật DESIGN và kết quả UI-01; không sửa module khác, CURRENT-STATE/ROADMAP, cài dependency, gọi API ghi, commit hoặc deploy.

## Bằng chứng

- `npm run build -w @wap/chat-web`: exit0, TypeScript/Vite PASS,1913 modules; CSS70.09kB/gzip15.29; main304.54kB/gzip94.98.
- `npm run test -w @wap/chat-web -- tests/components/hero-motion.test.tsx tests/components/landing-page-view.test.tsx`: exit0,2 files/11 tests PASS. Chạy kiểm thử hành vi hiện có để kiểm tra lớp trang trí không làm hỏng sự kiện; không thêm test soi selector CSS. Không chạy lại full monorepo.
- CUA desktop1440×900: mặt trước, cạnh75°/90°, back180° đọc đúng chiều;14 layers, depth14px, backZ−14px. Mobile390×844: depth10px, cạnh/back105°, pan-y pinch-zoom, không tràn ngang. Rotation qua bàn phím không reset ở90°. Các lớp không xuất hiện trong accessibility tree. Chưa kiểm phần cứng touch thật; logic Pointer Events được kiểm bằng test hiện có.
- `git diff --check`: PASS. Reset viewport và đưa hero về mặt trước sau QA.

Ảnh: `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/hero-thickness-desktop.jpg`.

Preview: `http://127.0.0.1:5175/?view=landing`. UI-01 vẫn chờ chủ dự án xem/review độc lập; không đóng task roadmap.
