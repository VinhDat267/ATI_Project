# Kế hoạch Triển khai: Google Calendar OAuth Cá nhân & Tự động hóa Lịch trình Thông minh (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cấp toàn diện trải nghiệm Google Calendar OAuth cá nhân (`mycalendar`) và Tự động hóa Lịch trình v2: (1) Chọn nhanh Lịch chính 1-chạm (`autoSelectPrimary` & `POST /api/connections/mycalendar/select-primary`) giảm ma sát kết nối; (2) Bộ lọc sự kiện tự nhiên (`today`/`upcoming`/`open`/`conflict`/`*`) kèm phát hiện trùng lịch (`detectCalendarConflicts`) trong `CalendarAdapter` / `PersonalCalendarAdapter` và cảnh báo trùng giờ tự động ngay ở bước lập kế hoạch (`ChatService.bindConnections`); (3) Chế độ duyệt lịch chạy `approvalMode: 'manual' | 'auto_digest'` (`kind: 'calendar_digest'`) tự động đọc lịch cá nhân buổi sáng, kiểm tra xung đột giờ họp và gửi bản tin vào kênh Slack hoặc nhóm Telegram đã khóa mà không bắt người dùng bấm duyệt lại mỗi sáng.

**Architecture:** Kế thừa kiến trúc 5 gói của v3 (`@wap/tool-schemas`, `@wap/tool-adapters`, `@wap/planner`, `@wap/executor`, `@wap/chat-api`, `@wap/chat-web`). Giữ nguyên tuyệt đối 33 tools trong `ALL_TOOLS` và SHA-256 của `prompts/system.md` khi cờ tính năng tắt. Mọi bài kiểm thử cơ sở dữ liệu, khóa đồng thời (CAS/FOR UPDATE) và ràng buộc SQL chạy trên PostgreSQL 16 thật; mọi bài kiểm thử timeout chạy qua `AbortSignal` thật.

**Tech Stack:** TypeScript (ESM), Node.js 20+, PostgreSQL 16, Express, React 18 + Zustand + Tailwind CSS, Vitest.

**Spec tham chiếu:** [`docs/superpowers/specs/2026-11-02-calendar-oauth-and-automation-design.md`](../specs/2026-11-02-calendar-oauth-and-automation-design.md)

---

## Ràng buộc Toàn cục & Bất biến (Global Constraints)

1. **Bất biến `ALL_TOOLS` (33 tools) & System Prompt SHA-256:**
   - Không thêm/sửa/xóa phần tử nào trong `ALL_TOOLS` (`packages/tool-schemas/src/index.ts`).
   - Không sửa `prompts/system.md` (giữ nguyên SHA-256 `b31234b91e0c22191f5b0c5fb4be73299e673178df36ea3accb2633b42ec64f9`).
2. **Tương thích ngược 100% với bộ test `OAUTH-02` và `SCHED-01` hiện hữu:**
   - `POST /api/connections/mycalendar/callback` khi không truyền `autoSelectPrimary: true` vẫn lưu `selectedCalendars: []` và trả `status: 'scope_required'`.
   - `calendar.list_events` và `mycalendar.list_events` khi các sự kiện không trùng giờ và không lọc `conflict` vẫn trả về đúng 5 trường `{ id, title, start, end, url }` (không thêm `conflict: false` làm gãy `.toEqual`).
   - `POST /api/conversations/:convId/schedule-proposals/:messageId/confirm` khi không truyền body vẫn mặc định `approvalMode: 'manual'` (`kind = 'plan'`).
3. **Không Mock Ảo giác:**
   - Kiểm thử migration, constraint SQL, `confirmProposal` và `ScheduleRunner` trên PostgreSQL 16 thật (`DATABASE_URL`).
   - Kiểm thử timeout 30s (đọc lịch) và 10s (tóm tắt AI) bằng `AbortSignal` thật.

---

## Cấu trúc Tệp tin (File Map)

- **Cơ sở dữ liệu (`db/v3/`):**
  - Tạo mới: `db/v3/0015_calendar_automation_digest.sql`
  - Tạo mới test: `apps/chat-api/tests/db/calendar-digest-migration.test.ts`
- **Schemas (`packages/tool-schemas/`):**
  - Sửa: `packages/tool-schemas/src/types.ts` (thêm `ScheduleApprovalMode`, `ScheduleKind`, `CalendarDigestConfig`, `CalendarDigestCandidate`, `CalendarDigestDelivery`, mở rộng `ScheduleProposalMetadata`, `ScheduleView`, `ScheduleRunState`, `ScheduleRunView`, `ScheduleConflictCode`)
