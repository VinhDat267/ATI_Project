# Báo cáo Review Độc lập — PL-09 (Kết nối Trello, GitHub, Telegram theo Design Brief v2.0 & Business-First UX)

- **Reviewer:** Antigravity / Gemini 4 Argon (High); model ID `gemini-4-argon-high`
- **Ngày review:** 05/11/2026 (thực chạy 07/11/2026)
- **Task:** [PL-09 · Kết nối Trello, GitHub, Telegram (Provider Connections)](../tasks/PL-09-planora-trello-github-telegram.md)
- **UX Authority:** [`docs/superpowers/specs/2026-11-05-planora-design-brief.md`](../../superpowers/specs/2026-11-05-planora-design-brief.md) & [`docs/superpowers/specs/2026-11-05-planora-business-first-ux.md`](../../superpowers/specs/2026-11-05-planora-business-first-ux.md)
- **PR_URL hoặc LOCAL_ONLY:** `LOCAL_ONLY`
- **Target Branch:** `longnguyen005/feat-planora-pl-09` (target tích hợp: `codex/planora-ui`)
- **Base SHA:** `13d18efb565ccf8d121f1914a919856aac974590`
- **Reviewed Head SHA:** `5b5df90e3413384ec71fb2afbf4bd0c6964c458c`
- **Worktree review:** `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-09` (branch `longnguyen005/review-planora-pl-09`)
- **Orca Worker / Coordinator:** `term_364d58fd-80b5-4922-b711-8cbefa24a9af` / `term_2d35bb18-7746-41a6-83b0-2669aeb86776` (`task_02d1ed3d945a`, `ctx_a5e554f1dbc1`)

---

## 1. Xác minh Git, Head SHA & Phạm vi File (File Ownership)

1. **Xác minh SHA:**
   - `git rev-parse HEAD` = `5b5df90e3413384ec71fb2afbf4bd0c6964c458c`
   - `git rev-parse longnguyen005/feat-planora-pl-09` = `5b5df90e3413384ec71fb2afbf4bd0c6964c458c`
   - `git merge-base 13d18efb565ccf8d121f1914a919856aac974590 5b5df90e3413384ec71fb2afbf4bd0c6964c458c` = `13d18efb565ccf8d121f1914a919856aac974590`
   - Khớp chính xác 40 ký tự SHA của commit `feat(planora): implement PL-09 Trello, GitHub, Telegram provider connections`.
2. **Phạm vi thay đổi (`13d18efb565ccf8d121f1914a919856aac974590..5b5df90e3413384ec71fb2afbf4bd0c6964c458c`):**
   - Gồm đúng 9 files (`+658 / -223`), hoàn toàn nằm trong phạm vi sở hữu của PL-09:
     1. `apps/chat-web/src/pages/Settings/TrelloConnection.tsx`
     2. `apps/chat-web/src/pages/Settings/GitHubConnection.tsx`
     3. `apps/chat-web/src/pages/Settings/TelegramConnection.tsx`
     4. `apps/chat-web/src/views/TrelloCallbackView.tsx`
     5. `apps/chat-web/src/views/GitHubCallbackView.tsx`
     6. `apps/chat-web/src/views/TelegramCallbackView.tsx`
     7. `apps/chat-web/tests/planora-pl-09-connections.test.tsx` *(tạo mới)*
     8. `docs/handoff/tasks/PL-09-planora-trello-github-telegram.md`
     9. `docs/handoff/log/2026-11-07-gemini-pl-09.md` *(tạo mới)*
   - Không có thay đổi trái phép sang `apps/chat-api`, `packages/*`, `db/v3`, `prompts`, `evaluations`, `ConnectionCallbackFrame.tsx`, `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 2. Kiểm tra Trọng tâm theo Design Brief v2.0 & Business-First UX

### 2.1. Chuẩn CSS Tokens Planora, Tương phản WCAG AA (GATE-03) & Thương hiệu (GATE-04)
1. **Nút Primary CTA (`TrelloConnection.tsx:10-11`, `GitHubConnection.tsx:9-10`, `TelegramConnection.tsx:9-10`, `TelegramCallbackView.tsx:22-23`):**
   - Toàn bộ nút hành động chính (`#trello-connect`, `#trello-save-scope`, `#github-connect`, `#github-save-scope`, `#telegram-connect`, `#telegram-save-scope`, `#telegram-open-bot`, và nút `"Xác nhận ngắt kết nối"` trong cả 3 modal) dùng chuẩn `bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)]`.
   - Đạt tỷ lệ tương phản **7.80:1** ở Light mode (`#fffdf7` trên `#3c5741`) và **7.91:1** ở Dark mode (`#132014` trên `#8fb68e`), vượt ngưỡng tối thiểu WCAG AA 4.5:1.
   - Chạy `git grep -n -i -E "FF5701|E04C00|e04d01"` trên cả 6 file trả về **0 kết quả**.
