# Báo cáo Review Độc lập — PL-02 (Round 5: Refactor Business-First UX v2.0)

- **Reviewer:** Antigravity / Gemini 4 Argon (High); model ID `gemini-4-argon-high`
- **Ngày review:** 05/11/2026 (thực chạy 07/11/2026)
- **Task:** [PL-02 · Shell, sidebar và không gian cá nhân/tổ chức](../tasks/PL-02-planora-shell-workspaces.md)
- **UX Task:** `docs/handoff/tasks/PLANORA-UX-01-business-first-redesign.md`
- **PR_URL hoặc LOCAL_ONLY:** `LOCAL_ONLY`
- **Target Branch:** `longnguyen005/feat-planora-pl-02` (target tích hợp: `codex/planora-ui`)
- **Task Base SHA:** `83ea86123b36201f4e00601b384fdb846dee80e0`
- **Round 5 Base SHA:** `965150a9d80418d85354b7b3e8c6e8fff1fedd90`
- **Reviewed Head SHA:** `f19ceed319271a7ec3c0005f133d4747665dc18c`
- **Worktree review:** `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-02-r5` (branch `longnguyen005/review-planora-pl-02-r5`)

---

## 1. Xác minh Git, Head SHA & Phạm vi File

- `git rev-parse HEAD` và `git rev-parse longnguyen005/feat-planora-pl-02` đều khớp chính xác SHA 40 ký tự: `f19ceed319271a7ec3c0005f133d4747665dc18c`.
- Diff giữa `965150a9d80418d85354b7b3e8c6e8fff1fedd90..f19ceed319271a7ec3c0005f133d4747665dc18c` gồm 9 files nằm đúng phạm vi cho phép của card PL-02 (`apps/chat-web/src/App.tsx`, `apps/chat-web/src/routes.ts`, `apps/chat-web/src/components/layout/MainNav.tsx`, `apps/chat-web/src/planora/layout/PlanoraShell.tsx`, `apps/chat-web/src/planora/layout/PlanoraSidebar.tsx`, `apps/chat-web/src/planora/styles/shell.css`, `apps/chat-web/tests/planora-shell.test.tsx`, task card và log bàn giao).
- Không có thay đổi trái phép sang `apps/chat-api`, `packages/*`, `db/v3`, `prompts`, `evaluations`, `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 2. Kiểm tra Trọng tâm theo Design Brief v2.0 (MẪU 2) & Business-First UX

### 2.1. Cấu trúc Sidebar Planora (248px Desktop / Drawer Mobile)
1. **Header (`PlanoraSidebar.tsx:254-269`):**
   - Hiển thị Monogram Planora (`Brand` + `PlanoraMark` chữ "P" vector SVG thanh lịch) kèm nút đóng drawer trên mobile (`CloseIcon` SVG) và `WorkspaceSwitcher` (`variant="sidebar"`).
   - Hỗ trợ chuyển đổi giữa Không gian Cá nhân và Tổ chức, tạo/tham gia tổ chức qua `createPortal(..., document.body)` thoát khỏi transform containing block của sidebar.
2. **Điều hướng công việc (`PlanoraSidebar.tsx:271-403`):**
   - Nút CTA *"Cuộc trò chuyện mới"* (`.planora-new-chat-btn`) nổi bật, gọi `onNewConversation` / `reset({ preservePlanning: true })` bảo toàn khóa in-flight planning của hội thoại cũ.
   - Mục *Hộp thư đề xuất* (`/inbox`) kèm badge số lượng đề xuất thực tế (`[data-inbox-badge-count]`) sử dụng class `.planora-badge-count` với nền xanh rừng Planora `background-color: var(--planora-primary)` (`#3c5741` ở Light mode, `#8fb68e` ở Dark mode) và chữ `var(--planora-on-primary)`.
   - Mục *Hội thoại gần đây* tái sử dụng `SidebarHistory` khi `currentTab === 'workspace'`.
   - Mục *Nhật ký & Lịch chạy* (`/history`) kèm badge `[data-schedule-count]`, cùng *Kết nối dịch vụ* (`/settings`), *Cẩm nang* (`/guide`), và *Người dùng* (`/admin/users` phân quyền đúng theo org admin vs global `user.role`).
