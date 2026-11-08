# PL-12 · Nhật ký, lịch sử và lưu trữ hội thoại (History & Conversation Archives)

**Trạng thái:** HOÀN THÀNH — ĐÃ DUYỆT ĐẠT (Round 2) · **Nhánh thực hiện:** `longnguyen005/feat-planora-pl-12` · **Phụ thuộc:** PL-02, PL-11 đã hoàn tất và được duyệt Đạt.  
**Base SHA:** `b4f42665ee5d05f20fc6d1465cad41111bcec4b3` (HEAD accepted của PL-11).  
**Target branch:** `codex/planora-ui`.  
**Đặc tả:** [Planora migration design](../../superpowers/specs/2026-11-02-planora-migration-design.md), [Design Brief v2.0](../../superpowers/specs/2026-11-05-planora-design-brief.md), [Business-First UX](../../superpowers/specs/2026-11-05-planora-business-first-ux.md) · **Kế hoạch:** [Planora migration plan](../../superpowers/plans/2026-11-02-planora-migration.md) mục PL-12.  
**Prompt thi công:** [PL-12.md](../planora-prompts/PL-12.md).  
**Quy ước chung:** [COMMON.md](../planora-prompts/COMMON.md).

---

## 1. Mục tiêu

Thiết kế trải nghiệm xem nhật ký, lịch sử và lưu trữ hội thoại theo nhận diện Planora và tiêu chuẩn Business-First UX v2.0:
1. **Tìm kiếm & Tiếp tục công việc tự nhiên:**
   - Giúp người dùng dễ dàng tìm và tiếp tục các công việc cũ theo tiêu đề, nội dung công việc, thời gian và kết quả đạt được.
   - Tránh biến Nhật ký thành một log sự kiện kỹ thuật khô cứng (technical event log), danh sách UUID/run-ID vô hồn hoặc replay các bước nội bộ của engine.
2. **Kiến trúc Trang Nhật ký & Sidebar:**
   - **Trang Nhật ký đầy đủ (`HistoryPage.tsx`):** Danh sách hội thoại, phân vùng lịch chạy (`ScheduleSection` đã chuẩn hóa ở PL-11), bộ lọc/tìm kiếm và phân trang theo đúng API backend; xử lý đầy đủ các trạng thái rỗng (`empty`), đang tải (`loading`) và lỗi (`error`); điều hướng mở lại chính xác tại `/c/:id`.
   - **Thanh bên Lịch sử (`SidebarHistory.tsx`):** Đóng vai trò tóm tắt nhanh các hội thoại gần đây; không quảng cáo tìm kiếm vượt phạm vi dữ liệu thật đã tải (không giả vờ tìm toàn server trên danh sách giới hạn đã nạp).
3. **Bảo toàn Quyền hạn & Thao tác Hội thoại:**
   - Hỗ trợ chính xác các thao tác mà hợp đồng API backend hiện tại cung cấp: Đổi tên (`rename`), mở `/c/:id`, phân trang con trỏ (`cursor`), và lọc trạng thái công việc (`all`, `completed`, `needs_action`, `chatting`).
   - Ghi chú rõ ràng: API backend hiện tại chưa cung cấp endpoint cho `archive`, `delete`, `restore`; frontend tuyệt đối tuân thủ nguyên tắc không tạo mock ảo giác để giả vờ hỗ trợ các thao tác chưa có hợp đồng backend.
   - Xử lý đồng bộ ngay lập tức giữa thanh bên (`SidebarHistory`) và trang chính (`HistoryPage`) sau mỗi thao tác đổi tên qua `useChatStore`.
4. **Bảo vệ chống Rò rỉ Dữ liệu & Race Conditions:**
   - Ngăn chặn triệt để tình trạng dữ liệu workspace cũ lọt sang workspace mới khi đổi workspace giữa chừng trong lúc request GET đang tải.
   - Giữ nguyên trạng thái bộ lọc và phân trang khi làm mới trang (refresh).
   - Xử lý an toàn khi người dùng truy cập vào hội thoại đã bị xoá hoặc không có quyền truy cập.
5. **Tiêu chuẩn Thiết kế & Trợ năng Planora (GATE-03):**
   - Áp dụng typography editorial Planora (font serif `font-serif` cho headings, Be Vietnam Pro cho body, nền giấy kem `var(--planora-paper)`, nền lồng `var(--planora-surface-inset)`, viền phân cách `var(--planora-divider)`, xanh lá rừng `var(--planora-primary)`).
   - 0% màu cam prototype cũ `#FF5701` / `#E04C00`, 0% class prototype cũ ghi đè token (`#111827`, `#E7E7E2`, `#F8F8F6`), 0% "ATI", 100% SVG vector icons có thuộc tính `aria-hidden="true"`.
   - Đạt chuẩn tương phản WCAG AA $\ge 4.5:1$ trên cả chế độ Sáng và Tối.

---

## 2. Ranh giới sở hữu & Phạm vi File (Module Ownership)