- **Adapters (`packages/tool-adapters/`):**
  - Sửa: `packages/tool-adapters/src/calendar/calendar-adapter.ts` (thêm `parseCalendarEventQuery`, `detectCalendarConflicts`, tích hợp lọc tự nhiên & phát hiện trùng giờ trong `listEvents`)
  - Sửa: `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts` (sử dụng `parseCalendarEventQuery` & `detectCalendarConflicts` trong `list_events`, thêm phương thức `findConflicts` để kiểm tra trùng lịch cho một khung giờ `[start, end]`)
  - Sửa: `packages/tool-adapters/src/index.ts` (export `parseCalendarEventQuery`, `detectCalendarConflicts`, `type CalendarEventWithConflict`)
  - Sửa/Thêm test: `packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts` và `packages/tool-adapters/tests/calendar-adapter.test.ts`
- **Backend API (`apps/chat-api/`):**
  - Sửa: `apps/chat-api/src/routes/connections/mycalendar.ts` (hỗ trợ `autoSelectPrimary?: boolean` trong `POST /callback` và thêm `POST /select-primary`)
  - Sửa: `apps/chat-api/src/services/gmail/connection-reference.ts` (bổ sung `selectedCalendars` chi tiết gồm `{ id, summary, primary }` trong `activeMyCalendarConnection` để phục vụ cả cảnh báo trùng lịch lẫn `calendarDigestCandidate`)
  - Tạo mới: `apps/chat-api/src/services/schedules/calendar-digest-candidate.ts` (hàm `evaluateCalendarDigestCandidate`, `computeCalendarDigestHash`, `isCalendarWriteIntent`)
  - Tạo mới: `apps/chat-api/src/services/schedules/calendar-digest-runner.ts` (hàm `executeCalendarDigestRun`, `escapeDigestText`, `formatCalendarDigestMessage`)
  - Sửa: `apps/chat-api/src/services/chat-service.ts` (kiểm tra xung đột lịch họp `lookupCalendarConflicts` trong `bindConnections` gắn cảnh báo vào `plan.warnings`; gắn `digestCandidate` trong `prepareProposal`)
  - Sửa: `apps/chat-api/src/db/repositories/schedule-repo.ts` (ánh xạ `kind`, `approvalMode`, `digestConfig` trong `ScheduleRow` và `view`)
  - Sửa: `apps/chat-api/src/services/schedules/run-state.ts` (ánh xạ `delivery` trong `RunRow` và `runView`)
  - Sửa: `apps/chat-api/src/services/schedules/schedule-service.ts` (nhận `approvalMode?: ScheduleApprovalMode` trong `confirmProposal`, xác thực lại `verifyDigestApproval`, hạ cấp an toàn khi `update`, cho phép `replan` với `digest_failed`)
  - Sửa: `apps/chat-api/src/services/schedules/schedule-runner.ts` (nhánh thực thi `kind === 'calendar_digest'`, tự động tạm dừng sau 3 lượt `digest_failed` liên tiếp)
  - Sửa: `apps/chat-api/src/routes/schedule-routes.ts` (validate `approvalMode` ở `POST .../confirm`)
  - Sửa: `apps/chat-api/src/config/schedules-runtime.ts` & `apps/chat-api/src/server.ts` (nối `runCalendarDigest` và `verifyDigestApproval` vào `ScheduleRunner` / `ScheduleService` / `ChatService`)
  - Tạo mới/Sửa test:
    - `apps/chat-api/tests/routes/mycalendar-connections.test.ts`
    - `apps/chat-api/tests/services/calendar-conflict-planning.test.ts`
    - `apps/chat-api/tests/services/schedule-calendar-digest.test.ts`
    - `apps/chat-api/tests/services/calendar-digest-runner.test.ts`
- **Frontend Web (`apps/chat-web/`):**
  - Sửa: `apps/chat-web/src/services/api-client.ts` (thêm `selectPrimaryMyCalendar()`, mở rộng `completeMyCalendarConnection` với `autoSelectPrimary?: boolean`, mở rộng `confirmSchedule` với `approvalMode?: ScheduleApprovalMode`)
  - Sửa: `apps/chat-web/src/views/MyCalendarCallbackView.tsx` & `apps/chat-web/src/pages/Settings/PersonalMyCalendar.tsx` (thêm nút `#mycalendar-quick-primary` «Dùng ngay Lịch chính»)
  - Sửa: `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx` (thêm bộ chọn chế độ chạy `#schedule-mode-manual` / `#schedule-mode-auto-digest` và hộp xem trước phạm vi khóa `#schedule-auto-digest-scope`)
  - Sửa: `apps/chat-web/src/pages/History/ScheduleSection.tsx`, `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`, `apps/chat-web/src/services/schedule-text.ts` (huy hiệu `Tự gửi`, nhãn `digest_sent` / `digest_failed`, nút lập lại cho `digest_failed`)
  - Tạo mới test: `apps/chat-web/tests/schedule-calendar-digest-mode.test.tsx`

