# 2026-11-05 · Gemini 4 Argon (High) · Review Độc lập PL-06 Round 3 (Refactor Business-First UX theo Design Brief v2.0)

- **Reviewer:** Antigravity / Gemini 4 Argon (High) (`gemini-4-argon-high`)
- **Task:** `PL-06` — Kế hoạch, thực thi, xem trước và biên nhận (Refactor Business-First UX theo Design Brief v2.0)
- **Task Card:** `docs/handoff/tasks/PL-06-planora-workflow-cards.md`
- **UX Task Card:** `docs/handoff/tasks/PLANORA-UX-01-business-first-redesign.md`
- **Worktree Review:** `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-06-r3` (`longnguyen005/review-planora-pl-06-r3`)
- **Target Branch:** `longnguyen005/feat-planora-pl-06` (target tích hợp: `codex/planora-ui`)
- **Base SHA:** `514d982fd9fc152290feb305b0d97f2c40dda21a`
- **Head SHA:** `5fdcb366fd49e456bd81842ee0b6d9577a2fe6a7`
- **PR_URL / Mode:** `LOCAL_ONLY`

---

## 1. Xác minh Git, Phạm vi File & Đối chiếu Chuẩn tắc

- **Xác minh HEAD SHA:** `git rev-parse HEAD` và `git rev-parse longnguyen005/feat-planora-pl-06` đều khớp chính xác `5fdcb366fd49e456bd81842ee0b6d9577a2fe6a7`.
- **Phạm vi file thay đổi (`514d982f..5fdcb366`):**
  - `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`
  - `apps/chat-web/src/planora/workspace/PlanoraWorkflowSteps.tsx`
  - `apps/chat-web/src/pages/Cockpit/PreviewContents.tsx`
  - `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`
  - `apps/chat-web/src/planora/styles/tokens.css`
  - `apps/chat-web/tests/planora-workflow-steps.test.tsx`
  - `docs/handoff/log/2026-11-05-gemini-pl-06-business-first-refactor.md`
  - `docs/handoff/tasks/PL-06-planora-workflow-cards.md`
  - `docs/handoff/tasks/PLANORA-UX-01-business-first-redesign.md`
  - `docs/handoff/planora-prompts/COMMON.md`
- **Ranh giới sở hữu:** Không sửa `apps/chat-api`, `packages/*`, `db/v3`, `CURRENT-STATE.md` hay `ROADMAP.md`. Tuân thủ đúng quy ước bàn giao.

---

## 2. Kết quả Chạy Kiểm thử & Kiểm chứng Thực tế tại Máy Reviewer

| Lệnh kiểm tra | Exit Code | Kết quả thực tế |
| :--- | :---: | :--- |
| `npm run typecheck:v3` | `0` | **PASS** — Không có lỗi kiểu dữ liệu trên cả `apps/chat-api` và `apps/chat-web`. |
| `npm test -w @wap/chat-web -- planora-workflow-steps` | `0` | **PASS** — `1 passed (1)`, `16 passed (16)` trong `tests/planora-workflow-steps.test.tsx` (246ms). |
| `npm test -w @wap/chat-web` | `0` | **PASS** — `101 passed (101)` test files, `1131 passed (1131)` tests (31.98s). |
| `npm run build:v3` | `0` | **PASS** — `tsc -p tsconfig.json && vite build` thành công (`198 modules transformed`, 461ms). |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** — `PASS: production build excludes credential sentinels and 7 forbidden UI claims`. |

