# UI-01 · Landing workflow story · 03/10/2026

## Phạm vi

Chủ dự án yêu cầu nâng motion có chọn lọc, giữ nhận diện B, hero tương tác và logo marquee; triển khai trực tiếp, không demo mới. Đọc state/README/ba log mới nhất, status/log và mã landing/CSS/hook; tiếp tục codex/ati-ui-b, HEADc6d6e89. Dirty files là công việc của phiên này, không có commit mới/changes của agent khác. Chỉ sửa frontend landing và docs UI-01; không v2/backend/provider writes/commit/deploy/CURRENT-STATE/ROADMAP.

## Kết quả

- LandingPageView.tsx: refs hook story, mask hai dòng tiêu đề, nhãn workflow minh họa và ba fragment chữ nhỏ; roadmap badge thành nút inline, Enter/Space/click/Escape, aria-expanded/controls; CTA cuối giữ callback.
- use-landing-story.ts: IO reveal một lần và gating scroll gần viewport; rAF chỉ khi có input, refs không setState theo frame. Stage01/02/03 theo geometry; mobile tuyến dọc theo offset thật, short-page cap giúp stage03 đạt trước footer. Range không tính chiều cao roadmap mở. Cleanup observers/listeners/media handlers/frames, live reduced-motion changes về static.
- landing-story.css: token6px, fill muted; stage transitions380–400ms, fragment6px; mask750ms/90ms stagger, depth≤10px desktop; roadmap connector400ms trước label, panel350ms/6px; paper light±8px, magnetic±3px/arrow4px, press0.985, nav underline200ms. Mobile/reduced tắt cursor/light/parallax. Không thêm particles/glow/3D/card hoặc rAF loop idle.
- main.tsx import CSS riêng. motion.css bỏ animation-timeline cũ ở how/roadmap/CTA để không chồng transform. Hero hook/markup/front dimensions và marquee animation không thay.
- Roadmap chỉ phân biệt đã tích hợp và đang lên kế hoạch; không tự đặt thứ tự NEXT/LATER hay ngày phát hành. Trạng thái completed của fragment nằm dưới nhãn minh họa.
- DESIGN và task UI-01 cập nhật đúng hiện trạng.

## Kiểm thử

Roadmap test RED thật trước triển khai: không có button Roadmap; sau triển khai PASS. Test mới kiểm geometry cuộn tiến/lùi, coalescing rAF, reduced-motion change, unmount cleanup, trang ngắn và mobile khoảng cách dọc. Test hero media harness cập nhật để hỗ trợ nhiều subscribers/query với matches sống thay vì một listener global, phù hợp hai hook hiện tại; không đổi các assertions drag/inertia. CTA test kiểm cả nút đầu/cuối.

- npm run test -w @wap/chat-web: exit0,27 files/163 tests,4.01s.
- npm run build -w @wap/chat-web: exit0 TypeScript/Vite8.3.0,1915 modules; main310.83kB/gzip96.99, CSS78.42kB/gzip16.87, services7.92kB/gzip2.91; build483ms.
- Sau sửa fixture observer đủ các trường TypeScript và mở rộng test cả CTA, chạy lại landing/landing-story/hero: exit0,3 files/19 tests PASS.
- Sandbox đầu tiên chặn Vite spawn EPERM; chạy lại runtime đã có với quyền auto-review chấp thuận. Không cài dependency. Một build giữa lượt lỗi kiểu fixture IO, đã sửa và build lại PASS. Không full monorepo/E2E suite vì phạm vi frontend landing.

## Browser QA

CUA preview5175, desktop1440×900 và mobile390×844:

- Desktop stage01 →02 →03 theo scroll và ngược lại; finalprogress1 trước footer, không tràn ngang. Mobile tuyến1px dọc, length488px theo geometry thực, stage02 được ghi nhận khi progress0.625; cuối stage03 và token tới số03. Tên/mô tả/fragments vẫn đọc được; không thấy layout nhảy do reveal (không đo CLS tự động).
- Roadmap Enter mở/Escape đóng desktop; click ở viewport mobile mở inline,5 planned services và disclaimer đầy đủ. Mobile connector dọc, không tràn. Không auto-hover reveal để tránh tự thay đổi chiều cao khi đọc.
- Cursor CTA desktop tạo magnetX1.025px/Y−0.396px và paper shift6.793px; mobile style magnetic rỗng. Hiệu ứng có giới hạn theo hook/CSS, không đổi handler.
- Bấm CTA cuối ở mobile chuyển sang workspace của tài khoản đã đăng nhập, composer đọc được và không gửi yêu cầu mới. Sau đó quay lại landing để bàn giao preview.
- Hero mặt sau183° hiển thị đúng, floatati-hero-float; tiếp tục xoay912.848° với keyboard/pointer input, không overflow. Thử native drag cần chờ paint; kết hợp keyboard xác nhận giá trị vượt720°, không tuyên bố đo pause/resume mới bằng ảnh tại từng thời điểm. Bộ11 hero regressions giữ chứng minh pointer threshold/click guard/unbounded/inertia/cleanup/pan-y.
- Marquee giữ18s, bốn group cùng523.802px desktop, loop−25% còn nguyên. Không thêm marquee thứ hai.
- Không có media-emulation capability trong browser hiện tại; reduced-motion kiểm bằng thay đổi media event trong test hook và fallback CSS, chưa đổi OS/ghi hình reduced trực tiếp. Mobile là viewport QA, chưa thao tác touch trên thiết bị vật lý; pan-y/manual-touch regressions và CSS giữ nguyên.

Ảnh: C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/story-desktop.jpg, story-stage2-desktop.jpg, story-roadmap-desktop.jpg, story-mobile.jpg, story-roadmap-mobile.jpg. Không dùng story-stage1-desktop.jpg làm bằng chứng story vì ảnh lúc đó ở hero trước khi cuộn ổn định. Viewport QA reset và giữ tab preview cuối.

Chưa CI/review độc lập/PR/commit/deploy. FE-01/02/03 và service roadmap không đóng.
