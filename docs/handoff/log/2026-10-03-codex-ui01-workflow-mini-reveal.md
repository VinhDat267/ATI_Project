# UI-01 · Minh họa trong card và scroll reveal · 03/10/2026

## Phạm vi

Chủ dự án muốn nội dung card trực quan bằng icon/giao diện nhỏ, cuộn đến đâu xuất hiện đến đó. Đọc CURRENT-STATE/README/AGENTS/ba log mới nhất, team-workflow và scope v3; git status/log: Frontend_UXUI HEAD995f5f7, bốn file dirty là thay đổi card hover của chính phiên trước. Không có commit của agent khác; tiếp tục UI-01 và nhánh hiện tại, giữ các changes này.

Chỉ sửa LandingPageView.tsx, landing-story.css, regression landing-story.test.tsx và docs UI-01/DESIGN/log mới. Không sửa hook/hero/marquee logic, backend/v2/shared package/dependency/CURRENT-STATE/ROADMAP; không API ghi dịch vụ thật/commit/push/deploy.

## Kết quả

- Fragment chữ thành WorkflowIllustration nội bộ:01 mini chat với tác giả Bạn, bubble yêu cầu và icon gửi trang trí;02 ba hàng logo/hành động/nơi nhận và trạng thái Chờ bạn duyệt;03 cùng tài nguyên, dấu check và kết quả mẫu.
- Mỗi minh họa có group/tên truy cập và nhãn Minh họa; nhãn chung giữ nguyên. Dùng ServiceLogo/Icon hiện có (SVG local/Lucide), không cài thư viện. Không input/button/link giả, không handler hoặc fetch trong minh họa, không giả dữ liệu runtime. Hoàn tất là ví dụ minh họa, không trạng thái service thật. Roadmap năm dịch vụ giữ planned và disclaimer.
- Panel nhỏ radius12px, min-height248px, chat dùng flex để footer nằm dưới, cùng hệ cream/green. Mô tả/h3/số vẫn giữ; card outer hover−6px/bóng mềm/active tint của lượt trước còn nguyên.
- Đánh dấu từng card và các section tích hợp/roadmap/CTA vào IntersectionObserver sẵn có, không tạo observer/frame loop/setState theo cuộn mới. Threshold0.12, reveal một lần rồi unobserve. CSS opacity/translate650ms/14px, delay0/75/150ms desktop, mobile không delay. Thuộc tính translate độc lập với hover transform; bố cục có sẵn, không animate width/height/display. Focus-within hiện ngay không transition cho section có control; không aria-hidden/inert nội dung vì animation. Reduced-motion hoặc thiếu IO: enhancement không bật, nội dung tĩnh đọc được; cleanup vốn có giữ nguyên.

## Kiểm thử

- Test mới RED thật trước sửa: observer chưa observe card; exit1,1 failed/4 passed. Sau thêm targets, npm run test -w @wap/chat-web -- tests/components/landing-page-view.test.tsx tests/components/landing-story.test.tsx tests/components/hero-motion.test.tsx exit0:3 files/20 tests PASS,937ms. Test kiểm intersection false không reveal, chỉ card nhận entry true reveal/unobserve, card khác chưa reveal, reduced change bỏ enhancement và giữ nội dung. Không dùng test này thay chứng minh browser/CSS.
- Build sau căn chỉnh preview: exit0 TypeScript/Vite8.3.0,1915 modules,375ms; CSS81.99kB/gzip17.52, main312.69kB/gzip97.43, services7.92kB/gzip2.91. Sau QA thêm một rule focus-within transition:none; diff-check PASS. Không full monorepo/E2E vì phạm vi landing frontend.

## Browser QA

CUA tại5175, desktop1440×900/mobile390×844:

- Desktop mở từ đầu: cả ba card dưới viewport opacity0/data-revealed chưa có. Bấm Cách hoạt động/cuộn đến: cả ba revealed=true/opacity1, logo sáu ảnh trong plan/result tải đúng. ScrollWidth1425≤1440. Mini UI đọc đầy đủ; tiến trình/active tint vẫn hoạt động. Hover vẫn−6px, translate riêng trở vềnone. Ảnh desktop có surrounding heading/rail/cards/roadmap.
- Mobile: lúc đến how,01 revealed/opacity1,02 ởy810 và03 ởy1322 chưa revealed/opacity0. Cuộn thường:02 revealed,03 vẫnopacity0; cuộn tiếp03 revealed/active, progress1, token100%, rail995px từ offset thực. Cards transformnone, scrollWidth375≤390; không tràn ngang. Cuộn không chặn; minh họa nhỏ không bắt pointer. Viewport QA, không thiết bị touch thật.
- Roadmap mobile click mở/Escape đóng; Tab từ Roadmap tới CTA cuối đúng focus, panel opacity1/focus-withintrue. Không submit CTA hoặc gọi API.
- HMR giữ effect cũ không quan sát các target mới thêm trong lúc hot update; đã tải lại trang để kiểm tra từ mount mới. Đây là QA ở môi trường dev, không bỏ qua kiểm tra reveal. Không đo CLS tự động; không thấy bố cục nhảy vì reveal.
- Reduced-motion kiểm regression media change và CSS fallback, không thay OS/browser media emulation trong lượt này. Không tuyên bố xác minh giảm chuyển động bằng thiết bị thật. Logic cleanup không sửa, regression unmount PASS.

Ảnh ngoài repo tại C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/: workflow-mini-desktop.jpg, workflow-mini-mobile-01.jpg, workflow-mini-mobile-02.jpg, workflow-mini-mobile-03.jpg.

Preview frontend còn chạy tại http://127.0.0.1:5175/?view=landing#how; không khởi động/kiểm tra backend trong lượt này. Không thay old preview5174. Kết quả mới local, chưa CI/review độc lập/PR/commit/push/deploy, FE-01/02/03 và roadmap dịch vụ vẫn mở.
