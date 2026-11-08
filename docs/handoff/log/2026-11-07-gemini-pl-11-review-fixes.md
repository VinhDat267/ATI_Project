# 2026-11-07 · gemini · PL-11 · Khắc phục toàn diện Review Findings F1-F3 (Argon High)

- **Nhiệm vụ:** [PL-11 · Lịch chạy và bản tin tự động (Schedules & Auto-Digest UI)](../tasks/PL-11-planora-schedules-digest.md)
- **Worktree / Nhánh:** `longnguyen005/feat-planora-pl-11`
- **Target branch:** `codex/planora-ui`
- **Base SHA (Trước khi sửa):** `f643a297a9dc809465f58656c40e364e0870eb18`
- **Orca Task ID:** `task_d47f31e0d703` (Dispatch `ctx_f023946ac364`)

---

## 1. Mục tiêu & Bối cảnh

Khắc phục triệt để 1 finding P2 (F1) và 2 findings P3 (F2, F3) được chỉ ra trong báo cáo review độc lập của Argon High:

1. **[F1 — P2] Bổ sung variant="planora" vào WorkflowFlowCanvas & gỡ bỏ vi.mock che khuất kiểm thử:**
   - Tại `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx:164-166`: bổ sung prop `variant="planora"` và `className="mt-3"` khi gọi `WorkflowFlowCanvas`.
   - Tại `apps/chat-web/src/pages/History/ScheduleSection.tsx:112-119`: bổ sung prop `variant="planora"` và `className="mt-3"` khi gọi `WorkflowFlowCanvas`.
   - Tại `apps/chat-web/tests/planora-pl-11-schedules.test.tsx`:
     - Gỡ bỏ hoàn toàn `vi.mock('../src/components/WorkflowFlowCanvas', ...)`.
     - Render `WorkflowFlowCanvas` thật với `services: ['mycalendar', 'slack']` trong cả `ScheduleMoment` và `ScheduleSection`.
     - Kiểm tra DOM render đầy đủ các node của `PlanoraWorkflowSteps` (`data-planora-workflow-steps="true"`, `node-bubble-mycalendar`, `node-bubble-slack`).
     - Xác nhận 0% rò rỉ mã màu prototype cũ (`#FF5701`, `#E04C00`, `#111827`, `#E7E7E2`, `#F8F8F6`).
     - Bổ sung `aria-hidden="true"` cho các SVG icons trong `PlanoraWorkflowSteps.tsx` (như trigger badge lịch `data-trigger-badge="schedule"`), đảm bảo 100% thẻ `<svg>` vector icons đều có `aria-hidden="true"`.

2. **[F2 — P3] Câu mô tả phê duyệt động theo approvalMode & id radio ở nhánh Sheets:**
   - Tại `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx:392-394` (nhánh Calendar): cập nhật câu mô tả theo trạng thái phê duyệt thực tế `approvalMode === 'auto_digest'`:
     - Khi `auto_digest`: `"Tới giờ, Planora tự động gửi bản tin theo kế hoạch đã duyệt."`
     - Khi `manual`: `"Tới giờ, Planora lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào."`
   - Tại `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx:402-425` (nhánh Sheets/Generic): bổ sung `id="schedule-mode-manual"` cho radio duyệt thủ công và `id="schedule-mode-auto-digest"` cho radio tự gửi.
   - Thêm unit test xác thực chuyển đổi câu mô tả động khi toggle radio Calendar và kiểm tra id radio của nhánh Sheets.

3. **[F3 — P3] Đính chính SHA trong tài liệu & tạo handoff log khắc phục:**
   - Sửa commit SHA ban đầu `ee7b98ce...` thành SHA thực tế `f643a297a9dc809465f58656c40e364e0870eb18` trong `docs/handoff/tasks/PL-11-planora-schedules-digest.md` và `docs/handoff/log/2026-11-07-gemini-pl-11.md`.
   - Tạo handoff log này ghi nhận đầy đủ việc khắc phục các findings.

---

## 2. Chi tiết các tệp đã sửa đổi

1. **`apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`:**
   - Thêm `variant="planora"` và `className="mt-3"` vào `WorkflowFlowCanvas`.
   - Cập nhật câu mô tả phê duyệt động theo `approvalMode === 'auto_digest'`.
   - Thêm `id="schedule-mode-manual"` và `id="schedule-mode-auto-digest"` vào các radio buttons nhánh Sheets.

2. **`apps/chat-web/src/pages/History/ScheduleSection.tsx`:**
   - Thêm `variant="planora"` và `className="mt-3"` vào `WorkflowFlowCanvas`.

3. **`apps/chat-web/src/planora/workspace/PlanoraWorkflowSteps.tsx`:**
   - Bổ sung `aria-hidden="true"` cho toàn bộ các SVG vector icons trang trí (connector line, filter badge, trigger badge lịch, spinner, router icon).

4. **`apps/chat-web/tests/planora-pl-11-schedules.test.tsx`:**
   - Gỡ bỏ hoàn toàn `vi.mock` che khuất `WorkflowFlowCanvas`.
   - Bổ sung kiểm tra rendering thật của `PlanoraWorkflowSteps` trong `ScheduleMoment` và `ScheduleSection`.
   - Bổ sung kiểm tra dynamic description (F2 Calendar) và radio IDs (F2 Sheets).

5. **`docs/handoff/tasks/PL-11-planora-schedules-digest.md`:**
   - Sửa commit SHA từ `ee7b98ce...` sang `f643a297a9dc809465f58656c40e364e0870eb18`.

6. **`docs/handoff/log/2026-11-07-gemini-pl-11.md`:**
   - Sửa HEAD SHA từ `ee7b98ce...` sang `f643a297a9dc809465f58656c40e364e0870eb18`.

7. **`docs/handoff/log/2026-11-07-gemini-pl-11-review-fixes.md`:**
   - Tạo mới handoff log ghi nhận toàn bộ quá trình khắc phục review findings F1-F3.

---

## 3. Bằng chứng Kiểm thử Thực tế

| Lệnh kiểm thử | Exit Code | Kết quả | Chi tiết |
|---|:---:|:---:|---|
| `npm run typecheck:v3` | `0` | **PASS** | `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` sạch 0 lỗi TypeScript |
| `npm test -w @wap/chat-web -- sched` | `0` | **PASS** | 7 test files, 78/78 tests pass (tăng 3 tests so với đợt trước) |
| `npm test -w @wap/chat-web` | `0` | **PASS** | Toàn bộ 106 test files, 1.208/1.208 tests pass (0 regressions) |
| `npm run build:v3` | `0` | **PASS** | Vite production build thành công (200 modules transformed, HTML/CSS/JS bundles) |
| `node scripts/test-v3-web-build-security.mjs` | `0` | **PASS** | Excludes credential sentinels and 7 forbidden UI claims |
