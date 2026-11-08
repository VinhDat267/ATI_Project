# Báo cáo Review Độc lập — PL-12 (Nhật ký, lịch sử và lưu trữ hội thoại theo Design Brief v2.0 & Business-First UX)

- **Reviewer:** Antigravity / Gemini 4 Argon (High); model ID `gemini-4-argon-high`
- **Ngày review:** 07/11/2026
- **Task:** [PL-12 · Nhật ký, lịch sử và lưu trữ hội thoại (History & Conversation Archives)](../tasks/PL-12-planora-history-archive.md)
- **UX Authority:** [`docs/superpowers/specs/2026-11-05-planora-design-brief.md`](../../superpowers/specs/2026-11-05-planora-design-brief.md) & [`docs/superpowers/specs/2026-11-05-planora-business-first-ux.md`](../../superpowers/specs/2026-11-05-planora-business-first-ux.md)
- **PR_URL hoặc LOCAL_ONLY:** `LOCAL_ONLY`
- **Target Branch:** `longnguyen005/feat-planora-pl-12` (target tích hợp: `codex/planora-ui`)
- **Base SHA:** `b4f42665ee5d05f20fc6d1465cad41111bcec4b3` (HEAD accepted của PL-11)
- **Reviewed Head SHA:** `e2e0d064a270c3673ba3ea51883359801a5f2842`
- **Worktree review:** `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-12` (branch `longnguyen005/review-planora-pl-12`)
- **Orca Worker / Coordinator:** `term_dad65338-8495-4244-a599-a650e7d80100` / `term_2d35bb18-7746-41a6-83b0-2669aeb86776` (`task_1a55f1c79164`, `ctx_a65af67920ff`)

---

## 1. Xác minh Git, Head SHA & Phạm vi File (File Ownership)

1. **Xác minh SHA:**
   - `git rev-parse HEAD` = `e2e0d064a270c3673ba3ea51883359801a5f2842`
   - `git merge-base b4f42665ee5d05f20fc6d1465cad41111bcec4b3 e2e0d064a270c3673ba3ea51883359801a5f2842` = `b4f42665ee5d05f20fc6d1465cad41111bcec4b3`
   - Khớp commit `e2e0d064 feat(planora): implement PL-12 history, archives and sidebar UI`.
