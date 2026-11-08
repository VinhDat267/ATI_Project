# Báo cáo Tái thẩm định Độc lập (Round 2) — PL-11 (Lịch chạy và bản tin tự động theo Design Brief v2.0 & Business-First UX)

- **Reviewer:** Antigravity / Gemini 4 Argon (High); model ID `gemini-4-argon-high`
- **Ngày review:** 07/11/2026 (Round 2)
- **Task:** [PL-11 · Lịch chạy và bản tin tự động (Schedules & Auto-Digest UI)](../tasks/PL-11-planora-schedules-digest.md)
- **Báo cáo Round 1 đối chiếu:** [2026-11-07-argon-review-pl-11.md](2026-11-07-argon-review-pl-11.md)
- **Nhật ký khắc phục đối chiếu:** [2026-11-07-gemini-pl-11-review-fixes.md](2026-11-07-gemini-pl-11-review-fixes.md)
- **UX Authority:** [`docs/superpowers/specs/2026-11-05-planora-design-brief.md`](../../superpowers/specs/2026-11-05-planora-design-brief.md) & [`docs/superpowers/specs/2026-11-05-planora-business-first-ux.md`](../../superpowers/specs/2026-11-05-planora-business-first-ux.md)
- **PR_URL hoặc LOCAL_ONLY:** `LOCAL_ONLY`
- **Target Branch:** `codex/planora-ui`
- **Base SHA:** `89deb95ce3de0f3708c3d07d7184c335b65f61b5` (HEAD accepted của PL-10)
- **Round 1 Head SHA:** `f643a297a9dc809465f58656c40e364e0870eb18`
- **Reviewed Round 2 Head SHA:** `b4f42665ee5d05f20fc6d1465cad41111bcec4b3` (`fix(planora): resolve review findings F1-F3 for PL-11 schedules UI`)
- **Worktree review:** `C:\Users\Admin\orca\workspaces\ATI_Project\review-planora-pl-11` (branch `longnguyen005/review-planora-pl-11`)
- **Orca Worker / Coordinator:** `term_18ea0dbe-db99-423e-8c99-7adcb5f6f76c` / `term_2d35bb18-7746-41a6-83b0-2669aeb86776` (`task_7674e04d3fee`, `ctx_d5f5888827ca`)

---

## 1. Xác minh Git, Head SHA & Phạm vi File (File Ownership)

1. **Xác minh SHA:**
   - `git rev-parse HEAD` = `b4f42665ee5d05f20fc6d1465cad41111bcec4b3`
   - `git merge-base 89deb95ce3de0f3708c3d07d7184c335b65f61b5 HEAD` = `89deb95ce3de0f3708c3d07d7184c335b65f61b5`
2. **Phạm vi thay đổi Round 2 (`f643a297a9dc809465f58656c40e364e0870eb18..b4f42665ee5d05f20fc6d1465cad41111bcec4b3`):**
   - 7 files (`+257 / -16`):
     1. `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`
     2. `apps/chat-web/src/pages/History/ScheduleSection.tsx`
     3. `apps/chat-web/src/planora/workspace/PlanoraWorkflowSteps.tsx` (bổ sung `aria-hidden="true"` cho các thẻ `<svg>` trang trí trong `PlanoraWorkflowSteps`)
     4. `apps/chat-web/tests/planora-pl-11-schedules.test.tsx`
     5. `docs/handoff/tasks/PL-11-planora-schedules-digest.md`
     6. `docs/handoff/log/2026-11-07-gemini-pl-11.md`
     7. `docs/handoff/log/2026-11-07-gemini-pl-11-review-fixes.md` *(tạo mới)*
3. **Tổng phạm vi thay đổi toàn task PL-11 (`89deb95ce3de0f3708c3d07d7184c335b65f61b5..b4f42665ee5d05f20fc6d1465cad41111bcec4b3`):**
   - 10 files (`+1895 / -333`), không đụng chạm trái phép sang `apps/chat-web/src/hooks/use-schedules.ts`, `apps/chat-api`, `packages/*`, `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 2. Đối chiếu Khắc phục các Findings từ Round 1

### [F1 — P2] `WorkflowFlowCanvas` với `variant="planora"`, gỡ bỏ `vi.mock` và chuẩn hóa `aria-hidden="true"` trên SVG — **ĐÃ KHẮC PHỤC TRIỆT ĐỂ (CLOSED)**
- **Mã nguồn:**
  - `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx:165-171`: đã truyền `variant="planora"`, `mode="schedule"`, `services={scheduleServices}`, `isAutoDigest={isAutoDigestActive}`, `className="mt-3"`.
  - `apps/chat-web/src/pages/History/ScheduleSection.tsx:113-120`: đã truyền `variant="planora"`, `mode="schedule"`, `services={schedule.services}`, `isAutoDigest={schedule.kind !== 'plan'}`, `compact`, `className="mt-3"`.
  - `apps/chat-web/src/planora/workspace/PlanoraWorkflowSteps.tsx:126,151,218,242,496,609,634,814`: toàn bộ các thẻ `<svg>` trang trí (connector line, filter badge, schedule trigger badge, running spinner, auto-digest bolt, router branch connector, preview eye icon) đều có `aria-hidden="true"`.
- **Kiểm thử:**
  - `apps/chat-web/tests/planora-pl-11-schedules.test.tsx`: đã gỡ bỏ hoàn toàn `vi.mock('../src/components/WorkflowFlowCanvas')`, render `PlanoraWorkflowSteps` thật với `services: ['mycalendar', 'slack']` ở cả `ScheduleMoment` (`#L81-L117`) và `ScheduleSection` (`#L285-L315`), xác nhận sự hiện diện của `workflow-flow-canvas`, `workflow-node-mycalendar`, `workflow-node-slack`, 0% rò rỉ `#FF5701` / `#E04C00` / `#111827` / `#E7E7E2` / `#F8F8F6`, và 100% `<svg>` có `aria-hidden="true"`.