2. **Viền thành phần tương tác & phân cách (WCAG 1.4.11 ≥ 3.0:1):**
   - Toàn bộ nút phụ (`secondary`), ô tìm kiếm (`input[type="search"]`), `select` chọn không gian Trello (`#trello-workspace-select`), `checkbox` chọn bảng/repo/chat và huy hiệu bộ đếm (`github-scope-counter`, `telegram-scope-counter`) dùng `border-[var(--planora-border-strong)]` (đạt **3.16:1** Light / **3.12:1** Dark).
   - Các khung thẻ và đường phân cách cấu trúc dùng `border-[var(--planora-divider)]` và nền `bg-[var(--planora-paper)]` / `bg-[var(--planora-surface-inset)]`.
   - Chạy `git grep -n -e "planora-border"` trên toàn bộ `apps/chat-web/src/` xác nhận **0 vị trí** dùng biến không tồn tại `--planora-border`.
3. **Iconography & Accessibility (MẪU 2 Design Brief v2.0):**
   - 100% thẻ `<svg>` trong `TrelloConnection.tsx:453`, `GitHubConnection.tsx:437`, `TelegramConnection.tsx:400`, `ServiceLogo.tsx` và `ConnectionCallbackFrame.tsx` đều có `aria-hidden="true"`.
   - Không sử dụng bất kỳ ký tự emoji trần nào trên giao diện.
   - Thông báo lỗi dùng `role="alert"`, thông báo trạng thái dùng `role="status"`.
4. **Xóa sạch thương hiệu cũ `"ATI"` (GATE-04):**
   - Chạy `git grep -n -E "\bATI\b"` trên cả 6 file thuộc phạm vi PL-09 trả về **0 kết quả**.
   - Tiêu đề trang (`meta.title`) ở cả 3 callback views đổi thành `'Trello — Planora'`, `'GitHub — Planora'`, `'Telegram — Planora'`.
   - Nội dung hộp thoại xác nhận ngắt kết nối ở cả 3 thẻ kết nối (`TrelloConnection.tsx:492`, `GitHubConnection.tsx:476`, `TelegramConnection.tsx:439`) và hướng dẫn pairing trong `TelegramCallbackView.tsx:107` đều đã chuyển sang `"Planora"`.
   - Bảo toàn nguyên vẹn các định danh kỹ thuật và tham số giao thức (`start=ati_...`, `startgroup=ati_scope`, `#trello`, `#github`, `#telegram`).

### 2.2. Bảo toàn Phân quyền & Nghiệp vụ của từng Provider
1. **Trello (`TrelloConnection.tsx`):**
   - Giữ nguyên bộ chọn Trello Workspace (`#trello-workspace-select`) và danh sách bảng (`#trello-scope`), kiểm tra trạng thái thành viên (`member: false` hiển thị `"Bạn cần được thêm vào bảng"` ở trạng thái `needs_membership`), giới hạn chọn tối đa 10 bảng (`selectedBoardIds.length >= 10`), vô hiệu hóa nút `#trello-save-scope` khi chọn 0 bảng.
   - Bảo toàn `subscribeWorkspace` khi chuyển đổi không gian làm việc và phân quyền `canSelectScope` (ẩn bộ chọn bảng và nút `#trello-edit-scope` đối với `member` trong không gian tổ chức).
2. **GitHub (`GitHubConnection.tsx`):**
   - Giữ nguyên danh sách repository (`#github-scope`), huy hiệu `Private` / `Public` hỗ trợ cả Light và Dark mode (`GitHubConnection.tsx:391-400`), ô lọc tìm kiếm nhanh khi có từ 5 repo trở lên (`aria-label="Tìm nhanh repository"`), bộ đếm `Đã chọn X/10` (`data-testid="github-scope-counter"`), giới hạn tối đa 10 repositories (`selectedRepos.length >= 10`), và phân quyền `isAdmin` (`user?.role === 'admin'`).