### Kiểm chứng Mutation / Regression (Chống Mock Ảo giác)
Để xác minh bộ test `apps/chat-web/tests/planora-workflow-steps.test.tsx` kiểm tra hành vi thật chứ không phải mock hình thức, reviewer đã thực hiện đột biến tạm thời trong worktree review:
1. Tắt `setApprovingLocal(true)` và `setIsReplacedByChat(true)` trong `PlanMoment.tsx:55-64`.
2. Tắt điều kiện render nhãn đọc trung thực `isRead && mode === 'preview'` trong `PlanoraWorkflowSteps.tsx:421`.
3. Chạy lại `npm test -w @wap/chat-web -- planora-workflow-steps`:
   - **Kết quả RED:** Exit code `1` (`3 failed | 13 passed (16)`), bắt chính xác 3 lỗi: thiếu nhãn `"Sẽ đọc khi bạn duyệt kế hoạch"`, nút duyệt không khóa chống double-click, và thiếu huy hiệu `"Đã thay thế bằng đề xuất mới trong cuộc trò chuyện"`.
4. Khôi phục nguyên trạng mã nguồn và chạy lại `npm test -w @wap/chat-web -- planora-workflow-steps`:
   - **Kết quả GREEN:** Exit code `0` (`16 passed (16)`), `git status` và `git diff` sạch hoàn toàn.

---

## 3. Đánh giá Chi tiết theo Yêu cầu Trọng tâm & Design Brief v2.0 (Mẫu 4)

### 3.1. Xóa bỏ triệt để rác kỹ thuật & đồ họa cũ (`UX-F1`, `UX-F2`)
- **`PlanMoment.tsx`:**
  - Đã xóa hoàn toàn state `techOpen`, nút bật/tắt và toàn bộ khối `#tech-details-panel` chứa `<pre>{JSON.stringify(plan, null, 2)}</pre>`.
  - Đã xóa hiển thị chuỗi `plan_hash` / UUID thô trên bề mặt giao diện; giữ thuộc tính `data-plan-id` và `data-plan-hash` trên phần tử ẩn (`className="hidden" aria-hidden="true"`) để bảo toàn định danh kiểm chứng.
- **`PlanoraWorkflowSteps.tsx`:**
  - Đã xóa bỏ hoàn toàn đồ thị Orbital Flow cũ (`OrbitalNodeButton`, `orbitalAssets`, `getOrbitalMeta`, `DottedConnector`, `showStatusBubble`, `workflow-router-node`, hoạt họa SVG chấm quỹ đạo).
  - Thay bằng dải lọc công cụ dạng pill tinh tế (`workflow-upstream-chain`) và chuỗi thẻ công việc tuần tự `planora-step-cards-grid` (`grid-cols-1 md:grid-cols-2`), giữ nguyên các định danh tương tác (`#plan-cards-container`, `data-od-id="plan-item-N"`, `#preview-${step.id}`).

### 3.2. Các chuẩn nghiệp vụ từ Design Brief v2.0 & Claude Opus Review
- **Chuẩn D1 (Trung thực dữ liệu & Placeholder phụ thuộc):**
  - Bước đọc trong kế hoạch (`isRead && mode === 'preview'`) hiển thị rõ hộp thông báo `[data-testid="read-step-notice-${step.id}"]`: *"Sẽ đọc khi bạn duyệt kế hoạch"* (`PlanoraWorkflowSteps.tsx:421-431`), không bịa số lượng kết quả đọc trước khi chạy.
  - Bước ghi tiếp theo có tham số phụ thuộc kết quả bước trước (`$ref`, `$template`, `$step_X`) được `formatBusinessArgValue` (`PreviewContents.tsx:27-59`) và `extractBusinessArgs` (`PlanoraWorkflowSteps.tsx:86-117`) ánh xạ thành placeholder chữ nghiêng thân thiện: `‹danh sách công việc đọc ở bước X›` (và `‹kết quả step_X: url›` cho liên kết).
