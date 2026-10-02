# 2026-10-03 · Codex · UI-01 bổ sung motion B

Yêu cầu trực tiếp của chủ dự án: giao diện hơi chán, thêm motion. Tiếp tục UI-01 trên `codex/ati-ui-b`, HEAD `c6d6e89`. Trước khi làm đã đọc state/README/ba log mới nhất, status/log. Các thay đổi chưa commit đều là UI-01 của phiên trước; không có thay đổi người khác hoặc commit nền mới.

## Thay đổi

- `apps/chat-web/src/motion.css`: motion token, easing, entrance/sequence cho landing, login, empty workspace, dịch vụ, plan/messages/results. Hover/press ngắn; card dịch vụ đổi border/shadow; modal scale/fade; drawer 320ms. Scroll reveal dùng CSS view timeline có fallback static. Không có motion trang trí chạy lặp vô hạn, không animate kích thước composer/feed hoặc từng token streaming.
- Running halo và succeeded check bám class trạng thái hiện có; không tạo trạng thái/tiến độ giả. Reduced-motion tắt animation, transition và smooth scroll, nhãn trạng thái vẫn giữ.
- `main.tsx` import stylesheet sau CSS nền. `ServicesView.tsx` thêm spinner và aria-busy chỉ lúc request test kết nối thực đang chờ. Không thay API/actions/approval/recovery.
- Cập nhật frontend DESIGN và kết quả task UI-01. Không sửa API/packages/v2/CURRENT-STATE/ROADMAP hoặc `.env`; không cài thư viện, commit, deploy hay gọi ghi ra nhà cung cấp.

## Bằng chứng

- `npm run test -w @wap/chat-web`: exit 0, 25 files / 146 tests PASS. Đây là thay đổi trình bày, không bổ sung test chỉ để soi selector CSS.
- `npm run build -w @wap/chat-web`: exit 0, TypeScript + Vite PASS. Build cuối CSS 68.83kB/gzip14.94, main300.22kB/gzip93.34, services7.92kB/gzip2.91. Test/build ban đầu bị sandbox Windows chặn native dependency/spawn; chạy lại với quyền thực thi đã được chấp thuận thì đạt, không cài lại dependency.
- `git diff --check`: exit 0.
- CUA desktop1440×900/mobile390×844: không overflow ngang; xác nhận animation CSS được áp dụng (dịch vụ delay40/120/200ms, plan60/130/200ms, hero illustration, login rise, succeeded check). Landing scroll tới `#how`: các card hiện opacity1 đúng vị trí; browser hỗ trợ view timeline. Mobile hero thẳng, không giữ rotation desktop. Composer nằm trong viewport. Modal Escape trả focus về Cấu hình; drawer Escape trả focus về menu.
- Mở hội thoại kết quả sandbox đã lưu và accordion plan để kiểm tra; không gửi yêu cầu chat hay duyệt mới. Đăng xuất/đăng nhập lại bằng tài khoản UI QA có sẵn để xem login; không dùng tài khoản hoặc token nhà cung cấp thật. Không bấm Test/Save dịch vụ.

Ảnh: `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/` gồm motion-services-desktop.jpg, motion-landing-desktop.jpg, motion-landing-mobile.jpg, motion-workspace-mobile.jpg, motion-login-mobile.jpg. Preview tiếp tục cổng5175, API sandbox3005. Reset viewport override sau QA.

Giới hạn: đã kiểm tra rule reduced-motion trong stylesheet, chưa thay cài đặt OS để chạy lại toàn bộ UI ở chế độ reduce. Không chạy lại full monorepo/browser suite vì thay đổi chỉ frontend presentation; bộ frontend và build đã chạy. Chưa review độc lập/CI/PR, giữ task chờ chủ dự án xem UI.