---

## Chi tiết Từng Task (TDD Step-by-Step)

### Task 1: Migration PostgreSQL `0015_calendar_automation_digest.sql` & Kiểm thử Ràng buộc DB

**Files:**
- Tạo mới: `db/v3/0015_calendar_automation_digest.sql`
- Tạo mới: `apps/chat-api/tests/db/calendar-digest-migration.test.ts`

- [ ] **Step 1: Viết failing test trong `apps/chat-api/tests/db/calendar-digest-migration.test.ts`**
  - Kiểm tra trên PostgreSQL 16 thật (schema riêng có UUID):
    1. Chạy toàn bộ migrations `db/v3/*.sql` **2 lần liên tiếp** để chứng minh tính idempotent.
    2. Bảng `schedules`:
       - Chấp nhận `kind = 'plan'` khi `digest_config`, `digest_config_hash`, `digest_approved_at` đều `NULL`.
       - Chấp nhận `kind = 'calendar_digest'` khi cả 3 cột `digest_config`, `digest_config_hash`, `digest_approved_at` đều `NOT NULL`.
       - Từ chối (`23514` `check_violation`) `kind = 'calendar_digest'` nếu thiếu bất kỳ cột nào trong 3 cột trên, hoặc `kind = 'plan'` nhưng `digest_config IS NOT NULL`, hoặc `kind = 'invalid_kind'`.
    3. Bảng `schedule_runs`:
       - Chấp nhận `status = 'digest_sent'` kèm `delivery = '{"channelId":"C123","totalEvents":3}'::jsonb`.
       - Từ chối `status = 'digest_sent'` khi `delivery IS NULL`.
       - Chấp nhận `status = 'digest_failed'` khi `delivery IS NULL`, và từ chối `status = 'digest_failed'` khi `delivery IS NOT NULL`.
- [ ] **Step 2: Chạy test để xác nhận RED**
  - Lệnh: `$env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3"; node ./node_modules/vitest/vitest.mjs run --dir apps/chat-api tests/db/calendar-digest-migration.test.ts`
- [ ] **Step 3: Viết `db/v3/0015_calendar_automation_digest.sql`**
  - Định nghĩa đầy đủ các cột và constraint `schedules_kind_digest_check`, `schedule_runs_status_check`, `schedule_runs_delivery_check`.
- [ ] **Step 4: Chạy lại test để xác nhận GREEN (cùng `mycalendar-migration.test.ts` và `schedule-migration.test.ts`)**
  - Lệnh: `$env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3"; node ./node_modules/vitest/vitest.mjs run --dir apps/chat-api tests/db/calendar-digest-migration.test.ts tests/db/mycalendar-migration.test.ts tests/db/schedule-migration.test.ts`
- [ ] **Step 5: Commit Task 1**
  - `git add db/v3/0015_calendar_automation_digest.sql apps/chat-api/tests/db/calendar-digest-migration.test.ts`
  - `git commit -m "feat(db): add calendar_digest schedule mode and delivery constraints"`

---

### Task 2: Bộ lọc Sự kiện Tự nhiên (`parseCalendarEventQuery`) & Phát hiện Xung đột (`detectCalendarConflicts`) trong Adapters

**Files:**
- Sửa: `packages/tool-adapters/src/calendar/calendar-adapter.ts`
- Sửa: `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts`
- Sửa: `packages/tool-adapters/src/index.ts`
- Sửa: `packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts`
- Sửa: `packages/tool-adapters/tests/calendar-adapter.test.ts`

- [ ] **Step 1: Viết failing tests trong `packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts` và `packages/tool-adapters/tests/calendar-adapter.test.ts`**
  - Kiểm tra `parseCalendarEventQuery`:
    - `query: "today"`, `"hôm nay"`, `"upcoming"`, `"open"`, `"busy"`, `"*"` → không gửi tham số `q=` lên Google Calendar API, trả về toàn bộ sự kiện trong khung giờ.
    - `query: "conflict"`, `"conflicts"`, `"trùng lịch"`, `"xung đột"` → không gửi `q=conflict` lên Google API, tự động tính giao thoa thời gian và chỉ trả về các sự kiện bị trùng giờ kèm `conflict: true` và `conflictsWith: [...]`.
    - `query: "conflict sprint"` → lọc các sự kiện vừa bị trùng giờ vừa khớp từ khóa `"sprint"`.
  - Kiểm tra `detectCalendarConflicts`:
    - Hai sự kiện `09:00–10:00` và `09:30–10:30` → cả hai được đánh dấu `conflict: true` và `conflictsWith` chứa tiêu đề của nhau.
    - Hai sự kiện nối tiếp `09:00–10:00` và `10:00–11:00` (chạm biên `end === start`) → **không** bị coi là trùng giờ, giữ nguyên đúng 5 trường `{ id, title, start, end, url }`.
  - Kiểm tra `personalAdapter.findConflicts({ calendarId, start, end }, signal)`:
    - Trả về danh sách các sự kiện giao thoa với khoảng `[start, end]` trên lịch được chọn và truyền đúng `AbortSignal`.
