# Task: CALENDAR-REM-B-REVIEW — Independent-Review Remediation for Calendar Core Adapter, Coverage, Precheck & Timezone Safety

- **ID:** `CALENDAR-REM-B-REVIEW`
- **Giai đoạn:** Calendar Service Full Audit & Remediation v2 (`run_70d6561381b9` — Independent-Review Fix Phase on `9e94c30fd887ce299a30042f020753258ccb08c6`)
- **Trạng thái:** `in-review` (Draft PR #312 updated; awaiting independent reviewer re-verification)
- **Phụ thuộc:** `CALENDAR-REM-B` (`9e94c30fd887ce299a30042f020753258ccb08c6`), `CONTRACTS.md` (v1), `logs/codex-review-b-9e94c30.md`

---

## Mục tiêu

Khắc phục triệt để 4 lỗi hồi quy (regressions) được phát hiện trong đợt review độc lập đối với `9e94c30fd887ce299a30042f020753258ccb08c6` (`CALENDAR-AUDIT-01`, `CALENDAR-AUDIT-02`, `CALENDAR-AUDIT-06`, `CALENDAR-AUDIT-08`):

1. **`CALENDAR-AUDIT-01` (P1 — Malformed `nextPageToken` at exact cap):** Validate hình thái `nextPageToken` (`undefined` hoặc `string`, không lặp lại trong `seenPages`) trước khi return ở ngưỡng trần `20` sự kiện (`mycalendar.list_events`, `calendar.list_events`) và `250` sự kiện (`mycalendar.find_free_slots`). Không bao giờ trả `coverage.complete = true` khi `nextPageToken` sai định dạng hoặc lặp lại.
2. **`CALENDAR-AUDIT-02` (P1 — Trustworthy coverage contract in `ChatService` precheck):** Trong `ChatService.bindConnections` (Calendar block `393–585`), yêu cầu `rawResult` có mảng `events` hợp lệ VÀ `coverage` đáng tin cậy (`coverage.complete === true`, `returned === events.length`, `totalAvailable === returned`, không có `reason`) trước khi tuyên bố dữ liệu đầy đủ hoặc gợi ý khung giờ trống (`Gợi ý khung giờ trống`).
3. **`CALENDAR-AUDIT-06` (P2 — Preserve effective IANA `timeZone` on normalized all-day events):** Giữ nguyên `timeZone` IANA của lịch được cấp quyền trên các sự kiện cả ngày (`YYYY-MM-DD`) sau khi chuẩn hóa (`normalizedEvent`), để các bước kiểm tra trùng lịch hạ nguồn (`eventsOverlap` trong precheck và digest) tính đúng khoảng `[00:00, 00:00 ngày kế tiếp)` theo múi giờ của lịch đó thay vì mặc định `Asia/Ho_Chi_Minh`.
4. **`CALENDAR-AUDIT-08` (P2 — Fail closed when calendar timezone metadata is unavailable):** Xóa bỏ `inferTimeZoneFromIsoOffset` và cơ chế nuốt lỗi metadata để rơi về `Asia/Ho_Chi_Minh`. Khi truy vấn ngày tự nhiên (`query: 'tomorrow'`, `'next week'`, v.v.), kiểm tra lịch trống (`find_free_slots`), hoặc chuẩn hóa sự kiện cả ngày cần múi giờ lịch nhưng metadata `GET /calendars/{id}` lỗi hoặc thiếu `timeZone` IANA hợp lệ, hệ thống phải từ chối/báo lỗi an toàn thay vì đoán múi giờ từ offset hoặc dùng mặc định Việt Nam; đồng thời vẫn giữ nguyên khả năng đọc `list_events` với `timeMin`/`timeMax` ISO tường minh cho các sự kiện có giờ (`dateTime`).

---

## Phạm vi file được phép sửa

- `packages/tool-adapters/src/calendar/time-utils.ts`
- `packages/tool-adapters/src/calendar/calendar-adapter.ts`
- `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts`
- `apps/chat-api/src/services/chat-service.ts` (chỉ trong Calendar `bindConnections` block `393–585`; giữ nguyên phần Trello candidate ở quanh dòng `1580`)
- `packages/tool-adapters/tests/calendar/calendar-rem-b-review.test.ts`
- `packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts`
- `apps/chat-api/tests/services/calendar-rem-b-review-precheck.test.ts`
- `apps/chat-api/tests/services/calendar-conflict-planning.test.ts`

---

## Kết quả

- **Trạng thái:** Đã hoàn thành sửa lỗi theo quy trình TDD (RED → GREEN) và cập nhật Draft PR #312; chờ độc lập kiểm tra nghiệm thu.
- **Files đã sửa / tạo mới:**
  - `packages/tool-adapters/src/calendar/time-utils.ts`
  - `packages/tool-adapters/src/calendar/calendar-adapter.ts`
  - `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts`
  - `apps/chat-api/src/services/chat-service.ts`
  - `packages/tool-adapters/tests/calendar/calendar-rem-b-review.test.ts`
  - `packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts`
  - `apps/chat-api/tests/services/calendar-rem-b-review-precheck.test.ts`
  - `apps/chat-api/tests/services/calendar-conflict-planning.test.ts`
  - `docs/handoff/tasks/CALENDAR-REM-B-REVIEW-fixes.md`
  - `docs/handoff/log/2026-11-10-calendar-rem-b-review-fixes.md`
- **Bằng chứng kiểm thử (RED → GREEN trên PostgreSQL 16 riêng `127.0.0.1:56655`):**
  - **RED:**
    - `npx vitest run packages/tool-adapters/tests/calendar/calendar-rem-b-review.test.ts --no-color` → `6 failed (6)` (`workers/B-review/logs/red-b-review-regressions.log`)
    - `DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56655/ati_v3 npx vitest run apps/chat-api/tests/services/calendar-rem-b-review-precheck.test.ts --no-color` → `2 failed (2)` (`workers/B-review/logs/red-b-review-precheck.log`)
  - **GREEN:**
    - `npx vitest run packages/tool-adapters/tests/calendar/calendar-rem-b-review.test.ts packages/tool-adapters/tests/calendar/calendar-rem-b.test.ts packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts packages/tool-adapters/tests/calendar-adapter.test.ts packages/tool-adapters/tests/bounded-results.test.ts --no-color` → `5 passed (5), 109 passed (109)` (`workers/B-review/logs/green-adapters.log`)
    - `npx vitest run packages/tool-schemas/tests/mycalendar-schemas.test.ts packages/tool-schemas/tests/calendar.test.ts packages/tool-schemas/tests/registry-invariants.test.ts packages/planner/tests/calendar-routing.test.ts packages/planner/tests/validator.test.ts --no-color` → `5 passed (5), 86 passed (86)` (`workers/B-review/logs/green-schemas-planner.log`)
    - `DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56655/ati_v3 npx vitest run apps/chat-api/tests/services/calendar-rem-b-review-precheck.test.ts apps/chat-api/tests/services/calendar-rem-b-precheck.test.ts apps/chat-api/tests/services/calendar-conflict-planning.test.ts apps/chat-api/tests/routes/mycalendar-services.test.ts --no-color` → `4 passed (4), 27 passed (27)` (`workers/B-review/logs/green-precheck.log`)
    - `npm run typecheck:v3` → `0 errors, exit code 0` (`workers/B-review/logs/typecheck.log`)