2. **Phạm vi thay đổi (`b4f42665ee5d05f20fc6d1465cad41111bcec4b3..e2e0d064a270c3673ba3ea51883359801a5f2842`):**
   - Gồm 7 files (`+1465 / -270`), nằm hoàn toàn trong phạm vi được phép của PL-12:
     1. `apps/chat-web/src/components/layout/SidebarHistory.tsx`
     2. `apps/chat-web/src/pages/History/HistoryPage.tsx`
     3. `apps/chat-web/src/pages/History/page.css`
     4. `apps/chat-web/src/pages/History/useHistory.ts`
     5. `apps/chat-web/tests/planora-pl-12-history.test.tsx` *(tạo mới)*
     6. `docs/handoff/tasks/PL-12-planora-history-archive.md`
     7. `docs/handoff/log/2026-11-07-gemini-pl-12.md` *(tạo mới)*
   - Không có thay đổi trái phép sang `apps/chat-api`, `packages/*`, `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 2. Kết quả Chạy Lệnh Kiểm thử Thực tế

| Lệnh thực thi | Kết quả | Exit Code | Chi tiết |
| :--- | :---: | :---: | :--- |
| `npm run typecheck:v3` | **PASS** | `0` | chat-api & chat-web sạch lỗi TypeScript |
| `npm test -w @wap/chat-web -- planora-pl-12-history fe-09-pages sidebar-history sprint1-history-schedules-empty history-snapshot-race` | **PASS** | `0` | 5 test files, 38/38 tests PASS |
| `npm test -w @wap/chat-web` | **PASS** | `0` | 107 test files, 1.220/1.220 tests PASS |
| `npm run build:v3` | **PASS** | `0` | Vite production bundle thành công (`200 modules transformed`) |
| `node scripts/test-v3-web-build-security.mjs` | **PASS** | `0` | PASS: Không rò rỉ credential sentinels và 7 forbidden UI claims |

---

## 3. Các phát hiện (Findings) — Cần khắc phục trước khi đóng Gate

### [F1 — P2] `SidebarHistory` thiếu bảo vệ race condition và không dọn trạng thái đổi tên (`editing`, `saving`, `error`) khi chuyển Workspace hoặc thay đổi từ khoá tìm kiếm
- **Vị trí:** `apps/chat-web/src/components/layout/SidebarHistory.tsx:45-51, 108-127`.
- **Cách tái hiện (Trigger):**
  1. Người dùng bấm Đổi tên trên một hội thoại ở Workspace A trong `SidebarHistory` và bấm Lưu (gọi `apiClient.renameConversation` đang in-flight).
  2. Trong khi request chưa trả về, người dùng chuyển sang Workspace B (`setActiveWorkspaceId`).
- **Tác động & Bằng chứng (Impact & Evidence):**
  - Khi đổi `workspaceId`, `SidebarHistory` chỉ xoá `conversations` trong store mà không reset `editing`, `title`, `saving`, `error`.
  - Hàm `rename` không có thế hệ request (generation counter) để kiểm tra sau await:
    - Cờ `saving` giữ `true` ở Workspace B làm khoá nút thao tác.
    - Nếu request cũ lỗi muộn, lỗi của Workspace A hiển thị sang thanh bên của Workspace B.
    - Nếu người dùng mở form sửa ở Workspace B, request cũ về muộn sẽ gọi `setEditing(null)` đóng mất form của Workspace B.
- **Hướng sửa (Fix):**
  - Khi `workspaceId` hoặc `search` thay đổi trong `SidebarHistory`: gọi `setEditing(null)`, `setTitle('')`, `setSaving(false)`, `setError(null)`.
  - Trong `rename(id)`: dùng `generationRef` (tương tự `useHistory.ts:124-138`) để chụp generation trước await và kiểm tra sau await, nếu generation đã cũ thì bỏ qua không cập nhật state/store.

---

### [F2 — P2] Bài kiểm thử đột biến M1/M2 trong `planora-pl-12-history.test.tsx` chạy đồng bộ trước khi `getConversations` resolve, bỏ sót `RequestCard` và SVG của `SidebarHistory`
- **Vị trí:** `apps/chat-web/tests/planora-pl-12-history.test.tsx:338-367` (và dòng 67-105).
- **Cách tái hiện & Tác động:**
  - Test render component và gọi ngay `container.querySelectorAll('svg')` và `expect(container.innerHTML).not.toContain('#FF5701')` mà không `await screen.findByText(...)` để đợi mock API resolve.
  - Khi đó danh sách hội thoại thật chưa mount vào DOM, kiểm thử SVG và palette chỉ kiểm tra skeleton/khung rỗng, bỏ lọt các thẻ `RequestCard` và nút thao tác thật.
- **Hướng sửa (Fix):**
  - Sử dụng `await screen.findByText(...)` để đảm bảo danh sách hội thoại đã render đầy đủ trước khi thực hiện kiểm tra tokens, SVG `aria-hidden="true"` và mutation testing.

---

### [F3 — P3] `HistoryPage` không hiển thị empty state khi bộ lọc `statusFilter` ra 0 kết quả, và `useHistory` không xoá `notice` khi đổi Workspace
- **Vị trí:**
  - `apps/chat-web/src/pages/History/HistoryPage.tsx:446-475`
  - `apps/chat-web/src/pages/History/useHistory.ts:86-96`
- **Tác động & Hướng sửa:**
  - Khi `conversations.length > 0` nhưng `statusFilter` lọc ra 0 kết quả (`filteredConversations.length === 0`), trang ẩn `#empty-state` và không hiển thị thông báo thân thiện nào cho người dùng. Cần hiển thị empty state phù hợp: *"Không có hội thoại nào phù hợp bộ lọc đã chọn"*.
  - Trong `useHistory.ts:86-96`: Khi `workspaceId` thay đổi, gọi `setNotice(null)` để dọn sạch thông báo của workspace cũ.

---

### [F4 — P3] `PL-12-planora-history-archive.md` ghi nhận các thao tác `archive`/`delete`/`restore` không có trong contract backend
- **Vị trí:** `docs/handoff/tasks/PL-12-planora-history-archive.md:22, 56, 66` và `docs/handoff/log/2026-11-07-gemini-pl-12.md`.
- **Tác động & Hướng sửa:**
  - API hiện tại của main chỉ có endpoint `renameConversation`. Chưa có endpoint cho `archive`, `delete`, `restore`.
  - Cần đính chính tài liệu task card và log bàn giao để phản ánh trung thực contract hiện có: hỗ trợ đổi tên (`rename`), mở `/c/:id`, phân trang con trỏ, và lọc theo trạng thái công việc. Ghi nhận rõ các thao tác archive/delete/restore chưa được backend cung cấp.

---

## 4. Kết luận Thẩm định (Verdict)

- **Đánh giá Behavior & Technical:** **PASS** (`107/107` test files, `1.220/1.220` tests PASS; `typecheck:v3`, `build:v3`, `build-security` đều PASS với exit code `0`).
- **Đánh giá UX Gate 05/11 (Business-First & Design Brief v2.0):** **CHƯA ĐẠT** (Còn **2 findings P2** `F1` race condition rename trong `SidebarHistory`, `F2` mutation test async timing; **2 findings P3** `F3` empty state khi lọc và `F4` đính chính contract thao tác lưu trữ trong tài liệu).
- **Gate:** Cần worker khắc phục `F1–F4` trên `longnguyen005/feat-planora-pl-12` và submit commit mới cho Round 2 re-review.
- **Overall Verdict:** **Chưa đạt**