3. **Chân Sidebar (`PlanoraSidebar.tsx:338-384, 406-446`):**
   - Dải trạng thái kết nối dịch vụ (`.planora-sidebar-services`) hiển thị 8 icon vector SVG tự host (`ServiceLogo`: Jira, Slack, Google Sheets, Google Calendar, Trello, GitHub, Notion, Telegram) kèm đèn trạng thái thực tế từ API (`connected`, `warning` khi `reconnect_required`/`unhealthy`, `disconnected`). Chỉ gọi `getServices()` khi `currentTab === 'settings'`, không gây rò rỉ request thừa trên các trang khác.
   - Thẻ hồ sơ người dùng (`.planora-user-card` dẫn tới `/account`), nút chuyển đổi giao diện Sáng/Tối (`ThemeToggle` giữ key `ati-theme`), liên kết *Chính sách* (`/privacy`), và nút *Đăng xuất*.
4. **Iconography (`PlanoraSidebar.tsx:27-89`, `PlanoraShell.tsx:243-280`):**
   - 100% icons điều hướng (`ChatBubbleIcon`, `InboxIcon`, `HistoryIcon`, `BoltIcon`, `GuideIcon`, `UsersIcon`, `PlusIcon`, `CloseIcon`, hamburger button SVG, mobile workspace pill SVG) đều là vector `<svg aria-hidden="true">`.
   - Tuyệt đối không dùng emoji trần trong markup điều hướng (`<nav aria-label="Điều hướng chính">`).

### 2.2. Mobile Drawer (< 1024px) & Trợ năng (`PlanoraShell.tsx:89-194`)
- Mở bằng nút hamburger SVG (`aria-label="Mở menu điều hướng"`, `aria-expanded`) hoặc nút workspace pill SVG.
- Khi mở: sidebar có `role="dialog"`, `aria-modal="true"`, khóa cuộn nền (`document.body.style.overflow = 'hidden'`), gắn `inert` lên `.planora-main-work`, tự động đưa focus vào nút đóng trong drawer.
- Đóng bằng click backdrop (`.planora-drawer-backdrop.open`), nút đóng hoặc phím `Escape` (nhường quyền ưu tiên cho portal modal con nếu đang mở).
- Focus trap `Tab` / `Shift+Tab` xoay vòng an toàn các phần tử hiển thị trong drawer; khi đóng trả focus về đúng phần tử đã mở (`openerRef`: hamburger hoặc workspace pill). Khi vượt breakpoint `>= 1024px`, tự động đóng drawer và giải phóng scroll lock.

### 2.3. Chuyển đổi Không gian Làm việc An toàn (`PlanoraShell.tsx:70-86`, `PlanoraSidebar.tsx:186-194`)
- Khi chuyển workspace qua `subscribeWorkspace`: lập tức gọi `useChatStore.getState().reset()`, `setConversationId(null)`, xóa `internalInboxCount` về `0`, phát sự kiện `inbox:refresh` và `conversations:refresh`, và điều hướng khỏi `/c/:id` về `/`.
- Các phản hồi GET trễ (`loadConversationHistory` với guard `isCurrent()`) và sự kiện SSE đến muộn (`handleSSEEvent` kiểm tra `conversationId`) từ workspace cũ đều bị loại bỏ hoàn toàn, không rò rỉ sang workspace mới.

---

## 3. Kết quả Chạy Lệnh Kiểm thử & Kiểm chứng Mutation

