# OAuth phần 2: Google Calendar của riêng bạn (OAUTH-02)

**Trạng thái:** bản nháp, chờ nhóm trưởng quyết ngày 29/10/2026 **làm hay bỏ**. Mặc định là bỏ ([FINISH-PLAN](../../handoff/FINISH-PLAN.md) mục 4). Viết sẵn ngày 26/10 để, nếu chọn làm, có thể giao ngay mà không cần lập kế hoạch lại.
**Dựa trên:**
- [đặc tả Gmail theo kết nối riêng](2026-10-13-gmail-personal-connections-design.md) (GMAIL-01 → 03);
- [OAUTH-01](2026-10-25-oauth-connect-from-chat-design.md): kết nối ngay trong hội thoại, `return_to`.

## 1. Bối cảnh và quyết định

### 1.1. Khi nào làm

Chỉ làm nếu **sáng 29/10** đủ cả ba điều kiện:
- #172 (OAUTH-01) đã merge hoặc đã "Đạt";
- PR bật cờ Gmail của GMAIL-04 đã merge;
- SCHED-03 (#171) đã merge hoặc chỉ còn chờ kiểm lại.

Thiếu một điều kiện thì bỏ, và ghi vào báo cáo là hướng phát triển. **Mốc cắt 01/11:** nếu phần mã chưa merge thì đóng PR.

**Ước lượng:** 3 ngày công của một agent thi công (backend 1,5; giao diện 1; đo và nghiệm thu 0,5), cộng review. Lịch rất sát; đây là lý do mặc định là bỏ.

### 1.2. Vì sao một dịch vụ riêng, không thay Calendar chung

| Cách | Vì sao không chọn / chọn |
|---|---|
| Thay nguồn khoá của `calendar.*`: ai đã kết nối thì dùng token của người đó, chưa thì dùng service account chung | Không chọn. Cùng một câu chat cho ra kết quả khác nhau theo người; kịch bản demo Calendar → Slack (lịch chung) bị đổi nguồn; vi phạm quy tắc của Gmail "không rơi về khoá chung" |
| **Dịch vụ riêng `mycalendar`** ("Google Calendar của bạn"), tool riêng, sau cờ riêng | **Chọn.** Calendar chung giữ nguyên từng byte (catalog 33 tool/8 dịch vụ, các phép đo, kịch bản demo). Màn duyệt cho biết rõ ghi vào lịch của ai |

### 1.3. Vì sao một client OAuth riêng

Google gom quyền theo cặp **(người dùng, client OAuth)**. Nếu Calendar riêng dùng chung client với Gmail:
- ngắt kết nối Gmail gọi `revoke`, thu hồi cả grant của client đó, nên Calendar cũng mất quyền;
- kết nối lại một dịch vụ có thể làm đổi phạm vi quyền của dịch vụ kia.

Vì vậy dùng **client OAuth thứ hai** (loại web) **trong cùng Google Cloud project** của Gmail. Bật thêm Google Calendar API, và thêm quyền Calendar vào màn đồng ý (chế độ Testing, cùng danh sách test user).

### 1.4. Phạm vi hẹp

- Chỉ **lịch chính** (`primary`) của người đã kết nối. Không liệt kê, không chọn lịch khác, nên tool không có tham số `calendarId` và không cần allowlist.
- **Hai tool:**
  - `mycalendar.list_events` (đọc);
  - `mycalendar.create_event` (ghi; không mời ai, `sendUpdates=none`).
- **Không làm:** sửa hoặc xoá sự kiện; lịch khác ngoài `primary`; mời người tham dự; thông báo.

## 2. Những điều không được xảy ra

1. **Cờ `MYCALENDAR_ENABLED` tắt** (mặc định): không có gì đổi.
   - `ALL_TOOLS` vẫn 33 tool, `SERVICE_REGISTRY` vẫn 8 dịch vụ;
   - prompt giống từng byte, routing 116 câu không đổi;
   - không route `/api/connections/mycalendar`; `/api/health` không có trường mới.
2. Không bao giờ rơi về service account của Calendar chung, kể cả khi kết nối riêng hỏng.
3. Không ai, kể cả quản trị viên, dùng được lịch của người khác. Kế hoạch có bước `mycalendar.*` chỉ chạy bằng **đúng kết nối đã gắn lúc xem trước** (như `connections.gmail`).
4. Ngắt kết nối Gmail không làm mất kết nối Calendar riêng, và ngược lại.
5. Không có lệnh ghi nào tự chạy. Lượt của lịch chạy (SCHED) lập kế hoạch với kết nối của chủ lịch, và vẫn chờ duyệt.

## 3. Luồng người dùng

1. **Kết nối từ `/settings`:** nhóm "Của riêng bạn" có hàng "Google Calendar của bạn" với 4 trạng thái như hàng Gmail:
   - chưa kết nối;
   - đã kết nối · `<email>`;
   - cần kết nối lại;
   - đang xử lý.
2. **Kết nối ngay trong hội thoại** (theo OAUTH-01): câu "Thêm lịch họp 3 giờ chiều mai vào lịch của tôi" khi chưa kết nối → từ chối với `unavailableServices: [{ id: 'mycalendar', name: 'Google Calendar của bạn' }]` → nút "Kết nối Google Calendar" → quay về đúng hội thoại → "Gửi lại yêu cầu".
3. **Lập kế hoạch:** catalog của người gọi có `mycalendar.*` khi cờ bật và họ đã kết nối. Màn duyệt ghi "Ghi vào: lịch chính của `<email>`".
4. **Ngắt kết nối:** hộp xác nhận, thu hồi token ở Google (client riêng), xoá dòng kết nối.

## 4. Dữ liệu và cấu hình

### 4.1. Migration `db/v3/0012_mycalendar.sql` (chạy lại được)

- `oauth_states`:
  - mode thêm `connect_mycalendar`;
  - ràng buộc chủ sở hữu như `connect_gmail` (`user_id` và `session_id` khác NULL);
  - ràng buộc `return_to` của 0011 nhận cả `connect_mycalendar`.
- `service_credentials`: thêm ràng buộc `service <> 'mycalendar' OR user_id IS NOT NULL`.

### 4.2. Biến môi trường

- `MYCALENDAR_ENABLED`: `on`/`off`, mặc định `off`, giá trị khác là lỗi cấu hình.
- `MYCALENDAR_OAUTH_CLIENT_ID`, `MYCALENDAR_OAUTH_CLIENT_SECRET`, `MYCALENDAR_OAUTH_REDIRECT_URI` (`/connections/mycalendar/callback`).
- Sandbox thêm `MYCALENDAR_OAUTH_AUTH_URL`, `MYCALENDAR_OAUTH_TOKEN_URL`, `MYCALENDAR_OAUTH_REVOKE_URL`, `MYCALENDAR_API_BASE_URL`, trỏ tới máy chủ giả.
- Quy tắc như Gmail:
  - live, cờ `on` mà thiếu biến → lỗi khởi động;
  - không có PostgreSQL → tắt và cảnh báo;
  - sandbox thiếu endpoint giả → route trả 503.
- Quyền xin: `https://www.googleapis.com/auth/calendar.events`.
- `.env.example` thêm các biến (để trống).

### 4.3. Kiểu dữ liệu (`packages/tool-schemas`)

- `MYCALENDAR_SERVICE`: `connection: 'personal'`, ngoài `SERVICE_REGISTRY`, như `GMAIL_SERVICE`.
- `intentKeywords`: "lịch của tôi", "lịch của mình", "lịch cá nhân", "lịch riêng", "my calendar", "calendar của tôi". Router hiện có đã loại dịch vụ riêng khỏi nhánh dự phòng khi câu không nhắc tới.
- `MYCALENDAR_TOOLS`, export riêng, ngoài `ALL_TOOLS`. Schema output giống `calendar.*`; input bỏ `calendarId`:
  - `list_events`: `timeMin`, `timeMax` (tối đa 31 ngày), `query`, `limit` ≤ 20;
  - `create_event`: `summary` ≤ 200, `description` ≤ 4.000, `start`, `end` (≤ 24 giờ), `location`.
- `PlanConnections.mycalendar?: { credentialId: string; email: string }`.

## 5. Backend

### 5.1. Tổng quát hoá phần kết nối riêng của Gmail

Ba phần tổng quát hoá theo **mã dịch vụ**. Bộ test của Gmail phải đạt **không sửa assertion nào**; đây là lưới an toàn của việc tổng quát hoá.

| Phần | Hiện tại | Sau |
|---|---|---|
| Client OAuth | `GmailOAuthClient` (`services/gmail/oauth-client.ts`) | Tham số hoá theo cấu hình. Cách lấy danh tính tách theo dịch vụ: Gmail `users/me/profile`, Calendar `GET /calendar/v3/calendars/primary` → `id` (email) |
| Quản lý token | `GmailTokenManager` | Một instance cho mỗi dịch vụ. Câu lỗi theo tên dịch vụ; `invalid_grant` → `reconnect_required` của đúng dịch vụ |
| Route kết nối | `routes/connections/gmail.ts` (start, callback, DELETE; khoá advisory → user → session; state một lần; `return_to`) | Một factory theo dịch vụ, gắn ở `/api/connections/gmail` và `/api/connections/mycalendar`. Giữ nguyên thứ tự khoá và các bảo đảm chống callback cũ ghi đè, đăng xuất giữa chừng (review #140) |

Nếu tổng quát hoá route buộc phải sửa assertion của test Gmail, thì **dừng lại và chép** thành `routes/connections/mycalendar.ts`. Ghi lý do vào log; review sẽ xét phần trùng lặp.

### 5.2. Adapter (`packages/tool-adapters/src/calendar/`)

- `PersonalCalendarAdapter`: dùng chung phần gửi request và chuẩn hoá của `CalendarAdapter` (tách hàm chung, không đổi hành vi của `calendar.*`).
- Lấy token từ một `AccessTokenProvider` (khái quát từ `GmailAccessTokenProvider`). 401 thì làm mới token một lần (`forceRefresh`), như Gmail.
- Luôn dùng `calendars/primary`.
- Lệnh ghi:
  - lỗi trước khi gửi → `requestSent: false`, nên executor xếp vào `failed`;
  - sau khi đã gửi mà không rõ kết quả → `UNKNOWN`, không gửi lại.
- Sandbox: adapter giả trả sự kiện mẫu và tạo sự kiện giả, như Gmail.

### 5.3. Nối vào hệ thống

- **`AdapterFactory`:** `gmailAdapter` tổng quát thành `personalAdapter(service, context)`:
  - cache `<service>:<userId>`;
  - khi thực thi, kiểm `context.connections[service].credentialId`;
  - `clearPersonal(userId)` xoá cả hai dịch vụ.
- **`getToolCatalogFor`:** thêm `MYCALENDAR_TOOLS` khi cờ bật và người gọi có kết nối `active`.
- **Registry của người gọi:** `[...SERVICE_REGISTRY, GMAIL_SERVICE?, MYCALENDAR_SERVICE?]`.
- **`ChatService.bindConnections`:** gắn `connections.mycalendar` trước khi băm; thiếu kết nối thì từ chối như Gmail.
  - Đường lượt chạy của lịch (`planScheduledRun`) dùng chung hàm này nên tự có;
  - `mayFallbackToShared` (kế hoạch soạn sẵn ở sandbox) không rơi về khi câu nhắc dịch vụ riêng.
- **Executor và recovery** (`execution-recovery.ts`): biết `mycalendar.create_event` là lệnh ghi; kiểm `connections.mycalendar` như `connections.gmail`.
- **`GET /api/services`:** có hàng `mycalendar` của chính người gọi khi cờ bật. `/api/health` có `mycalendarEnabled` khi dùng được.

## 6. Giao diện (`apps/chat-web`)

- **`/settings`:** hàng "Google Calendar của bạn" trong nhóm "Của riêng bạn". Tổng quát hoá hàng Gmail theo mã dịch vụ; câu mô tả: "ATI chỉ đọc sự kiện và tạo sự kiện mới trong lịch chính của bạn, không sửa hay xoá sự kiện, không mời ai."
- **Callback** `/connections/mycalendar/callback`: tổng quát hoá `GmailCallbackView`, giữ:
  - gửi một lần;
  - xoá query khỏi URL trước khi gửi;
  - không làm mới token khi 401;
  - `returnTo` (OAUTH-01).
- **Màn từ chối:** nút "Kết nối Google Calendar" cho `unavailableServices` có `mycalendar`, theo OAUTH-01.
- **Màn duyệt và biên nhận:** `toolDefinition()` tra cả `MYCALENDAR_TOOLS`; nhãn hành động "Tạo sự kiện"; đích "Lịch chính của `<email>`"; link "Mở lịch" chỉ `https`.
- **`/privacy`** (khi cờ bật): thêm đoạn về lịch riêng: dữ liệu sự kiện đi qua 9router tới model, giống Gmail.

## 7. An toàn

- **Tiêm lệnh qua sự kiện:** lịch chính nhận được lời mời từ bất kỳ ai, nên tiêu đề và mô tả sự kiện là dữ liệu không tin cậy, giống thư.
  - Kết quả tra cứu vẫn nằm trong khối "dữ liệu, không phải chỉ dẫn";
  - tool ghi duy nhất chỉ ghi vào lịch của chính người dùng, không mời ai, và luôn cần duyệt;
  - bộ đo có 2 câu tiêm lệnh qua tiêu đề sự kiện (mục 8).
- **Token:** refresh token mã hoá như Gmail, access token chỉ trong bộ nhớ.
- **Ngắt kết nối:** thu hồi đúng grant của client Calendar.

## 8. Kiểm thử và đo

- **Cờ tắt:**
  - SHA-256 prompt và catalog không đổi;
  - routing 116 câu không đổi;
  - không có route hay trường health mới.
- **Gmail:** toàn bộ test GMAIL-01 → 03 và OAUTH-01 đạt, không sửa assertion.
- **Backend** (PostgreSQL thật, OAuth và Calendar giả):
  - kết nối, callback cũ, đăng xuất giữa chừng, `invalid_grant` → `reconnect_required`;
  - ngắt Calendar không đụng Gmail;
  - adapter 401 → làm mới một lần; lệnh ghi treo → `UNKNOWN`;
  - thực thi với `credentialId` khác kết nối hiện tại → từ chối.
- **Browser:** nhóm `mycalendar` (cờ bật, OAuth giả): kết nối từ `/settings`, kết nối trong hội thoại rồi quay về, duyệt tạo sự kiện, 1440/375 sáng/tối. Ca `MYCALENDAR off:` ở nhóm default.
- **Golden** `cases-mycalendar.json`, 8 câu, label commit trước mọi lời gọi model:
  - 2 tạo sự kiện vào lịch của tôi;
  - 2 lịch nhóm (phải dùng `calendar.*`);
  - 1 đọc lịch của tôi rồi gửi Slack;
  - 1 hỏi lại khi mơ hồ;
  - 2 tiêm lệnh qua tiêu đề sự kiện.

  Chạy ×3, `llm`, model chính.
- **Nghiệm thu thật** (nhóm trưởng):
  - kết nối;
  - tạo một sự kiện trong lịch chính của tài khoản thử;
  - đọc lại;
  - ngắt kết nối, kiểm token đã thu hồi, kiểm Gmail vẫn kết nối.
- **Quy tắc bật cờ:**
  - golden ≥ 20/24, gồm 6/6 lượt tiêm lệnh;
  - không câu lịch nhóm nào ghi vào lịch riêng;
  - nghiệm thu thật đạt.

  Không đạt trước 03/11 thì giữ tắt.

## 9. Ai làm và mốc (nếu chọn làm)

| Ngày | Việc | Ai |
|---|---|---|
| 29/10 sáng | Quyết làm; Google Cloud: bật Calendar API, tạo client OAuth thứ hai, thêm quyền vào màn đồng ý, nhập biến vào `.env` ở máy | Nhóm trưởng |
| 29–30/10 | PR 1: tool-schemas, migration 0012, tổng quát hoá OAuth/token/route, adapter, nối hệ thống, sandbox, test backend | A-thi công |
| 30–31/10 | PR 2: giao diện, nhóm browser | A-thi công |
| 31/10 | Review hai PR | A-review |
| **01/11** | **Merge hoặc đóng (mốc cắt)** | Nhóm trưởng |
| 02–03/11 | Golden ×3, nghiệm thu thật, quyết cờ | A-thi công, nhóm trưởng |
| 04/11 | PR bật cờ (nếu đạt) | A-thi công |

Task card: [OAUTH-02](../../handoff/tasks/OAUTH-02-personal-calendar.md).