- [ ] **Step 2: Chạy test để xác nhận RED**
  - Lệnh: `node ./node_modules/vitest/vitest.mjs run --dir packages/tool-adapters tests/calendar/personal-calendar-adapter.test.ts tests/calendar-adapter.test.ts`
- [ ] **Step 3: Triển khai `parseCalendarEventQuery`, `detectCalendarConflicts`, và `findConflicts`**
  - Trong `packages/tool-adapters/src/calendar/calendar-adapter.ts`:
    - Export `parseCalendarEventQuery(rawQuery?: string)` và `detectCalendarConflicts(events: CalendarEventItem[], options?: { onlyConflicts?: boolean; keywordFilter?: string })`.
    - Cập nhật `CalendarAdapter.listEvents` dùng `parseCalendarEventQuery` và `detectCalendarConflicts`.
  - Trong `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts`:
    - Cập nhật `list_events` dùng `parseCalendarEventQuery` và `detectCalendarConflicts`.
    - Thêm phương thức `findConflicts(input: { calendarId: string; start: string; end: string }, signal?: AbortSignal): Promise<CalendarEventWithConflict[]>`.
  - Export các helper từ `packages/tool-adapters/src/index.ts`.
- [ ] **Step 4: Chạy toàn bộ test của `@wap/tool-adapters` để xác nhận GREEN**
  - Lệnh: `npm test -w @wap/tool-adapters`
- [ ] **Step 5: Commit Task 2**
  - `git add packages/tool-adapters/src/calendar/calendar-adapter.ts packages/tool-adapters/src/calendar/personal-calendar-adapter.ts packages/tool-adapters/src/index.ts packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts packages/tool-adapters/tests/calendar-adapter.test.ts`
  - `git commit -m "feat(adapters): add natural calendar query filtering and overlap conflict detection"`

---

### Task 3: Chọn nhanh Lịch chính OAuth (`select-primary`) & Cảnh báo Trùng lịch ở Bước Lập kế hoạch (`ChatService.bindConnections`)

**Files:**
- Sửa: `apps/chat-api/src/routes/connections/mycalendar.ts`
- Sửa: `apps/chat-api/src/services/gmail/connection-reference.ts`
- Sửa: `apps/chat-api/src/services/chat-service.ts`
- Sửa: `apps/chat-api/tests/routes/mycalendar-connections.test.ts`
- Tạo mới: `apps/chat-api/tests/services/calendar-conflict-planning.test.ts`

- [ ] **Step 1: Viết failing tests**
  - Trong `apps/chat-api/tests/routes/mycalendar-connections.test.ts`:
    - `POST /api/connections/mycalendar/callback` với `{ code, state, autoSelectPrimary: true }` tự động chọn lịch `primary: true` trong danh sách lịch ghi được, lưu `allowed_scope` và trả về `status: 'connected'`, `selectedCalendars` có 1 lịch chính.
    - `POST /api/connections/mycalendar/select-primary` tự động chọn lịch `primary: true` (hoặc lịch ghi được đầu tiên) cho kết nối hiện tại và chuyển trạng thái sang `status: 'connected'`.
  - Trong `apps/chat-api/tests/services/calendar-conflict-planning.test.ts`:
    - Khi plan có bước `mycalendar.create_event` (`calendarId: 'primary'`, `start: '2026-05-01T09:00:00+07:00'`, `end: '2026-05-01T10:00:00+07:00'`), nếu `lookupCalendarConflicts` (hoặc adapter `mycalendar`) phát hiện sự kiện `"Họp Sprint"` (`09:30–10:30`), `ChatService` tự động gắn cảnh báo `"Cảnh báo trùng lịch: Sự kiện \"Họp khách hàng\" trùng giờ với 1 sự kiện hiện có trên lịch: \"Họp Sprint\"."` vào `plan.warnings` trước khi tính `planHash` và lưu DB.
    - Nếu không có sự kiện trùng giờ, `plan.warnings` giữ nguyên không bị thêm cảnh báo giả.
