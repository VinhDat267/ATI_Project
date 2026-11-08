# Báo cáo Review Độc lập (Round 1 & Round 2) — PL-10 (Kết nối Jira, Không gian làm việc và Dự án theo Design Brief v2.0 & Business-First UX)

- **Reviewer:** Antigravity / Gemini 4 Argon (High); model ID `gemini-4-argon-high`
- **Ngày review:** 07/11/2026
- **Task:** [PL-10 · Kết nối Jira, Không gian làm việc và Dự án (Jira UI & Workspace Management)](../tasks/PL-10-planora-jira-ui.md)
- **UX Authority:** [`docs/superpowers/specs/2026-11-05-planora-design-brief.md`](../../superpowers/specs/2026-11-05-planora-design-brief.md) & [`docs/superpowers/specs/2026-11-05-planora-business-first-ux.md`](../../superpowers/specs/2026-11-05-planora-business-first-ux.md)
- **PR_URL hoặc LOCAL_ONLY:** `LOCAL_ONLY`
- **Target Branch:** `longnguyen005/feat-planora-pl-10` (target tích hợp: `codex/planora-ui`)
- **Base SHA:** `5b5df90e3413384ec71fb2afbf4bd0c6964c458c` (HEAD accepted của PL-09)
- **Round 1 Reviewed Head SHA:** `b58c9eb2b7ef344a010d2704d2164001d74ef6e5`
- **Round 2 Fix Commit SHA:** `64b9fa7cbb0fbdbf61435a5596308d379e2bf89e`
- **Round 2 Reviewed Head SHA:** `89deb95ce3de0f3708c3d07d7184c335b65f61b5`
- **Worktree review:** `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-10` (branch `longnguyen005/review-planora-pl-10`)
- **Orca Worker / Coordinator (Round 2):** `term_25db8524-13e9-4a73-a213-8356c9ade270` / `term_2d35bb18-7746-41a6-83b0-2669aeb86776` (`task_91ff06a80c44`, `ctx_93fddbab5313`)

---

## 1. Xác minh Git, Head SHA & Phạm vi File (File Ownership)

1. **Xác minh SHA (Round 2):**
   - `git rev-parse HEAD` = `89deb95ce3de0f3708c3d07d7184c335b65f61b5`
   - `git merge-base 5b5df90e3413384ec71fb2afbf4bd0c6964c458c HEAD` = `5b5df90e3413384ec71fb2afbf4bd0c6964c458c`
   - Chuỗi 3 commits trên `5b5df90e3413384ec71fb2afbf4bd0c6964c458c`:
     1. `b58c9eb2b7ef344a010d2704d2164001d74ef6e5` — `feat(planora): implement PL-10 Jira workspace, site/project and permissions`
     2. `64b9fa7cbb0fbdbf61435a5596308d379e2bf89e` — `fix(planora): resolve review findings F1-F3 for PL-10 Jira UI`
     3. `89deb95ce3de0f3708c3d07d7184c335b65f61b5` — `docs(handoff): add PL-10 review fixes log`
