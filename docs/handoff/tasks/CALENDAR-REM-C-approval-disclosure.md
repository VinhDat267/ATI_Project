# CALENDAR-REM-C · Đồng bộ hiển thị lời mời họp / múi giờ khi phê duyệt kế hoạch & công bố phạm vi OAuth Google Calendar

**Trạng thái:** Sẵn sàng review Draft PR · **Nhánh:** `VinhDat267/calendar-rem-v2-ui-argon` · **Baseline:** `2eed8d1d4309e833088d6f1d3fa774189049e283` · **Ngày:** 10/11/2026.

## Phạm vi

Khắc phục hai phát hiện đã xác nhận trong đợt kiểm toán độc lập Google Calendar v3 (`CALENDAR-AUDIT-07` và `CALENDAR-AUDIT-09`) trong phạm vi sở hữu của Worker C:

1. **`CALENDAR-AUDIT-07` — Đồng bộ hiển thị lời mời họp (`sendInvites`) và múi giờ (`timeZone`) giữa giao diện phê duyệt (`PlanMoment.tsx`, `PreviewContents.tsx`) và tầng transport (`PersonalCalendarAdapter`):**
   - Tầng adapter (`packages/tool-adapters/src/calendar/personal-calendar-adapter.ts`) giữ nguyên quy tắc nghiêm ngặt: chỉ gửi `sendUpdates=all` khi `step.args.sendInvites === true`; khi `sendInvites` là `undefined` hoặc `false` thì gửi `sendUpdates=none`.
   - Tại `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`: sửa điều kiện hiển thị nhãn `📨 Gửi email mời họp` thành `attendees.length > 0 && step.args.sendInvites === true`. Khi có `attendees` nhưng `step.args.sendInvites !== true` (`undefined` hoặc `false`), hiển thị nhãn rõ ràng `🔕 Không gửi email mời họp`. Khi có `step.args.timeZone` hợp lệ, hiển thị nhãn `🌐 Múi giờ: {timeZone}` mà không tự suy diễn từ múi giờ trình duyệt.
   - Tại `apps/chat-web/src/pages/Cockpit/PreviewContents.tsx`: đồng bộ thẻ xem trước `calendar_event` hiển thị danh sách khách mời (`👤 {email}`), trạng thái gửi lời mời (`📨 Gửi email mời họp cho khách mời` khi `sendInvites === true` hoặc `🔕 Không gửi email mời họp` khi `sendInvites !== true`), hiển thị `Múi giờ: {timeZone}` trong khối `Thời gian sự kiện` khi được truyền, và đưa `sendInvites`, `timeZone` vào danh sách `except` của `OtherArguments` để không hiển thị trùng hoặc gây hiểu nhầm khi không có khách mời.
2. **`CALENDAR-AUDIT-09` — Công bố trung thực phạm vi OAuth Google Calendar và cơ chế ngắt kết nối tại `apps/chat-web/src/pages/Privacy/PrivacyPage.tsx` (dòng 469–474 baseline):**
   - Sau khi Coordinator xác nhận giải phóng hold sở hữu mục Google Calendar (`msg_f3e21b11408f`, đối chiếu với worker Sheets `msg_71d7a1611ed0`), cập nhật đúng phạm vi dòng `469–474` tại `PrivacyPage.tsx`:
     - Nêu đúng hai phạm vi OAuth thực tế trong `MYCALENDAR_SCOPE` (`calendar.readonly` và `calendar.events`), loại bỏ thông tin sai lệch `calendar.calendarlist.readonly`.
     - Phân biệt rõ quyền OAuth do Google cấp với cơ chế giới hạn danh sách lịch được phép (`allowedCalendars`) ở tầng ứng dụng Planora.
     - Loại bỏ cam kết tuyệt đối thiếu điều kiện (`sẽ bị thu hồi hoàn toàn`); giải thích rõ khi ngắt kết nối, Planora xoá token cùng phạm vi lịch đã lưu và gửi yêu cầu thu hồi token tới Google (hội thoại và kế hoạch cũ vẫn được giữ lại), đồng thời người dùng có thể kiểm tra hoặc gỡ quyền trực tiếp trong trang quản lý quyền của tài khoản Google (Google Account).

