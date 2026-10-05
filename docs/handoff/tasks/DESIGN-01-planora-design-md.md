# DESIGN-01 · Chuẩn hóa DESIGN.md của Planora

## Yêu cầu

Chủ dự án yêu cầu dùng getdesign.md để chuẩn hóa tài liệu, giữ phong cách
Planora kem/xanh rừng/editorial. Không thiết kế lại code hoặc deploy.

## Phạm vi

- DESIGN.md ở gốc: front matter tokens và9mục của collection getdesign.md.
- apps/chat-web/DESIGN.md: trỏ về tài liệu chính, không nhân đôi palette.
- Task này và một log bàn giao. Không sửa System Design lịch sử/v2,
  source UI/API, CURRENT-STATE hoặc ROADMAP.

## Nghiệm thu

- Palette/fonts/layout/motion đối chiếu CSS/hook hiện tại.
- Page inventory đúng7view, chat/review/progress/result cùng workspace.
- Phân biệt source code, cloud capabilities và roadmap.
- Loading theo chunk/API/process, responsive, keyboard/reduced-motion và
  trạng thái component có quy tắc cụ thể.
- Links tương đối tồn tại,9sections/front matter đọc được, diff-check đạt;
  không có credential hoặc tuyên bố test/browser chưa chạy.

## Kết quả

- Đã viết tài liệu riêng của Planora theo cấu trúc collection chính thức,
  không sao chép phong cách brand khác hoặc sử dụng generator trả phí.
- Thay root ATI/Airtable cũ bằng Planora; app doc trỏ về root.
- Runtime read-only ngày05/10: health200 accounts/conversations=true,
  planning/execution/signup=false; auth/config200 signupEnabled/googleEnabled=false.
- Values lấy từ index/login/settings/sidebar/story/motion CSS và hooks;
  checklist UI mới tách khỏi mô tả triển khai hiện tại.
- Kiểm tra nội dung/diff ghi trong log cùng task; chưa thay ứng dụng.