2. **Phạm vi thay đổi toàn task (`5b5df90e3413384ec71fb2afbf4bd0c6964c458c..89deb95ce3de0f3708c3d07d7184c335b65f61b5`):**
   - Gồm 8 files (`+771 / -123`), nằm hoàn toàn trong phạm vi được phép của PL-10:
     1. `apps/chat-web/src/pages/Settings/JiraConnection.tsx`
     2. `apps/chat-web/src/views/JiraCallbackView.tsx`
     3. `apps/chat-web/tests/jira-connection-responsive.test.tsx`
     4. `apps/chat-web/tests/browser/jira-09a.spec.ts`
     5. `apps/chat-web/tests/planora-pl-10-jira.test.tsx` *(tạo mới)*
     6. `docs/handoff/tasks/PL-10-planora-jira-ui.md` *(tạo mới)*
     7. `docs/handoff/log/2026-11-07-gemini-pl-10.md` *(tạo mới)*
     8. `docs/handoff/log/2026-11-07-gemini-pl-10-review-fixes.md` *(tạo mới)*
   - Không có thay đổi trái phép sang `apps/chat-web/src/services/jira-api.ts`, `jira-connection.ts`, `ConnectionCallbackFrame.tsx`, `apps/chat-api`, `packages/*`, `db/v3`, `prompts`, `evaluations`, `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 2. Xác minh Khắc phục Findings Round 1 (F1, F2, F3) tại Round 2 (`89deb95c`)

### 2.1. [F1 — P2] ĐÃ KHẮC PHỤC TRIỆT ĐỂ
- **Xử lý xung đột class CSS cũ & chuyển đổi toàn bộ 4 phân vùng con sang tokens Planora:**
  - Chạy `git grep -n -E "(#[0-9A-Fa-f]{3,6}|neutral-|gray-|slate-|emerald-|amber-|rose-|blue-|green-|bg-white|text-white)" apps/chat-web/src/pages/Settings/JiraConnection.tsx` trả về **0 kết quả**.
  - `buttonSecondary` (`JiraConnection.tsx:24-25`), `#jira` container (`dòng 585-589`), header (`dòng 592-633`), panel *Chi tiết danh tính Atlassian & Sites* (`dòng 790-833`), bộ chọn/form *Jira Workspaces* (`dòng 836-887`), panel *Chi tiết Workspace & Capabilities Directory* (`dòng 890-960`), panel *Quản trị Thành viên, Mã mời, Liên kết Sites & Projects* (`dòng 963-1237`) và panel *Hội thoại Atlassian Jira trong Cockpit* (`dòng 1246-1266`) đều dùng đồng nhất hệ thống token `--planora-paper`, `--planora-surface-inset`, `--planora-text`, `--planora-muted`, `--planora-divider`, `--planora-border-strong` (không còn bị `.bg-white`, `.dark\:bg-\[\#111827\]` hay `.dark\:text-white` ghi đè trong bundle CSS biên dịch).
  - Cập nhật có chủ đích `apps/chat-web/tests/jira-connection-responsive.test.tsx:143-150` để kiểm tra token `bg-[var(--planora-paper)]` và `border-[var(--planora-divider)]`.

### 2.2. [F2 — P2] ĐÃ KHẮC PHỤC TRIỆT ĐỂ
- **Đạt chuẩn tương phản WCAG AA ≥ 4.5:1 (GATE-03) ở cả Light mode và Dark mode:**
  - Xoá toàn bộ `text-neutral-400` (2.48:1), `placeholder-neutral-400` (2.48:1), `text-neutral-500` (3.20:1 ở Dark mode), `text-green-600` (3.24:1) và `text-amber-600` (3.13:1).
  - Thay bằng `text-[var(--planora-muted)]` (5.42:1 Light / 7.77:1 Dark), `placeholder:text-[var(--planora-placeholder)]`, và các semantic status tokens (`--planora-success-bg/text/border`, `--planora-pending-bg/text/border`, `--planora-error-bg/text/border`, `--planora-unknown-bg/text/border`) trên toàn bộ huy hiệu trạng thái kết nối (`dòng 602-627`), khung cảnh báo/lỗi/thông báo (`dòng 720, 749, 779, 784, 1050`), huy hiệu `membershipStatus` (`dòng 900-919`), trạng thái thành viên (`dòng 983-991`) và trạng thái site (`dòng 1145-1147`).

