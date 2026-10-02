# W3-02 · Google Calendar

**Trạng thái:** đang review · **Nhánh:** `vinhdat/feat-w3-02-google-calendar` · **Phụ thuộc:** W3-00 và W3-01 đã merge (dùng lại `google/service-account.ts`) · **Làm song song với:** W3-03, W3-04, W3-05

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
| `calendar.list_calendars` | read, `discovers: 'calendar'`, `listable` | `query` (có thể rỗng), `limit` ≤ 10 | `{ id, title, timeZone }` của lịch trong allowlist (`title` lấy từ `summary` của API) |
| `calendar.list_events` | read | `calendarId` (`x-resource: 'calendar'`), `timeMin`, `timeMax` (ISO 8601 có múi giờ, bắt buộc, khoảng ≤ 31 ngày), `query` (tùy chọn), `limit` ≤ 20 | `{ events: [{ id, title, start, end, url }] }` (`title` ← `summary`, `url` ← `htmlLink`); `singleEvents=true`, `orderBy=startTime`. Không `listable` (cần khoảng thời gian) |
| `calendar.create_event` | write, `riskLevel: 'medium'` | `calendarId`, `summary` (≤ 200 ký tự), `description` (tùy chọn, ≤ 4000), `start`, `end` (ISO 8601 có múi giờ), `location` (tùy chọn) | `{ id, title, url, start, end }` |

- `create_event` không có `attendees`, không gửi thông báo (`sendUpdates=none`).
- Kiểm tra trước khi gọi API (lỗi `VALIDATION`, số lần gọi `fetch` = 0): `end` sau `start`; độ dài ≤ 24 giờ; thời điểm có múi giờ rõ ràng.
- Thời gian tương đối ("3 giờ chiều thứ Sáu tuần sau") do planner đổi sang ISO dựa trên ngữ cảnh ngày giờ đã có (`date-context.ts`, `APP_TIME_ZONE`). Không sửa prompt trong task này; nếu test cho thấy model không đổi được thì ghi lại để W3-06 đo.

## Ca định tuyến dễ nhầm (thêm vào test)

- "Xem lịch sử commit của repo ati-test" → GitHub, không có Calendar.
- "Báo lên Slack là cuộc họp dời sang 3 giờ" khi Calendar **chưa cấu hình** → Slack, không bị từ chối.
- "Đặt lịch họp review lúc 15h thứ Sáu và báo kênh ati-test" → Calendar + Slack.

## Sandbox

Kịch bản `calendar_slack`: tạo sự kiện → báo Slack kèm `url` và giờ bắt đầu của step trước.

## Ảnh hưởng tới golden set

Câu `rf06` của bộ 50 câu ("Schedule a Google Calendar meeting with the frontend team tomorrow at 3pm") đang có label `refusal` vì trước đây chưa có Calendar. Task này **không sửa label**; W3-06 xử lý trong commit riêng trước khi chạy model. Ghi điều này trong PR.

Ngày 02/10/2026, người dùng đã chấp thuận ngoại lệ định tuyến cho đúng câu này: Calendar đã đăng ký nhưng catalog chỉ có Trello/Slack/GitHub → `[]`; catalog đầy đủ → đúng `['calendar']`. `routing-exceptions.json` và guard W3-00 ràng buộc ID, nguồn, prompt, label và hai cấu hình catalog; không nới cho các câu khác. Khi thêm Calendar, cập nhật snapshot định tuyến trong **commit riêng** và giải thích thay đổi của `rf06` trong PR. Khi W3-06 đổi label, phải xử lý ngoại lệ và test liên quan cùng commit; không giữ ngoại lệ `refusal` cho ca đã thành workflow.

## Tiêu chí riêng (ngoài tiêu chí chung)

- [x] Test kiểm tra thời gian: `end` trước `start`, quá 24 giờ, thiếu múi giờ đều bị từ chối trước khi gọi API.
- [x] Test `list_events` từ chối khoảng thời gian > 31 ngày.
- [x] Test body `create_event` không có `attendees` và query có `sendUpdates=none`.
- [x] Test hai service Google (Sheets, Calendar) cấu hình cùng service account vẫn lấy hai token đúng scope.

