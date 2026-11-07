# Nhật ký thi công: Refactor PL-02 theo Design Brief v2.0 & Business-First UX

- **Ngày:** 05/11/2026
- **Người thực hiện:** Antigravity / Gemini 3.8 Flash High
- **Nhiệm vụ:** [PL-02 · Shell, sidebar và không gian cá nhân/tổ chức](../tasks/PL-02-planora-shell-workspaces.md)
- **UX Task:** [PLANORA-UX-01 · Business-First Redesign](../tasks/PLANORA-UX-01-business-first-redesign.md)
- **Worktree:** `feat-planora-pl-02`
- **Nhánh:** `longnguyen005/feat-planora-pl-02`
- **Head SHA:** `965150a9`
- **Base SHA:** `83ea86123b36201f4e00601b384fdb846dee80e0`

---

## 1. Mục tiêu & Bối cảnh

Module PL-02 được refactor để đạt 100% chuẩn Business-First UX theo đặc tả `docs/superpowers/specs/2026-11-05-planora-design-brief.md` (v2.0, MẪU 2: Điều hướng không gian & Hộp thư đề xuất chờ xử lý) và `docs/superpowers/specs/2026-11-05-planora-business-first-ux.md`:
1. **Sidebar Planora (248px desktop / Drawer mobile):**
   - **Phần 1: Nhận diện & Bộ chọn không gian (Workspace Switcher):** Monogram Planora (chữ "P" thanh lịch) + dropdown chọn không gian Cá nhân / Tổ chức / Tạo hoặc tham gia tổ chức. Cơ chế chuyển đổi không gian an toàn: hủy an toàn request đang chờ, tải mới danh sách hội thoại và inbox, tuyệt đối không để lộ dữ liệu nhóm cũ sang nhóm mới.
   - **Phần 2: Điều hướng công việc (Work Navigation):**
     - CTA *"Cuộc trò chuyện mới"* (nổi bật trên nền giấy kem).
     - Mục Hộp thư đề xuất (`/inbox`) kèm badge số lượng thực tế xanh rừng Planora `#3c5741` (`[data-inbox-badge-count]`).
     - *"Hội thoại gần đây"* tích hợp `SidebarHistory`.
     - *"Nhật ký & Lịch chạy"* (`/history`).
   - **Phần 3: Dịch vụ & Tài khoản (Chân sidebar):**
     - *"Kết nối dịch vụ"* (`/settings`): Hiển thị icon vector SVG tự host (Jira, Slack, Google Sheets, Calendar, Trello, GitHub, Notion, Telegram) kèm chỉ báo trạng thái thực tế từ API (connected / warning / disconnected). Tải trạng thái khi xem trang settings hoặc khi có focus/refresh, không gây leak API request không mong muốn trên trang admin/unauthorized.
     - *"Hồ sơ & Đăng xuất"*: Tên người dùng + Avatar ký tự tắt + chuyển đổi giao diện Sáng/Tối (`ati-theme`) + Chính sách an toàn + Đăng xuất.
   - **Biểu tượng (Iconography):** Tuyệt đối 100% icon SVG vector chính thức có `aria-hidden="true"`, CẤM dùng emoji trực tiếp trong markup navigation.
2. **Mobile Drawer (< 1024px):**
   - Nút hamburger và workspace pill sử dụng vector SVG chuẩn có `aria-hidden="true"`.
   - Vòng đời trợ năng hoàn chỉnh: Escape đóng drawer, click backdrop đóng drawer, Tab/Shift+Tab focus trap xoay vòng an toàn bên trong drawer.
3. **App & Routing Integration:**
   - Đăng ký route `/inbox` trong `routes.ts` và map sang tab `'inbox'` trong `App.tsx` cùng fallback container chuẩn Business-First layout.
   - Hỗ trợ prop `inboxBadgeCount` trong `PlanoraShell` và `MainNav`.

---

## 2. Chi tiết các tệp đã sửa đổi

1. **`apps/chat-web/src/planora/layout/PlanoraSidebar.tsx`:**
   - Tái cấu trúc theo 3 phần chuẩn Editorial Planora (Header & Switcher -> Work Nav -> Services & Account Footer).
   - Thêm SVG Monogram Planora (P), nút CTA "Cuộc trò chuyện mới", tab Hộp thư đề xuất (`/inbox`) với badge xanh rừng `#3c5741`.
   - Bổ sung 8 icon vector SVG tự host cho Jira, Slack, Sheets, Calendar, Trello, GitHub, Notion, Telegram hiển thị đèn trạng thái từ API.
   - Quản lý nạp services an toàn (chỉ gọi `getServices` khi `currentTab === 'settings'`, bảo đảm không kích hoạt API request thừa trên trang admin không có quyền).
   - Loại bỏ 100% emoji trần trong markup navigation.