- [ ] **Step 2: Chạy test để xác nhận RED**
  - Lệnh: `$env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3"; node ./node_modules/vitest/vitest.mjs run --dir apps/chat-api tests/routes/mycalendar-connections.test.ts tests/services/calendar-conflict-planning.test.ts`
- [ ] **Step 3: Triển khai trong `mycalendar.ts`, `connection-reference.ts`, và `chat-service.ts`**
  - Trong `apps/chat-api/src/routes/connections/mycalendar.ts`:
    - Hỗ trợ `req.body?.autoSelectPrimary === true` trong `POST /callback`: chọn lịch `primary: true` (hoặc lịch đầu tiên nếu chỉ có 1 lịch) và lưu `selectedCalendars` + `allowed_scope`.
    - Thêm route `POST /select-primary` dùng token hiện tại gọi `listCalendars`, chọn lịch `primary: true` (hoặc lịch đầu tiên), cập nhật `service_credentials` và trả về `{ status: 'connected', email, selectedCalendars, allowedScope }`.
  - Trong `apps/chat-api/src/services/gmail/connection-reference.ts`:
    - Mở rộng `ActiveMyCalendarConnection` trả thêm `selectedCalendars?: Array<{ id: string; summary: string; primary?: boolean }>` bên cạnh `{ credentialId, email, allowedCalendars }` (nhưng lưu ý khi ghi vào `plan.connections.mycalendar` trong `ChatService.bindConnections`, chỉ giữ `{ credentialId, email, allowedCalendars }` để schema `PlanConnections['mycalendar']` không chứa trường lạ).
  - Trong `apps/chat-api/src/services/chat-service.ts`:
    - Trong `bindConnections`: với các bước `mycalendar.create_event` có `calendarId`, `start`, `end` dạng chuỗi hợp lệ, nếu `this.lookupCalendarConflicts` (hoặc `this.getAdapter?.('mycalendar', { actor: { userId }, connections: { mycalendar: mycalConn } })`) khả dụng, kiểm tra xung đột với timeout 5 giây (`AbortSignal`) và nếu có sự kiện trùng giờ thì nối cảnh báo tiếng Việt vào `bound.warnings`.
- [ ] **Step 4: Chạy test để xác nhận GREEN**
  - Lệnh: `$env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3"; node ./node_modules/vitest/vitest.mjs run --dir apps/chat-api tests/routes/mycalendar-connections.test.ts tests/routes/mycalendar-services.test.ts tests/services/calendar-conflict-planning.test.ts tests/integration/calendar-extension.test.ts`
- [ ] **Step 5: Commit Task 3**
  - `git add apps/chat-api/src/routes/connections/mycalendar.ts apps/chat-api/src/services/gmail/connection-reference.ts apps/chat-api/src/services/chat-service.ts apps/chat-api/tests/routes/mycalendar-connections.test.ts apps/chat-api/tests/services/calendar-conflict-planning.test.ts`
  - `git commit -m "feat(calendar): add primary calendar quick-select and planning conflict warnings"`

---

### Task 4: Chế độ Duyệt Lịch chạy (`manual` vs `auto_digest`) & `calendar-digest-candidate.ts`

**Files:**
- Sửa: `packages/tool-schemas/src/types.ts`
- Tạo mới: `apps/chat-api/src/services/schedules/calendar-digest-candidate.ts`
- Sửa: `apps/chat-api/src/db/repositories/schedule-repo.ts`
- Sửa: `apps/chat-api/src/services/schedules/run-state.ts`
- Sửa: `apps/chat-api/src/services/schedules/schedule-service.ts`
- Sửa: `apps/chat-api/src/routes/schedule-routes.ts`
- Sửa: `apps/chat-api/src/services/chat-service.ts`
- Tạo mới: `apps/chat-api/tests/services/schedule-calendar-digest.test.ts`

