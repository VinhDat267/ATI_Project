# 2026-11-05 · Antigravity / Gemini 4 Argon (High) · Re-review độc lập PL-07 (Round 3 — Business-First UX Refactor)

**Kết luận tổng thể (Overall Verdict): ĐẠT**
- **Behavior & Technical Verdict:** **PASS (ĐẠT)** (Toàn bộ 25/25 unit/integration tests trong `planora-responses-recovery.test.tsx`, 102/102 test files với 1153/1153 tests trong `@wap/chat-web`, `typecheck:v3`, `build:v3`, `test-v3-web-build-security.mjs`, kiểm tra đột biến RED 7/25 ca fail đúng hành vi, và 2/2 bộ Playwright E2E trên PostgreSQL 18.3 sandbox đều đạt exit code `0`).
- **UX Gate 05/11 (Business-First — Design Brief v2.0 Mẫu 3 & Mẫu 4):** **ĐẠT** (Cả 4 findings từ Round 2 gồm `UX-F1`, `UX-F2`, `UX-F3`, `UX-P3-1` và chuẩn an toàn `D2` cho `delivery_unknown` đều đã được giải quyết triệt để trong phạm vi file của PL-07).

---

## 1. Định danh Reviewer, Model/Session Evidence & Phạm vi SHA

- **Reviewer:** Antigravity / Gemini 4 Argon (High) — reviewer độc lập, không phải tác giả task và không sửa code của worker.
- **Model & Session Evidence:**
  - Model ID: `gemini-4-argon-high` (Display: Gemini 4 Argon (High)).
  - Conversation ID: `e8167c32-c5f0-4339-8696-60d1df92244e`.
  - Orca Worker Terminal: `term_8f4d8d90-380d-4eeb-8114-71f8d5338e1e` (Coordinator: `term_d44548a4-d059-43db-836b-af952932c369`).
  - Task ID / Dispatch ID: `task_ca9460528a21` / `ctx_aa05134107cc`.
- **Task & Card:**
  - Task: `PL-07` (Refactor Business-First UX theo Design Brief v2.0).
  - Card: [`docs/handoff/tasks/PL-07-planora-responses-recovery.md`](../tasks/PL-07-planora-responses-recovery.md).
  - UX Task: `docs/handoff/tasks/PLANORA-UX-01-business-first-redesign.md`.
- **PR_URL / LOCAL_ONLY:** `LOCAL_ONLY`.
- **Target branch:** `longnguyen005/feat-planora-pl-07` (target tích hợp `codex/planora-ui`).
- **Worktree review độc lập:** `C:/Users/Admin/orca/workspaces/ATI_Project/review-planora-pl-07-r3` (nhánh `longnguyen005/review-planora-pl-07-r3`).
- **Xác minh SHA:**
  - Integration Base SHA (`codex/planora-ui`): `514d982fd9fc152290feb305b0d97f2c40dda21a`.
  - Round 1 HEAD SHA: `4405fd36bfda8e46623261c81aaa971301ec834c`.
  - Round 2 HEAD SHA (`BASE_SHA` của đợt sửa này): `f4cd6f4419f63bf7ed733a7efde6b4b673139efa`.
  - Round 3 HEAD SHA (`HEAD_SHA` hiện tại, khớp 100% với `longnguyen005/feat-planora-pl-07`): `2ddaab93e56622891357c8baa47178da9cd172ab`.
