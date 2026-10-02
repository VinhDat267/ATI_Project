# 2026-10-03 · Codex · UI-01 logo marquee

## Phạm vi và kết quả

Chủ dự án yêu cầu ba logo tự chạy ngang liên tục kiểu infinite loop, sau đó yêu cầu bỏ nút tạm dừng. Đã đọc state/README/ba log mới nhất, status/log; tiếp tục UI-01 trên `codex/ati-ui-b`, HEAD `c6d6e89`, toàn bộ changes của phiên này.

- `LandingPageView.tsx`: bốn nhóm logo cùng nội dung; chỉ nhóm đầu accessible, ba bản sao aria-hidden. Heading đứng yên. Bản cuối đã bỏ nút tạm dừng, React state và handler theo chỉ dẫn mới nhất.
- `index.css`: viewport720px tối đa, overflow hidden, mask mờ6% hai đầu; các nhóm width intrinsic, gap64px/trailing padding64px desktop,40px mobile. Logo32px; tên22px desktop/18px mobile. Không thay artwork hoặc gọi CDN.
- `motion.css`: track transform0→−25% (chính xác một trong bốn nhóm),18s linear infinite. Hover dừng bằng play-state, rời ra resume không reset. Reduced-motion tắt animation, ẩn bản sao/mask, bố trí ba dịch vụ static/wrap (mobile vertical). Không JS rAF/timer/listener cho marquee hoặc dependency mới.
- DESIGN/task cập nhật; không sửa hero, API/packages/v2/CURRENT-STATE/ROADMAP, không gọi dịch vụ ghi, commit/deploy.

## Bằng chứng

- `npm run build -w @wap/chat-web`: exit0, TypeScript/Vite PASS;1913 modules; CSS71.10kB/gzip15.53, main305.04kB/gzip95.13.
- `npm run test -w @wap/chat-web -- tests/components/landing-page-view.test.tsx tests/components/hero-motion.test.tsx`: exit0,2 files/14 tests PASS. Kiểm tên tích hợp chỉ đọc3 lần qua3 listitems accessible; CTA/roadmap/hero vẫn đạt. Không full monorepo run vì chỉ presentation landing.
- CUA desktop1440×900: animation ati-logo-marquee18s/running; bốn nhóm cùng width523.802px (sai số subpixel), track2095.208px, viewport720px. Shift25% bằng một nhóm; ba nhóm còn lại đủ phủ viewport toàn vòng. Transform thay đổi theo thời gian. Mobile390×844 chạy ngang, không overflow. Bản cuối cả desktop/mobile section có0 buttons.
- Bản trung gian tạm dừng có browser xác nhận matrix giữ nguyên qua hai lần quan sát và resume tiếp tục; điều khiển bằng nút đã bị loại bỏ theo user, không báo là tính năng còn tồn tại. Rule hover pause vẫn giữ; chưa kiểm lại hover native hoặc OS reduced-motion trực tiếp. Reduced fallback kiểm qua CSS, không coi là đã đổi OS.
- `git diff --check`: PASS. Reset viewport sau QA; giữ preview chạy tại section dịch vụ.

Ảnh: `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/marquee-desktop.jpg`, `marquee-mobile.jpg` (bản cuối không nút).

Preview: `http://127.0.0.1:5175/?view=landing#ecosystem`. UI-01 vẫn chờ chủ dự án xem và review độc lập; roadmap không đóng.