- [ ] **Step 1: Viết failing tests trong `apps/chat-api/tests/services/schedule-calendar-digest.test.ts`**
  - Kiểm tra trên PostgreSQL 16 thật:
    1. `evaluateCalendarDigestCandidate`:
       - Khi `services = ['mycalendar', 'slack']` (hoặc `['mycalendar', 'telegram']`), `request` là yêu cầu đọc/tóm tắt lịch buổi sáng, user có kết nối `mycalendar` active (1–5 lịch) và `slack` có đúng 1 kênh `C0123456789` (hoặc `telegram` có đúng 1 `chatId` `-100123456`) → `canAutoDigest: true`, `defaultMode: 'manual'`, sinh đúng `config` và `configHash` SHA-256.
       - Khi `request` chứa từ khóa ghi sự kiện (`"Tạo sự kiện họp thứ Hai hằng tuần"`) → `canAutoDigest: false` kèm `disabledReason`.
       - Khi user chưa kết nối `mycalendar` hoặc `slack` có >1 kênh trong `allowedScope` → `canAutoDigest: false` kèm `disabledReason`.
    2. `ScheduleService.confirmProposal`:
       - Mặc định không truyền `approvalMode` → lưu `kind = 'plan'`, `digest_config = NULL`.
       - Truyền `approvalMode: 'auto_digest'` khi hợp lệ → lưu `kind = 'calendar_digest'`, `digest_config`, `digest_config_hash`, `digest_approved_at`, `ScheduleView` trả về `kind: 'calendar_digest'`, `approvalMode: 'auto_digest'`.
       - Truyền `approvalMode: 'auto_digest'` nhưng trước lúc bấm xác nhận user đã ngắt kết nối `mycalendar` → trả `409 AUTO_DIGEST_NOT_ELIGIBLE`.
       - Khi `update` lịch đang ở `calendar_digest` sang yêu cầu có thao tác ghi → tự động hạ cấp về `kind = 'plan'`, xóa `digest_config`.
    3. `POST /api/conversations/:convId/schedule-proposals/:messageId/confirm` từ chối `approvalMode: 'invalid'` với HTTP `400`.
- [ ] **Step 2: Chạy test để xác nhận RED**
  - Lệnh: `$env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3"; node ./node_modules/vitest/vitest.mjs run --dir apps/chat-api tests/services/schedule-calendar-digest.test.ts`
- [ ] **Step 3: Triển khai types, `calendar-digest-candidate.ts`, `schedule-repo.ts`, `schedule-service.ts`, `schedule-routes.ts`, và `chat-service.ts`**
- [ ] **Step 4: Chạy test để xác nhận GREEN (bao gồm toàn bộ test lịch hiện có `tests/services/schedule-*.test.ts` và `tests/routes/schedule-routes.test.ts`)**
  - Lệnh: `$env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3"; node ./node_modules/vitest/vitest.mjs run --dir apps/chat-api tests/services/schedule-calendar-digest.test.ts tests/db/schedule-migration.test.ts`
- [ ] **Step 5: Commit Task 4**
  - `git add packages/tool-schemas/src/types.ts apps/chat-api/src/services/schedules/calendar-digest-candidate.ts apps/chat-api/src/db/repositories/schedule-repo.ts apps/chat-api/src/services/schedules/run-state.ts apps/chat-api/src/services/schedules/schedule-service.ts apps/chat-api/src/routes/schedule-routes.ts apps/chat-api/src/services/chat-service.ts apps/chat-api/tests/services/schedule-calendar-digest.test.ts`
  - `git commit -m "feat(schedules): add calendar_digest approval mode and candidate evaluation"`

---

### Task 5: Bộ Thực thi Bản tin Lịch Sáng (`calendar-digest-runner.ts`) & Tích hợp `ScheduleRunner`

**Files:**
- Tạo mới: `apps/chat-api/src/services/schedules/calendar-digest-runner.ts`
- Sửa: `apps/chat-api/src/services/schedules/schedule-runner.ts`
- Sửa: `apps/chat-api/src/config/schedules-runtime.ts`
- Sửa: `apps/chat-api/src/server.ts`
- Tạo mới: `apps/chat-api/tests/services/calendar-digest-runner.test.ts`

- [ ] **Step 1: Viết failing tests trong `apps/chat-api/tests/services/calendar-digest-runner.test.ts`**
  - Kiểm tra trên PostgreSQL 16 thật và `AbortSignal` thật:
    1. **Happy path (Slack & Telegram):** Lịch `kind = 'calendar_digest'` đến hẹn → đọc sự kiện từ `mycalendar` của chủ lịch, phát hiện 2 sự kiện trùng giờ (`conflictCount: 2`), định dạng bản tin tiếng Việt rõ ràng và gửi vào kênh Slack `C0123456789` (hoặc Telegram chat `-100123456`), lưu `status = 'digest_sent'` kèm `delivery: { totalEvents, conflictCount, calendarsChecked, ... }` trong `schedule_runs`.
    2. **Sanitization chống Mass-Mention:** Tiêu đề sự kiện chứa `<!channel> <script> & @here` bị escape thành `&lt;!channel&gt; &lt;script&gt; &amp; @\u200bhere` trước khi gửi.
    3. **Cổng Pre-Read chặn khi mất kết nối / đổi scope:** Khi kết nối `mycalendar` bị ngắt hoặc `digest_config_hash` không khớp → lượt chạy chuyển sang `status = 'blocked'`, lịch chuyển sang `status = 'paused'`, **0** lệnh gọi Google Calendar hoặc Slack/Telegram.
    4. **Timeout tóm tắt AI 10 giây bằng `AbortSignal` thật:** Khi hàm `summarizeDigest` treo và chỉ kết thúc khi `signal.aborted === true`, sau đúng timeout (cấu hình 50ms trong test) tín hiệu hủy được kích hoạt, runner tự động fallback gửi bản tin định dạng chuẩn (`summaryIncluded: false`, `status = 'digest_sent'`).
    5. **Kiểm tra phiên bản tức thì trước khi gửi (Pre-Send Version Check):** Nếu trong lúc đang đọc Google Calendar mà người dùng sửa hoặc hủy lịch (`version` tăng lên hoặc `status = 'cancelled'`), runner hủy gửi (**0** tin nhắn gửi tới Slack/Telegram) và ghi `status = 'discarded'`.
    6. **Tự động tạm dừng sau 3 lượt `digest_failed` liên tiếp:** Khi gửi Slack/Telegram hoặc đọc lịch lỗi 3 lượt `scheduled` liên tiếp, ở tick tiếp theo lịch tự động chuyển sang `status = 'paused'` với `pause_reason = '3 lượt gửi bản tin liên tiếp thất bại'`.
