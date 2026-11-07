# 2026-11-07 · gemini · PL-03 · Refactor Landing, Login và Signup theo Business-First UX v2.0

- **Nhiệm vụ:** [PL-03 · Landing, đăng nhập và đăng ký (Public & Auth)](../tasks/PL-03-planora-public-auth.md)
- **UX Task:** [PLANORA-UX-01 · Business-First Redesign](../tasks/PLANORA-UX-01-business-first-redesign.md)
- **Worktree:** `feat-planora-pl-03`
- **Nhánh:** `longnguyen005/feat-planora-pl-03`
- **Target branch:** `codex/planora-ui`

---

## 1. Mục tiêu & Bối cảnh

Thực hiện yêu cầu refactor PL-03 đạt chuẩn Business-First UX v2.0 theo kết quả audit ngày 05/11/2026:
- **Hiện trạng trước khi sửa:** Hero và form đăng nhập còn mang cấu trúc khung công nghệ Agentic cũ, copy mang tính nền tảng thay vì nói rõ giá trị công việc.
- **Yêu cầu refactor:**
  1. Tái cấu trúc Hero và copywriting hướng tới giá trị công việc thực tế, loại bỏ thuật ngữ kỹ thuật, sử dụng typography editorial Planora.
  2. Bổ sung các chi tiết nhận diện thương hiệu Planora vào form Đăng nhập, Đăng ký và Quên mật khẩu: vector input icons và endnote chữ ký Planora.
  3. Dọn dẹp markup dư thừa (double tabs wrapper) trong `PlanoraAuthFrame`.
  4. Bảo toàn 100% contracts nghiệp vụ và suite kiểm thử tự động.

---

## 2. Chi tiết các tệp đã sửa đổi

1. **`apps/chat-web/src/pages/Landing/LandingPage.tsx`:**
   - Cập nhật tiêu đề Hero chuẩn Editorial Planora: *"Một lời nhắn. Công việc được kết nối."* với typography serif và nhấn mạnh nghệ thuật `<em>được kết nối.</em>`.
   - Cập nhật đoạn văn Hero tập trung vào giá trị công việc: *"Biến ý tưởng thành kế hoạch trên những công cụ bạn đã quen. Bạn kiểm tra, bạn quyết định — Planora phối hợp các bước còn lại trên GitHub, Trello, Slack, Google Calendar và Sheets."*
   - Cập nhật tiêu đề trang (`meta.title`): *"Planora — Nền tảng điều phối công việc liên dịch vụ"*.
   - Cập nhật văn bản CTA chân trang: *"Bắt đầu trong không gian làm việc của bạn, duyệt trước khi tạo thay đổi."*
   - Cập nhật subtitle đăng ký: *"Tạo tài khoản để bắt đầu kết nối quy trình làm việc cùng Planora."*
   - Tích hợp vector SVG icons (Mail, LockKeyhole, UserRound) vào ô nhập Email, Mật khẩu, Họ tên trong các form Đăng nhập, Đăng ký và Quên mật khẩu.
   - Thêm endnote chữ ký Planora (`.planora-auth-endnote`): *"Một lời nhắn. Một khởi đầu nhẹ nhàng."* ở chân form Đăng nhập và Đăng ký.

2. **`apps/chat-web/src/planora/layout/PlanoraAuthFrame.tsx`:**
   - Loại bỏ thẻ bọc `<div className="planora-auth-tabs">` lồng nhau không cần thiết, render trực tiếp prop `tabs`.

3. **`apps/chat-web/src/planora/styles/auth.css`:**
   - Bổ sung quy tắc CSS cho `.planora-auth-input-icon` và `.planora-auth-input.has-icon-left` để hiển thị icon mượt mà, căn giữa theo chiều dọc và không cản trở tương tác người dùng.

4. **`docs/handoff/tasks/PL-03-planora-public-auth.md`:**
   - Cập nhật phần Kết quả phản ánh đầy đủ các cải tiến Business-First UX v2.0.

---

## 3. Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| `npm run typecheck:v3` | **PASS (exit code 0)** | Chat API & Chat Web 0 lỗi TypeScript |
| `npm run build:v3` | **PASS (exit code 0)** | Build Vite production thành công |
| `node scripts/test-v3-web-build-security.mjs` | **PASS (exit code 0)** | Loại trừ credential sentinels và 7 claim UI bị cấm |
| `npm test -w @wap/chat-web -- tests/fe-08-landing-auth.test.tsx` | **PASS (24/24 tests, exit code 0)** | Toàn bộ suite landing & auth pass |
| `npm test -w @wap/chat-web -- tests/landing-orbital-redesign.test.tsx` | **PASS (5/5 tests, exit code 0)** | 3D Rotator & 3-step workflow pass |
| `npm test -w @wap/chat-web -- tests/components/login-view.test.tsx` | **PASS (10/10 tests, exit code 0)** | Form đăng nhập & validation pass |
| `npm test -w @wap/chat-web -- tests/auth-signup-reset.test.tsx` | **PASS (5/5 tests, exit code 0)** | Đăng ký & reset password pass |
| `npm test -w @wap/chat-web -- tests/auth-google.test.tsx` | **PASS (43/43 tests, exit code 0)** | Luồng Google Auth pass |
| `npm test -w @wap/chat-web -- tests/fe-04b-prototype-foundation.test.tsx` | **PASS (6/6 tests, exit code 0)** | Prototype foundation & 404 scope pass |
| `npm test -w @wap/chat-web` | **PASS (98/98 files, 1080/1080 tests, exit code 0)** | Toàn bộ test suite web xanh sạch |

---

## 4. Trạng thái Bàn giao

- **Trạng thái:** `STATUS: READY_FOR_CODEX_REVIEW`.
- Không sửa `CURRENT-STATE.md` hay `ROADMAP.md` (chỉ reviewer cập nhật sau khi merge).