## Tiêu chí bàn giao

- [x] Tuân thủ TDD: viết bài kiểm thử hành vi mong muốn trước (`calendar-rem-c-07-invitation-preview.test.tsx`, `calendar-rem-c-09-oauth-disclosure.test.tsx`), ghi nhận log RED (`EXIT_CODE=1`) trên đúng commit baseline `2eed8d1d4309e833088d6f1d3fa774189049e283` trước khi sửa mã sản phẩm.
- [x] Kiểm tra đối chiếu trực tiếp truy vấn HTTP thực tế của `PersonalCalendarAdapter` (`sendUpdates=none` vs `sendUpdates=all` qua máy chủ loopback `127.0.0.1`) với nhãn hiển thị trên `PlanMoment` và `PreviewContents` cho đầy đủ tổ hợp `sendInvites: undefined | false | true` × có/không có `attendees`.
- [x] Toàn bộ kiểm thử đơn vị và liên đới (`7/7` file test — `70/70` tests), `evaluations/generic-plumbing/static-guard.test.ts` (`2/2` PASS), `npm run typecheck:v3` (`EXIT_CODE=0`), `node scripts/test-v3-web-build-security.mjs` (`EXIT_CODE=0`) và kịch bản Playwright `SCENARIO=mycalendar` (`8/8` PASS trên DB độc lập `127.0.0.1:56653`) đều đạt `EXIT_CODE=0`.
- [x] Chỉ chạm các file thuộc phạm vi sở hữu của Worker C; không sửa `docs/handoff/CURRENT-STATE.md` hoặc `docs/handoff/ROADMAP.md`.

## Kết quả

Hoàn tất sửa lỗi `CALENDAR-AUDIT-07` và `CALENDAR-AUDIT-09` trên nhánh `VinhDat267/calendar-rem-v2-ui-argon` từ baseline `2eed8d1d4309e833088d6f1d3fa774189049e283`. Kết quả kiểm thử thực tế:
- Pha RED trên baseline `2eed8d1d4309e833088d6f1d3fa774189049e283`: `calendar-rem-c-07-invitation-preview.test.tsx` (`6/7` failed, `EXIT_CODE=1`), `calendar-rem-c-09-oauth-disclosure.test.tsx` (`1/1` failed, `EXIT_CODE=1`).
- Pha GREEN sau khi sửa:
  - `npx vitest run tests/calendar-rem-c-07-invitation-preview.test.tsx tests/calendar-rem-c-09-oauth-disclosure.test.tsx` (`2/2` files, `8/8` tests PASS, `EXIT_CODE=0`).
  - Suite liên đới `@wap/chat-web` (`tests/mycalendar-ui.test.tsx`, `tests/mycalendar-review-fixes.test.tsx`, `tests/fe-10-guide-privacy.test.tsx`, `tests/mysheets-ui.test.tsx`, `tests/gmail-public.test.tsx` cùng 2 file mới: `7/7` files, `70/70` tests PASS, `EXIT_CODE=0`).
  - `npx vitest run evaluations/generic-plumbing/static-guard.test.ts` (`2/2` tests PASS, `EXIT_CODE=0`).
  - `npm run typecheck:v3` (`EXIT_CODE=0`).
  - `node scripts/test-v3-web-build-security.mjs` (`EXIT_CODE=0`).
  - Playwright Browser E2E `SCENARIO=mycalendar` trên PostgreSQL 16 độc lập cổng `127.0.0.1:56653` (`8/8` tests PASS, `EXIT_CODE=0`).
- Chi tiết bằng chứng được lưu tại [log bàn giao](../log/2026-11-10-calendar-rem-c-approval-disclosure.md) và thư mục bằng chứng độc lập `C:/Users/VinhDat/orca/workspaces/ATI_Project/calendar-remediation-v2-evidence-20261110/workers/C/`.
