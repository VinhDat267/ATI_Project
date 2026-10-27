# 27/10/2026 · OAUTH-02 · Google Calendar cá nhân kèm chọn phạm vi lịch (`mycalendar`)

**Người viết:** Antigravity Orchestrator (thi công theo quy trình `subagent-driven-development` với các subagent `Model: "flash"`).  
**Nhánh:** `feat/oauth-02-personal-calendar` (tách từ `main` `2888a9fe`).  
**Task card:** [`docs/handoff/tasks/OAUTH-02-personal-calendar.md`](../tasks/OAUTH-02-personal-calendar.md).  
**Đặc tả:** [`docs/superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md`](../../superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md).  
**Kế hoạch triển khai:** [`docs/superpowers/plans/2026-10-27-oauth-02-personal-calendar.md`](../../superpowers/plans/2026-10-27-oauth-02-personal-calendar.md).

---

## 1. Tóm tắt những việc đã làm (6 Tasks)

1. **Task 1 — Tool Schemas, Registry, Executor Write Catalog & DB Migration `0012` (`cfec72a3`):**
   - Thêm `packages/tool-schemas/src/mycalendar.ts` và `packages/tool-schemas/src/registry/mycalendar.ts`:
     - `MYCALENDAR_SERVICE` (`connection: 'personal'`, `scopeKey: 'calendars'`, `authType: 'oauth2'`).
     - 3 công cụ `mycalendar.list_calendars` (`discovers: 'mycalendar'`), `mycalendar.list_events` và `mycalendar.create_event` (`'x-resource': 'mycalendar'`), dùng `CALENDAR_ID_PATTERN` (cấm `'primary'`, `..`, `/`, `?`, `#`) và `CALENDAR_TIME_PATTERN`.
   - Cập nhật `packages/executor/src/runner.ts` thêm `'mycalendar.create_event'` vào `WRITE_TOOLS`.
   - Tạo migration idempotent `db/v3/0012_mycalendar_personal_connections.sql` mở rộng `service_credentials_personal_check` cho `'mycalendar'` và `oauth_states_mode_check` cho `'connect_mycalendar'`.

2. **Task 2 — `PersonalCalendarAdapter` & Shared Calendar Transport Reuse (`c1732a6b`):**
   - Tách các hàm normalize/transport dùng chung từ `packages/tool-adapters/src/calendar/calendar-adapter.ts`.
   - Xây dựng `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts`:
     - Kiểm tra nghiêm ngặt `calendarId ∈ allowedScope.calendars` (`assertAllowedScope('calendars', value)`) trên cả `list_events` và `create_event`.
     - `mycalendar.list_calendars` chỉ trả về danh sách các lịch thuộc `allowedScope.calendars` (ẩn hoàn toàn các lịch không được chọn).
     - `mycalendar.create_event` luôn gửi `sendUpdates=none` và loại bỏ `attendees` để không phát sinh email mời ngoài ý muốn.
     - Tự động làm mới access token 1 lần khi gặp `401`; phân biệt rõ lỗi trước khi gửi (`requestSent: false`) và lỗi mạng/timeout sau khi đã gửi lệnh ghi (`StepError` với `category: 'UNKNOWN'`).

3. **Task 3 — Fake Google Server Calendar Support, Env Config & `/api/connections/mycalendar` Routes (`b9047b93`):**
   - Mở rộng `scripts/fake-google-gmail.mjs` hỗ trợ `/calendar/v3/users/me/calendarList` (trả lịch chính `owner`, lịch phụ `writer`, và lịch nghỉ lễ `reader`), `/calendar/v3/calendars/:id`, và `/calendar/v3/calendars/:id/events`.
   - Bổ sung `MYCALENDAR_ENABLED` (mặc định `off`) và `MYCALENDAR_OAUTH` trong `apps/chat-api/src/config/env.ts` và `.env.example`; thêm `docs/ai-evidence/MYCALENDAR-LIVE/` vào `.gitignore`.
   - Thêm `GmailOAuthClient.writableCalendars()` lọc chỉ giữ các lịch có `accessRole === 'owner' || accessRole === 'writer'`, loại bỏ hoàn toàn lịch chỉ đọc (`reader` / `freeBusyReader`).
   - Tổng quát hóa `GmailConnectionRepo` (thêm `updateConfigIfActive` dùng `pg_advisory_xact_lock(hashtext(service), hashtext(userId))` + `FOR UPDATE`) và `GmailTokenManager` cho cả `'gmail'` và `'mycalendar'` mà không sửa bất kỳ assertion nào của bộ test Gmail hiện có.
   - Xây dựng `apps/chat-api/src/routes/connections/mycalendar.ts`:
     - `POST /start`: PKCE S256, cookie `ati_mycalendar_browser`, kiểm tra quyền sở hữu hội thoại `returnTo`.
     - `POST /callback`: đổi code, lưu kết nối ở trạng thái `scope_required` (`selectedCalendars: []`), trả danh sách lịch ghi được và `returnTo`.
     - `GET /calendars`: trả danh sách lịch ghi được từ Google kèm `selectedCalendarIds` hiện tại.
     - `PUT /scope`: yêu cầu ít nhất 1 lịch hợp lệ nằm trong danh sách lịch ghi được của Google, cập nhật nguyên tử dưới khóa giao dịch và chuyển sang `connected`.
     - `DELETE /`: thu hồi refresh token của `mycalendar` và xoá dòng `mycalendar`, giữ nguyên dòng `gmail` của cùng người dùng.