- [ ] **Step 2: Chạy test để xác nhận RED**
  - Lệnh: `$env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3"; node ./node_modules/vitest/vitest.mjs run --dir apps/chat-api tests/services/calendar-digest-runner.test.ts`
- [ ] **Step 3: Triển khai `calendar-digest-runner.ts` và tích hợp vào `schedule-runner.ts`, `schedules-runtime.ts`, `server.ts`**
- [ ] **Step 4: Chạy test để xác nhận GREEN**
  - Lệnh: `$env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3"; node ./node_modules/vitest/vitest.mjs run --dir apps/chat-api tests/services/calendar-digest-runner.test.ts tests/services/schedule-calendar-digest.test.ts`
- [ ] **Step 5: Commit Task 5**
  - `git add apps/chat-api/src/services/schedules/calendar-digest-runner.ts apps/chat-api/src/services/schedules/schedule-runner.ts apps/chat-api/src/config/schedules-runtime.ts apps/chat-api/src/server.ts apps/chat-api/tests/services/calendar-digest-runner.test.ts`
  - `git commit -m "feat(schedules): implement calendar_digest runner with conflict detection and safety gates"`

---

### Task 6: Nâng cấp Giao diện Web (`apps/chat-web`) & Kiểm thử Component

**Files:**
- Sửa: `apps/chat-web/src/services/api-client.ts`
- Sửa: `apps/chat-web/src/views/MyCalendarCallbackView.tsx`
- Sửa: `apps/chat-web/src/pages/Settings/PersonalMyCalendar.tsx`
- Sửa: `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`
- Sửa: `apps/chat-web/src/pages/History/ScheduleSection.tsx`
- Sửa: `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`
- Sửa: `apps/chat-web/src/services/schedule-text.ts`
- Tạo mới: `apps/chat-web/tests/schedule-calendar-digest-mode.test.tsx`

- [ ] **Step 1: Viết failing tests trong `apps/chat-web/tests/schedule-calendar-digest-mode.test.tsx`**
  - Kiểm tra:
    1. `ScheduleMoment`:
       - Mặc định chọn `#schedule-mode-manual` và gửi `confirmSchedule(convId, msgId, 'manual')`.
       - Khi `digestCandidate.canAutoDigest === true`, người dùng chọn `#schedule-mode-auto-digest`, thấy hộp phạm vi khóa `#schedule-auto-digest-scope` (email, tên lịch, tên kênh Slack/Telegram) và khi bấm xác nhận thì gọi `confirmSchedule(convId, msgId, 'auto_digest')`.
       - Khi `digestCandidate.canAutoDigest === false`, radio `#schedule-mode-auto-digest` bị `disabled` và hiển thị rõ `disabledReason`.
    2. `ScheduleSection` & `ScheduleRunRecovery` & `schedule-text.ts`:
       - Hiển thị huy hiệu `Tự gửi` cho lịch có `approvalMode === 'auto_digest'`.
       - Hiển thị `Đã gửi · 4 sự kiện (1 trùng giờ)` cho lượt chạy `digest_sent` và `Gửi bản tin thất bại` (kèm nút `Lập lại kế hoạch`) cho lượt chạy `digest_failed`.
    3. `MyCalendarCallbackView` & `PersonalMyCalendar`:
       - Hiển thị nút `#mycalendar-quick-primary` («Dùng ngay Lịch chính») khi có lịch chính, bấm vào tự động lưu lịch chính và hoàn tất kết nối.
