# W3-02 · Google Calendar

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w3-02-google-calendar` · **Phụ thuộc:** W3-00 và W3-01 đã merge (dùng lại `google/service-account.ts`) · **Làm song song với:** W3-03, W3-04, W3-05

Đọc trước: [yêu cầu chung cho task thêm service](W3-service-common.md). Card này chỉ ghi phần riêng của Google Calendar.

## Xác thực

- Dùng lại module service account của W3-01. `credentialFields` giống Sheets (`clientEmail`, `privateKey`), lưu riêng cho service `calendar` (người dùng có thể dùng cùng một service account).
- Scope token: `https://www.googleapis.com/auth/calendar.events` và `https://www.googleapis.com/auth/calendar.readonly` (kiểm lại trong tài liệu hiện hành xem `calendars.get` cần scope nào).
- Người dùng chia sẻ một lịch thử nghiệm cho email service account với quyền "Thay đổi sự kiện" (xem W3-07). Service account **không** mời được người khác vào sự kiện nếu không có domain-wide delegation; task này cũng không cho phép mời.

## Thiết kế service

- `id: 'calendar'`, `name: 'Google Calendar'`, `scopeKey: 'calendars'`, `scopeLabel: 'Calendar ID'`, `scopePattern` chấp nhận dạng email/ID của Google Calendar (ví dụ `…@group.calendar.google.com`); kiểm lại định dạng trong tài liệu.
- `intentKeywords`: `calendar`, `google calendar`, `lịch họp`, `lên lịch`, `đặt lịch`. `fallbackIntentKeywords`: `cuộc họp`, `họp`, `meeting`, `sự kiện`, `event` (các từ này hay xuất hiện trong nội dung tin nhắn Slack, nên chỉ dùng khi không service nào khác khớp).
- **Không** dùng `lịch` đơn lẻ: tiếng Việt tách âm tiết bằng khoảng trắng nên `lịch` khớp cả "lịch sử", "du lịch", "lịch sự".
- `checkConnection`: `calendars.get` cho lịch đầu tiên trong allowlist.

| Tool | Loại | Input | Output |
|---|---|---|---|
| `calendar.list_calendars` | read, `discovers: 'calendar'`, `listable` | `query` (có thể rỗng), `limit` ≤ 10 | `{ id, summary, timeZone }` của lịch trong allowlist |
| `calendar.list_events` | read | `calendarId` (`x-resource: 'calendar'`), `timeMin`, `timeMax` (ISO 8601 có múi giờ, bắt buộc, khoảng ≤ 31 ngày), `query` (tùy chọn), `limit` ≤ 20 | `{ events: [{ id, summary, start, end, htmlLink }] }`; `singleEvents=true`, `orderBy=startTime` |
| `calendar.create_event` | write, `riskLevel: 'medium'` | `calendarId`, `summary` (≤ 200 ký tự), `description` (tùy chọn, ≤ 4000), `start`, `end` (ISO 8601 có múi giờ), `location` (tùy chọn) | `{ id, htmlLink, start, end }` |

- `create_event` không có `attendees`, không gửi thông báo (`sendUpdates=none`).
- Kiểm tra trước khi gọi API (lỗi `VALIDATION`, số lần gọi `fetch` = 0): `end` sau `start`; độ dài ≤ 24 giờ; thời điểm có múi giờ rõ ràng.
- Thời gian tương đối ("3 giờ chiều thứ Sáu tuần sau") do planner đổi sang ISO dựa trên ngữ cảnh ngày giờ đã có (`date-context.ts`, `APP_TIME_ZONE`). Không sửa prompt trong task này; nếu test cho thấy model không đổi được thì ghi lại để W3-06 đo.

## Ca định tuyến dễ nhầm (thêm vào test)

- "Xem lịch sử commit của repo ati-test" → GitHub, không có Calendar.
- "Báo lên Slack là cuộc họp dời sang 3 giờ" khi Calendar **chưa cấu hình** → Slack, không bị từ chối.
- "Đặt lịch họp review lúc 15h thứ Sáu và báo kênh ati-test" → Calendar + Slack.

## Sandbox

Kịch bản `calendar_slack`: tạo sự kiện → báo Slack kèm `htmlLink` và giờ bắt đầu của step trước.

## Tiêu chí riêng (ngoài tiêu chí chung)

- [ ] Test kiểm tra thời gian: `end` trước `start`, quá 24 giờ, thiếu múi giờ đều bị từ chối trước khi gọi API.
- [ ] Test `list_events` từ chối khoảng thời gian > 31 ngày.
- [ ] Test body `create_event` không có `attendees` và query có `sendUpdates=none`.
- [ ] Test hai service Google (Sheets, Calendar) cấu hình cùng service account vẫn lấy hai token đúng scope.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Tài liệu API đã đọc (đường dẫn, ngày):
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