3. **Telegram (`TelegramConnection.tsx` & `TelegramCallbackView.tsx`):**
   - Bảo toàn hoàn toàn mô hình kết nối 1-click deep link qua bot Telegram (không biến thành OAuth redirect): giữ nút `#telegram-open-bot` (`Mở Telegram và bấm Start`), `#telegram-open-group` (`+ Thêm bot vào nhóm Telegram`), xử lý mã `TELEGRAM_PAIRING_PENDING` hiển thị trạng thái `"Chờ xác nhận"` kèm nút `#telegram-verify-pairing` (`Tôi đã bấm Start trên Telegram`), tự động kiểm tra khi quay lại tab (`visibilitychange` / `focus`), và chọn tối đa 10 chat/nhóm (`#telegram-scope`, `data-testid="telegram-scope-counter"`).
4. **An toàn Hộp thoại Xác nhận Ngắt kết nối (`CockpitDialog`):**
   - Cả 3 thẻ kết nối (`TrelloConnection.tsx:482-484`, `GitHubConnection.tsx:466-468`, `TelegramConnection.tsx:429-431`) đều chặn đóng modal khi đang gửi yêu cầu ngắt kết nối: `onClose={() => { if (!busy) setConfirm(false); }}`.

### 2.3. Tái sử dụng `ConnectionCallbackFrame` trong 3 Callback Views
- `TrelloCallbackView.tsx:86-99`, `GitHubCallbackView.tsx:86-99`, `TelegramCallbackView.tsx:89-160` tích hợp `ConnectionCallbackFrame` thuần trình bày, không can thiệp vào `useEffect` hay single-use `completed.current` / `exchanged.current` và `sessionOwner` guards.
- Truyền trực tiếp `error={error ? <p role="alert">{error}</p> : undefined}` vào `ConnectionCallbackFrame`, không lồng thêm hộp `<div className="bg-red-50">` thứ hai.
- Sử dụng duy nhất nút điều hướng `onBackToSettings={() => navigate('/settings', true)}` (`backToSettingsLabel="Về Kết nối dịch vụ"`) từ footer của `ConnectionCallbackFrame`, không render trùng lặp thẻ `<a href="/settings">`.

---

## 3. Kết quả Chạy Lệnh Kiểm thử & Kiểm chứng Mutation

### 3.1. Bảng lệnh kiểm thử thực tế tại worktree review (`review-planora-pl-09` @ `5b5df90e`)

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
| :--- | :---: | :---: | :--- |
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` (0 lỗi) |
| `npm test -w @wap/chat-web -- trello github telegram planora-pl-09-connections` | `0` | **PASS** | `6 passed (6)` test files, `45 passed (45)` tests (`4.64s`) |
| `npm test -w @wap/chat-web` | `0` | **PASS** | `104 passed (104)` test files, `1184 passed (1184)` tests (`44.69s`) |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (`200 modules transformed`, `dist/assets/index-Dwt5G83l.css`, `dist/assets/index-BS9y1b0i.js`) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` |

### 3.2. Kiểm chứng Mutation / Regression thực tế (Chống Mock Ảo giác)

Thực hiện 4 phép thử đột biến (mutation) tạm thời trên mã nguồn trong worktree review để xác minh bộ test `tests/planora-pl-09-connections.test.tsx` bắt thật các lỗi hồi quy về token màu WCAG AA, thương hiệu `"ATI"`, biến viền `--planora-border-strong` và giới hạn 10 tài nguyên:

1. **Mutation M1 (`TrelloConnection.tsx:11` — Revert nút Primary về `#FF5701`):**
   - Đổi `bg-[var(--planora-primary)] text-[var(--planora-on-primary)]` thành `bg-[#FF5701] text-white`.
   - Chạy `npx vitest run --dir apps/chat-web tests/planora-pl-09-connections.test.tsx` -> **FAIL (`M1_EXIT=1`)**:
     `FAIL TrelloConnection uses Planora primary button tokens and no #FF5701 — AssertionError: expected 'px-4 py-2.5 ... bg-[#FF5701] ...' to contain 'bg-[var(--planora-primary)]'`.
