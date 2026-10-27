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
   - trong project của Gmail, bật Google Calendar API;
   - tạo client OAuth **thứ hai** (web), redirect `/connections/mycalendar/callback`;
   - thêm quyền `calendar.events` và `calendar.readonly` vào màn đồng ý (Testing, cùng test user);
   - ghi `MYCALENDAR_OAUTH_*` vào `.env` ở máy, không commit. Ghi project id và client id (không ghi secret) trong bằng chứng.
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

- [x] RED trước GREEN; đột biến đều bị bắt (8/8 đột biến tại mục 8.2 đều bị bắt với exit code 1 và khôi phục khớp SHA-256).
- [x] `npm run check` (`typecheck:v3`, `build:v3`, `test:v3`, `test:eval:v3`) và `npm run test:browser:v3` (`SCENARIO=mycalendar` 7/7 + `SCENARIO=default` `MYCALENDAR off:` 1/1) exit 0, không sửa assertion cũ.
- [x] Label commit trước lời gọi model đầu tiên (`evaluations/golden/cases-mycalendar.json` 8 câu); báo cáo đủ nguồn gốc.
- [ ] Nghiệm thu thật đạt; quyết định bật cờ ghi trong log kèm số liệu (chờ nhóm trưởng cấu hình Google Cloud OAuth Client thứ hai và chạy P-LIVE).

## Ngoài phạm vi

- Sửa hoặc xoá sự kiện; mời người tham dự.
- OAuth cho Slack, GitHub, Notion, Jira, Trello.

## Kết quả (agent thi công điền)

- **Nhánh:** `feat/oauth-02-personal-calendar` (tách từ `main` `2888a9fe`, 8 commits từ đặc tả + kế hoạch qua 6 tasks SDD: `cb968542..4b82133`).
- **Kiểm thử & Đột biến:**
  - `npm run typecheck:v3`: exit 0.
  - `RUNTIME_MODE=sandbox npm run build:v3`: exit 0.
  - `npm run test:v3`: **2.304 passed** (6 workspaces: `tool-schemas` 74, `tool-adapters` 425, `planner` 393, `executor` 42, `chat-api` 564, `chat-web` 806).
  - `npm run test:eval:v3`: **394 passed** (24 files, bao gồm `golden.test.ts` với `cases-mycalendar.json` và `static-guard.test.ts`).
  - Browser E2E (`scripts/test-v3-browser.mjs`): `SCENARIO=mycalendar` **7/7 passed** (4 flows × 1440/375 sáng/tối), `SCENARIO=default GREP="MYCALENDAR off:"` **1/1 passed**.
  - Đột biến bắt buộc (Spec §8.2): **8/8 bị bắt** (M1–M8 đều fail đúng assertion với exit code 1, khôi phục khớp SHA-256).
- **Số đo (`EVAL_SET=mycalendar`):** Đã commit 8 câu chuẩn (`mc01`–`mc06`, `mi01`–`mi02`) tại `evaluations/golden/cases-mycalendar.json` và `evaluations/golden-v2/cases-mycalendar.json` (pass `golden.test.ts` 4/4). Đo live model ×3 sẽ chạy cùng bước nghiệm thu thật khi có khóa môi trường.
- **Nghiệm thu thật:** Chờ nhóm trưởng tạo OAuth Client thứ hai trên Google Cloud Project (`/connections/mycalendar/callback`) và chạy P-LIVE (bằng chứng lưu tại `docs/ai-evidence/MYCALENDAR-LIVE/`, đã thêm vào `.gitignore`).
- **Quyết định bật cờ:** Mặc định `MYCALENDAR_ENABLED=off`; sẵn sàng bật sau khi hoàn tất P-LIVE.
- **Log bàn giao:** [`docs/handoff/log/2026-10-27-OAUTH-02-personal-calendar.md`](../log/2026-10-27-OAUTH-02-personal-calendar.md).
