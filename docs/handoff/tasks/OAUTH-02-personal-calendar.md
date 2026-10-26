# OAUTH-02 · Google Calendar của riêng bạn (tuỳ chọn)

**Trạng thái:** **chờ nhóm trưởng quyết ngày 29/10**; mặc định bỏ ([FINISH-PLAN](../FINISH-PLAN.md) mục 4) · **Nhánh gợi ý:** `feat/oauth-02-backend`, `feat/oauth-02-web`, `eval/oauth-02-measure` · **Phụ thuộc:** OAUTH-01 (#172), PR bật cờ GMAIL-04, SCHED-03 (#171), xem đặc tả mục 1.1 · **Mốc:** mã merge **trước 01/11** (mốc cắt); đo, nghiệm thu, bật cờ trước 04/11/2026
**Đặc tả:** [`2026-10-26-oauth-02-personal-calendar-design.md`](../../superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md), đọc hết trước khi làm. Quy tắc của dịch vụ riêng: [GMAIL-common](GMAIL-common.md).
**Có phần việc của con người:** cấu hình Google Cloud (bước 0), nghiệm thu thật (bước 4).

## Mục tiêu

Khi `MYCALENDAR_ENABLED=on`, mỗi người kết nối Google Calendar của chính mình:
- từ `/settings` hoặc ngay trong hội thoại;
- lập kế hoạch đọc sự kiện và tạo sự kiện trong **lịch chính** của mình;
- duyệt rồi chạy.

Calendar chung (`calendar.*`) không đổi. Cờ tắt thì hệ thống không đổi từng byte.

## Việc cần làm

0. **Google Cloud** (nhóm trưởng, sáng 29/10):
   - trong project của Gmail, bật Google Calendar API;
   - tạo client OAuth **thứ hai** (web), redirect `/connections/mycalendar/callback`;
   - thêm quyền `calendar.events` vào màn đồng ý (Testing, cùng test user);
   - ghi `MYCALENDAR_OAUTH_*` vào `.env` ở máy, không commit. Ghi project id và client id (không ghi secret) trong bằng chứng.
1. **PR 1, backend** (đặc tả mục 4, 5):
   - `MYCALENDAR_SERVICE`, `MYCALENDAR_TOOLS`, `PlanConnections.mycalendar`; cờ và biến môi trường; migration 0012;
   - tổng quát hoá client OAuth, quản lý token, route kết nối theo mã dịch vụ. Bộ test Gmail đạt không sửa assertion; nếu không được thì chép route, theo đặc tả 5.1;
   - `PersonalCalendarAdapter` cùng adapter giả cho sandbox; máy chủ giả của Gmail thêm danh tính Calendar;
   - `AdapterFactory.personalAdapter`, catalog và registry của người gọi, `bindConnections`, executor và recovery, `GET /api/services`, `/api/health`.
2. **PR 2, giao diện** (đặc tả mục 6):
   - hàng ở `/settings`; callback; nút ở màn từ chối; nhãn ở màn duyệt và biên nhận; `/privacy`;
   - nhóm browser `mycalendar` trong `scripts/test-v3-browser.mjs` (đặt `MYCALENDAR_ENABLED=on` chỉ cho nhóm này), cùng ca `MYCALENDAR off:` ở nhóm default.
3. **Đo** (đặc tả mục 8):
   - `cases-mycalendar.json`, 8 câu, commit và push label **trước mọi lời gọi model**;
   - `EVAL_SET=mycalendar` ×3;
   - báo cáo ở `docs/ai-evidence/V3-GOLDEN-V2/<ngày>-OAUTH-02-REPORT.md`.
4. **Nghiệm thu thật** (nhóm trưởng thao tác, agent ghi theo câu lệnh P-LIVE):
   - kết nối; tạo một sự kiện trong lịch chính của tài khoản thử; đọc lại;
   - ngắt kết nối, kiểm token đã thu hồi và **Gmail vẫn kết nối**.

   Bằng chứng ở `docs/ai-evidence/MYCALENDAR-LIVE/`, không commit; thêm thư mục này vào `.gitignore` ở PR 1.
5. **PR bật cờ** nếu đạt quy tắc ở đặc tả mục 8, trước 04/11.

## Test tối thiểu

- **Cờ tắt:** SHA-256 prompt và catalog bằng giá trị trước task; routing 116 câu; không có route hay trường health mới.
- **Gmail, OAUTH-01:** các test hiện có đạt, không sửa assertion.
- **PostgreSQL thật:**
  - state một lần;
  - callback cũ không ghi đè kết nối mới;
  - đăng xuất giữa chừng → `401 INVALID_SESSION`;
  - `invalid_grant` → `reconnect_required` của đúng `mycalendar`;
  - ngắt Calendar không đổi dòng Gmail;
  - thực thi với `credentialId` khác → từ chối.
- **Adapter:** 401 → làm mới một lần; lỗi trước khi gửi → `requestSent: false`; treo sau khi gửi → `UNKNOWN`; huỷ bằng `AbortSignal` thật.
- **Browser** nhóm `mycalendar`: kết nối từ `/settings`; kết nối trong hội thoại rồi quay về và gửi lại yêu cầu; duyệt tạo sự kiện; 1440/375 sáng/tối.

## Đột biến

- Rơi về service account chung khi chưa kết nối riêng.
- Bỏ kiểm `connections.mycalendar.credentialId` khi thực thi.
- Ngắt Calendar thu hồi cả Gmail.
- Cờ tắt vẫn thêm `MYCALENDAR_TOOLS` vào catalog.
- `create_event` gửi `attendees` hoặc `sendUpdates` khác `none`.
- Lỗi ghi sau khi gửi bị xếp `failed` thay vì `UNKNOWN`.

Ghi kết quả từng đột biến vào log.

## Tiêu chí nghiệm thu

- [ ] RED trước GREEN; đột biến đều bị bắt.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0, không sửa assertion cũ.
- [ ] Label commit trước lời gọi model đầu tiên; báo cáo đủ nguồn gốc.
- [ ] Nghiệm thu thật đạt; quyết định bật cờ ghi trong log kèm số liệu.

## Ngoài phạm vi

- Lịch khác ngoài `primary`; sửa hoặc xoá sự kiện; mời người tham dự.
- OAuth cho Slack, GitHub, Notion, Jira, Trello.

## Kết quả (agent thi công điền)

- PR:
- Số đo:
- Nghiệm thu thật:
- Quyết định bật cờ:
