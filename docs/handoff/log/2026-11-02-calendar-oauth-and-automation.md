# Bàn giao: Google Calendar OAuth & AI Automation v2 (Auto-Digest, Conflict Detection & Natural Event Filtering)

- **Ngày:** 2026-11-02
- **Nhánh:** `feat/calendar-oauth-v2`
- **Đặc tả & Kế hoạch:**
  - `docs/superpowers/specs/2026-11-02-calendar-oauth-and-automation-design.md`
  - `docs/superpowers/plans/2026-11-02-calendar-oauth-and-automation.md`

## Tóm tắt thay đổi
1. **Brainstorming, Đặc tả & Kế hoạch (`1ed6db3d`):**
   - Hoàn thành đặc tả thiết kế `docs/superpowers/specs/2026-11-02-calendar-oauth-and-automation-design.md` và kế hoạch thi công `docs/superpowers/plans/2026-11-02-calendar-oauth-and-automation.md` qua vòng lặp tự phản biện User/Business và Kỹ thuật/Bảo mật (0 lỗi).
   - Giữ nguyên bất biến 33 tool trong `ALL_TOOLS` và SHA-256 system prompt (`b31234b91e0c22191f5b0c5fb4be73299e673178df36ea3accb2633b42ec64f9`).
2. **Migration PostgreSQL 16 `0015_calendar_automation_digest.sql` (`32b0324d`):**
   - Mở rộng bảng `schedules` (`kind`, `digest_config`, `digest_config_hash`, `digest_approved_at` cùng ràng buộc `schedules_kind_check`) và bảng `schedule_runs` (thêm trạng thái `'digest_sent'`, `'digest_failed'` và cột `delivery JSONB`).
   - Kiểm thử idempotency và ràng buộc toàn vẹn trên PostgreSQL 16 (`apps/chat-api/tests/db/calendar-digest-migration.test.ts`).
3. **Lọc sự kiện tự nhiên & Phát hiện trùng lịch trong Adapter (`1c45bf37`):**
   - Bổ sung `parseCalendarEventQuery` (hỗ trợ tiền tố `state:today|upcoming|past|all`, `type:meeting|focus|allday`, `conflict:only`, `has:url` kết hợp từ khóa tự do, dùng múi giờ `Asia/Ho_Chi_Minh`) và `eventsOverlap` / `detectCalendarConflicts` trong `packages/tool-adapters/src/calendar/calendar-adapter.ts`.
   - Tích hợp lọc sự kiện nâng cao và `findConflicts` vào `PersonalCalendarAdapter` (`packages/tool-adapters/src/calendar/personal-calendar-adapter.ts`), đảm bảo tương thích ngược hoàn toàn với schema `list_events` hiện có.
4. **Chọn nhanh Lịch chính (1 chạm) & Cảnh báo trùng lịch khi lập kế hoạch (`bea07f65`):**
   - Bổ sung `autoSelectPrimary` trên `POST /api/connections/mycalendar/callback` và endpoint `POST /api/connections/mycalendar/select-primary` trong `apps/chat-api/src/routes/connections/mycalendar.ts`.
   - Mở rộng `ChatService.bindConnections` (`apps/chat-api/src/services/chat-service.ts`) để kiểm tra sự kiện trùng giờ (với `AbortSignal` 5 giây) cho các bước `mycalendar.create_event` và thêm cảnh báo tiếng Việt vào `plan.warnings` mà không làm thay đổi cấu trúc `plan.connections.mycalendar`.
5. **Chế độ duyệt lịch (`manual` vs `auto_digest`) & Đánh giá phạm vi khóa (`4ace4338`):**
   - Bổ sung các kiểu dữ liệu `ScheduleApprovalMode`, `ScheduleKind`, `CalendarDigestConfig`, `CalendarDigestCandidate`, `CalendarDigestDelivery` trong `packages/tool-schemas/src/types.ts`.
   - Triển khai `apps/chat-api/src/services/schedules/calendar-digest-candidate.ts` kiểm tra điều kiện đủ để bật `auto_digest` (chặn mọi ý định ghi bằng `isCalendarWriteIntent`, xác minh kết nối `mycalendar` đang active và kênh đích Slack/Telegram nằm trong `allowedScope`, tính `computeCalendarDigestHash` SHA-256).
   - Cập nhật `schedule-repo.ts`, `run-state.ts`, `schedule-service.ts`, `schedule-routes.ts` và `chat-service.ts` để hỗ trợ xác nhận lịch ở chế độ `manual` hoặc `auto_digest`.
6. **Bộ thực thi bản tin Lịch tự động `calendar-digest-runner.ts` & `ScheduleRunner` (`62cf1497`):**
   - Triển khai `apps/chat-api/src/services/schedules/calendar-digest-runner.ts`: kiểm tra Pre-Read Gate (xác thực `digest_config_hash`, trạng thái kết nối `mycalendar`, danh sách lịch cho phép và `allowedScope` của Slack/Telegram trước khi gọi API), đọc sự kiện với `AbortSignal` 30 giây, phát hiện xung đột giờ họp, tóm tắt AI tùy chọn với `AbortSignal` 10 giây (tự động fallback nếu quá hạn), trung hòa ký tự HTML/mention (`escapeDigestText`), kiểm tra version lịch trước khi gửi, và ghi nhận kết quả `digest_sent` / `digest_failed` / `blocked` / `discarded`.
   - Tự động tạm dừng lịch sau 3 lượt `digest_failed` liên tiếp (`3 lượt gửi bản tin liên tiếp thất bại`).
7. **Giao diện người dùng `apps/chat-web` (`9f2ee871`):**
   - Bổ sung nút chọn nhanh `#mycalendar-quick-primary` (`Dùng ngay Lịch chính (1 chạm)`) tại `MyCalendarCallbackView.tsx` và `PersonalMyCalendar.tsx`.
   - Bổ sung bộ chọn chế độ chạy định kỳ (`#schedule-mode-manual` và `#schedule-mode-auto-digest`) kèm thẻ hiển thị phạm vi đã khóa (`#schedule-auto-digest-scope`) trong `ScheduleMoment.tsx`.
   - Hiển thị huy hiệu `Tự gửi` (`data-schedule-kind="calendar_digest"`) trong `ScheduleSection.tsx` và `ScheduleMoment.tsx`, nhãn trạng thái tiếng Việt cho `digest_sent` / `digest_failed` trong `schedule-text.ts`, và nút `Lập lại kế hoạch` cho lượt `digest_failed` trong `ScheduleRunRecovery.tsx`.

## Bằng chứng kiểm thử (PostgreSQL 16 + Vitest + TypeScript)
- `npm --prefix packages/tool-schemas test`: **17 test files, 341 tests passed** (exit code 0).
- `npm --prefix packages/tool-adapters test`: **19 Vitest files (460 tests) + 32 Node probe tests passed** (exit code 0).
- `npm --prefix packages/planner test`: **27 test files, 381 tests passed** (exit code 0, giữ nguyên 33 tools và SHA-256 prompt).
- `npm --prefix packages/executor test`: **5 test files, 42 tests passed** (exit code 0).
- `DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3" npm --prefix apps/chat-api test`: **110 test files, 794 tests passed** (exit code 0).
- `npm --prefix apps/chat-web test`: **81 test files, 899 tests passed** (exit code 0).
- `npm run typecheck:v3`: **exit code 0** (0 lỗi TypeScript trên cả `apps/chat-api` và `apps/chat-web`).
