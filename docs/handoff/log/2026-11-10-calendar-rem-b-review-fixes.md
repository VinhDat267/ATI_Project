# Bàn giao: CALENDAR-REM-B-REVIEW — Independent-Review Fixes for Calendar Core Adapter, Coverage, Precheck & Timezone Safety

- **Ngày:** 2026-11-10
- **Task:** `CALENDAR-REM-B-REVIEW` (follow-up cho `CALENDAR-REM-B` trên base `9e94c30fd887ce299a30042f020753258ccb08c6`, run `run_70d6561381b9`)
- **Nhánh:** `VinhDat267/calendar-rem-v2-core-review-argon` (fast-forward lên `VinhDat267/calendar-rem-v2-core-argon`, Draft PR #312)
- **Trạng thái:** Đã hoàn tất sửa lỗi theo review độc lập; chờ reviewer kiểm định lại trước khi tích hợp cùng Worker A (`95b168232d213d5a5159c4ed6f6729168bf6cfda`).

## Tóm tắt công việc đã thực hiện

1. **`CALENDAR-AUDIT-01` (Validation `nextPageToken` trước ngưỡng trần 20 / 250 sự kiện):**
   - Trong `PersonalCalendarAdapter.execute('mycalendar.list_events')`, `CalendarAdapter.execute('calendar.list_events')`, và vòng lặp quét nội bộ của `PersonalCalendarAdapter.execute('mycalendar.find_free_slots')`, kiểm tra tính hợp lệ của `value.nextPageToken` (`undefined` hoặc `string`, không lặp lại trong `seenPages` / `seenScanPages`) ngay khi nhận phản hồi trang và **trước** khi kiểm tra chạm ngưỡng `maximum` (`20`) hoặc `INTERNAL_AVAILABILITY_MAX_EVENTS` (`250`).
   - Khi `nextPageToken` sai kiểu dữ liệu (ví dụ `{ invalid: true }`) ở đúng ngưỡng 20 hoặc 250 sự kiện, adapter gọi `badResponse()` (`SERVER_ERROR`) thay vì trả về `coverage.complete = true, totalAvailable = 20`.

2. **`CALENDAR-AUDIT-02` (Hợp đồng `coverage` chặt chẽ trong `ChatService` precheck):**
   - Trong `apps/chat-api/src/services/chat-service.ts` (khối `usesMyCalendar` dòng `465–560`), chỉ coi kết quả đọc lịch là đầy đủ khi `Array.isArray(rawResult?.events)` VÀ `rawResult?.coverage` là object có `complete === true`, `returned === rawResult.events.length`, `totalAvailable === returned`, không có `reason`, và mọi sự kiện hiệu lực có `start`/`end` hợp lệ (bao gồm `timeZone` IANA hợp lệ cho sự kiện cả ngày).
   - Khi `lookupTool` hoặc adapter trả thiếu `coverage`, `coverage` sai lệch, hoặc thiếu `timeZone` trên sự kiện cả ngày, `precheckIncompleteOrFailed` được bật thành `true`, tuyệt đối không phát sinh `Gợi ý khung giờ trống` và luôn gắn cảnh báo dữ liệu lịch chưa đầy đủ.

3. **`CALENDAR-AUDIT-06` (Bảo toàn `timeZone` IANA trên sự kiện cả ngày sau chuẩn hóa):**
   - Mở rộng `normalizedEvent(value, writing, fallbackTimeZone)` để gắn trường `timeZone` IANA hợp lệ từ `value.start.timeZone`, `value.end.timeZone`, hoặc `fallbackTimeZone`.
   - Trong `mycalendar.list_events` và `mycalendar.get_event`, khi có sự kiện cả ngày (`YYYY-MM-DD`) hoặc `args.timeZone` tường minh, adapter phân giải múi giờ IANA của lịch được cấp quyền (`resolveCalendarTimeZone`) và gắn vào sự kiện chuẩn hóa để `eventsOverlap` hạ nguồn (precheck, digest, `findConflicts`) tính đúng khoảng bận `[00:00, 00:00 ngày kế tiếp)` theo múi giờ của lịch đó (ví dụ `America/New_York` bận lúc `20:00-05:00`).

4. **`CALENDAR-AUDIT-08` (Loại bỏ suy đoán múi giờ từ offset và mặc định Việt Nam khi metadata lỗi):**
   - Xóa hàm `inferTimeZoneFromIsoOffset` trong `packages/tool-adapters/src/calendar/time-utils.ts`.
   - Trong `resolveNaturalTemporalQuery`, bắt buộc phải có `options.timeZone` là định danh IANA hợp lệ khi `requireTemporalWindow: true` (không bao giờ rơi về `DEFAULT_CALENDAR_TIMEZONE`).
   - Trong `PersonalCalendarAdapter.resolveCalendarTimeZone`, không nuốt ngoại lệ khi `GET /calendars/{id}` thất bại (`503`, `403`, lỗi mạng) và báo lỗi đóng (`badResponse(false)` hoặc `VALIDATION` cho sự kiện lặp lại) nếu metadata không có `timeZone` IANA hợp lệ. Các lệnh đọc `mycalendar.list_events` với `timeMin`/`timeMax` ISO tường minh và sự kiện có giờ (`dateTime`) vẫn hoạt động bình thường không cần gọi metadata.

## Bằng chứng kiểm thử (PostgreSQL 16 riêng trên `127.0.0.1:56655`)

- **RED:**
  - `npx vitest run packages/tool-adapters/tests/calendar/calendar-rem-b-review.test.ts --no-color` → `6 failed` (`workers/B-review/logs/red-b-review-regressions.log`)
  - `DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56655/ati_v3 npx vitest run apps/chat-api/tests/services/calendar-rem-b-review-precheck.test.ts --no-color` → `2 failed` (`workers/B-review/logs/red-b-review-precheck.log`)
- **GREEN:**
  - `npx vitest run packages/tool-adapters/tests/calendar/calendar-rem-b-review.test.ts packages/tool-adapters/tests/calendar/calendar-rem-b.test.ts packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts packages/tool-adapters/tests/calendar-adapter.test.ts packages/tool-adapters/tests/bounded-results.test.ts --no-color` → `5 passed (5), 109 passed (109)` (`workers/B-review/logs/green-adapters.log`)
  - `npx vitest run packages/tool-schemas/tests/mycalendar-schemas.test.ts packages/tool-schemas/tests/calendar.test.ts packages/tool-schemas/tests/registry-invariants.test.ts packages/planner/tests/calendar-routing.test.ts packages/planner/tests/validator.test.ts --no-color` → `5 passed (5), 86 passed (86)` (`workers/B-review/logs/green-schemas-planner.log`)
  - `DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56655/ati_v3 npx vitest run apps/chat-api/tests/services/calendar-rem-b-review-precheck.test.ts apps/chat-api/tests/services/calendar-rem-b-precheck.test.ts apps/chat-api/tests/services/calendar-conflict-planning.test.ts apps/chat-api/tests/routes/mycalendar-services.test.ts --no-color` → `4 passed (4), 27 passed (27)` (`workers/B-review/logs/green-precheck.log`)
  - `npm run typecheck:v3` → `exit code 0` (`workers/B-review/logs/typecheck.log`)
