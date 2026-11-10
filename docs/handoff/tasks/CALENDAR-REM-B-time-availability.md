# CALENDAR-REM-B · Google Calendar v3 Remediation v2 (Producer Coverage, Precheck, Multi-Day Free Slots, Recurring TimeZone, Busy Semantics & Natural Temporal Query)

**Trạng thái:** đã hoàn thành toàn bộ 6 findings (`CALENDAR-AUDIT-01` producer, `02`, `03`, `04`, `06`, `08`) · **Nhánh:** `VinhDat267/calendar-rem-v2-core-argon` · **Base SHA:** `2eed8d1d4309e833088d6f1d3fa774189049e283`

## Vấn đề

Đợt kiểm toán độc lập Google Calendar (`calendar-audit-evidence-20261110`) xác nhận 6 lỗi thuộc phạm vi Worker B:
1. **`CALENDAR-AUDIT-01` (P1 — Producer):** `calendar.list_events` và `mycalendar.list_events` dừng ở 20 sự kiện mà không trả về metadata `coverage` để phân biệt danh sách đầy đủ với danh sách bị cắt ngắn; `mycalendar.find_free_slots` đọc qua `list_events` bị giới hạn 20 sự kiện nên báo trống giả cho sự kiện thứ 21 trở đi.
2. **`CALENDAR-AUDIT-02` (P1 — Precheck):** `ChatService.bindConnections` kiểm tra xung đột lịch khi lập kế hoạch chỉ đọc từ `minStart` với `limit: 20` trên một calendar, bỏ sót xung đột ở các giờ sau hoặc trên các calendar được cấp quyền khác, tự báo xung đột với chính sự kiện đang `update_event`, và nuốt lỗi đọc lịch.
3. **`CALENDAR-AUDIT-03` (P2 — Multi-Day Free Slots):** `mycalendar.find_free_slots` chỉ lấy ngày của `timeMin` nên không tìm được khung giờ trống ở các ngày tiếp theo trong khoảng `[timeMin, timeMax]`.
4. **`CALENDAR-AUDIT-04` (P2 — Recurring TimeZone):** Các thao tác ghi sự kiện lặp lại (`create_event`, `update_event`, `schedule_meet` có `recurrence`) không đính kèm IANA `timeZone` khớp cho `start` và `end`; fake provider (`scripts/fake-google-gmail.mjs`) chưa chặn request thiếu `timeZone` khi có `recurrence`.
5. **`CALENDAR-AUDIT-06` (P2 — Busy Semantics):** Sự kiện `transparency: 'transparent'` và `status: 'cancelled'` vẫn bị tính là bận; sự kiện cả ngày (`all-day`) bị diễn giải theo mốc nửa đêm UTC thay vì nửa đêm local `[startDate, endDate)` theo IANA `timeZone` của lịch.
6. **`CALENDAR-AUDIT-08` (P2 — Natural Temporal Query):** Truy vấn thời gian tự nhiên trong `list_events`/`find_free_slots` tính sai `next week` / `tuần tới` và đẩy các từ khóa thời gian sang tham số `q` của Google API làm rỗng kết quả; biểu thức ngày mơ hồ không được chặn an toàn.

## Việc cần làm

1. Thêm trường tùy chọn `timeZone` (IANA pattern) và `coverage: { complete, returned, totalAvailable, reason? }` vào `packages/tool-schemas/src/mycalendar.ts` theo đúng `CONTRACTS.md` v1.
2. Xây dựng bộ xử lý thời gian theo múi giờ IANA chuẩn tại `packages/tool-adapters/src/calendar/time-utils.ts` và cập nhật `calendar-adapter.ts`, `personal-calendar-adapter.ts`, `scripts/fake-google-gmail.mjs` để giải quyết triệt để `CALENDAR-AUDIT-01` (producer), `03`, `04`, `06`, `08`.
3. Sau khi Coordinator mở khóa conditional hold (`msg_ff6be484fcc6`), cập nhật vùng `Calendar bindConnections` (lines 393–519) trong `apps/chat-api/src/services/chat-service.ts` và kiểm thử tích hợp trên PostgreSQL thật (`127.0.0.1:56652`) tại `apps/chat-api/tests/services/calendar-rem-b-precheck.test.ts` cho `CALENDAR-AUDIT-02`.

## Tiêu chí nghiệm thu