4. **Task 4 — Runtime Wiring: `AdapterFactory`, Tool Catalog, `ChatService`, `ResourceLabels`, `/api/services` & `/api/health` (`e07eaf22`, `fb8a5cd6`):**
   - `connection-reference.ts`: thêm `createMyCalendarConnectionLookup`, `planUsesMyCalendar`, `readPlanMyCalendarConnection`, `attachPlanConnections` (hỗ trợ kế hoạch có riêng `gmail.*`, riêng `mycalendar.*` hoặc kết hợp cả hai).
   - `adapter-factory.ts`: khi thực thi (`phase === 'execution'`), kiểm tra đồng thời `record.id === previewed.credentialId` và mọi lịch trong `previewed.allowedCalendars` vẫn nằm trong `allowedScope.calendars` hiện tại.
   - `registered-services.ts` & `gmail-tools-runtime.ts`: chỉ đưa `MYCALENDAR_TOOLS` vào catalog khi `mycalendarEnabled === true` và kết nối đang ở trạng thái `connected` (`selectedCalendars.length > 0`); chặn fallback sang `calendar.*` chung khi ý định người dùng nhắm vào lịch cá nhân.
   - `resource-labels.ts`: ánh xạ `calendarId` (`'x-resource': 'mycalendar'`) sang tên lịch (`title`) từ `mycalendar.list_calendars`.
   - `services-routes.ts` & `app.ts`: trả `personalStatus: 'not_connected' | 'scope_required' | 'connected' | 'reconnect_required'` kèm `selectedCalendars`; chặn các route quản trị dùng chung với `400 PERSONAL_CONNECTION`; ẩn `mycalendarEnabled` khỏi `/api/health` khi `MYCALENDAR_ENABLED=off`.
   - `packages/planner/src/router.ts`: ưu tiên dịch vụ lịch cá nhân dựa trên siêu dữ liệu chung (`connection === 'personal'` và `scopeKey === 'calendars'`), đảm bảo vượt qua `evaluations/generic-plumbing/static-guard.test.ts`.

5. **Task 5 — Giao diện Web: `MyCalendarCallbackView`, `/settings#mycalendar`, `RefusalMoment`, `PlanMoment`/`ReceiptMoment` & `/privacy` (`5749d41f`):**
   - `MyCalendarCallbackView.tsx` (`/connections/mycalendar/callback`): xoá query params trước khi vẽ (`useLayoutEffect`), hiển thị ngay bộ chọn lịch sau khi Google redirect (tự động gợi ý chọn sẵn lịch chính `primary: true`), hỗ trợ chế độ `?mode=select&returnTo=/c/<uuid>` không cần chạy lại OAuth, bắt buộc chọn ít nhất 1 lịch mới cho bấm lưu, và kiểm tra nghiêm ngặt `conversationReturnPath(returnTo)` chống open redirect.
   - `PersonalMyCalendar.tsx` (`/settings#mycalendar`): hiển thị đủ 4 trạng thái (`not_connected`, `scope_required`, `connected` kèm badge tên các lịch đã chọn, `reconnect_required`), hộp thoại chọn lại phạm vi lịch và hộp thoại xác nhận ngắt kết nối.
   - `ResponseMoment.tsx` (`RefusalMoment`): hiển thị nút *"Kết nối Google Calendar"* (`not_connected`), *"Chọn lịch Google Calendar"* (`scope_required` → mở `/connections/mycalendar/callback?mode=select&returnTo=...`), *"Kết nối lại Google Calendar"* (`reconnect_required`), và *"Gửi lại yêu cầu"* (`connected`).
   - `PlanMoment.tsx`, `ReceiptMoment.tsx`, `RecoveryMoment.tsx`, `PrivacyPage.tsx`: hiển thị `Tài khoản: <email> (Google Calendar của bạn)`, tên lịch đích từ `resourceLabels`, liên kết `https://` mở sự kiện trên Google Calendar, và mục quyền riêng tư *"Dữ liệu Google Calendar của bạn"*.

6. **Task 6 — Playwright Browser E2E, Golden Set (`cases-mycalendar.json`) & 8 Đột biến Bắt buộc (`4b82133`):**
   - Thêm 8 câu đánh giá chuẩn tại `evaluations/golden/cases-mycalendar.json` và `evaluations/golden-v2/cases-mycalendar.json` (`mc01`–`mc06`, `mi01`–`mi02`).
   - Thêm `apps/chat-web/tests/browser/mycalendar.spec.ts` và kịch bản `mycalendar` trong `scripts/test-v3-browser.mjs`.
   - Thực thi và xác nhận cả 8 đột biến bắt buộc tại mục 8.2 của đặc tả.

---

