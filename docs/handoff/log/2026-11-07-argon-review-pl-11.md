# Báo cáo Review Độc lập — PL-11 (Lịch chạy và bản tin tự động theo Design Brief v2.0 & Business-First UX)

- **Reviewer:** Antigravity / Gemini 4 Argon (High); model ID `gemini-4-argon-high`
- **Ngày review:** 07/11/2026
- **Task:** [PL-11 · Lịch chạy và bản tin tự động (Schedules & Auto-Digest UI)](../tasks/PL-11-planora-schedules-digest.md)
- **UX Authority:** [`docs/superpowers/specs/2026-11-05-planora-design-brief.md`](../../superpowers/specs/2026-11-05-planora-design-brief.md) & [`docs/superpowers/specs/2026-11-05-planora-business-first-ux.md`](../../superpowers/specs/2026-11-05-planora-business-first-ux.md)
- **PR_URL hoặc LOCAL_ONLY:** `LOCAL_ONLY`
- **Target Branch:** `longnguyen005/feat-planora-pl-11` (target tích hợp: `codex/planora-ui`)
- **Base SHA:** `89deb95ce3de0f3708c3d07d7184c335b65f61b5` (HEAD accepted của PL-10)
- **Reviewed Head SHA:** `f643a297a9dc809465f58656c40e364e0870eb18`
- **Worktree review:** `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-11` (branch `longnguyen005/review-planora-pl-11`)
- **Orca Worker / Coordinator:** `term_86c9edbc-3871-4b48-9fd9-2e2dbf03c167` / `term_2d35bb18-7746-41a6-83b0-2669aeb86776` (`task_ec0e08afa645`, `ctx_feff763aca43`)

---

## 1. Xác minh Git, Head SHA & Phạm vi File (File Ownership)

1. **Xác minh SHA:**
   - `git rev-parse HEAD` = `f643a297a9dc809465f58656c40e364e0870eb18`
   - `git merge-base 89deb95ce3de0f3708c3d07d7184c335b65f61b5 f643a297a9dc809465f58656c40e364e0870eb18` = `89deb95ce3de0f3708c3d07d7184c335b65f61b5`
   - Khớp chính xác commit `f643a297 feat(planora): implement PL-11 schedules and auto-digest UI`.
2. **Phạm vi thay đổi (`89deb95ce3de0f3708c3d07d7184c335b65f61b5..f643a297a9dc809465f58656c40e364e0870eb18`):**
   - Gồm 8 files (`+1648 / -327`), nằm hoàn toàn trong phạm vi được phép của PL-11:
     1. `apps/chat-web/src/pages/Cockpit/ScheduleActions.tsx`
     2. `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`
     3. `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`
     4. `apps/chat-web/src/pages/History/ScheduleSection.tsx`
     5. `apps/chat-web/tests/planora-pl-11-schedules.test.tsx` *(tạo mới)*
     6. `apps/chat-web/tests/sched-03-ui.test.tsx`
     7. `docs/handoff/tasks/PL-11-planora-schedules-digest.md`
     8. `docs/handoff/log/2026-11-07-gemini-pl-11.md` *(tạo mới)*
   - Không có thay đổi trái phép sang `apps/chat-web/src/hooks/use-schedules.ts`, `apps/chat-api`, `packages/*`, `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 2. Kết quả Chạy Lệnh Kiểm thử Thực tế

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
| :--- | :---: | :---: | :--- |
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` (0 lỗi trên toàn bộ 6 workspaces) |
| `npm test -w @wap/chat-web -- sched` | `0` | **PASS** | `7 passed (7)` test files, `75 passed (75)` tests |
| `npm test -w @wap/chat-web` | `0` | **PASS** | `106 passed (106)` test files, `1205 passed (1205)` tests |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (`200 modules transformed`) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | PASS: Built web bundle contains only safe public config references |

---

## 3. Các phát hiện (Findings) — Cần khắc phục trước khi đóng Gate