- [ ] **Step 2: Chạy test để xác nhận RED**
  - Lệnh: `node ./node_modules/vitest/vitest.mjs run --dir apps/chat-web tests/schedule-calendar-digest-mode.test.tsx`
- [ ] **Step 3: Triển khai các thay đổi UI trong `apps/chat-web`**
- [ ] **Step 4: Chạy toàn bộ test của `apps/chat-web` để xác nhận GREEN (bao gồm `mycalendar-ui.test.tsx` và `mycalendar-review-fixes.test.tsx`)**
  - Lệnh: `node ./node_modules/vitest/vitest.mjs run --dir apps/chat-web tests/schedule-calendar-digest-mode.test.tsx tests/mycalendar-ui.test.tsx tests/mycalendar-review-fixes.test.tsx`
- [ ] **Step 5: Commit Task 6**
  - `git add apps/chat-web/src/services/api-client.ts apps/chat-web/src/views/MyCalendarCallbackView.tsx apps/chat-web/src/pages/Settings/PersonalMyCalendar.tsx apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx apps/chat-web/src/pages/History/ScheduleSection.tsx apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx apps/chat-web/src/services/schedule-text.ts apps/chat-web/tests/schedule-calendar-digest-mode.test.tsx`
  - `git commit -m "feat(chat-web): add calendar auto-digest selector and primary calendar quick-select UI"`

---

### Task 7: Kiểm định Toàn diện (Full Suite Verification), Audit Code & Ghi Nhật ký Bàn giao

**Files:**
- Tạo mới: `docs/handoff/log/2026-11-02-calendar-oauth-and-automation.md`

- [ ] **Step 1: Chạy toàn bộ bộ test trên tất cả các workspaces (`@wap/tool-schemas`, `@wap/tool-adapters`, `@wap/planner`, `@wap/executor`, `@wap/chat-api`, `@wap/chat-web`) trên PostgreSQL 16 thật**
- [ ] **Step 2: Kiểm tra bất biến 33 tools & SHA-256 system prompt (`packages/planner/tests/read-answers.test.ts` & `packages/planner/tests/schedules.test.ts`)**
- [ ] **Step 3: Tự Review diff toàn nhánh (`git diff main...HEAD`) theo chuẩn `REVIEW-CHECKLIST.md` đến khi 0 lỗi**
- [ ] **Step 4: Tạo nhật ký bàn giao `docs/handoff/log/2026-11-02-calendar-oauth-and-automation.md` và commit**

---

## Vòng lặp Thẩm định & Đối chiếu Kế hoạch với Codebase (Plan Self-Audit Loop)

1. **Đối chiếu chữ ký `ScheduleService.confirmProposal` và `ScheduleMoment.tsx`:**
   - Trong `ScheduleMoment.tsx` hiện tại (dòng 48): `const result = await apiClient.confirmSchedule(convId, messageId);`.
   - Để không làm gãy các bài kiểm thử UI hiện có (những bài test chỉ truyền `proposal` mà không có `digestCandidate`, và mock `apiClient.confirmSchedule` kiểm tra `toHaveBeenCalledWith(convId, messageId)`), trong `ScheduleMoment.tsx`:
     - Chỉ truyền tham số thứ 3 `approvalMode` vào `apiClient.confirmSchedule(convId, messageId, approvalMode)` khi `metadata.digestCandidate` có mặt (hoặc trong `apiClient.confirmSchedule(convId, messageId, approvalMode?)` chỉ đính kèm `body: JSON.stringify({ approvalMode })` khi `approvalMode` được truyền).
     - Nhờ đó, mọi test cũ gọi `expect(apiClient.confirmSchedule).toHaveBeenCalledWith(convId, msgId)` đều tiếp tục PASS 100%!
2. **Đối chiếu `PlanConnections['mycalendar']` và `plan_hash`:**
   - Trong `ChatService.bindConnections`, `connections.mycalendar` được lưu vào `plan_json` và tính `planHash`. Vì vậy `connections.mycalendar` chỉ giữ đúng 3 trường chuẩn `{ credentialId, email, allowedCalendars }`, không nhét `selectedCalendars` vào `connections.mycalendar` để không làm lệch schema hay `planHash`.
3. **Đối chiếu khóa hàng (Lock Order) trong PostgreSQL:**
   - Tuân thủ nghiêm ngặt thứ tự lock của `ScheduleRepo.ownedSchedule`: khóa `conversations` trước, sau đó khóa `schedules`, rồi `users`, rồi `schedule_runs`. Không bao giờ lock ngược chiều để tránh deadlock.

**Kết luận Thẩm định Kế hoạch:** **0 lỗi (0 P1 / 0 P2 / 0 P3)** — Sẵn sàng thi công TDD từ Task 1 đến Task 7.
