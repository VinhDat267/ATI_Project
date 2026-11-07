# 2026-11-07 · gemini · PL-12 · Khắc phục toàn diện Review Findings F1-F4 (Argon High)

- **Nhiệm vụ:** [PL-12 · Nhật ký, lịch sử và lưu trữ hội thoại (History & Conversation Archives)](../tasks/PL-12-planora-history-archive.md)
- **Worktree / Nhánh:** `longnguyen005/feat-planora-pl-12`
- **Target branch:** `codex/planora-ui`
- **Base SHA (Trước khi sửa):** `e2e0d0645f7c32bfd58957ba966378ae2c48d6c8`
- **Orca Task ID:** `task_7bd3eaf3f1a8` (Dispatch `ctx_084fd7cb4bc1`)

---

## 1. Mục tiêu & Bối cảnh

Khắc phục triệt để 2 findings P2 (F1, F2) và 2 findings P3 (F3, F4) được xác định trong báo cáo review độc lập của Argon High:

1. **[F1 — P2] Bảo vệ race condition và reset trạng thái đổi tên trong SidebarHistory:**
   - Tại `apps/chat-web/src/components/layout/SidebarHistory.tsx`:
     - Thêm `renameGenRef = useRef(0);`.
     - Khi `workspaceId` hoặc `search` thay đổi: dọn sạch trạng thái đổi tên `setEditing(null); setTitle(''); setSaving(false); setError(null); renameGenRef.current++;`.
     - Trong hàm `rename(id: string)`:
       - Chụp `const generation = ++renameGenRef.current;` trước khi `await apiClient.renameConversation(id, trimmed)`.
       - Sau `await`: kiểm tra `if (generation !== renameGenRef.current) return;` trước khi cập nhật store và dọn dẹp state (`editing`, `error`, `saving`).
       - Trong khối `catch`: kiểm tra `if (generation !== renameGenRef.current) return;` trước khi `setError(userErrorMessage(reason))` và `setSaving(false)`.

2. **[F2 — P2] Async timing cho mutation test & SVG audit trong planora-pl-12-history.test.tsx:**
   - Tại `apps/chat-web/tests/planora-pl-12-history.test.tsx`:
     - Trong các bài test kiểm tra tokens, SVG `aria-hidden="true"` và mutation tests M1-M3: bắt buộc dùng `await screen.findByRole(...)` / `await screen.findByText(...)` để đợi mock API `getConversations` resolve và các item hội thoại thật đã mount vào DOM trước khi query SVG hoặc assertion `#FF5701`.
     - Loại bỏ triệt để các cảnh báo unhandled `act(...)` trong toàn bộ test suite.
     - Bổ sung 1 unit test chuyên biệt: kiểm chứng race condition khi đang đổi tên trong `SidebarHistory` mà chuyển đổi `workspaceId` $\rightarrow$ xác nhận state `editing`, `saving`, `error` được dọn sạch hoàn toàn, không rò rỉ thông báo lỗi hay khóa nút ở workspace mới.

3. **[F3 — P3] Empty state khi lọc statusFilter ra 0 kết quả & dọn notice khi đổi Workspace:**
   - Tại `apps/chat-web/src/pages/History/HistoryPage.tsx`:
     - Khi `rows.length > 0` nhưng `displayed.length === 0` (do bộ lọc trạng thái loại bỏ hết): render empty state thân thiện với người dùng: *"Không có hội thoại nào phù hợp bộ lọc"* kèm nút *"Đặt lại bộ lọc"* để đưa `statusFilter` về `'all'`.
     - Ẩn nút "Tải thêm" khi danh sách lọc rỗng.
   - Tại `apps/chat-web/src/pages/History/useHistory.ts`:
     - Khi `workspaceId` thay đổi (`prevWorkspaceId.current !== workspaceId`): gọi `setNotice(null)` để dọn dẹp các thông báo cũ còn sót lại.

