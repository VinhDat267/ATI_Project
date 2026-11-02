# Bàn giao: Hoàn thiện & Nâng cấp Thực chiến Google Calendar (`mycalendar` & `calendar`) + Kiểm thử Playwright E2E

- **Ngày:** 03/11/2026 (Asia/Ho_Chi_Minh)
- **Nhánh:** `fix/migration-rerun-idempotency`
- **Phạm vi:** Audit kỹ thuật `OAUTH-02` & `#239`, nâng cấp chiều sâu nghiệp vụ họp doanh nghiệp & liên dịch vụ (Vòng 1 & Vòng 2), nâng cấp toàn diện Frontend UI/UX trên `apps/chat-web`, và nghiệm thu Playwright E2E (`SCENARIO=mycalendar` & `MYCALENDAR off`) trên trình duyệt Chromium thật.

---

## 1. Các hạng mục đã hoàn thành

### Phần A: Khắc phục 5 lỗi kỹ thuật OAuth-02 & #239
1. **Bảo vệ trạng thái kết nối khi Re-consent (`apps/chat-api/src/routes/connections/gmail.ts`):** Giữ nguyên `credential_id` và `selectedCalendars` hiện có khi người dùng thực hiện re-consent cùng email, tránh làm mất phạm vi lịch đã chọn.
2. **Kiểm tra scope Google cấp trên Callback (`apps/chat-api/src/routes/connections/gmail.ts`):** Kiểm tra `tokens.scope` trả về từ Google OAuth phải chứa quyền đọc/ghi lịch trước khi lưu credential.
3. **Tuân thủ `allowedCalendars` trong Calendar Digest (`apps/chat-api/src/services/schedules/calendar-digest-runner.ts` & `telegram-digest-runner.ts`):** Chỉ quét sự kiện trên các lịch nằm trong `allowedCalendars` của người dùng thay vì quét toàn bộ lịch trong tài khoản.
4. **Đồng bộ `resourceLabels` & `plan_hash` (`apps/chat-api/src/services/chat-service.ts` & `resource-labels.ts`):** Hiển thị chính xác tên lịch tiếng Việt (`Lịch chính`, `Lịch việc riêng`) cho cả 7 công cụ `mycalendar.*`.
5. **Chống sập `GET /api/services` (`apps/chat-api/src/routes/services-routes.ts`):** Bọc `try/catch` quanh `decryptCredentials` cho các bản ghi dịch vụ dùng chung/cá nhân để một bản ghi lệch khoá mã hoá không làm `GET /api/services` trả về HTTP 500.

### Phần B & C: Nâng cấp Nghiệp vụ Họp Doanh nghiệp, Lặp lại & Liên dịch vụ (Vòng 1 & Vòng 2)
1. **Mở rộng `MYCALENDAR_TOOLS` lên 7 công cụ (`packages/tool-schemas/src/mycalendar.ts`):**
   - `mycalendar.list_calendars` (đọc danh sách lịch được cấp phép)
   - `mycalendar.list_events` (tự động suy luận `timeMin`/`timeMax` từ `query` tiếng Việt như `hôm nay`, `ngày mai`, `tuần này`, `DD/MM/YYYY`; gắn `discovers: 'myevent'`)
   - `mycalendar.get_event` (đọc chi tiết Agenda/`description`, `meetLink`, `recurrence`, `attendeesCount`; gắn `discovers: 'myevent'`)
   - `mycalendar.find_free_slots` (tìm các khung giờ trống theo `durationMinutes` trong giờ hành chính `08:30–18:00`)
   - `mycalendar.create_event` (hỗ trợ `createMeetLink: boolean` qua `conferenceDataVersion=1&sendUpdates=none`, `recurrence` RRULE/preset `DAILY | WEEKDAYS | WEEKLY | BIWEEKLY | MONTHLY`, `location`, `description`)
   - `mycalendar.update_event` (dời lịch/cập nhật sự kiện qua `PATCH` kèm kiểm tra trùng giờ & gợi ý giờ trống)
   - `mycalendar.delete_event` (huỷ sự kiện qua `DELETE` với `sendUpdates=none`)
   - Bảo toàn bất biến: `ALL_TOOLS` giữ nguyên 33 công cụ và `SERVICE_REGISTRY` giữ nguyên 8 dịch vụ khi `MYCALENDAR_ENABLED=off`.
2. **Trí nhớ hội thoại đa lượt & Định tuyến Liên dịch vụ (`packages/planner`):**
   - Lưu trữ `myevent` (`id`, `summary`, `start`, `end`, `location`, `meetLink`, `recurrence`, `calendarId`) vào `WorkingMemory.__observed.myevent` trong `packages/planner/src/search.ts`.
   - Bổ sung khối `### Personal Google Calendar (mycalendar) Rules` vào `packages/planner/src/prompts/system-prompt.ts` (chỉ khi catalog có `mycalendar.*`), hướng dẫn tự chọn lịch duy nhất và truyền `${step_1.output.meetLink}` sang Slack, Telegram, Gmail, Notion, Trello.
