# UI-04 · Trang đăng nhập editorial trực quan

Yêu cầu03/10/2026: hoàn thiện page login, nâng phần editorial sáng tạo/trực quan/đẹp hơn. Tiếp tục Frontend_UXUI HEAD995f5f7, dirty files các lượt trước của cùng agent. Không commit/push/deploy; không v2/backend/dependency/CURRENT-STATE/ROADMAP.

## Hợp đồng

- Giữ palette cream/forest, serif/sans tiếng Việt tự host, nguồn logo chung. Cân chỉnh tỷ lệ trang để phần editorial/form có độ hiện diện, tránh khối nội dung quá nhỏ giữa khoảng trống.
- Editorial dùng một micro workflow có nhãn ví dụ, lựa chọn 01 lời nhắn → 02 kế hoạch → 03 kết nối; không gọi API, không trạng thái giả từ hệ thống. Dùng icon/logo, paper/layers và connector, không neon/dashboard.
- Keyboard tabs/Arrow/Home/End, nội dung readable khi reduced-motion; không tự lặp animation/auto đổi stage. Không ghi service, không thư viện mới.
- Form dùng login API/props hiện có, required/autocomplete, hiện/ẩn mật khẩu, pending/error/keyboard và hỗ trợ tài khoản do quản trị cấp. Không tạo Google/signup/forgot/password flow giả hoặc điền admin credential.
- Mobile form trước, editorial gọn phía sau vẫn xem/chạm được; không ẩn toàn bộ editorial. No overflow, inputs/buttons touch-friendly, không che nội dung khi màn hình thấp.
- Kiểm frontend hành vi thật trong phạm vi + build; browser desktop/mobile và API login fixture local; DESIGN/task/log mới.

## Kết quả

Hoàn thành local03/10/2026; chưa review độc lập/CI/PR.

- LoginStory mới: paper xanh kem, heading serif/italic, ATI seal, ba tab/micro UI lời nhắn-kế hoạch-kết quả với assets logo chung. Một nhãn ví dụ; không API/status thật. Scene chồng grid reserve chiều cao lớn nhất nên không nhảy khi đổi bước, scene khuất aria-hidden/inert. Native keyboard tabs; chỉ state khi user chọn, entrance220ms/reduced-motion, không loop/dep.
- LoginView giữ form/API/Back, thêm field icons/focus/autofill54px, passwordtoggle44px/aria-pressed/disabled pending, error-describedby, aria-busy/chặn submit pending, Caps Lock hint và native details xin tài khoản từ quản trị viên. Không signup/Google/forgot giả/credential injection. Mobile form trước/editorial sau, không ẩn editorial.
- Files lượt này: LoginView.tsx, mới LoginStory.tsx/login.css, login-view.test.tsx, DESIGN/task/log mới. Không sửa App/backend/v2/dependency hay sections khác.
- RED1fail/7pass trước triển khai tab semantics; focused13pass login/navigation, sau đó login9pass. Full cuối34files/193tests exit0,4.77s. TypeScript/Vite build exit0,1921modules/438ms. Main331.01kB(gzip102.29), CSS98.55kB(gzip20.86), không dependency mới. Prettier chỉ4files task. Diff-check PASS.
- CUA desktop1440×900, mobile390×844/320×740: không tràn ngang, form trước/ảnh giấy sau, cuộn bình thường. Mobile paper312.0625px trước/sau đổi kết quả→lời nhắn; 320px paper/scene tự tăng, không clipping. Tab End chọn kết quả/focus đúng; details xin tài khoản mở được. CSS reduced-motion reviewed, không giả lập OS/thiết bị touch vật lý.
- Login API local3006/PostgreSQL fixture Kiểm thử: sai mật khẩu trả lỗi thật, đúng mật khẩu vào workspace; logout xóa phiên, preview quay login trống. Không send/chat/approval/provider writes, không thay tài khoản/database/backend. API cũ không restart.
- Preview5176 `?view=login`, ảnh ngoài repo thư mục ati-implementation/login-editorial-desktop.png và login-editorial-mobile.png. Viewport reset/tab deliverable. HEAD995f5f7/Frontend_UXUI không đổi; không commit/push/deploy/CURRENT-STATE/ROADMAP.