2. **Mutation M2 (`GitHubConnection.tsx:476` — Revert copy modal ngắt kết nối về `"ATI"`):**
   - Đổi `Planora sẽ xoá token kết nối GitHub` thành `ATI sẽ xoá token kết nối GitHub`.
   - Chạy `npx vitest run --dir apps/chat-web tests/planora-pl-09-connections.test.tsx` -> **FAIL (`M2_EXIT=1`)**:
     `FAIL replaces all "ATI" mentions with "Planora" in disconnect confirmation modals — TestingLibraryElementError: Unable to find an element with the text: /Planora sẽ xoá token kết nối GitHub/i`.
3. **Mutation M3 (`GitHubConnection.tsx` — Thay `--planora-border-strong` bằng biến không tồn tại `--planora-border`):**
   - Đổi `border-[var(--planora-border-strong)]` thành `border-[var(--planora-border)]`.
   - Chạy `npx vitest run --dir apps/chat-web tests/planora-pl-09-connections.test.tsx` -> **FAIL (`M3_EXIT=1`)**:
     `FAIL GitHubConnection uses Planora primary button tokens and search/counter tokens — AssertionError: expected 'text-[11px] ... border-[var(--planora-border)] ...' to contain 'border-[var(--planora-border-strong)]'`.
4. **Mutation M4 (`GitHubConnection.tsx:369` — Phá vỡ giới hạn tối đa 10 repositories):**
   - Đổi `selectedRepos.length >= 10` thành `selectedRepos.length >= 11`.
   - Chạy `npx vitest run --dir apps/chat-web tests/planora-pl-09-connections.test.tsx` -> **FAIL (`M4_EXIT=1`)**:
     `FAIL enforces maximum 10 resources across all provider scope selectors — Error: expect(element).toBeDisabled(): Received element is not disabled`.
5. **Khôi phục sạch mã nguồn & xác nhận GREEN:**
   - Khôi phục toàn bộ file thử nghiệm về nguyên trạng, kiểm tra `git diff --exit-code` = `0` (`GIT_DIFF_EXIT=0`) và chạy lại `npx vitest run --dir apps/chat-web tests/planora-pl-09-connections.test.tsx` -> **PASS 10/10 tests (`GREEN_EXIT=0`)**.

---

## 4. Findings (P1 / P2 / P3)

- **P1 (Critical):** Không có (`0`).
- **P2 (Major):** Không có (`0`).
- **P3 (Minor):** Không có (`0`).
- *(Ghi chú ngoài phạm vi file của PL-09: chuỗi fallback tại `apps/chat-web/src/services/telegram-connection.ts:34` cho mã `TELEGRAM_PAIRING_PENDING` vẫn chứa chữ `"ATI"`, nhưng trong thực tế `TelegramCallbackView.tsx:69-71` đã chặn riêng mã `TELEGRAM_PAIRING_PENDING` và hiển thị thông điệp chuẩn `"Planora"` tại `TelegramCallbackView.tsx:107` mà không gọi tới nhánh fallback đó; file `services/telegram-connection.ts` nằm ngoài danh sách file được phép sửa của PL-09).*

---

## 5. Đánh giá Tổng hợp & Kết luận (Verdict)

- **Đánh giá Behavior & Technical:** **PASS** (`104/104` test files, `1184/1184` tests PASS; `typecheck:v3`, `build:v3` và `test-v3-web-build-security.mjs` đều PASS với exit code `0`; bảo toàn đầy đủ OAuth state machine, Telegram 1-click bot pairing, giới hạn 10 tài nguyên, RBAC Admin vs Member và deep-link anchors `#trello`/`#github`/`#telegram`).
- **Đánh giá UX Gate 05/11 (Business-First & Design Brief v2.0):** **ĐẠT** (Tuân thủ đầy đủ bảng màu token `--planora-primary` / `--planora-on-primary` đạt tương phản WCAG AA 7.80:1 Light / 7.91:1 Dark, viền `--planora-border-strong` / `--planora-divider`, 100% SVG `aria-hidden="true"`, sạch bóng `#FF5701`, emoji trần và thương hiệu cũ `"ATI"`, tích hợp chuẩn `ConnectionCallbackFrame` không lồng khung lỗi và không lặp nút điều hướng).
- **Overall Verdict:** **Đạt**
