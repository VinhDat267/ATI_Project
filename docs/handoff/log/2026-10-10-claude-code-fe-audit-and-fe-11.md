# 2026-10-10 · claude-code · audit frontend, task card FE-11

- **Đã làm:** audit các task FE trên `main` `c99b7ba` theo yêu cầu người dùng, rồi gom mọi lỗi frontend còn mở vào task card [FE-11](../tasks/FE-11-frontend-bugfixes.md). ROADMAP thêm dòng FE-11; CURRENT-STATE mục 5 thêm một dòng kết quả audit và ghi chú dòng minor sandbox FE-01 đã lỗi thời.
- **PR / commit:** nhánh `docs/fe-11-task-card`.
- **Kiểm tra đã chạy (lệnh và kết quả):**
  - `npm run typecheck:v3` exit 0; `npm run build:v3` exit 0 (cảnh báo bundle 779 kB > 500 kB).
  - `npm test -w @wap/chat-web`: 642/643, exit 1; ca fail `auth-google.test.tsx` "shows enabled Google action… on /login" (`findByRole` quá 1 giây, 1.650 ms) khi app, Vite và build chạy cùng lúc. Chạy riêng file 3 lần: 41/41 mỗi lần.
  - App sandbox (PostgreSQL 16 tmpfs tạm ở 56533, API 3091, web 5191, tài khoản test của CI), Playwright: 10 route công khai và 11 route sau đăng nhập, mỗi route 1440/375 × sáng/tối (84 tổ hợp): 0 cuộn ngang, 0 control thiếu nhãn, 0 lỗi JavaScript; trang đăng nhập có hai `h1` nhưng trang nền `inert`/`aria-hidden` và form trong dialog `aria-modal` (đúng); `/settings#notion` mở dialog có nhãn, focus trong dialog.
  - Tái hiện lỗi: `/c/<id>` → `POST /api/auth/logout-all` → tải lại → `/login` "Phiên đăng nhập đã hết hạn" → đăng nhập → `/`; `/settings#notion` chưa đăng nhập → đăng nhập → `/`. `curl /api/conversations/khong-ton-tai` HTTP 500, `/api/conversations/00000000-0000-0000-0000-000000000000` HTTP 404.
  - Môi trường thử đã dọn: tắt tiến trình 3091/5191, xoá container PostgreSQL tạm.
- **Chưa làm / vấn đề phát hiện:** không chạy full `npm run check`/browser ở máy (CI `main` xanh); không thử luồng duyệt/thực thi, chế độ live, đo tương phản (FE-10). Lỗi đã biết khác không kiểm lại ngoài việc đối chiếu mã (còn: `Workspace.tsx:121`, regex `ResponseMoment.tsx:15-16`, `PlanningErrors.tsx:51`, `use-sse.ts:311`).
- **Việc tiếp theo đề xuất:** FE-11 đã giao `longnguyen005` (người dùng chốt 10/10), làm phần A trước 20/10 và trước FE-10; review khi có PR.