### 2.3. [F3 — P3] ĐÃ KHẮC PHỤC TRIỆT ĐỂ
- **A11y, Disabled Guards & Mutation Safety:**
  - Đã thêm `aria-label="Chọn site Atlassian để liên kết"` cho `select#link-site-select` (`JiraConnection.tsx:1099`).
  - Đã thêm `disabled={busy}` cho nút `"Huỷ"` trong khung xác nhận ngắt kết nối (`JiraConnection.tsx:768`) và nút `"Đóng"` trong khung cấu hình Projects (`JiraConnection.tsx:1224`).
  - Đã mở rộng `apps/chat-web/tests/planora-pl-10-jira.test.tsx` (`dòng 90-145, 260-363`) để bao phủ `<svg>` trong cảnh báo lỗi `connectionError` của `JiraConnection`, các `<svg>` trong `JiraCallbackView`, `aria-label` của `#link-site-select`, và `disabled={busy}` trên nút `"Huỷ"` và `"Đóng"`.
  - Đã cập nhật đúng `HEAD_SHA` Round 1 (`b58c9eb2b7ef344a010d2704d2164001d74ef6e5`) trong `docs/handoff/log/2026-11-07-gemini-pl-10.md:81`. *(Ghi chú nhỏ không chặn: `docs/handoff/log/2026-11-07-gemini-pl-10-review-fixes.md:8` ghi `64b9fa7c86fe...` thay vì `64b9fa7cbb0f...`, trùng short SHA `64b9fa7c`).*

---

## 3. Kiểm tra Trọng tâm Kỹ thuật & Nghiệp vụ (Behavior & Technical)

1. **Bảo toàn phân quyền RBAC Jira Workspace độc lập (`JiraConnection.tsx:76-78, 185, 963`):**
   - `const isWorkspaceAdmin = selectedWorkspace?.role === 'admin';` được kiểm soát độc lập theo từng Jira workspace, không tự suy từ `user.role` toàn cục hay workspace chung trên sidebar.
2. **Bảo toàn Race Condition Guards & Xử lý lỗi (`JiraConnection.tsx:72-74, 169-209, 232-248, 408-561`):**
   - Giữ nguyên `activeWorkspaceIdRef` và `workspaceFetchSeqRef` ngăn phản hồi trễ của workspace A ghi đè lên workspace B.
   - Giữ nguyên phân loại lỗi HTTP 401, 403, 409, 429, 500, 503 và lỗi mạng, hiển thị đúng badge `"Lỗi kết nối"` thay vì `"Chưa kết nối"`.
   - Giữ nguyên nút hội thoại Jira ở trạng thái `disabled` chờ `JIRA-08` (`JiraConnection.tsx:1257-1264`).
3. **Tích hợp `ConnectionCallbackFrame` trong `JiraCallbackView.tsx` (`JiraCallbackView.tsx:89-104`):**
   - Tích hợp `ConnectionCallbackFrame` presentation-only, bảo toàn `useLayoutEffect` xoá query nhạy cảm (`code`/`state`) trước khi paint, single-use `pending.current ??= jiraApi.callback(...)`, `subscribeAuthTokens` + `jiraSessionOwner()` chống đổi phiên giữa chừng, và `conversationReturnPath(result.returnTo) ?? '/settings#jira'`.

---

## 4. Kết quả Chạy Lệnh Kiểm thử & Kiểm chứng Mutation (Round 2 @ `89deb95c`)

### 4.1. Bảng lệnh kiểm thử thực tế tại worktree review (`review-planora-pl-10` @ `89deb95c`)

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
| :--- | :---: | :---: | :--- |
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` (0 lỗi) |
| `npm test -w @wap/chat-web -- jira` | `0` | **PASS** | `5 passed (5)` test files, `55 passed (55)` tests (`4.67s`) |
| `npm test -w @wap/chat-web` | `0` | **PASS** | `105 passed (105)` test files, `1192 passed (1192)` tests (`35.09s`) |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (`200 modules transformed`, `dist/assets/index-BJiRAcnj.css`, `dist/assets/index--b2u7N_3.js`) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` |
| Browser E2E (`tests/browser/jira-09a.spec.ts`) | `NOT_RUN` | **NOT_RUN** | Không chạy live Playwright server trong phiên review này; đã đối chiếu trực tiếp mã nguồn `jira-09a.spec.ts` với DOM của `JiraConnection.tsx` và `JiraCallbackView.tsx`. |

