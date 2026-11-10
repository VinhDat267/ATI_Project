# 2026-11-10 — Hoàn thành `CALENDAR-REM-A` (`CALENDAR-AUDIT-01` & `CALENDAR-AUDIT-05`)

- **Tác giả / Worker:** Worker A (`VinhDat267/calendar-rem-v2-digest-argon`, model `gemini-4-argon-high`, effort `high`)
- **Task card:** [`docs/handoff/tasks/CALENDAR-REM-A-digest-accuracy.md`](../tasks/CALENDAR-REM-A-digest-accuracy.md)
- **Baseline SHA:** `2eed8d1d4309e833088d6f1d3fa774189049e283`

## Tóm tắt công việc đã thực hiện

1. **`CALENDAR-AUDIT-01` — Độ phủ dữ liệu bảo thủ & trung thực trong `calendar-digest-runner.ts`:**
   - Bổ sung `normalizeCalendarReadCoverage` để chuẩn hóa metadata `coverage?: { complete, returned, totalAvailable, reason }` từ `mycalendar.list_events` theo `CONTRACTS.md` v1.
   - Khi thiếu hoặc sai định dạng `coverage`, runner gán trạng thái `unknown` (không bao giờ coi là `complete`). Khi `complete === false` hoặc `returned < totalAvailable` hoặc vượt trần 20 sự kiện, runner gán trạng thái `partial` và không tự bịa mẫu số `20/20`.
   - Chỉ hiển thị `• ✅ Không có xung đột giờ họp` khi `conflicting.length === 0` **và** toàn bộ các lịch được kiểm tra đều đạt `status === 'complete'`. Khi độ phủ là `partial` hoặc `unknown`, hiển thị cảnh báo không thể kết luận lịch trống xung đột trên dữ liệu chưa đầy đủ.
   - Tự động chặn gọi `options.summarizeDigest` ngay trong `createCalendarDigestExecutor` khi bất kỳ lịch nào có độ phủ `partial`/`unknown` hoặc khi tổng số sự kiện hợp nhất vượt trần hiển thị 20 sự kiện (`enrichedEvents.length > 20`), không cần chạm vào `apps/chat-api/src/server.ts`.
   - Cắt danh sách hiển thị theo ranh giới từng dòng sự kiện hoàn chỉnh (trần 20 sự kiện và trần `3900` ký tự), kèm dòng chú thích số lượng sự kiện và số sự kiện trùng giờ bị lược bớt ngoài danh sách hiển thị.
   - Kiểm tra chặt phản hồi `res?.events` phải là mảng hợp lệ; nếu không hợp lệ hoặc lỗi đọc ở lịch bất kỳ, trả về `digest_failed` trước khi đánh dấu `delivery_started_at`.

2. **`CALENDAR-AUDIT-05` — Khung giờ nửa mở `[00:00:00, nextDay 00:00:00)` & đúng nửa đêm DST:**
   - Cập nhật `buildDayWindow` sử dụng `resolveLocalMidnightInstant` để tìm đúng thời điểm UTC của `00:00:00` địa phương tại múi giờ được cấu hình thay vì tái sử dụng offset tại thời điểm `dueAt`.
   - Loại bỏ phép trừ `- 1_000` ms tại `timeMax`, trả về đúng khoảng nửa mở `[timeMin, timeMax)` cho chu kỳ 24h/48h, qua ngày cuối tháng, cuối năm, năm nhuận và ngày đổi giờ DST (`America/New_York`, `Europe/Berlin`).

## Bằng chứng kiểm thử (PostgreSQL 16 độc lập tại `127.0.0.1:56651`)

- **RED trên baseline `2eed8d1d4309e833088d6f1d3fa774189049e283`:**
  - `npm test -w @wap/chat-api -- tests/services/calendar-rem-a-digest-accuracy.test.ts --maxWorkers=1` → `10 failed` (`exit code 1`, log tại `C:\Users\VinhDat\orca\workspaces\ATI_Project\calendar-remediation-v2-evidence-20261110\workers\A\logs\red-baseline.log`).
- **GREEN sau khi khắc phục:**
  - `npm test -w @wap/chat-api -- tests/services/calendar-rem-a-digest-accuracy.test.ts tests/services/calendar-digest-runner.test.ts tests/services/calendar-digest-delivery-safety.test.ts --maxWorkers=1` → **3 test files passed, 32 tests passed (`exit code 0`)**.
  - `npm test -w @wap/chat-api -- tests/services/calendar-digest-approval.test.ts tests/services/schedule-calendar-digest.test.ts tests/services/schedules/schedule-locks.test.ts tests/services/schedules/schedule-runner.test.ts tests/services/schedules/next-occurrence.test.ts tests/integration/schedule-recovery.test.ts --maxWorkers=1` → **6 test files passed, 57 tests passed (`exit code 0`)**.
  - `npm run typecheck:v3` → **PASS (`exit code 0`)**.
