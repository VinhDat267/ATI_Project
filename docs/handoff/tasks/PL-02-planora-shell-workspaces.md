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

- [ ] Viết test fail trước cho: chuyển đổi nav giữa các trang, admin tổ chức khác `user.role`, badge pending và hiển thị `WorkspaceSwitcher` trên mobile.
- [ ] Sidebar desktop 248px từ 1024px; drawer trợ năng dưới 1024px hoạt động chuẩn xác (Escape, backdrop, focus restore, screen reader).
- [ ] Bảo toàn bất biến: Đổi workspace giữ nguyên trang hiện tại (`subscribeWorkspace`), reset đúng dữ liệu phụ thuộc không gian làm việc; GET/SSE cũ của workspace A không ghi đè lên workspace B.
- [ ] Tích hợp `PlanoraShell` vào các protected views trong `App.tsx`; loại bỏ lớp bọc `MainNav` thừa, đảm bảo toàn bộ trang chỉ có một main landmark, một global nav, một h1.
- [ ] `npm run typecheck:v3` exit 0.
- [ ] `npm run test -w @wap/chat-web` (bao gồm tests mới và các regression liên quan đến nav/workspace/admin) PASS, exit 0.
- [ ] Chụp ảnh kiểm chứng tại 1440, 1024, 768, 375 ở cả hai theme Sáng/Tối.
- [ ] Gửi packet `READY_FOR_CODEX_REVIEW` cho Codex re-review độc lập.

---

## 5. Kết quả

*(Worker điền sau khi hoàn thành nhiệm vụ)*
