# OAUTH-02 · Google Calendar của riêng bạn kèm chọn phạm vi lịch

**Trạng thái:** đã chốt thiết kế qua `/brainstorming` ngày 27/10/2026 (Phương án 2 + Option A chọn lịch ngay trên màn callback) · **Nhánh gợi ý:** `feat/oauth-02-backend`, `feat/oauth-02-web`, `eval/oauth-02-measure` · **Phụ thuộc:** OAUTH-01 (#172), SCHED-03 (#171) · **Mốc:** mã merge **trước 01/11** (mốc cắt); đo, nghiệm thu, bật cờ trước 04/11/2026
**Đặc tả:** [`2026-10-26-oauth-02-personal-calendar-design.md`](../../superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md), đọc hết trước khi làm. Quy tắc của dịch vụ riêng: [GMAIL-common](GMAIL-common.md).
**Có phần việc của con người:** cấu hình Google Cloud (bước 0), nghiệm thu thật (bước 4).

## Mục tiêu

Khi `MYCALENDAR_ENABLED=on`, mỗi người kết nối Google Calendar của chính mình:
- từ `/settings` hoặc ngay trong hội thoại (`RefusalMoment` kèm `returnTo`);
- ngay sau khi Google redirect về `/connections/mycalendar/callback`, chọn các lịch trong tài khoản được phép sử dụng (`allowedCalendars`, gợi ý chọn sẵn lịch chính `primary`); trước khi lưu phạm vi lịch, kết nối ở trạng thái `scope_required`;
- lập kế hoạch đọc danh sách lịch (`mycalendar.list_calendars`), đọc sự kiện (`mycalendar.list_events`) và tạo sự kiện (`mycalendar.create_event`) trên đúng những lịch đã chọn;
- duyệt kế hoạch (hiển thị rõ tên lịch đích và `<email>`) rồi chạy.

Calendar chung (`calendar.*`) không đổi. Cờ tắt thì hệ thống không đổi từng byte.

## Việc cần làm

0. **Google Cloud** (nhóm trưởng):
   - tạo Google Cloud project **riêng**, khác project Gmail và đăng nhập, rồi bật Google Calendar API;
   - trong project Calendar riêng, tạo client OAuth web, redirect `/connections/mycalendar/callback`;
   - thêm quyền `calendar.events` và `calendar.readonly` vào màn đồng ý (Testing, cùng test user);
   - ghi `MYCALENDAR_OAUTH_*` vào `.env` ở máy, bao gồm `MYCALENDAR_OAUTH_PROJECT_ID`, và khai báo `GMAIL_OAUTH_PROJECT_ID` nếu client Gmail đã có cấu hình. Đối chiếu client thuộc project tương ứng trên Google Cloud. Live từ chối thiếu project ID, cùng project hoặc cùng client. Ghi hai project id và client id (không ghi secret) trong bằng chứng; không commit `.env`.
1. **PR 1, backend** (đặc tả mục 4, 5):
   - `MYCALENDAR_SERVICE`, `MYCALENDAR_TOOLS` (`mycalendar.list_calendars`, `mycalendar.list_events`, `mycalendar.create_event` với `'x-resource': 'mycalendar'`), `PlanConnections.mycalendar`; cờ và biến môi trường; migration `0012_mycalendar_personal_connections.sql`;
   - tổng quát hoá client OAuth, quản lý token, kho kết nối cá nhân và các route `/api/connections/mycalendar` (`POST /start`, `POST /callback`, `GET /calendars`, `PUT /scope`, `DELETE /`). Bộ test Gmail đạt không sửa assertion;
   - `PersonalCalendarAdapter` kiểm tra `allowedScope.calendars` cùng adapter giả cho sandbox; máy chủ giả `scripts/fake-google-gmail.mjs` thêm `/calendar/v3/users/me/calendarList` và các endpoint sự kiện;
   - `AdapterFactory`, catalog và registry của người gọi, `ChatService.bindConnections`, `resourceLabels`, executor và recovery, `GET /api/services` (`not_connected | scope_required | connected | reconnect_required`), `/api/health`.
2. **PR 2, giao diện** (đặc tả mục 6):
   - màn callback `/connections/mycalendar/callback` hiển thị ngay bộ chọn lịch (tick gợi ý sẵn lịch chính, nút *"Lưu lịch được dùng & quay lại hội thoại"* hoặc *"Lưu lịch được dùng"*), hỗ trợ cả `?mode=select` khi đang ở `scope_required`;
   - hàng "Google Calendar của bạn" ở `/settings#mycalendar` kèm hiển thị badge các lịch đã chọn và nút *"Chọn lại lịch được dùng"*;
   - nút ở `RefusalMoment` (`Kết nối Google Calendar` khi `not_connected`, `Chọn lịch Google Calendar` khi `scope_required`, `Kết nối lại Google Calendar` khi `reconnect_required`, `Gửi lại yêu cầu` khi `connected`);
   - nhãn tên lịch đích và `<email>` ở `PlanMoment` và `ReceiptMoment`; `/privacy`;
   - nhóm browser `mycalendar` trong `scripts/test-v3-browser.mjs` (đặt `MYCALENDAR_ENABLED=on` chỉ cho nhóm này), cùng ca `MYCALENDAR off:` ở nhóm default.
3. **Đo** (đặc tả mục 8.3):
   - `cases-mycalendar.json`, 8 câu, commit và push label **trước mọi lời gọi model**;
   - `EVAL_SET=mycalendar` ×3;
   - báo cáo ở `docs/ai-evidence/V3-GOLDEN-V2/<ngày>-OAUTH-02-REPORT.md`.
4. **Nghiệm thu thật** (nhóm trưởng thao tác, agent ghi theo câu lệnh P-LIVE):
   - kết nối và chọn phạm vi lịch; tạo một sự kiện trong lịch đã chọn của tài khoản thử; đọc lại;
   - ngắt kết nối, kiểm token đã thu hồi và **Gmail vẫn kết nối**.

   Bằng chứng ở `docs/ai-evidence/MYCALENDAR-LIVE/`, không commit; thêm thư mục này vào `.gitignore` ở PR 1.
5. **PR bật cờ** nếu đạt quy tắc ở đặc tả mục 8.3, trước 04/11.

## Test tối thiểu

- **Cờ tắt:** SHA-256 prompt và catalog bằng giá trị trước task; routing 116 câu; không có route hay trường health mới.
- **Gmail, OAUTH-01:** các test hiện có đạt, không sửa assertion.
- **PostgreSQL thật:**
  - state một lần;
  - callback lưu trạng thái `scope_required` (`selectedCalendars: []`), chưa mở `MYCALENDAR_TOOLS`;
  - `GET /calendars` và `PUT /scope` xác minh danh sách lịch ghi được từ Google và chuyển sang `connected`;
  - callback cũ không ghi đè kết nối mới;
  - đăng xuất giữa chừng → `401 INVALID_SESSION`;
  - `invalid_grant` → `reconnect_required` của đúng `mycalendar`;
  - ngắt Calendar không đổi dòng Gmail;
  - thực thi với `credentialId` khác hoặc `calendarId` đã bị bỏ khỏi `allowedCalendars` → từ chối.
- **Adapter:** chặn mọi `calendarId` ngoài `allowedScope.calendars`; 401 → làm mới một lần; lỗi trước khi gửi → `requestSent: false`; treo sau khi gửi → `UNKNOWN`; huỷ bằng `AbortSignal` thật.
- **Browser** nhóm `mycalendar`: kết nối từ `/settings` + chọn lịch + đổi lại lịch; kết nối trong hội thoại → chọn lịch trên callback → quay về hội thoại → gửi lại yêu cầu → duyệt tạo sự kiện; xử lý trạng thái `scope_required` từ `RefusalMoment`; 1440/375 sáng/tối.

## Đột biến

- Rơi về service account chung khi chưa kết nối riêng.
- Cho phép `mycalendar.*` khi kết nối còn ở `scope_required` (`selectedCalendars` rỗng).
- Bỏ kiểm tra `calendarId ∈ allowedCalendars` ở `PUT /scope`, `bindConnections`, `AdapterFactory` hoặc `PersonalCalendarAdapter`.
- Bỏ kiểm `connections.mycalendar.credentialId` khi thực thi.
- Ngắt Calendar thu hồi cả Gmail.
- Cờ tắt vẫn thêm `MYCALENDAR_TOOLS` vào catalog.
- `create_event` gửi `attendees` hoặc `sendUpdates` khác `none`.
- Lỗi ghi sau khi gửi bị xếp `failed` thay vì `UNKNOWN`.

Ghi kết quả từng đột biến vào log.

## Tiêu chí nghiệm thu

- [x] RED trước GREEN; chạy lại 8/8 đột biến mục 8.2 trên source sửa `2be4696a`, đều bị bắt bằng assertion fail với exit code 1 và khôi phục khớp SHA-256; thêm 3/3 mutation mới cho review fixes.
- [x] `npm run check` và toàn bộ `npm run test:browser:v3` exit 0: 2.341 workspace tests, 406 eval, 134 browser passed / 1 skip có chủ đích trên 14 nhóm; không sửa assertion Gmail cũ.
- [ ] Label đã commit trước lời gọi model đầu tiên (`evaluations/golden/cases-mycalendar.json`, 8 câu; sửa label ở `e9fc6d7a`); đo model ×3 và báo cáo nguồn gốc còn `NOT_RUN`.
- [ ] Nghiệm thu thật đạt; quyết định bật cờ ghi trong log kèm số liệu (chờ nhóm trưởng cấu hình client Calendar trong Cloud project riêng và chạy P-LIVE).

## Ngoài phạm vi

- Sửa hoặc xoá sự kiện; mời người tham dự.
- OAuth cho Slack, GitHub, Notion, Jira, Trello.

## Kết quả (agent thi công điền)

- **Nhánh:** `feat/oauth-02-personal-calendar`, tách từ `main` `2888a9fe`; review tại `c774af3a`; label sửa riêng ở `e9fc6d7a`, mã sửa sáu lỗi ở `2be4696a`.
- **Kiểm thử & Đột biến:**
  - `npm run typecheck:v3`: exit 0.
  - `RUNTIME_MODE=sandbox npm run build:v3`: exit 0.
  - `npm run check`: exit 0, gồm toàn bộ các mục kiểm tra dưới đây và security/launcher/fixture checks.
  - `npm run test:v3`: **2.341 passed** (6 workspaces: `tool-schemas` 65, `tool-adapters` 425, `planner` 378, `executor` 42, `chat-api` 614, `chat-web` 817).
  - `npm run test:eval:v3`: **406 passed / 25 files**; test runner dùng fixture lịch cá nhân thật và kiểm accepted refusal/clarification chưa lookup không được chấm đạt.
  - Browser E2E toàn bộ: **134 passed / 1 skip có chủ đích / 14 nhóm**, gồm default 94 pass / 1 skip, Gmail 10/10, MyCalendar 7/7; có so sánh email tài khoản trên preview và receipt, viewport 1440/375 sáng/tối.
  - Đột biến bắt buộc (Spec §8.2): chạy lại **8/8 bị bắt** trên source sửa; thêm **3/3** mutation mới; mỗi file được khôi phục và đối chiếu SHA-256.
  - Review độc lập source `c774af3a..2be4696a`: không còn phát hiện quan trọng; reviewer tự chạy 85 focused tests, exit 0.
- **Số đo (`EVAL_SET=mycalendar`):** 8 câu (`mc01`–`mc06`, `mi01`–`mi02`), hai bản JSON đồng nhất; label sửa tại `e9fc6d7a` trước mọi lời gọi model. `mc04` kỳ vọng clarification theo chính sách chỉ đọc; injection nằm trong dữ liệu sự kiện và cần lookup thành công. **Model ×3 / báo cáo live: NOT_RUN.**
- **Nghiệm thu thật:** Chờ nhóm trưởng tạo client Calendar trong Google Cloud project riêng (redirect `/connections/mycalendar/callback`), đối chiếu với project Gmail, khai báo hai project ID và chạy P-LIVE (bằng chứng lưu tại `docs/ai-evidence/MYCALENDAR-LIVE/`, đã thêm vào `.gitignore`). Nếu đã tạo client trong project Gmail theo hướng dẫn cũ thì phải chuyển sang project riêng và kết nối lại.
- **Quyết định bật cờ:** Giữ `MYCALENDAR_ENABLED=off`; chỉ mở PR bật cờ sau khi model ×3 và P-LIVE đều đạt quy tắc đặc tả §8.3.
- **Log bàn giao:** [thi công ban đầu](../log/2026-10-27-OAUTH-02-personal-calendar.md), [sửa sau review và bằng chứng mới nhất](../log/2026-10-27-codex-OAUTH-02-review-fixes.md).
