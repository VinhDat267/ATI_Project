# UI-01 · Đồng bộ logo dịch vụ · 03/10/2026

## Phạm vi và trạng thái

Chủ dự án yêu cầu đồng bộ assets logo chuẩn, kèm ảnh card dịch vụ và ba bước hero còn dùng icon nét. Tiếp tục UI-01 trên codex/ati-ui-b, HEAD c6d6e89. Đã đọc bàn giao và kiểm tra git trước khi sửa; các thay đổi chưa commit là công việc UI của chính phiên này, không có commit mới của agent khác. Không tạo commit/PR/deploy, không sửa CURRENT-STATE/ROADMAP hoặc v2.

## Thay đổi

- Brand.tsx: ServiceLogo và danh mục tám assets; Icon dịch vụ dùng chung component, chức năng khác giữ Lucide. Tên lạ dùng Grid2X2 dự phòng.
- LandingPageView.tsx: marquee dùng ServiceLogo thay img riêng; hero giữ markup Icon hiện có và nhận logo qua danh mục chung.
- ServicesView.tsx: năm chip roadmap dùng logo tương ứng; không thay dữ liệu trạng thái, cấu hình hoặc thao tác kiểm tra.
- index.css/motion.css: card mark32px, giữ tỷ lệ; bỏ khung trung tính quanh mark và hiệu ứng xoay/phóng mark khi hover. Không sửa hero drag/float hay marquee.
- public/logos: giữ ba SVG GitHub/Trello/Slack đã có, thêm Google Sheets/Calendar, Notion, Telegram, Jira từ trang/tài nguyên chính thức. Files giữ nguyên nội dung tải về; README ghi nguồn trực tiếp và trang nguồn. Không thêm thư viện hoặc CDN runtime.
- DESIGN.md và kết quả task UI-01 ghi giao diện thực tế.

Google Sheets/Calendar, Notion, Telegram, Jira vẫn là roadmap chưa cấu hình được. Logo không chứng minh kết nối. ExecutionProgress vẫn dùng icon trạng thái, không thêm thông tin dịch vụ giả.

## Bằng chứng thực tế

- npm run test -w @wap/chat-web: exit0,26 files/158 tests PASS,4.18s.
- npm run build -w @wap/chat-web: exit0, TypeScript và Vite8.3.0 PASS,1913 modules; main304.86kB/gzip95.04, CSS72.13kB/gzip15.65, services7.92kB/gzip2.91.
- Không viết test chỉ phản chiếu markup/logo; dùng bộ regression hiện có. Không chạy lại toàn monorepo vì chỉ assets và frontend trình bày.
- CUA local preview5175: desktop1440×900 hero có ba mark tải đúng; trang dịch vụ có tám ảnh tải đúng, card và roadmap hiển thị đúng. Mobile390×844 card/roadmap đọc được, không tràn ngang; kiểm tra ảnh complete/naturalWidth và kích thước DOM.
- Mở readonly hội thoại sandbox đã lưu882282dc-4e5d-4c3f-a38f-5decbb4e6cee, mở accordion Kế hoạch đã duyệt: ba PlanStepItem GitHub/Trello/Slack tải đúng mark, không overflow. Không gửi chat/duyệt mới, không Save/Test cấu hình dịch vụ, không ghi lên provider thật.
- Trạng thái card Chưa cấu hình lấy từ API local3005. Plan/kết quả snapshot sandbox có nhãn minh họa.

Ảnh ngoài repo tại C:/Users/Admin/.codex/visualizations/2026/10/02/01a0faf0-f9b9-7432-89ab-cfec274816e2/ati-implementation/: logos-hero-desktop.jpg, logos-services-desktop.jpg, logos-services-mobile.jpg, logos-roadmap-mobile.jpg. logos-plan-desktop.jpg chỉ là ảnh accordion trong feed, bằng chứng mark kế hoạch xác nhận bằng DOM.

Chưa review độc lập/CI/merge; FE-01/02/03 vẫn mở. Không thay API/auth, catalog hay adapter.
