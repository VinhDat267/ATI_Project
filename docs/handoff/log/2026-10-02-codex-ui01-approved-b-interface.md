# UI-01 · Áp dụng bộ giao diện B đã được chọn

Ngày: 02/10/2026 · Agent: Codex · Nhánh: `codex/ati-ui-b` · HEAD nền: `c6d6e89`.

## Yêu cầu và phạm vi

Chủ dự án đã xem bộ preview B nền ấm và yêu cầu triển khai giao diện thật cho workspace, dịch vụ, đăng nhập và giới thiệu. Chat/duyệt/tiến trình/kết quả dùng chung workspace. Task card: `docs/handoff/tasks/UI-01-approved-b-interface.md`. Ban đầu git sạch; tạo nhánh riêng, không đổi nhánh có thay đổi của người khác. Không commit hoặc deploy.

Chỉ sửa `apps/chat-web`, tạo task card và log này. Không sửa API/packages/database/v2/CURRENT-STATE/ROADMAP. Giữ bộ preview cũ ngoài repository.

## Kết quả

- B nền kem/xanh rừng, tiêu đề serif, Be Vietnam Pro cục bộ và logo ATI nối các bước. Landing có mẫu gắn nhãn minh họa, chỉ ba tích hợp hiện có; roadmap tách riêng. Login chỉ dùng credential nhập thực, loại quick-fill/default admin và define Vite chứa mật khẩu.
- Workspace với sidebar lịch sử/tài khoản/dịch vụ, feed cuộn riêng, một composer textarea, draft suggestions, IME và chặn gửi lặp. Kế hoạch chia card, tham số đọc được, ID nguồn không bị đổi thành tên suy đoán; review dock luôn phía trên composer.
- Tiến trình/kết quả dùng trạng thái và output từ SSE/snapshot; link HTTP(S) an toàn, chi tiết thu gọn. Bảo toàn recovery UNKNOWN; đóng modal không Stop, Stop cần xác nhận. Clarification/error kết thúc gather busy.
- Điều hướng query/History API; URL cập nhật ngay lúc chọn để tránh response cũ và effect restore quay về hội thoại trước. Guard revision/snapshot được giữ; regression Back cùng workspace đã chứng minh lỗi trước khi sửa và đạt sau sửa.
- Trang dịch vụ tải lazy, skeleton/error boundary; API list/save/test riêng, scopes và nhãn trường từ API. Connected hiển thị “Đã cấu hình”; chỉ kết quả test mới có “Kiểm tra thành công”. Role do API kiểm tra, không giả chọn Admin. Không lưu credential trong localStorage.
- Tài liệu chi tiết bộ B và giới hạn nằm ở `apps/chat-web/DESIGN.md`.

## Bằng chứng

1. TDD: `b-ui.test.tsx` 7/7 RED trước triển khai, gồm textarea, busy guard, IME, plan ID, link output an toàn, dismissal không Stop và bỏ default admin. Cuối lượt 146/146 test frontend, 25 files PASS (bổ sung dịch vụ API và Back/clarification).
2. `npm run check`: exit 0; typecheck API/web, tests tool-schemas 11, adapters 53, planner 128, executor 25, chat-api 143, chat-web 146, evaluations 66 = 572 Vitest tests PASS; build/launcher/environment tests PASS. Launcher ban đầu fail vì title đổi; giữ nhận diện ATI và hậu tố platform v3 để tương thích smoke test. Sau thay đổi nhỏ giữ `c` khi quay từ landing, frontend test + build chạy lại exit 0.
3. Build cuối: Vite 8.3.0, ServicesView tách chunk 7.84kB, main 300.28kB (gzip 93.36kB), CSS 64.29kB (gzip 13.96kB). Không cài dependency. Bundle scan sentinel, default-admin define và password cấu hình không xuất hiện; kiểm tra không in secret ra log. `git diff --check` exit 0.
4. CUA browser: 1440×900 và 390×844; login, landing, workspace, dịch vụ; không overflow ngang mobile. Điều chỉnh tiêu đề hai dòng, icon bước và textarea không cuộn giả. Drawer Esc trả focus; modal Shift+Tab trap và Escape đóng. Edit chỉ prefill. Duyệt sandbox ba dịch vụ nhận 3/3 succeeded; reload khôi phục output/duration và trạng thái.
5. API sandbox riêng cổng 3005, frontend 5175, DB local riêng tại 55533. Tạo tài khoản local `ui-review-20261002@ati.local` tên “Minh họa UI” để QA; không cấp quyền cấu hình dịch vụ. Không Save/Test credential thật hoặc gửi write tới nhà cung cấp. Log API xác nhận sandbox adapter cho github/trello/slack. Hội thoại minh họa chờ duyệt để xem: `1295a2d4-8875-4335-b993-b34d2c590cc2`; hội thoại kết quả sandbox: `882282dc-4e5d-4c3f-a38f-5decbb4e6cee`.

Ảnh bên ngoài repository: `C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/`: workspace-desktop.jpg, workspace-mobile.jpg, results-mobile.jpg, services-desktop.jpg, services-mobile.jpg, landing-desktop.jpg, landing-mobile.jpg, login-desktop.jpg, login-mobile.jpg. Log kiểm tra tại `apps/chat-web/ui-check-output.log` và `ui-test-output.log` (ignored, không đưa vào commit).

## Chưa nghiệm thu ngoài phạm vi

Không đóng FE-01/02/03; chưa bổ sung auth/signup/Google/reset, role API, resourceLabels, pagination, dịch planner hoặc API runtime health. Nhãn mode frontend chỉ là cấu hình chạy/build, không phải chứng nhận mode backend. Sandbox không chứng minh nghiệm thu live đa dịch vụ. Chưa chạy nguyên bộ Playwright E2E (selector đã cập nhật), chưa review độc lập/CI/PR/commit/deploy. Reviewer tiếp theo cần đọc task, chạy checks và browser suite khi lập PR.