### [F1 — P2] `ScheduleMoment` và `ScheduleSection` gọi `WorkflowFlowCanvas` thiếu `variant="planora"`, làm rò rỉ bảng màu prototype cũ (`#FF5701`, `#111827`, `#E7E7E2`, `#F8F8F6`) và bị che khuất bởi `vi.mock` trong test
- **File & dòng:**
  - `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx:165`
  - `apps/chat-web/src/pages/History/ScheduleSection.tsx:113-118`
  - `apps/chat-web/tests/planora-pl-11-schedules.test.tsx:15-17` (cùng #L84 và #L277-L338)
- **Cách tái hiện (Trigger):**
  - Hiển thị `ScheduleMoment` với `metadata.services` không rỗng (ví dụ `['mycalendar', 'slack']`) hoặc `ScheduleSection` với một lịch có `services: ['mycalendar', 'slack']` trên trình duyệt thực tế (không mock `WorkflowFlowCanvas`).
- **Tác động & Bằng chứng (Impact & Evidence):**
  - `WorkflowFlowCanvas` chỉ uỷ quyền sang `PlanoraWorkflowSteps` khi nhận prop `variant="planora"` (`WorkflowFlowCanvas.tsx:311`).
  - Do `ScheduleMoment.tsx:165` và `ScheduleSection.tsx:113` không truyền `variant="planora"`, cả hai nơi vẫn render nhánh Orbital cũ (`WorkflowFlowCanvas.tsx:465-800`) với viền/nền sáng cứng `border-[#E7E7E2] bg-[#F8F8F6]` (#L471), chấm cam `bg-[#FF5701]` ở `mode="schedule"` (#L486), nút/badge `bg-[#111827] text-white` (#L237), chữ `text-[#111827]` / `text-[#4B5563]` / `text-[#6B7280]`, cùng các thẻ `<svg>` trang trí không có `aria-hidden="true"` (#L143, #L169, #L239, #L537).
  - Trong `planora-pl-11-schedules.test.tsx:15-17`, test đã mock cứng `WorkflowFlowCanvas` thành `<div data-testid="workflow-flow-canvas-mock" />` và truyền `services: []` ở dòng 84, khiến các kiểm tra `not.toContain('#FF5701')`, `not.toContain('#111827')`, `not.toContain('#E7E7E2')` và kiểm tra `svg[aria-hidden="true"]` bị vô hiệu hoá đối với luồng hiển thị bước dịch vụ.
- **Hướng sửa (Fix):**
  1. Truyền `variant="planora"` vào `<WorkflowFlowCanvas variant="planora" ... />` tại `ScheduleMoment.tsx:165` và `ScheduleSection.tsx:113-118`.
  2. Bỏ `vi.mock('../src/components/WorkflowFlowCanvas', ...)` trong `planora-pl-11-schedules.test.tsx`, render canvas thật với `services: ['mycalendar', 'slack']` và kiểm tra không còn rò rỉ mã màu cũ, 100% SVG có `aria-hidden="true"`.

---

### [F2 — P3] Câu mô tả chế độ duyệt bị cố định ở nhánh Calendar và thiếu id radio ở nhánh Sheets
- **File & dòng:**
  - `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx:392-394`
  - `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx:402-426`
- **Tác động & Bằng chứng:**
  - Tại dòng 392-394, câu mô tả cố định là `"Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt..."` bất kể `approvalMode` là `manual` hay `auto_digest`.
  - Tại dòng 402-425 (nhánh generic/Sheets), các thẻ radio thiếu thuộc tính `id="schedule-mode-manual"` và `id="schedule-mode-auto-digest"`.
- **Hướng sửa:**
  - Cập nhật câu mô tả theo `approvalMode === 'auto_digest'` tương tự như nhánh Telegram/GitHub (`#L280-L284`, `#L444-L448`).
  - Gắn `id="schedule-mode-manual"` / `id="schedule-mode-auto-digest"` cho hai radio ở nhánh generic/Sheets (`#L402-L408` và `#L418-L425`).

---

### [F3 — P3] Lệch HEAD_SHA trong tài liệu bàn giao PL-11
- **File & dòng:**
  - `docs/handoff/tasks/PL-11-planora-schedules-digest.md:69`
  - `docs/handoff/log/2026-11-07-gemini-pl-11.md:105`
- **Tác động & Bằng chứng:**
  - Cả hai file đang ghi `ee7b98ceb82ac0452eb4fd2f902f6e22e49d5b91` (SHA trước khi amend, không tồn tại trong git history) thay vì commit thực tế `f643a297a9dc809465f58656c40e364e0870eb18`.
- **Hướng sửa:**
  - Cập nhật SHA chính xác và bổ sung handoff log khắc phục `docs/handoff/log/2026-11-07-gemini-pl-11-review-fixes.md`.

---

## 4. Kết luận Thẩm định (Verdict)

- **Đánh giá Behavior & Technical:** **PASS** (`106/106` test files, `1205/1205` tests PASS; `typecheck:v3`, `build:v3` và `build-security` đều PASS với exit code `0`).
- **Đánh giá UX Gate 05/11 (Business-First & Design Brief v2.0):** **CHƯA ĐẠT** (Còn **1 finding P2** `F1` rò rỉ palette prototype cũ trong WorkflowFlowCanvas do thiếu `variant="planora"` và bị che giấu bởi `vi.mock`; **2 findings P3** `F2` và `F3`).
- **Gate:** Cần worker khắc phục `F1`, `F2`, `F3` trên `longnguyen005/feat-planora-pl-11` và submit commit mới cho Round 2 re-review.
- **Overall Verdict:** **Chưa đạt**