## 2. Bằng chứng RED → GREEN & Kiểm thử toàn diện

Chạy trên PostgreSQL 16 tạm thời tại cổng `56533` (`ati-oauth02-pg`), tách biệt hoàn toàn với cổng `15433`:

| Nhóm kiểm thử | Lệnh chạy | Kết quả |
|---|---|---|
| TypeScript Typecheck | `npm run typecheck:v3` | **PASS** (exit code 0) |
| Build toàn bộ v3 | `RUNTIME_MODE=sandbox npm run build:v3` | **PASS** (exit code 0) |
| Unit & Integration (`test:v3`) | `npm run test:v3` | **PASS — 2.304 passed** (6 workspaces: `tool-schemas` 74, `tool-adapters` 425, `planner` 393, `executor` 42, `chat-api` 564, `chat-web` 806) |
| Evaluation & Static Guard (`test:eval:v3`) | `npm run test:eval:v3` | **PASS — 394 passed** (24 files, gồm `golden.test.ts` và `static-guard.test.ts`) |
| Browser E2E (`SCENARIO=mycalendar`) | `SCENARIO=mycalendar node scripts/test-v3-browser.mjs` | **PASS — 7/7 passed** (23.3s: Flow 1, Flow 2, Flow 3, Flow 4 1440×900 & 375×812 sáng/tối) |
| Browser E2E (`MYCALENDAR off:`) | `SCENARIO=default GREP="MYCALENDAR off:" node scripts/test-v3-browser.mjs` | **PASS — 1/1 passed** (6.3s) |

---

## 3. Bảng kết quả 8 Đột biến Bắt buộc (Spec §8.2)

Mỗi đột biến được áp vào mã nguồn, chạy bộ test mục tiêu để chứng minh test bắt được lỗi (`exit code 1`), sau đó khôi phục và đối chiếu SHA-256:

| # | Đột biến (Spec §8.2) | File áp đột biến | Test bắt lỗi | Exit Code | Khôi phục SHA-256 |
|---|---|---|---|:---:|:---:|
| **M1** | Rơi về `calendar.*` chung khi chưa kết nối `mycalendar` | `apps/chat-api/src/config/gmail-tools-runtime.ts` | `mycalendar-services.test.ts` (`mayFallbackToShared prevents shared fallback when mycalendar intent is routed`) | `1` | Khớp 100% |
| **M2** | Cho phép `mycalendar.*` vào catalog khi còn ở `scope_required` | `apps/chat-api/src/services/registered-services.ts` | `mycalendar-services.test.ts` (`excludes MYCALENDAR_TOOLS in getToolCatalogFor when in scope_required state`) | `1` | Khớp 100% |
| **M3** | Bỏ kiểm tra `calendarId ∈ allowedScope.calendars` | `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts` | `personal-calendar-adapter.test.ts` (`rejects calendarId not in allowedScope.calendars`) | `1` | Khớp 100% |
| **M4** | Bỏ kiểm tra `connections.mycalendar.credentialId` lúc thực thi | `apps/chat-api/src/services/adapter-factory.ts` | `mycalendar-services.test.ts` (`AdapterFactory throws AUTH_ERROR when credentialId changed between planning and execution`) | `1` | Khớp 100% |
| **M5** | Ngắt kết nối `mycalendar` xoá luôn dòng kết nối `gmail` | `apps/chat-api/src/routes/connections/mycalendar.ts` | `mycalendar-connections.test.ts` (`revokes the mycalendar token, deletes the mycalendar row, leaving gmail row active and untouched`) | `1` | Khớp 100% |
| **M6** | Cờ `MYCALENDAR_ENABLED=off` vẫn thêm `MYCALENDAR_TOOLS` vào catalog | `apps/chat-api/src/services/registered-services.ts` | `mycalendar-services.test.ts` (`excludes MYCALENDAR_TOOLS from getToolCatalogFor when mycalendarEnabled is false`) | `1` | Khớp 100% |
| **M7** | `mycalendar.create_event` gửi `sendUpdates` khác `'none'` | `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts` | `personal-calendar-adapter.test.ts` (`mycalendar.create_event sends POST .../calendars/<id>/events?sendUpdates=none without attendees`) | `1` | Khớp 100% |
| **M8** | Lỗi mạng sau khi gửi lệnh ghi xếp vào `NETWORK_ERROR` thay vì `UNKNOWN` | `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts` | `personal-calendar-adapter.test.ts` (`when fetchFn rejects after create_event is sent, throws StepError with category UNKNOWN`) | `1` | Khớp 100% |

---

## 4. Việc còn lại (cần thao tác của nhóm trưởng)

- Tạo OAuth Client thứ hai trên Google Cloud Project (redirect URI `/connections/mycalendar/callback`, scopes `calendar.calendarlist.readonly` và `calendar.events`) và điền `MYCALENDAR_OAUTH_*` vào `.env` máy local.
- Chạy nghiệm thu thật (P-LIVE) và đo live model `EVAL_SET=mycalendar` ×3 trước khi mở PR bật cờ `MYCALENDAR_ENABLED=on`.