- [x] `CALENDAR-AUDIT-01` (Producer): `calendar.list_events`, `mycalendar.list_events`, `mycalendar.find_free_slots` trả về `coverage: { complete, returned, totalAvailable, reason? }`; `find_free_slots` quét nội bộ đa trang có giới hạn (`maxPages=10`, `maxEvents=250`, `pageSize=100`) và trả về `freeSlots: []` khi `coverage.complete === false`.
- [x] `CALENDAR-AUDIT-02`: `ChatService.bindConnections` đọc toàn bộ dải ngày của ứng viên (`[readMin, readMax]`), kiểm tra tất cả lịch trong `allowedCalendars`, loại trừ chính `eventId` khi `update_event`, tôn trọng `transparent`/`cancelled`/`all-day`/biên tiếp xúc, bỏ gợi ý giờ trống khi `coverage.complete === false` hoặc lỗi đọc lịch, nêu rõ phạm vi lịch đã kiểm tra và rủi ro thay đổi trước khi thực thi mà không tự ý sửa thời gian đã duyệt.
- [x] `CALENDAR-AUDIT-03`: `mycalendar.find_free_slots` duyệt đầy đủ từng ngày lịch local trong `[timeMin, timeMax]` theo IANA `timeZone` của calendar được cấp quyền.
- [x] `CALENDAR-AUDIT-04`: `create_event`, `update_event`, `schedule_meet` có `recurrence` bắt buộc và đính kèm `start.timeZone` & `end.timeZone` hợp lệ; `scripts/fake-google-gmail.mjs` trả HTTP `400` nếu thiếu hoặc lệch `timeZone` khi có `recurrence`.
- [x] `CALENDAR-AUDIT-06`: Bỏ qua sự kiện `transparent` và `cancelled` khi tính bận/trùng lịch; sự kiện `all-day` dùng khoảng nửa mở `[startDate, endDate)` theo nửa đêm local của IANA `timeZone`.
- [x] `CALENDAR-AUDIT-08`: Tách biệt cụm từ thời gian tự nhiên khỏi tham số `q`, tính đúng tuần kế tiếp theo chuẩn ISO Monday-to-Monday với đồng hồ cố định (`nowFn`) và IANA `timeZone` của calendar, từ chối biểu thức ngày mơ hồ với `VALIDATION`.
- [x] Toàn bộ test adapter, schema, planner và ChatService precheck thuộc phạm vi sở hữu (`103/103` adapter tests + `86/86` schema/planner tests + `7/7` PG precheck tests) và `npm run typecheck:v3` đều PASS (exit `0`).

## Kết quả (agent thi công điền)

- **Draft PR:** [#312](https://github.com/VinhDat267/ATI_Project/pull/312) (`VinhDat267/calendar-rem-v2-core-argon`, base `2eed8d1d4309e833088d6f1d3fa774189049e283`).
- **Worker:** B (`term_74909767-b8b1-446d-b9fa-2cfe85dacd62`), model `gemini-4-argon-high` (effort `high`).
- **Files đã tạo / sửa đổi:**
  - `packages/tool-schemas/src/mycalendar.ts`
  - `packages/tool-schemas/tests/mycalendar-schemas.test.ts`
  - `packages/tool-adapters/src/calendar/time-utils.ts`
  - `packages/tool-adapters/src/calendar/calendar-adapter.ts`
  - `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts`
  - `packages/tool-adapters/tests/calendar-adapter.test.ts`
  - `packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts`
  - `packages/tool-adapters/tests/calendar/calendar-rem-b.test.ts`
  - `apps/chat-api/src/services/chat-service.ts` (chỉ sửa vùng `Calendar bindConnections` baseline lines 393–519 sau khi Coordinator mở khóa hold tại `msg_ff6be484fcc6`)
  - `apps/chat-api/tests/services/calendar-rem-b-precheck.test.ts`
  - `scripts/fake-google-gmail.mjs`
- **Bằng chứng kiểm thử (lưu tại `C:/Users/VinhDat/orca/workspaces/ATI_Project/calendar-remediation-v2-evidence-20261110/workers/B/`):**
  - `logs/red-adapters.log`: `npx vitest run packages/tool-adapters/tests/calendar/calendar-rem-b.test.ts --no-color` trên baseline → exit `1` (`15 failed`).
  - `logs/red-precheck.log`: `npx vitest run apps/chat-api/tests/services/calendar-rem-b-precheck.test.ts --no-color` trên baseline với PG `127.0.0.1:56652` → exit `1` (`3 failed`).
  - `logs/green-adapters.log`: `npx vitest run packages/tool-adapters/tests/calendar/calendar-rem-b.test.ts packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts packages/tool-adapters/tests/calendar-adapter.test.ts packages/tool-adapters/tests/bounded-results.test.ts --no-color` → exit `0` (`4 passed`, `103 passed`).
  - `logs/green-schemas.log`: `npx vitest run packages/tool-schemas/tests/mycalendar-schemas.test.ts packages/tool-schemas/tests/calendar.test.ts packages/tool-schemas/tests/registry-invariants.test.ts packages/planner/tests/calendar-routing.test.ts packages/planner/tests/validator.test.ts --no-color` → exit `0` (`5 passed`, `86 passed`).
  - `logs/green-precheck.log`: `npx vitest run apps/chat-api/tests/services/calendar-rem-b-precheck.test.ts apps/chat-api/tests/services/calendar-conflict-planning.test.ts --no-color` trên PG `127.0.0.1:56652` → exit `0` (`2 passed`, `7 passed`).
  - `logs/typecheck.log`: `npm run typecheck:v3` → exit `0`.
- **Điều chưa làm hoặc khác với task card:** Không có.