- **Phạm vi file thay đổi trong Round 3 (`f4cd6f44..2ddaab93` — 14 files):**
  - Mã nguồn UI (`apps/chat-web/src/`):
    - `pages/Cockpit/RecoveryEditor.tsx`
    - `pages/Cockpit/RecoveryMoment.tsx`
    - `pages/Cockpit/RequestMoments.tsx`
    - `pages/Cockpit/presentation.tsx`
    - `pages/Cockpit/recovery-labels.ts`
    - `pages/Errors/PlanningErrors.tsx`
    - `pages/Responses/ResponseMoment.tsx`
    - `planora/styles/components.css`
    - `planora/workspace/PlanoraActiveTurn.tsx`
    - `planora/workspace/PlanoraChatWorkspace.tsx`
  - Kiểm thử (`apps/chat-web/tests/`):
    - `planora-responses-recovery.test.tsx` (thêm 5 tests mới, nâng tổng số lên 25 tests)
    - `app-reconciliation.test.tsx` (cập nhật 4 dòng assertion hiển thị từ mã tool `trello.add_member` / `<pre>` JSON sang nhãn tiếng Việt `'Gán thành viên vào thẻ Trello'` và nội dung văn bản, giữ nguyên toàn bộ assertions hành vi đối soát)
  - Tài liệu bàn giao (`docs/handoff/`):
    - `tasks/PL-07-planora-responses-recovery.md`
    - `log/2026-11-05-gemini-pl-07-business-first-refactor.md`
  - Không chạm vào `apps/chat-api`, `packages/*`, `db/v3`, `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 2. Kiểm tra việc giải quyết 4 Findings từ Round 2 & Chuẩn D2

### 2.1. `UX-F1` (P2 — Loại bỏ mã tool kỹ thuật, raw JSON payload và biểu mẫu schema thô) → **ĐÃ ĐÓNG (PASS)**
1. **`ResponseMoment.tsx` & `presentation.tsx`:**
   - Tại `apps/chat-web/src/pages/Responses/ResponseMoment.tsx:49`, thẻ `<p className="font-mono font-semibold ...">{lookup.tool}</p>` đã được thay bằng `<p className="font-semibold text-[var(--planora-text)]">{toolActionLabel(lookup.tool)}</p>`.
   - Bảng `TOOL_ACTION_LABELS` và hàm `toolActionLabel(tool)` tại `apps/chat-web/src/pages/Cockpit/presentation.tsx:15-123` ánh xạ đầy đủ các tool (`trello.list_cards` → `"Đọc danh sách công việc Trello"`, `slack.post_message` / `slack.send_message` → `"Gửi thông báo Slack"`, `mysheets.read_range` → `"Đọc dữ liệu bảng tính Google Sheets"`, `gmail.send_message` → `"Gửi email Gmail"`, `trello.add_member` → `"Gán thành viên vào thẻ Trello"`, v.v.) kèm fallback tiếng Việt tự nhiên cho các tool mới. Không còn bất kỳ chuỗi định danh dạng `service.method` hay font monospace nào trên `AnswerMoment`.
2. **`RecoveryMoment.tsx` & `PlanoraActiveTurn.tsx`:**
   - Tại `apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx:105-130`, khối `<code>{paused.tool}</code>` và `<pre>{JSON.stringify(savedArguments(planStep.args, snapshot), null, 2)}</pre>` đã bị xóa bỏ hoàn toàn.
   - Thay thế bằng khối `<details><summary>Thông tin đối chiếu</summary>` hiển thị tóm tắt nghiệp vụ gồm: `Hành động: {toolActionLabel(paused.tool)}`, `Nội dung công việc: {paused.description}`, `Lý do gián đoạn: {paused.error}`, `Thời gian thực hiện: {paused.duration}`, và danh sách `Dữ liệu liên quan`.
   - Tại `apps/chat-web/src/planora/workspace/PlanoraActiveTurn.tsx:365-375`, khối `<pre>{JSON.stringify(state.activePlan, null, 2)}</pre>` cũng đã được thay bằng danh sách các bước công việc có đánh số thứ tự.
3. **`RecoveryEditor.tsx`:**
   - Tại `apps/chat-web/src/pages/Cockpit/RecoveryEditor.tsx:75-143`, biểu mẫu sửa bước lỗi cho các công cụ đã đăng ký (`slack.send_message`, `trello.create_card`, `telegram.send_message`, v.v.) không còn render textarea JSON thô:
     - Trường `channel` hiển thị `<input type="text">` với nhãn `"Tên kênh hoặc mã kênh"` và placeholder `"Ví dụ: #general, #thong-bao hoặc C12345"`.
     - Trường nội dung (`text`, `body`, `message`, `content`, `description`) hiển thị `<textarea>` văn bản thuần với nhãn `"Nội dung tin nhắn"`.
     - Copy hướng dẫn đã chuyển sang ngôn ngữ công việc (`"Để chỉnh lại nội dung công việc, cần dừng kế hoạch cũ và lập kế hoạch mới..."`, `"Gửi nội dung sửa để Planora lập kế hoạch mới?"`).

### 2.2. `UX-F2` (P2 — Loại bỏ badge "Make.com Orbital Flow", class cam cũ, nhãn "ATI", badge "Chưa lập kế hoạch" và lặp bong bóng tin nhắn) → **ĐÃ ĐÓNG (PASS)**
1. **`RequestMoments.tsx`:**
   - Đã xóa hoàn toàn huy hiệu `"Make.com Orbital Flow"` và toàn bộ các class cam cũ (`bg-brand-primary`, `border-[#FFDFC6]`, `focus-within:shadow-orange-glow`), chuyển sang hệ thống token ngữ nghĩa của Planora (`--planora-paper`, `--planora-divider`, `--planora-primary`, `--planora-on-primary`, `--planora-surface-inset`).
   - Tại `RequestMoments.tsx:400`, câu thông báo đã đổi thành `"Planora đang lập kế hoạch cho lượt này"`.
2. **`ResponseMoment.tsx` & `PlanningErrors.tsx`:**
   - Tại `ResponseMoment.tsx:68-79`: Avatar đổi từ `"A"` sang `"P"`, thương hiệu đổi từ `"ATI"` sang `"Planora"`, xóa bỏ hoàn toàn badge máy trạng thái `"Chưa lập kế hoạch"` và thay bằng badge ngữ cảnh nghiệp vụ (`"Thông tin tra cứu"`, `"Cần kết nối thêm"`, `"Làm rõ yêu cầu"`).
   - Tại `PlanningErrors.tsx:26-27, 60`: Đổi `"ATI đang suy nghĩ lâu hơn thường lệ"` thành `"Planora đang suy nghĩ lâu hơn thường lệ"`, và loại bỏ class `font-mono` khỏi `#failed-prompt-text`.
3. **Khử trùng lặp bong bóng tin nhắn (`PlanoraChatWorkspace.tsx:243-254`):**
   - `activeMessageIds` đã bao gồm cả tin nhắn assistant mới nhất ở các trạng thái `'answer'`, `'refusal'`, `3` và tin nhắn user đang hoạt động ở `[3, 4, 5, 6, 7, 8, 9, 'answer', 'refusal', 'unsuccessful']`. Kiểm chứng thực tế trên trình duyệt Chromium xác nhận câu yêu cầu của người dùng và câu hỏi làm rõ chỉ xuất hiện **đúng 1 lần duy nhất** trên màn hình.

### 2.3. `UX-F3` (P2 — Khắc phục thanh composer dock che khuất nút hành động) → **ĐÃ ĐÓNG (PASS)**
- **Cách sửa:** Tại `apps/chat-web/src/planora/styles/components.css:464-465, 537-538`, `.planora-chat-feed` được cấu hình:
  - Desktop: `padding: 24px 24px calc(var(--cockpit-bottom-space, 120px) + 24px);` và `scroll-padding-bottom: calc(var(--cockpit-bottom-space, 120px) + 24px);`
  - Mobile (`@media (max-width: 1023px)`): `padding: 16px 12px calc(var(--cockpit-bottom-space, 120px) + 20px);` và `scroll-padding-bottom: calc(var(--cockpit-bottom-space, 120px) + 20px);`
- **Bằng chứng đo thực tế trên Chromium (`r3-metrics.json`, ảnh `r3-clarification-desktop-light.png` & `r3-clarification-mobile-light.png`):**
  - Desktop (`1440×900`): `paddingBottom = 131.5px`, `scrollPaddingBottom = 131.5px`, đáy nút `"Xác nhận và tiếp tục"` ở `y = 560px` trong khi đỉnh thanh dock ở `y = 808.5px` (`overlaps: false`, khoảng cách thoáng `248.5px`).
  - Mobile (`375×812`): `paddingBottom = 148px`, `scrollPaddingBottom = 144px`, đáy nút `"Xác nhận và tiếp tục"` ở `y = 675.3px` trong khi đỉnh thanh dock ở `y = 704px` (`overlaps: false`, khoảng cách thoáng `28.7px`).

### 2.4. `UX-P3-1` (P3 — Tương phản trạng thái hover của nút "Dừng hẳn quy trình" ở Light mode) → **ĐÃ ĐÓNG (PASS)**
- **Cách sửa:** Tại `apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx:144`, nút `"Dừng hẳn quy trình"` dùng `bg-[var(--planora-error-bg)] hover:bg-[var(--planora-error-bg)] text-[var(--planora-error-text)] border border-[var(--planora-error-border)] hover:border-[var(--planora-error-text)] hover:shadow-xs`.
- **Số đo thực tế từ computed style trên Chromium (`r3-metrics.json`, ảnh `r3-stop-hover-light.png` & `r3-stop-hover-dark.png`):**
  - Light mode (default & `:hover`): chữ `rgb(154, 63, 50)` trên nền `rgb(248, 230, 223)` → tỷ lệ tương phản đạt **5.549:1** (vượt chuẩn WCAG AA `4.5:1` và ngưỡng `≥ 5.0:1`).
  - Dark mode (default & `:hover`): chữ `rgb(252, 165, 165)` trên nền `rgb(53, 26, 26)` → tỷ lệ tương phản đạt **8.420:1** (vượt chuẩn WCAG AA `4.5:1`).

### 2.5. Chuẩn D2 (Xử lý an toàn tuyệt đối khi `delivery_unknown`) → **ĐẠT (PASS)**
- Tại `apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx:57-58, 64-65, 75-76, 137-142`:
  - Khi `paused.status === 'delivery_unknown'`, `isDeliveryUnknown` và `hasUnknown` đều là `true`, khóa hoàn toàn `canRetry` (ẩn nút `"Thử lại"` và `"Sửa rồi thử lại"`) và `canContinue` (ẩn nút `"Làm tiếp các việc còn lại"`).
  - Nút Skip có điều kiện `(paused.status as string) !== 'delivery_unknown'`, nên bị ẩn hoàn toàn khi trạng thái là `delivery_unknown` kể cả khi `snapshot.recoveryActions` từ server có chứa `'skip'`.
  - Trên giao diện **CHỈ hiển thị 2 hành động an toàn**:
    1. Nút `"Dừng kế hoạch"` (`#btn-recovery-stop`) mở hộp thoại xác nhận dừng an toàn.
    2. Liên kết kiểm tra ngoài trên dịch vụ đích (`"Kiểm tra trên Slack"`, `href="https://slack.com/app_redirect?channel=%23announcements"`).

---

## 3. Lệnh kiểm thử đã chạy, Exit Codes & Kiểm chứng Đột biến (Mutation RED)

| Lệnh thực thi | Kết quả & Số lượng | Exit code |
| --- | --- | --- |
| `npm run typecheck:v3` | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` đạt sạch | `0` |
| `npm test -w @wap/chat-web -- planora-responses-recovery` | **1/1 file, 25/25 tests PASS** (345ms) | `0` |
| `npm test -w @wap/chat-web` | **102/102 test files, 1153/1153 tests PASS** (32.56s) | `0` |
| `npm run build:v3` | Vite build thành công (`198 modules transformed`, 437ms) | `0` |
| `node scripts/test-v3-web-build-security.mjs` | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` | `0` |
| Kiểm chứng đột biến RED thực tế: `git checkout f4cd6f44 -- apps/chat-web/src/ && npm test -w @wap/chat-web -- planora-responses-recovery` (sau đó khôi phục nguyên trạng `HEAD`) | **7/25 tests FAIL đúng hành vi vừa sửa** (2 test `AnswerMoment` phơi `trello.list_cards`, 1 test `SlowPlanningMoment` còn chữ `ATI`, 2 test `RecoveryMoment`/`RecoveryEditor` phơi `<code>`/`<pre>`/thiếu nhãn nghiệp vụ, 1 test `RecoveryEditor` còn chữ `ATI`, 1 test `Strict D2 safety` cho `delivery_unknown`) | `1` (RED thật) |
| Playwright E2E `r3.spec.mjs` trên PostgreSQL 18.3 sandbox riêng (port `55547`, API `3047`, Web `5247`) | **2/2 suites PASS** (15.2s): xác minh trực tiếp trên DOM Chromium cho `UX-F1`, `UX-F2`, `UX-F3` (desktop `1440×900` & mobile `375×812` `overlaps: false`), `UX-P3-1` (Light hover `5.549:1`, Dark hover `8.420:1`) | `0` |

### Bằng chứng ảnh chụp thực tế tại head `2ddaab93` (`C:/Users/Admin/AppData/Local/Temp/ati-pl07-review-r3-2ddaab93/results/`):
- `r3-answer-1440-light.png`: `AnswerMoment` với thương hiệu `Planora`, avatar `P`, badge `Thông tin tra cứu`, nhãn tra cứu tiếng Việt `Đọc danh sách công việc Trello`, không lặp bong bóng tin nhắn.
- `r3-failed-1440-light.png`: `RecoveryMoment` (Moment 7) mở accordion `Thông tin đối chiếu` hiển thị `Hành động: Gửi thông báo Slack`, không có thẻ `<code>` hay `<pre>` JSON.
- `r3-editor-1440-light.png`: `RecoveryEditor` hiển thị form nghiệp vụ với trường `Tên kênh hoặc mã kênh` (`#general`) và `Nội dung tin nhắn` (`Tổng hợp công việc`).
- `r3-clarification-desktop-light.png` & `r3-clarification-mobile-light.png`: `ExpandedClarificationMoment` đã prefill `"Gửi Slack"` xuống composer đáy, không lặp câu hỏi và nút `"Xác nhận và tiếp tục"` hoàn toàn không bị thanh dock che khuất.
- `r3-stop-hover-light.png` & `r3-stop-hover-dark.png`: Trạng thái `:hover` trên nút `"Dừng hẳn quy trình"` ở cả Light mode (`5.549:1`) và Dark mode (`8.420:1`).

### Phần `NOT_RUN` & Giới hạn:
- OAuth thật và gọi ghi/đọc tới các provider live (Gmail, Google Calendar, Google Sheets, Trello, GitHub, Telegram, Slack, Notion, Jira).
- Gọi LLM planner live.

---

## 4. Ghi chú P3 (Không chặn) & Phân định Phạm vi ngoài PL-07

1. ** UX-P3-2 (P3 — Không chặn): `RecoveryMoment.tsx:122` gọi `recoveryFieldLabel` thay vì `friendlyFieldLabel` cho danh sách `Dữ liệu liên quan`**
   - **Vị trí:** `apps/chat-web/src/pages/Cockpit/RecoveryMoment.tsx:122` và `apps/chat-web/src/pages/Cockpit/recovery-labels.ts:11-26`.
   - **Mô tả:** Worker đã viết hàm `friendlyFieldLabel(tool, key, description)` trong `recovery-labels.ts:11-26` (ánh xạ `channel` → `'Tên kênh hoặc mã kênh'`, `text`/`body` → `'Nội dung tin nhắn'`, v.v.), nhưng tại `RecoveryMoment.tsx:122` vẫn gọi `recoveryFieldLabel(paused.tool, k)`. Do `recovery-labels.json` chỉ khai báo `channel` trong nhóm `outputs` mà chưa có trong `common` hay `services.slack`, dòng đối chiếu trong accordion hiển thị `channel: #general` thay vì `Tên kênh hoặc mã kênh: #general` (xem ảnh `r3-failed-1440-light.png`).
   - **Gợi ý cải thiện nhỏ (có thể gộp ở nhịp polish chung):** Đổi `recoveryFieldLabel(paused.tool, k)` tại `RecoveryMoment.tsx:122` sang `friendlyFieldLabel(paused.tool, k)`.
2. **Phạm vi ngoài PL-07 (Thuộc PL-05):**
   - `CockpitHeader.tsx`, `ChatComposer.tsx` (nút `Gửi →` màu cam `#FF5701` và dòng chữ `"ATI chỉ đọc và ghi..."` ở chân trang) và `PlanoraConversationFeed.tsx` (nhãn `"ATI"` trên bong bóng lịch sử cũ) nằm ngoài danh sách file sở hữu của card PL-07 và thuộc phạm vi refactor của **PL-05** theo lộ trình Giai đoạn 2 trong Design Brief v2.0.

---

## 5. Kết luận Nghiệm thu (Final Verdict)

- **Đánh giá Behavior & Technical:** **PASS**
- **Đánh giá UX Gate 05/11 (Business-First):** **ĐẠT**
- **Overall Verdict:** **Đạt**