2. **`apps/chat-web/src/planora/layout/PlanoraShell.tsx`:**
   - Thêm prop `inboxBadgeCount`.
   - Khi chuyển đổi không gian làm việc (`handleWorkspaceChange`), kích hoạt sự kiện `inbox:refresh` và `conversations:refresh`.
   - Thay thế các ký tự unicode emoji `☰`, `👤`, `🏢` bằng SVG vector chính thức với `aria-hidden="true"`.
   - Bổ sung kiểm tra `window.getComputedStyle(el).display !== 'none'` khi thu thập focusable elements cho Tab focus trap.

3. **`apps/chat-web/src/planora/styles/shell.css`:**
   - Bổ sung style cho `.planora-nav-item-wrapper`, `.planora-sidebar-services`, `.planora-service-item`, `.planora-service-logo`, và `.planora-service-indicator` (xanh lá connected, cam warning, xám disconnected).

4. **`apps/chat-web/src/routes.ts`:**
   - Thêm route `{ kind: 'inbox', pattern: /^\/inbox\/?$/ }`.

5. **`apps/chat-web/src/App.tsx`:**
   - Bổ sung `case 'inbox': return 'inbox';` trong `getTab`.
   - Render fallback container cho route `/inbox`.

6. **`apps/chat-web/src/components/layout/MainNav.tsx`:**
   - Mở rộng type `NavTab` có thêm `'inbox'`.
   - Bổ sung prop `inboxBadgeCount` và render badge tương thích.

7. **`apps/chat-web/tests/planora-shell.test.tsx`:**
   - Thêm 5 unit/integration tests mới thuộc Suite 8:
     1. Khẳng định menu item `/inbox` hiển thị với badge số lượng đề xuất chờ xử lý màu xanh rừng Planora (`#3c5741`, `[data-inbox-badge-count]`).
     2. Khẳng định chuyển đổi workspace dọn dẹp sạch sẽ store state và không để lộ dữ liệu sang workspace mới.
     3. Khẳng định 100% navigation icons là vector SVG với `aria-hidden="true"`, không có emoji trần.
     4. Khẳng định mobile drawer xử lý trọn vẹn vòng đời trợ năng: mở drawer, click backdrop đóng, phím Escape đóng, Tab/Shift+Tab focus trap xoay vòng.
     5. Khẳng định dải trạng thái kết nối dịch vụ hiển thị 8 SVG tự host kèm đèn trạng thái API thực tế.
   - Tổng số test trong `planora-shell.test.tsx` tăng từ 19 lên 24 tests (toàn bộ PASS).

---

## 3. Bảng Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Kết quả | Ghi chú |
|---|---|---|
| `npm run typecheck:v3` | **PASS (exit code 0)** | Chat API & Chat Web 0 errors |
| `npm test -w @wap/chat-web -- tests/planora-shell.test.tsx` | **PASS (24/24 tests, exit code 0)** | Bao phủ 100% tiêu chí mới v2.0 |
| `npm test -w @wap/chat-web -- tests/admin-users.test.tsx` | **PASS (9/9 tests, exit code 0)** | Kiểm chứng không rò rỉ API request |
| `npm test -w @wap/chat-web -- tests/history-snapshot-race.test.tsx` | **PASS (5/5 tests, exit code 0)** | Kiểm chứng khôi phục nhãn hội thoại |
| `npm test -w @wap/chat-web` | **PASS (98/98 test files, 1080/1080 tests, exit code 0)** | Toàn bộ test suite xanh sạch |
| `npm run build:v3` | **PASS (exit code 0)** | Build Vite production thành công |
| `node scripts/test-v3-web-build-security.mjs` | **PASS (exit code 0)** | Excludes credential sentinels & forbidden UI claims |
| `node --check scripts/test-v3-browser.mjs` | **PASS (exit code 0)** | Cú pháp script kiểm tra trình duyệt hợp lệ |

---

## 4. Trạng thái Bàn giao

- Task PL-02 đã hoàn tất 100% yêu cầu refactor Business-First UX v2.0.
- Sẵn sàng bàn giao cho Codex Review.