4. **[F4 — P3] Đính chính contract trong tài liệu bàn giao:**
   - Tại `docs/handoff/tasks/PL-12-planora-history-archive.md` và `docs/handoff/log/2026-11-07-gemini-pl-12.md`:
     - Cập nhật mô tả để phản ánh chính xác contract backend hiện tại: hỗ trợ đổi tên (`rename`), mở `/c/:id`, phân trang con trỏ, và lọc trạng thái công việc.
     - Ghi chú rõ ràng rằng API backend hiện tại chưa cung cấp endpoint cho `archive`, `delete`, `restore`, và frontend tuyệt đối không tạo mock ảo giác.
   - Tạo file log khắc phục này ghi nhận toàn diện việc giải quyết F1-F4.

---

## 2. Chi tiết các tệp đã sửa đổi

1. **`apps/chat-web/src/components/layout/SidebarHistory.tsx`:**
   - Thêm `renameGenRef = useRef(0);`.
   - Reset trạng thái đổi tên trong `useEffect` khi `workspaceId` hoặc `search` thay đổi.
   - Bảo vệ generation counter trong hàm `rename`: ngăn chặn race condition khi phản hồi chậm trả về sau khi chuyển đổi workspace hoặc thay đổi search.

2. **`apps/chat-web/src/pages/History/useHistory.ts`:**
   - Thêm `prevWorkspaceId = useRef(workspaceId);`.
   - Dọn sạch `notice` (`setNotice(null)`) khi `workspaceId` thay đổi.

3. **`apps/chat-web/src/pages/History/HistoryPage.tsx`:**
   - Bổ sung `filter-empty-state` với thông điệp *"Không có hội thoại nào phù hợp bộ lọc"* và nút *"Đặt lại bộ lọc"* khi lọc trạng thái không có kết quả.
   - Ẩn container "Tải thêm" khi `displayed.length === 0`.

4. **`apps/chat-web/tests/planora-pl-12-history.test.tsx`:**
   - Điều chỉnh timing async cho các test tokens và mutation tests M1-M3: đợi dữ liệu hội thoại mount vào DOM trước khi assertion.
   - Bổ sung unit test kiểm tra `SidebarHistory` dọn sạch state đổi tên khi đổi workspace.
   - Bổ sung unit test kiểm tra empty state của bộ lọc trạng thái và nút đặt lại bộ lọc.
   - Bổ sung unit test kiểm tra dọn dẹp `notice` khi đổi workspace trong `HistoryPage`.
   - Toàn bộ 15/15 tests PASS sạch 0 cảnh báo `act(...)`.

5. **`docs/handoff/tasks/PL-12-planora-history-archive.md`:**
   - Đính chính mô tả contract: backend API hiện tại chỉ hỗ trợ `rename`, mở `/c/:id`, phân trang con trỏ, lọc trạng thái; ghi rõ chưa có `archive`, `delete`, `restore` và frontend không mock ảo giác.

6. **`docs/handoff/log/2026-11-07-gemini-pl-12.md`:**
   - Đính chính mục bảo toàn quyền hạn & thao tác hội thoại theo đúng contract thực tế.

7. **`docs/handoff/log/2026-11-07-gemini-pl-12-review-fixes.md`:**
   - Tạo mới log ghi nhận toàn diện việc khắc phục review findings F1-F4.

---

## 3. Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
|---|:---:|:---:|---|
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` sạch 0 lỗi TypeScript |
| `npm test -w @wap/chat-web -- history` | `0` | **PASS** | 4 test files, 29/29 tests pass (15/15 tests trong `planora-pl-12-history.test.tsx` không còn `act(...)` warning) |
| `npm test -w @wap/chat-web` | `0` | **PASS** | Toàn bộ 107 test files, 1.223/1.223 tests pass (0 regressions) |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (200 modules transformed, HTML/CSS/JS bundles) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | Excludes credential sentinels and 7 forbidden UI claims |