### 4.2. Kiểm chứng Mutation / Regression thực tế (4/4 đột biến bị bắt FAIL thật)

Thực hiện 4 phép thử đột biến (mutation) trên `apps/chat-web/src/pages/Settings/JiraConnection.tsx` tại `89deb95c`:

1. **Mutation M1 (`JiraConnection.tsx:23` — Revert `buttonPrimary` về `#FF5701`):**
   - Chạy `npx vitest run --dir apps/chat-web tests/planora-pl-10-jira.test.tsx` -> **FAIL (`M1_EXIT=1`)**:
     `AssertionError: expected 'px-4 py-2 ... bg-[#FF5701] ...' to contain 'var(--planora-on-primary)'`.
2. **Mutation M2 (`JiraConnection.tsx:77` — Suy quyền admin Jira workspace từ `user.role` toàn cục):**
   - Chạy `npx vitest run --dir apps/chat-web tests/planora-pl-10-jira.test.tsx` -> **FAIL (`M2_EXIT=1`)**:
     `Error: expect(element).not.toBeInTheDocument() — found <h5>Quản lý thành viên (0)</h5>`.
3. **Mutation M3 (`JiraConnection.tsx:728` — Xoá `aria-hidden="true"` khỏi `<svg>` cảnh báo lỗi):**
   - Chạy `npx vitest run --dir apps/chat-web tests/planora-pl-10-jira.test.tsx` -> **FAIL (`M3_EXIT=1`)**:
     `Error: expect(element).toHaveAttribute("aria-hidden", "true") — Received: null`.
4. **Mutation M4 (`JiraConnection.tsx:768` — Xoá `disabled={busy}` khỏi nút `"Huỷ"` xác nhận ngắt kết nối):**
   - Chạy `npx vitest run --dir apps/chat-web tests/planora-pl-10-jira.test.tsx` -> **FAIL (`M4_EXIT=1`)**:
     `Error: expect(element).toBeDisabled() — Received element is not disabled`.
5. **Khôi phục sạch mã nguồn & xác nhận GREEN:**
   - Khôi phục bằng `git checkout -- apps/chat-web/src/pages/Settings/JiraConnection.tsx`, kiểm tra `git diff --exit-code` = `0` (`DIFF_EXIT=0`) và chạy lại `npx vitest run --dir apps/chat-web tests/planora-pl-10-jira.test.tsx` -> **PASS 8/8 tests (`GREEN_EXIT=0`)**.

---

## 5. Đánh giá Tổng hợp & Kết luận (Verdict)

- **Đánh giá Behavior & Technical:** **PASS** (`105/105` test files, `1192/1192` tests PASS; `typecheck:v3`, `build:v3` và `test-v3-web-build-security.mjs` đều PASS với exit code `0`; 4/4 phép thử đột biến M1–M4 bị bắt FAIL thật; bảo toàn đầy đủ RBAC Jira workspace độc lập với global role, race guards khi đổi workspace/user, và callback contract).
- **Đánh giá UX Gate 05/11 (Business-First & Design Brief v2.0):** **PASS** (Đã khắc phục triệt để cả 3 findings `F1`, `F2`, `F3`: loại bỏ toàn bộ class màu prototype cũ đè token CSS, chuyển đổi đồng bộ tất cả các phân vùng của `JiraConnection.tsx` và `JiraCallbackView.tsx` sang tokens Planora và semantic status tokens đạt WCAG AA ≥ 4.5:1 ở cả Light và Dark mode, bổ sung đầy đủ `aria-label`, `disabled={busy}` guards và 100% SVG `aria-hidden="true"`).
- **Overall Verdict:** **Đạt**