- **Sửa đổi cho phép:**
  - `apps/chat-web/src/pages/History/HistoryPage.tsx`
  - `apps/chat-web/src/pages/History/page.css`
  - `apps/chat-web/src/pages/History/useHistory.ts`
  - `apps/chat-web/src/pages/History/ScheduleSection.tsx` (nếu cần tinh chỉnh tích hợp)
  - `apps/chat-web/src/components/layout/SidebarHistory.tsx`
  - `apps/chat-web/tests/planora-pl-12-history.test.tsx` (tạo mới)
  - Cập nhật các tests liên quan trong `apps/chat-web/tests/` (ví dụ `history-snapshot-race.test.tsx`, `sprint1-history-schedules-empty.test.tsx`).
- **Ngoài phạm vi:**
  - Không sửa `apps/chat-api` hoặc backend database/endpoints.
  - Không sửa logic state machine của lịch chạy đã chốt ở PL-11.
  - Không sửa `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 3. Tiêu chí nghiệm thu (Acceptance Criteria)

- [x] `HistoryPage.tsx`, `page.css`, `useHistory.ts` và `SidebarHistory.tsx` được chuyển đổi sang CSS tokens Planora và Business-First UX v2.0.
- [x] Danh sách hội thoại hiển thị thông tin công việc rõ ràng (tiêu đề, nội dung tóm tắt, thời gian, kết quả), mở đúng `/c/:id`.
- [x] Bảo toàn thao tác `rename`, mở `/c/:id`, phân trang con trỏ, đồng bộ tức thì với `SidebarHistory` (ghi nhận API backend chưa cung cấp `archive`, `delete`, `restore`, frontend không tạo mock ảo giác).
- [x] Chống rò rỉ dữ liệu giữa các workspace khi chuyển đổi trong lúc đang fetch.
- [x] Đạt chuẩn tương phản WCAG AA $\ge 4.5:1$ cả Light/Dark mode; 100% SVG có `aria-hidden="true"`; 0% màu `#FF5701`, 0% "ATI".
- [x] Toàn bộ test suite web PASS, `typecheck:v3` và `build:v3` exit code 0.
- [x] Có bài test đột biến (mutation testing) chứng minh bảo vệ hợp đồng an toàn và trợ năng.

---

## 4. Kết quả thực hiện

- **Commit SHA:** `5dc49c5e65182b72f4b0d89fbdfc8eea702d557f` (sau khi khắc phục F1-F4)
- **Trạng thái:** HOÀN THÀNH — ĐÃ DUYỆT ĐẠT (Round 2 độc lập bởi Gemini 3.8 Flash High)
- **Báo cáo Review Round 2:** [`docs/handoff/log/2026-11-07-gemini-review-pl-12-r2.md`](../log/2026-11-07-gemini-review-pl-12-r2.md)
- **Các tệp đã thay đổi / tạo mới:**
  - `apps/chat-web/src/pages/History/page.css`: Chuyển đổi toàn diện sang CSS design tokens Planora (`--planora-canvas`, `--planora-paper`, `--planora-text`, `--planora-muted`, `--planora-divider`, `--planora-primary`, `--planora-surface-inset`), hỗ trợ dark mode và reduced motion.
  - `apps/chat-web/src/pages/History/useHistory.ts`: Xử lý bảo vệ dữ liệu giữa các workspace bằng `generation.current` và xóa dữ liệu cũ ngay khi workspace đổi (`prevWorkspaceId.current !== workspaceId`); lắng nghe đồng bộ từ `useChatStore`.
  - `apps/chat-web/src/pages/History/HistoryPage.tsx`: Giao diện typography editorial Planora (`font-serif` cho headings), zero `#FF5701`, zero raw emojis, zero "ATI", 100% SVG vector icons có `aria-hidden="true"`, các huy hiệu trạng thái ngữ nghĩa (`completed`, `partial`, `chatting`), bộ lọc trạng thái và phân trang an toàn.
  - `apps/chat-web/src/components/layout/SidebarHistory.tsx`: Chuyển đổi sang CSS tokens Planora, xóa bỏ hoàn toàn emoji `💬` và `✎`, thay thế bằng SVG icons `aria-hidden="true"`, làm sạch danh sách tức thì khi đổi workspace, phân biệt tiền tố `› ` cho mục sidebar để tránh xung đột Testing Library với modal `HistoryDrawer`.
  - `apps/chat-web/tests/planora-pl-12-history.test.tsx` (Mới): 12 bài test toàn diện bao quát typography editorial, tokens Planora, 0% `#FF5701`, 0% raw emojis, 100% SVG `aria-hidden="true"`, đồng bộ rename giữa HistoryPage và SidebarHistory, phân trang con trỏ, cô lập dữ liệu workspace khi fetch chậm, và kiểm thử đột biến (M1-M3).
  - `docs/handoff/log/2026-11-07-gemini-pl-12.md`: Ghi chép chi tiết kết quả thực hiện và bằng chứng kiểm thử.
- **Bằng chứng kiểm thử thực tế:**
  - `npm test -w @wap/chat-web -- planora-pl-12-history`: 12/12 tests PASS (exit code 0).
  - `npm test -w @wap/chat-web -- history`: 4 test files PASS, 26/26 tests PASS (exit code 0).
  - `npm test -w @wap/chat-web`: 107 test files PASS, 1220/1220 tests PASS (exit code 0).
  - `npm run typecheck:v3`: TypeScript sạch không lỗi (exit code 0).
  - `npm run build:v3`: Build production thành công sạch sẽ (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