- **Chuẩn D5 (Vòng đời kế hoạch & Busy Locking):**
  - **Busy locking:** Khi bấm duyệt (`handleApprove`), `approvingLocal` chuyển ngay sang `true`, khóa nút `disabled={isApproveDisabled}`, hiển thị spinner kèm *"Đang xử lý..."*, chặn hoàn toàn double-click (`PlanMoment.tsx:55-59, 208-230`).
  - **Nhãn nút hành động theo số bước:** Kế hoạch 1 bước hiển thị động từ tác động cụ thể (*"Gửi tin nhắn Slack ngay"*, *"Lưu vào bảng tính"*, *"Gửi email ngay"*...); từ 2 bước trở lên hiển thị *"Duyệt và thực hiện X việc"* (`PlanMoment.tsx:8-21, 66-70`).
  - **Khóa đề xuất cũ khi bấm "Sửa qua Chat":** `handleEdit` đặt `isReplacedByChat = true`, làm mờ thẻ cũ (`opacity-70`), hiển thị huy hiệu `role="status"` `[data-testid="plan-replaced-badge"]`: *"Đã thay thế bằng đề xuất mới trong cuộc trò chuyện"*, đồng thời vô hiệu hóa cả nút Duyệt và nút Sửa trên thẻ cũ (`PlanMoment.tsx:61-64, 84-95, 212, 234`).
- **Chuẩn D8 (Tương phản màu sắc WCAG AA):**
  - Trong `apps/chat-web/src/planora/styles/tokens.css:130-133`, token dark mode `--planora-primary: #8fb68e` kết hợp với `--planora-on-primary: #171c18` đạt tỷ lệ tương phản **7.61:1**, vượt xa ngưỡng WCAG AA (≥ 4.5:1).
- **`ReceiptMoment.tsx` & `ExecutionMoment.tsx`:**
  - `ReceiptMoment.tsx` đã loại bỏ khối `<pre>{JSON.stringify(step.output, null, 2)}</pre>` từng làm lộ raw JSON output.
  - Biên nhận hiển thị tiêu đề kết quả nghiệp vụ (`resultTitle(step)` kèm số issue/key thật) và liên kết đích an toàn chỉ nhận `https:` (`outcomeURL(step)` với nhãn *"Xem tin nhắn vừa gửi trên Slack"*, *"Mở bảng tính Google Sheets"* hoặc `operation(step.tool).link`).
  - `ExecutionMoment.tsx` hiển thị tiến trình từng bước theo trạng thái thực tế của sự kiện server (`succeeded`, `running`, `pending`, `skipped`), không dùng bộ đếm thời gian giả.

---

## 4. Findings (P1 / P2 / P3)

- **P1 (Blocker):** Không có (0).
- **P2 (Major):** Không có (0).
- **P3 (Minor / Non-blocking notes):**
  1. **`P3-1` — `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx:145-153`:** Khối `<details><summary>Chi tiết kỹ thuật</summary><code>{step.tool}</code>...</details>` trong `ReceiptCard` đã bỏ `<pre>{JSON.stringify(step.output)}</pre>` nhưng vẫn giữ thẻ `<code>{step.tool}</code>` để tương thích ngược với kiểm thử cũ `apps/chat-web/tests/fe-05b-parity-b.test.tsx:99`. Khi cập nhật đồng bộ bộ test legacy FE-05b ở pha tích hợp cuối, nên ẩn luôn tên tool kỹ thuật này khỏi DOM hiển thị.
  2. **`P3-2` — `docs/handoff/tasks/PL-06-planora-workflow-cards.md:85`:** Mục 5 (Kết quả) ghi Base SHA là `514d982fa181829cb93c4a20f92fefae3334657d` (đúng prefix `514d982f`, nhưng lệch phần đuôi so với SHA thật của commit cha `514d982fd9fc152290feb305b0d97f2c40dda21a`). Không ảnh hưởng tới lịch sử Git hay mã nguồn.

---

## 5. Kết luận Nghiệm thu (Verdict)

- **Đánh giá Behavior & Technical:** **PASS**
- **Đánh giá UX Gate 05/11 (Business-First & Design Brief v2.0):** **ĐẠT**
- **Overall Verdict:** **Đạt**