### [F2 — P3] Câu mô tả phê duyệt động ở nhánh Calendar và `id` radio ở nhánh Sheets — **ĐÃ KHẮC PHỤC TRIỆT ĐỂ (CLOSED)**
- **Mã nguồn:**
  - `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx:398-402`: câu mô tả cập nhật động theo `approvalMode === 'auto_digest'` (`"Tới giờ, Planora tự động gửi bản tin theo kế hoạch đã duyệt."` vs `"Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào."`).
  - `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx:411,428`: bổ sung `id="schedule-mode-manual"` và `id="schedule-mode-auto-digest"` cho 2 radio ở nhánh Sheets/Generic.
- **Kiểm thử:**
  - `apps/chat-web/tests/planora-pl-11-schedules.test.tsx:446-554`: đã có 2 bài unit test kiểm chứng trực tiếp hành vi toggle mô tả động ở nhánh Calendar và `id` radio ở nhánh Sheets.

### [F3 — P3] Đính chính SHA trong tài liệu bàn giao PL-11 — **ĐÃ KHẮC PHỤC TRIỆT ĐỂ (CLOSED)**
- `docs/handoff/tasks/PL-11-planora-schedules-digest.md:69` và `docs/handoff/log/2026-11-07-gemini-pl-11.md:105` đã cập nhật đúng commit SHA `f643a297a9dc809465f58656c40e364e0870eb18`, đồng thời bổ sung `docs/handoff/log/2026-11-07-gemini-pl-11-review-fixes.md`.

---

## 3. Kết quả Chạy Lệnh Kiểm thử Thực tế trên HEAD `b4f42665`

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
| :--- | :---: | :---: | :--- |
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` (0 lỗi TypeScript) |
| `npm test -w @wap/chat-web -- sched` | `0` | **PASS** | `7 passed (7)` test files, `78 passed (78)` tests (gồm 16 tests trong `planora-pl-11-schedules.test.tsx` và 29 tests trong `sched-03-ui.test.tsx`) |
| `npm test -w @wap/chat-web` | `0` | **PASS** | `106 passed (106)` test files, `1208 passed (1208)` tests (0 regressions) |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (`200 modules transformed`, `dist/assets/index-BJp7ysQB.css`, `dist/assets/index-DPs-Ttwj.js`) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | `PASS: production build excludes credential sentinels and 7 forbidden UI claims` |

---

## 4. Bằng chứng Kiểm thử Đột biến (Mutation Verification — Round 2)

Đã thực thi 4 phép thử đột biến trực tiếp trên mã nguồn sản phẩm và chạy `npx vitest run tests/planora-pl-11-schedules.test.tsx --root apps/chat-web`:

| Mã đột biến | Nội dung đột biến trên mã nguồn | Exit Code khi đột biến | Kết quả bắt lỗi | Khôi phục & Chạy lại |
| :--- | :--- | :---: | :--- | :---: |
| **R2-M1** | Xoá `variant="planora"` khỏi `WorkflowFlowCanvas` trong `ScheduleMoment.tsx:166` | `1` (FAIL) | **3 tests FAIL** ngay lập tức (`AssertionError: expected '<section data-moment="schedule" ...' not to contain '#FF5701'`) | `0` (16/16 PASS) |
| **R2-M2** | Xoá `aria-hidden="true"` trên `<svg>` của schedule trigger badge trong `PlanoraWorkflowSteps.tsx:218` | `1` (FAIL) | **2 tests FAIL** trong cả `ScheduleMoment` và `ScheduleSection` SVG A11y audit | `0` (16/16 PASS) |
| **R2-M3** | Cố định câu mô tả phê duyệt ở nhánh Calendar trong `ScheduleMoment.tsx:399` | `1` (FAIL) | **1 test FAIL** (`F2: Calendar candidate toggles dynamic description according to approvalMode`) | `0` (16/16 PASS) |
| **R2-M4** | Chèn `<button type="button">Lập lại kế hoạch</button>` vào nhánh `needs_attention` (`delivery_unknown`) trong `ScheduleRunRecovery.tsx:126` | `1` (FAIL) | **2 tests FAIL** (`AssertionError: expected <button type="button"></button> to be null`) | `0` (16/16 PASS) |

Sau khi khôi phục toàn bộ 4 đột biến, `git status -s` sạch hoàn toàn đối với toàn bộ tracked files và `vitest run tests/planora-pl-11-schedules.test.tsx` đạt `16 passed (16)` (exit code `0`).

---

## 5. Kết luận Thẩm định (Verdict)

- **Đánh giá Behavior & Technical:** **ĐẠT (PASS)** (`106/106` test files, `1208/1208` tests PASS; `typecheck:v3`, `build:v3`, `build-security` đều PASS với exit code `0`).
- **Đánh giá UX Gate 05/11 (Business-First UX v2.0 & Design Brief v2.0):** **ĐẠT (PASS)** (Toàn bộ findings `F1`, `F2`, `F3` từ Round 1 đã được xử lý triệt để; 4/4 phép thử đột biến `R2-M1` → `R2-M4` đều bị bắt chính xác).
- **Overall Verdict:** **ĐẠT**
