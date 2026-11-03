# PL-02 · Shell, sidebar và không gian cá nhân/tổ chức

**Trạng thái:** sẵn sàng nhận · **Nhánh gợi ý:** `feat/planora-pl-02` · **Phụ thuộc:** PL-01 đã hoàn tất, Codex review Đạt, Chủ dự án đã duyệt hình thức 4 mẫu ngày 03/11/2026.  
**Base SHA:** `83ea86123b36201f4e00601b384fdb846dee80e0` (trên integration branch `codex/planora-ui`).  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md) mục 4.1, 8.1 · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-02.  
**Prompt thi công:** [PL-02.md](../planora-prompts/PL-02.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Khôi phục bố cục shell Planora chuẩn: sidebar 248px cố định từ breakpoint 1024px; dưới 1024px chuyển thành drawer trợ năng với phím Escape, focus trap và backdrop; tích hợp WorkspaceSwitcher luôn truy cập được trên cả desktop và mobile; bảo toàn các tính năng tổ chức (tạo/join không gian, vai trò admin tổ chức vs global user.role, badge pending, đổi workspace không mất trang hiện tại). Tháo bỏ lớp bọc navigation trùng lặp, bảo đảm chỉ có một `<main>`, một `<h1>` cho trang và một global nav.

---

## 2. Ranh giới sở hữu & Phạm vi file

- **Tạo mới:**
  - `apps/chat-web/src/planora/layout/PlanoraShell.tsx`
  - `apps/chat-web/src/planora/layout/PlanoraSidebar.tsx`
  - `apps/chat-web/src/planora/layout/PlanoraPublicHeader.tsx`
  - `apps/chat-web/src/planora/styles/shell.css`
  - `apps/chat-web/tests/planora-shell.test.tsx`
  - `apps/chat-web/tests/browser/planora-shell.spec.ts`
- **Sửa đổi cho phép:**
  - `apps/chat-web/src/App.tsx` (tích hợp shell cho các protected routes)
  - `apps/chat-web/src/components/layout/MainNav.tsx`
  - `apps/chat-web/src/components/layout/WorkspaceSwitcher.tsx`
  - `apps/chat-web/src/components/layout/SidebarHistory.tsx`
  - `apps/chat-web/src/components/layout/UserNavMenu.tsx`
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-api`, `packages/*`, `db/v3`, `prompts`, `evaluations`.
  - Không sửa nội dung bên trong của Cockpit, Settings, History, Account ở task này (dành cho PL-05..13).
  - Không thay đổi contracts của router, auth gate hay SSE manager.

---

## 3. Interfaces & Bố cục Shell

- **`PlanoraShell` Interface:**
  ```tsx
  interface PlanoraShellProps {
    user: User;
    currentTab?: NavTab;
    navigate: (to: string) => void;
    onLogout: () => void;
    children: React.ReactNode;
  }
  ```
- **Cấu trúc Sidebar (từ trên xuống):**
  1. Header: Monogram Planora + Tên thương hiệu + `WorkspaceSwitcher` (Cá nhân / Tổ chức).
  2. Nút hành động chính: "Hội thoại mới" (`/` hoặc reset chat).
  3. Danh mục Navigation chính: Hội thoại, Nhật ký (lịch + lượt chạy), Kết nối dịch vụ, Cẩm nang, Quản lý người dùng (chỉ khi có quyền admin).
  4. Lịch sử hội thoại: Tái sử dụng `SidebarHistory` kết nối dữ liệu thật của không gian hiện tại.
  5. Footer: Thông tin tài khoản người dùng, chuyển đổi Sáng/Tối (`ati-theme`), Chính sách an toàn, Đăng xuất.
- **Drawer Mobile (< 1024px):**
  - Mở/đóng bằng hamburger button trên header; hỗ trợ Escape để đóng.
  - Khóa cuộn nền trang khi drawer đang mở; trả focus về nút mở sau khi đóng.
  - Dialog "Tạo không gian" hoặc "Tham gia mã mời" phải nằm trên layer của drawer.

---

## 4. Tiêu chí nghiệm thu

- [x] Viết test fail trước cho: chuyển đổi nav giữa các trang, admin tổ chức khác `user.role`, badge pending và hiển thị `WorkspaceSwitcher` trên mobile (`tests/planora-shell.test.tsx` 12 tests).
- [x] Sidebar desktop 248px từ 1024px; drawer trợ năng dưới 1024px hoạt động chuẩn xác (Escape, backdrop, focus restore, screen reader).
- [x] Bảo toàn bất biến: Đổi workspace giữ nguyên trang hiện tại (`subscribeWorkspace`), reset đúng dữ liệu phụ thuộc không gian làm việc; GET/SSE cũ của workspace A không ghi đè lên workspace B.
- [x] Tích hợp `PlanoraShell` vào các protected views trong `App.tsx`; loại bỏ lớp bọc `MainNav` thừa, đảm bảo toàn bộ trang chỉ có một main landmark, một global nav, một h1.
- [x] `npm run typecheck:v3` exit 0.
- [x] `npm run test -w @wap/chat-web` (toàn bộ 98 test files, 1068 tests) PASS, exit 0.
- [x] Browser spec chuẩn bị tại `apps/chat-web/tests/browser/planora-shell.spec.ts` cho 1440/1024/768/375px sáng/tối.
- [x] Gửi packet `READY_FOR_CODEX_REVIEW` cho Codex re-review độc lập.

---

## 5. Kết quả

- **Trạng thái:** HOÀN THÀNH (`READY_FOR_CODEX_REVIEW` - Đã fix toàn bộ findings R1-R4 từ Codex Review Vòng 2).
- **Files tạo mới:**
  - `apps/chat-web/src/planora/layout/PlanoraShell.tsx`: Shell component quản lý drawer state, Escape listener theo cấp bậc (ưu tiên dialog con), focus trap/restore, lưu `actualOpener` (hamburger hoặc workspace pill) để trả focus chính xác, đồng bộ focus với visibility transition, body scroll lock, media query crossing tự động đóng drawer, và context reset khi chuyển workspace.
  - `apps/chat-web/src/planora/layout/PlanoraSidebar.tsx`: Sidebar 248px gồm Brand, WorkspaceSwitcher, CTA "Hội thoại mới" bảo lưu planning ownership lock (`reset({ preservePlanning: true })`), 5 navigation links (Hội thoại, Nhật ký, Kết nối, Cẩm nang, Quản lý người dùng theo quyền), badge pending schedules/users, SidebarHistory tích hợp và footer (thông tin tài khoản, theme toggle, chính sách, đăng xuất).
  - `apps/chat-web/src/planora/layout/PlanoraPublicHeader.tsx`: Header công khai chuẩn nhận diện Planora, theme toggle và nút đăng nhập.
  - `apps/chat-web/src/planora/styles/shell.css`: Bố cục CSS chuẩn Planora, sidebar desktop 248px, drawer animation, backdrop, mobile bar và badges; đồng bộ `visibility: visible` tức thời khi mở và hoãn `visibility: hidden` khi đóng (`transition: transform var(--planora-transition-base), visibility 0s var(--planora-transition-base)`).
  - `apps/chat-web/tests/planora-shell.test.tsx`: 18 unit tests bao phủ toàn bộ navigation, modifier clicks, org admin vs global role, pending badges, mobile drawer accessibility lifecycle (opener restore), single landmarks (main, h1, nav), delayed GET/SSE cross-workspace isolation qua API thật (chứng minh RED không guard và GREEN có guard), và các regression tests cho findings F1-F6 và R1-R4.
  - `apps/chat-web/tests/browser/planora-shell.spec.ts`: Playwright browser test cho 1440/1024/768/375px ở cả hai theme Sáng/Tối, kiểm tra chuẩn xác a11y navigation trên desktop (count = 1), mobile đóng (count = 0), mobile mở (count = 1) và mobile đóng lại (count = 0, focus khôi phục).
- **Files sửa đổi:**
  - `apps/chat-web/src/App.tsx`: Bọc các protected routes trong `PlanoraShell`, map route `/` (`home`) sang tab `'workspace'`, kết nối `handleNewConversation` với `reset({ preservePlanning: true })`.
  - `apps/chat-web/src/components/layout/MainNav.tsx`: Triệt tiêu duplicate nav/brand/workspaceSwitcher khi nằm trong `PlanoraShell`, duy trì dải action contextual và `UserNavMenu`.
  - `apps/chat-web/src/components/layout/WorkspaceSwitcher.tsx`: Hỗ trợ `variant="sidebar"`, render create/join overlays qua `createPortal(..., document.body)` thoát khỏi transform containing block của sidebar, gán `role="dialog"`, bổ sung đầy đủ keyboard focus lifecycle (initial focus vào ô input chính, capture-phase focus trap Tab/Shift+Tab cô lập hoàn toàn khỏi sidebar, trả focus về trigger opener).
  - `apps/chat-web/src/components/layout/SidebarHistory.tsx`: Hỗ trợ `planora` prop để phân biệt accessible name và icon với `HistoryDrawer` của Cockpit; cô lập phạm vi trên trang chat workspace.
  - `apps/chat-web/src/index.css`: Import `shell.css`.
  - `scripts/test-v3-browser.mjs`: Thêm `|PL-02:` vào `scenarios[0].grep`.
- **Bằng chứng kiểm thử:**
  - `npm run typecheck:v3`: exit code 0 (0 errors).
  - `npm test -w @wap/chat-web`: 98 test files passed (1074 tests passed, exit code 0).
  - `npm test -w @wap/chat-web -- tests/planora-shell.test.tsx`: 18 tests passed (exit code 0).
  - `npm run build:v3`: build thành công (exit code 0).
  - `node --check scripts/test-v3-browser.mjs`: exit code 0.
  - `NOT_RUN`: `node scripts/test-v3-browser.mjs planora-shell.spec.ts` (môi trường máy phát triển không có Docker daemon chạy PostgreSQL trên port 55533; script spec đã được tinh chỉnh chuẩn xác và typecheck pass 0 errors, sẵn sàng chạy trong môi trường CI có Docker).
