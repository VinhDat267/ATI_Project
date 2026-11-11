# 2026-11-10 · CALENDAR-REM-C: Đồng bộ hiển thị lời mời họp (`CALENDAR-AUDIT-07`) và công bố OAuth Google Calendar (`CALENDAR-AUDIT-09`)

- **Task card:** [`docs/handoff/tasks/CALENDAR-REM-C-approval-disclosure.md`](../tasks/CALENDAR-REM-C-approval-disclosure.md)
- **Nhánh:** `VinhDat267/calendar-rem-v2-ui-argon`
- **Baseline SHA:** `2eed8d1d4309e833088d6f1d3fa774189049e283`
- **Phạm vi phát hiện xử lý:** `CALENDAR-AUDIT-07`, `CALENDAR-AUDIT-09` (trong đợt Google Calendar v3 Remediation v2 — Worker C).

## 1. Tóm tắt thay đổi

1. **`apps/chat-web/src/pages/Cockpit/PlanMoment.tsx` (`CALENDAR-AUDIT-07`):**
   - Đổi điều kiện `sendInvites` từ `attendees.length > 0 && step.args.sendInvites !== false` sang `attendees.length > 0 && step.args.sendInvites === true` để khớp tuyệt đối với `PersonalCalendarAdapter` (`sendUpdates = args.sendInvites === true ? 'all' : 'none'`).
   - Khi `attendees.length > 0 && step.args.sendInvites !== true` (`undefined` hoặc `false`), hiển thị pill `🔕 Không gửi email mời họp` để người dùng không hiểu nhầm rằng thêm khách mời sẽ tự động gửi email.
   - Khi `step.args.timeZone` là chuỗi hợp lệ, hiển thị pill `🌐 Múi giờ: {timeZone}` (không tự suy diễn từ múi giờ trình duyệt khi vắng mặt).
2. **`apps/chat-web/src/pages/Cockpit/PreviewContents.tsx` (`CALENDAR-AUDIT-07`):**
   - Trong khối `style === 'calendar_event'`, hiển thị rõ nhãn `📨 Gửi email mời họp cho khách mời` khi `attendees.length > 0 && step.args.sendInvites === true`, và `🔕 Không gửi email mời họp` khi `attendees.length > 0 && step.args.sendInvites !== true`.
   - Hiển thị `Múi giờ: {timeZone}` trong hộp `Thời gian sự kiện` khi `step.args.timeZone` được cung cấp.
   - Đưa `sendInvites` và `timeZone` vào danh sách `except` của `OtherArguments` (và bổ sung nhãn `timeZone: 'Múi giờ'` trong từ điển `names`) để không hiển thị bảng tham số thô gây nhiễu khi không có khách mời.
3. **`apps/chat-web/src/pages/Privacy/PrivacyPage.tsx` dòng 469–474 (`CALENDAR-AUDIT-09`):**
   - Thực hiện sau khi nhận thông báo giải phóng hold từ Coordinator (`msg_f3e21b11408f`, xác nhận không chồng lấn với worker Sheets `msg_71d7a1611ed0`).
   - Công bố chính xác 2 phạm vi OAuth runtime trong `MYCALENDAR_SCOPE` (`calendar.readonly` và `calendar.events`), bỏ câu mô tả sai `calendar.calendarlist.readonly`.
   - Làm rõ ranh giới giữa phạm vi OAuth do Google cấp và danh sách lịch được phép (`allowedCalendars`) do tầng ứng dụng Planora kiểm soát.
   - Thay câu hứa tuyệt đối `sẽ bị thu hồi hoàn toàn` bằng mô tả trung thực: khi ngắt kết nối, Planora xoá token cùng phạm vi lịch đã lưu và gửi yêu cầu thu hồi token tới Google (hội thoại và kế hoạch cũ vẫn được giữ lại), đồng thời người dùng có thể kiểm tra hoặc gỡ quyền trực tiếp trong trang quản lý quyền của tài khoản Google (Google Account).
4. **Kiểm thử mới & cập nhật E2E:**
   - `apps/chat-web/tests/calendar-rem-c-07-invitation-preview.test.tsx`: kiểm thử ma trận `sendInvites: undefined | false | true` × có/không có `attendees` và `timeZone` trên `PlanMoment`, `PreviewContents` đối chiếu trực tiếp với request HTTP thực tế của `PersonalCalendarAdapter` qua loopback server `127.0.0.1`.
   - `apps/chat-web/tests/calendar-rem-c-09-oauth-disclosure.test.tsx`: kiểm thử đối chiếu `MYCALENDAR_SCOPE` với nội dung hiển thị thực tế của mục Google Calendar trên `PrivacyPage`.
   - `apps/chat-web/tests/browser/mycalendar.spec.ts`: bổ sung kiểm tra `/privacy#mycalendar` trên cả desktop (`1440x900`) và mobile (`375x812`) ở chế độ sáng/tối không tràn ngang, đồng thời xác nhận không hiển thị nhãn `Gửi email mời họp` khi bước sự kiện không có khách mời.

## 2. Bằng chứng kiểm thử (RED → GREEN)

- **Pha RED (trên đúng baseline `2eed8d1d4309e833088d6f1d3fa774189049e283`, `git diff` rỗng):**
  - `npx vitest run tests/calendar-rem-c-07-invitation-preview.test.tsx` → `6 failed | 1 passed`, `EXIT_CODE=1` (`logs/red-07-invitation-preview.log`).
  - `npx vitest run tests/calendar-rem-c-09-oauth-disclosure.test.tsx` → `1 failed`, `EXIT_CODE=1` (`logs/red-09-oauth-disclosure.log`).
- **Pha GREEN (sau khi sửa):**
  - `npx vitest run tests/calendar-rem-c-07-invitation-preview.test.tsx` → `7 passed (7)`, `EXIT_CODE=0` (`logs/green-07-invitation-preview.log`).
  - `npx vitest run tests/calendar-rem-c-09-oauth-disclosure.test.tsx` → `1 passed (1)`, `EXIT_CODE=0` (`logs/green-09-oauth-disclosure.log`).
  - `npx vitest run tests/calendar-rem-c-07-invitation-preview.test.tsx tests/calendar-rem-c-09-oauth-disclosure.test.tsx tests/mycalendar-ui.test.tsx tests/mycalendar-review-fixes.test.tsx tests/fe-10-guide-privacy.test.tsx tests/mysheets-ui.test.tsx tests/gmail-public.test.tsx` → `7 passed (7 files)`, `70 passed (70 tests)`, `EXIT_CODE=0` (`logs/green-adjacent-web-suites.log`).
  - `npx vitest run evaluations/generic-plumbing/static-guard.test.ts` → `2 passed (2)`, `EXIT_CODE=0` (`logs/static-guard.log`).
  - `npm run typecheck:v3` → `EXIT_CODE=0` (`logs/typecheck-v3.log`).
  - `node scripts/test-v3-web-build-security.mjs` → `PASS: production build excludes credential sentinels and 8 forbidden UI claims`, `EXIT_CODE=0` (`logs/web-build-security.log`).
  - `SCENARIO=mycalendar node scripts/test-v3-browser.mjs` (trên PostgreSQL 16 độc lập `127.0.0.1:56653`, API `56654`, Web `56655`) → `8 passed (50.4s)`, `EXIT_CODE=0` (`logs/browser-mycalendar.log`).