## Kết quả (agent thi công điền)

- PR: [#31](https://github.com/VinhDat267/ATI_Project/pull/31), triển khai và sửa review xong; chưa merge, trạng thái CI head cuối theo PR.
- Commit: implementation `6979777d7f21b55a31563ff828ef02ca9f3121c6`; snapshot riêng `93cd06cb41099ccb71f375115a4e319f86feff1b`; hardening ID `eededde64e9add0701efe2e2c0a4ae2dddc33dd5`; pagination `e426215575a062f13b15be002ec5f5c8556527ae`.
- Tài liệu API đã đọc ngày **2026-10-02**: [calendars.get](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/get), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events), [CalendarList resource](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList), [errors](https://developers.google.com/workspace/calendar/api/guides/errors), [quota](https://developers.google.com/workspace/calendar/api/guides/quota). Events scope + readonly cho metadata lịch; limiter nội bộ bảo thủ 60 request/phút/account, không coi đây là quota được cấp cho tài khoản thật.
- Test đã chạy: RED foundation5/6, adapter36/36, HTTP/PostgreSQL/sandbox3/3, browser1/1, live CLI6/6; GREEN tương ứng exit0. Dot-segment RED2/38 → GREEN39/39 cùng schema; pagination RED2/40 → GREEN40/40. Snapshot RED1/15 → GREEN15/15; guard không có legacy regression khác rf06.
- Full `npm run check` after review fix: **677 v3** (42 schema,149 adapters,138 planner,25 executor,162 API,161 web) +**91 offline eval**, exit0; typecheck/build/secret scan, launcher1/local-env3 đạt. Strict Calendar/Sheets/Google test + evaluation harness tsc exit0. Browser PostgreSQL/sandbox **11/11 exit0** after fix.
- Independent review: Critical0, Important1 fixed in one TDD pass, Minor0, eight bounded edge-probe groups passed; ten explicitly declined behaviors are recorded in the SDD ledger. Long `Retry-After` now returns typed `RATE_LIMIT` before a second dispatch when the requested wait exceeds 30 seconds.
- Điều chưa làm: Google live/model **NOT_RUN**; thời gian tương đối với model thật dành W3-06; chỉ search mode llm, không thêm gather regex. Label `rf06=refusal` và exception guard giữ nguyên cho W3-06.
- Chốt bàn giao **2026-10-03**: review độc lập toàn nhánh `716f568..441f485`, Critical0/Important1/Minor0; reviewer chạy lại check675+91, strict harness và browser11/11 exit0. Important đã sửa tại `008969073906f279d5ef75578c6dc4ae8f032ec3`: RED2failed/42 → GREEN42/42, fullcheck **677 v3 +91 eval**, strict harness và browser **11/11**, exit0. Không re-review; kết luận sau sửa dựa trên regression và full suite. Không có minor cần hoãn.
- CI `441f485` SUCCESS run37030150912. CI headfix0089690 từng lỗi Playwright đọc body response đã bị navigation bỏ qua ở test reload cũ; lần chạy sau bị hủy trong cài Chromium, nên không coi hai lần đó là PASS. Kiểm tra lại CI head cuối trước khi chuyển PR sang ready.
- Khác biệt: rate-limit 403 chỉ với hai reason được Google tài liệu hóa → RATE_LIMIT, Retry-After + tối đa một retry; các 403 khác AUTH_ERROR. Live CLI check dùng directory hợp đồng đã đăng ký (giữ child checks) thay nhánh cố định GitHub vốn làm service mới thất bại; khôi phục import discovery cũ còn thiếu. Description escape HTML; ISO yêu cầu giây/múi giờ; location≤1000; explicit calendar ID, không alias primary/dot-segment. List events theo nextPageToken, tối đa 20 trang rồi báo lỗi thay vì trả danh sách thiếu âm thầm.