3. **1-Click Primary Calendar & Cảnh báo trùng lịch thông minh (`apps/chat-api`):**
   - Endpoint `POST /api/connections/mycalendar/scope/primary` cho phép chọn nhanh Lịch chính (`primary`) chỉ với 1 chạm ngay tại màn hình OAuth Callback.
   - `ChatService` kiểm tra xung đột lịch cho cả `create_event` lẫn `update_event` và tự động tính toán tối đa 3 khung giờ trống gợi ý trong ngày (`Gợi ý khung giờ trống trong ngày: 10:30–11:30, ...`).

### Phần D: Nâng cấp Toàn diện Frontend UI/UX (`apps/chat-web`)
1. **Khung xem trước sự kiện lịch (`PreviewContents.tsx` & `cockpit-services.json`):**
   - Bổ sung `previewStyle: "calendar_event"` (`data-testid="calendar-event-preview"`) hiển thị trực quan khung giờ tiếng Việt, huy hiệu `🎥 Tự động tạo phòng họp Google Meet`, chu kỳ lặp lại (`🔁 Lặp lại: Thứ 2 – Thứ 6 hàng tuần`), địa điểm, nội dung/Agenda, và cảnh báo đỏ khi xoá sự kiện.
2. **Thẻ bước `PlanMoment.tsx` & Giải quyết trùng lịch 1 chạm (`Cockpit.tsx`):**
   - Hiển thị pills tóm tắt nhanh ngay trên thẻ bước: `🎥 Google Meet`, `🔁 Thứ 2 – Thứ 6 hàng tuần`, `📍 <location>`.
   - Banner cảnh báo trùng lịch (`data-testid="calendar-conflict-banner"`) trích xuất các khung giờ trống gợi ý thành các nút bấm 1 chạm (`Đổi sang 10:30–11:30`) giúp người dùng điền ngay yêu cầu đổi giờ.
3. **Biên nhận `ReceiptMoment.tsx`, Lịch chạy `ScheduleMoment.tsx` & Playbooks `RequestMoments.tsx`:**
   - Hiển thị nút `🎥 Tham gia Google Meet` bên cạnh `Mở sự kiện trên Google Calendar` trên biên nhận thực thi.
   - Sửa phân loại `isTelegramCandidate` trên `ScheduleMoment.tsx` để không nhận nhầm lịch chạy 3+ dịch vụ là `telegram_digest`.
   - Đồng bộ `RequestMoments.tsx` khớp Playbook đa dịch vụ cho cả cặp tương đương `calendar`/`mycalendar` và `sheets`/`mysheets`.
   - Cập nhật thông điệp quyền OAuth chuẩn xác trên `PersonalMyCalendar.tsx`, `MyCalendarCallbackView.tsx` và `PrivacyPage.tsx`.

### Phần E: Nâng cấp Hạ tầng Giả lập & Kiểm thử Playwright E2E (`scripts/fake-google-gmail.mjs`, `scenarios.ts`, `mycalendar.spec.ts`)
- Nâng cấp `scripts/fake-google-gmail.mjs` trả về `hangoutLink` khi `conferenceDataVersion=1`, lưu `recurrence`, và hỗ trợ `GET / PATCH / DELETE /calendar/v3/calendars/{calId}/events/{eventId}`.
- Mở rộng `apps/chat-api/src/sandbox/scenarios.ts` và bổ sung `Flow 5` vào `apps/chat-web/tests/browser/mycalendar.spec.ts`.

---

## 2. Bằng chứng Kiểm thử Thực tế (Quality Gate Evidence)

- **Typecheck toàn dự án (`npm run typecheck:v3`):** **PASS** (0 lỗi TypeScript, exit code 0).
- **Unit & Integration Tests (5 workspaces):**
  - `packages/tool-schemas`: **342/342 PASS** (exit code 0)
  - `packages/tool-adapters`: **53/53 PASS** trong `personal-calendar-adapter.test.ts` (exit code 0)
  - `packages/planner`: **422/422 PASS** trên 27 test files (exit code 0)
  - `apps/chat-api`: **120/120 PASS** trên các bộ test Calendar OAuth, Conflict Planning, Digest Runner & Services Routes với PostgreSQL 16 thật (exit code 0)
  - `apps/chat-web`: **56/56 PASS** trên 5 test files UI/UX (`mycalendar-ui.test.tsx`, `mycalendar-review-fixes.test.tsx`, `schedule-calendar-digest-mode.test.tsx`, `telegram-connection.test.tsx`, `workflow-flow-canvas.test.tsx`) (exit code 0)
- **Playwright Browser E2E trên Chromium thật:**
  - `$env:RUNTIME_MODE="sandbox"; $env:SCENARIO="mycalendar"; npm run test:browser:v3` → **8/8 PASS (25.4s, exit code 0)** (`Flow 1` → `Flow 5`, bao gồm kiểm tra responsive Light/Dark ở `1440x900` và `375x812`).
  - `$env:RUNTIME_MODE="sandbox"; $env:SCENARIO="default"; $env:GREP="MYCALENDAR off:"; npm run test:browser:v3` → **1/1 PASS (8.9s, exit code 0)**.