### 3.1. Bảng lệnh kiểm thử thực tế

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
| :--- | :---: | :---: | :--- |
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` (0 errors) |
| `npm test -w @wap/chat-web -- planora-shell` | `0` | **PASS** | `1 passed (1)`, `24 passed (24)` |
| `npm test -w @wap/chat-web -- --maxWorkers=4` | `0` | **PASS** | `98 passed (98)` test files, `1080 passed (1080)` tests |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (`dist/assets/index-BBKYLhSw.js`, `dist/assets/index-BCymHLnb.css`) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` |
| `node scripts/test-v3-browser.mjs planora-shell.spec.ts` | `NOT_RUN` | **NOT_RUN** | Môi trường review không chạy Docker PostgreSQL sandbox port 55533; spec file đã typecheck 0 lỗi |

### 3.2. Kiểm chứng Mutation / Regression thực tế (Chống Mock Ảo giác)

Thực hiện 3 phép biến đổi (mutation) tạm thời trong worktree review trên `PlanoraSidebar.tsx` và `PlanoraShell.tsx`:
1. **Mutation 1:** Tắt render `[data-inbox-badge-count]` trên mục `/inbox` tại `PlanoraSidebar.tsx:308`.
2. **Mutation 2:** Thay `<svg aria-hidden="true">` của `InboxIcon` bằng `<span>📥</span>` tại `PlanoraSidebar.tsx:36`.
3. **Mutation 3:** Bỏ `useChatStore.getState().reset()` và `setConversationId(null)` trong `subscribeWorkspace` tại `PlanoraShell.tsx:77-78`.

- **Kết quả chạy `npm test -w @wap/chat-web -- planora-shell` khi có mutation (RED):**
  - **Exit code:** `1` (`5 failed | 19 passed (24)`):
    - `FAIL ... > 6. Stale GET/SSE isolation on workspace switch > resets chat store when switching workspace` (`AssertionError: expected 'conv-alpha-123' to be null`)
    - `FAIL ... > 6. Stale GET/SSE isolation on workspace switch > ignores deferred GET/SSE responses` (`AssertionError: expected 'conv-alpha' to be null`)
    - `FAIL ... > 8. Business-First UX > renders /inbox navigation link with pending proposals badge count in forest green (#3c5741)` (`Error: expect(received).toBeInTheDocument() — Received: null`)
    - `FAIL ... > 8. Business-First UX > switching workspace cleanly resets all store state` (`AssertionError: expected 'conv-alpha-sensitive' to be null`)
    - `FAIL ... > 8. Business-First UX > all navigation icons are vector SVGs with aria-hidden="true" and navigation contains no bare emojis` (`Error: expect(received).toBeInTheDocument() — Received: null`)
- **Khôi phục code gốc & chạy lại (GREEN):**
  - Hoàn trả nguyên trạng `PlanoraSidebar.tsx` và `PlanoraShell.tsx` (`git status` sạch), chạy lại `npm test -w @wap/chat-web -- planora-shell` -> **PASS 24/24 tests (exit code 0)**.

---

## 4. Đánh giá & Kết luận

- **Đánh giá Behavior & Technical:** **PASS**
  - Bảo toàn đầy đủ các bất biến từ Vòng 1–4 (F1–F6, R1–R4): in-flight planning lock khi bấm "Cuộc trò chuyện mới", cô lập GET/SSE trễ khi đổi workspace, portal dialog focus trap & fallback focus không rớt ra `document.body`, giải phóng scroll lock khi vượt breakpoint desktop, phân quyền tab Người dùng theo org role vs global role.
- **Đánh giá UX Gate 05/11 (Business-First):** **ĐẠT**
  - Đạt chuẩn MẪU 2 của Design Brief v2.0 (05/11/2026): cấu trúc Sidebar 3 phần rõ ràng по ngữ cảnh công việc, bổ sung lối vào `/inbox` kèm badge xanh rừng `#3c5741`, dải 8 icon SVG dịch vụ tự host kèm đèn trạng thái API thật, 100% icon điều hướng là vector SVG `aria-hidden="true"` không dùng emoji trần.
- **Findings (P1 / P2 / P3):** Không còn finding nào.
- **Overall Verdict:** **Đạt**
