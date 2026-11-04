# Handoff Log: FLOW-06 · Lịch và phục hồi lỗi rõ ràng

- **Ngày:** 2026-11-04
- **Task:** FLOW-06
- **Nhánh:** `fix/flow-06-schedule-recovery`
- **Tác giả:** Antigravity Master Orchestrator (Backend + Frontend Engineering)

## 1. Nội dung đã thực hiện

1. **Phân biệt rõ ràng giữa "Chờ tôi duyệt mỗi lượt" (`plan`) và "Tự gửi theo phạm vi đã xác nhận" (`auto_digest`):**
   - Lịch dạng `plan` (mặc định) yêu cầu người dùng duyệt từng lượt chạy trước khi gửi tin/hành động. UI hiển thị badge `Mỗi lượt cần bạn duyệt` (`data-schedule-mode="manual"`).
   - Lịch dạng auto-digest (`calendar_digest`, `github_digest`, `trello_digest`, `sheets_digest`, `jira_digest`, `notion_digest`, `telegram_digest`) hiển thị badge `Tự gửi` kèm chú thích `Tự gửi theo phạm vi đã xác nhận`.
   - Ngăn chặn triệt để việc tự động nâng một workflow plan tổng quát thành auto mode khi chưa đủ điều kiện hoặc chưa khóa phạm vi an toàn.

2. **Cơ chế Pause / Resume & Chống backfill:**
   - Khi pause: đặt `status = 'paused'`, xóa `next_run_at = NULL`. Không tạo các lượt chạy trễ hay lỡ trong khi pause.
   - Khi resume: tính `next_run_at` chặt chẽ từ `now` trở đi bằng `nextOccurrence`, không bao giờ replay lại các lượt đã qua trong khoảng thời gian tạm dừng.

3. **Chống replay write không rõ kết quả (Idempotency & Ambiguous Delivery Protection):**
   - Khi tín hiệu gửi đi đã chạm tới dịch vụ ngoài (Slack/Telegram) nhưng response bị mất (socket drop / timeout) hoặc server trả HTTP 500 / malformed JSON:
     - Trạng thái lượt chạy chuyển sang `needs_attention`.
     - Chặn thao tác `replan` (`RUN_NOT_REPLANNABLE`) để ngăn việc người dùng hoặc scheduler vô tình gửi 2 lần cùng một thông báo.
   - Khi dịch vụ ngoài từ chối xác thực rõ ràng (HTTP 401): lượt chạy chuyển sang `digest_failed`, cho phép lập lại kế hoạch (`replan`).
   - Khi timeout xảy ra trước khi dispatch write: truyền và kích hoạt `AbortSignal` thật, hủy request đọc dữ liệu, cho phép `replan`.

4. **UI Trực quan hóa Lịch và Trạng thái cần xử lý:**
   - Cập nhật `ScheduleSection.tsx`:
     - Hiển thị rõ ràng timezone `giờ Việt Nam (Asia/Ho_Chi_Minh)` và giờ chạy kế tiếp.
     - Hiển thị alert box khi có lượt chạy `needs_attention`: thông báo rõ ràng "Lượt chạy cần bạn xem: Chưa xác định kết quả gửi. Để tránh gửi trùng, lượt này không tự động gửi lại."
     - Hiển thị notice box khi có lượt chạy `awaiting_approval`: thông báo "Lượt chạy chờ duyệt: Kế hoạch đã sẵn sàng, cần bạn xem và xác nhận trước khi gửi."
   - Cập nhật `ScheduleMoment.tsx`:
     - Hiển thị badge `Mỗi lượt cần bạn duyệt` cho các lịch `plan`.
     - Hiển thị badge `Tự gửi` và chú thích `Tự gửi theo phạm vi đã xác nhận` cho các lịch auto-digest.

## 2. Bằng chứng kiểm thử (Real Command Execution Output)

### A. Integration Tests (PostgreSQL thật + Loopback HTTP Server)
```bash
$ npx vitest run apps/chat-api/tests/integration/schedule-recovery.test.ts

 RUN  v4.1.11 D:/Môn Học/ATI/ATI_Project

 ✓ apps/chat-api/tests/integration/schedule-recovery.test.ts (8 tests) 4553ms
       ✓ sets kind = "plan" when approvalMode is "manual" or omitted 134ms
       ✓ refuses auto_digest when schedule proposal lacks eligible digest candidate 88ms
       ✓ clears next_run_at on pause, and resume calculates next_run_at from current now without backfilling 163ms
       ✓ rejects confirmation with DIGEST_PREVIEW_CHANGED when destination channel changes 119ms
       ✓ marks run as needs_attention and blocks replan when external server drops connection after receiving write 187ms
       ✓ marks run as needs_attention and blocks replan when external server returns HTTP 500 after receiving write 162ms
       ✓ permits replan when external service definitely rejects write before execution (HTTP 401) 168ms
       ✓ aborts the actual AbortSignal when timing out before write dispatch 410ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  6.47s
```

### B. Frontend Web Tests (ScheduleSection & Recovery)
```bash
$ npm test -w @wap/chat-web -- tests/schedule-recovery-and-modes.test.tsx

 RUN  v4.1.11 D:/Môn Học/ATI/ATI_Project/apps/chat-web

 ✓ tests/schedule-recovery-and-modes.test.tsx (4 tests) 238ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  3.35s
```

### C. Toàn bộ Web Suite liên quan đến Schedule
```bash
$ npm test -w @wap/chat-web -- tests/schedule-calendar-digest-mode.test.tsx tests/schedule-github-digest-mode.test.tsx tests/schedule-telegram-digest-mode.test.tsx tests/schedule-trello-digest-mode.test.tsx tests/sprint1-history-schedules-empty.test.tsx tests/schedule-recovery-and-modes.test.tsx

 Test Files  6 passed (6)
      Tests  27 passed (27)
   Duration  5.86s
```

### D. Static Guard & Typecheck
```bash
$ npm run typecheck:v3
> tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit
Exit code: 0

$ npx vitest run evaluations/generic-plumbing/static-guard.test.ts
Test Files  6 passed (6)
     Tests  12 passed (12)
Exit code: 0
```

## 3. Các file đã thay đổi / tạo mới

- `apps/chat-api/tests/integration/schedule-recovery.test.ts` (mới)
- `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx` (sửa)
- `apps/chat-web/src/pages/History/ScheduleSection.tsx` (sửa)
- `apps/chat-web/tests/schedule-recovery-and-modes.test.tsx` (mới)
- `docs/handoff/tasks/FLOW-06-schedule-recovery.md` (sửa kết quả)
- `docs/handoff/log/2026-11-04-FLOW-06-schedule-recovery.md` (mới)
