# W3-07 · Chạy thật năm service mới

**Trạng thái:** xong (04/10/2026): năm service mới và workflow 4 service đã chạy thật · **Nhánh gợi ý:** `test/w3-07-new-services-live` · **Phụ thuộc:** task service tương ứng đã merge; người dùng đã làm phần chuẩn bị của service đó · **Có phần việc của con người**

Có thể làm từng service ngay khi task của service đó merge, không cần chờ đủ năm.

## Chuẩn bị của người dùng (agent không tự làm)

Agent không tạo tài khoản, không tạo hay đọc key/token, không in giá trị bí mật ra log. Người dùng tự điền `.env` và lưu credentials qua "Cài đặt dịch vụ" hoặc `evaluations/live-app/setup-credentials.ts`. Tên biến env chính xác lấy từ `.env.example` sau khi task service merge.

**Google (dùng cho cả Sheets và Calendar)**
1. Google Cloud Console: tạo project, bật **Google Sheets API** và **Google Calendar API**.
2. Tạo một **service account**, tạo key dạng JSON (lấy `client_email` và `private_key`). Nên dùng tài khoản Google cá nhân: project thuộc tổ chức (ví dụ tài khoản trường) có thể bị chính sách tổ chức chặn tạo key service account. Key này được nhập hai lần, một cho Sheets và một cho Calendar (hai service lưu credentials riêng).
3. Sheets: tạo spreadsheet "ATI Test Tracker", tab `Tasks` có dòng tiêu đề `Ngày | Tiêu đề | Issue | Card | Người làm`; chia sẻ quyền **Editor** cho email service account; lấy spreadsheet ID từ URL.
4. Calendar: tạo lịch riêng "ATI Test" (không dùng lịch cá nhân); chia sẻ cho email service account với quyền **Thay đổi sự kiện**; lấy Calendar ID trong phần cài đặt lịch.

**Notion**
1. Tạo internal integration tại trang quản lý integration của Notion, lấy token.
2. Tạo database "ATI Test Notes" (có thuộc tính tiêu đề, `Trạng thái` kiểu select, `Link` kiểu url); trong menu của database chọn **Connect** tới integration vừa tạo; lấy database ID từ URL.

**Telegram**
1. Nhắn @BotFather, tạo bot, lấy bot token.
2. Tạo nhóm "ATI Test", thêm bot vào nhóm, rồi gửi lệnh `/start@<tên_bot>` trong nhóm. Bot ở chế độ privacy mặc định không nhận tin thường trong nhóm, nên tin bất kỳ có thể không hiện trong `getUpdates`.
3. Lấy chat ID của nhóm (số âm), ví dụ mở `getUpdates` của bot trong trình duyệt. Người dùng tự làm bước này vì URL chứa token.

**Jira**
1. Tạo site Jira Cloud gói Free, một project thử nghiệm (ví dụ key `ATIT`).
2. Tạo API token tại trang quản lý tài khoản Atlassian; credentials gồm site URL `https://<tên>.atlassian.net`, email, token.

## Việc cần làm

Với **mỗi** service đã sẵn sàng:

1. Chạy `checkConnection` và tool liệt kê (chỉ đọc). Ghi kết quả, không in bí mật.
2. Một lệnh ghi thật qua frontend (`evaluations/live-app/`), plan gồm service mới + Slack. **Người dùng phải duyệt đúng plan (mã băm) trong chat trước khi bấm Duyệt.**
3. Đọc lại kết quả bằng tool đọc của service (dòng Sheets, sự kiện Calendar, page Notion, issue Jira) hoặc kiểm bằng mắt có ảnh chụp (tin Telegram, vì bot không đọc lại được tin của chính nó qua API thông thường). Đối chiếu với `output_json` trong PostgreSQL.
4. Một ca lỗi thật **không ghi**: lưu credentials sai (token/key đã thu hồi hoặc gõ sai) rồi gọi `checkConnection`; kiểm tra service thật trả lỗi xác thực và hệ thống báo `AUTH_ERROR` mà không lộ bí mật. Sau đó lưu lại credentials đúng. (Chặn tài nguyên ngoài allowlist không gọi API nên đã được chứng minh bằng unit test, không cần chạy thật.)

Sau khi đủ các service còn trong phạm vi:

5. **Một workflow thật đi qua ≥ 4 service, ít nhất 2 service mới**, có phụ thuộc dữ liệu, ví dụ: "Tạo ticket Jira cho lỗi đăng nhập, đặt lịch họp review lúc 15h thứ Sáu trên lịch ATI Test có link ticket, ghi một page vào ATI Test Notes với link ticket và link sự kiện, rồi báo nhóm Telegram ATI Test". Người dùng duyệt đúng plan. Đối chiếu từng kết quả như bước 3.
6. Dọn dẹp tài nguyên thử nghiệm chỉ khi người dùng yêu cầu, và do người dùng làm trên giao diện của service (không có tool xóa).

## Tiêu chí nghiệm thu

- [ ] Mỗi service còn trong phạm vi: một lần đọc thật, một lần ghi thật đã được người dùng duyệt, có đối chiếu kết quả.
- [ ] Một workflow thật ≥ 4 service (≥ 2 service mới) thành công, có đối chiếu từng bước.
- [ ] Mỗi service: một ca credentials sai được service thật từ chối và hệ thống phân loại `AUTH_ERROR`, không lộ bí mật.
- [ ] Bằng chứng lưu `docs/ai-evidence/V3-LIVE-EXECUTION/` (**không commit**). Thư mục này hiện chỉ được bỏ qua bằng `.git/info/exclude` ở máy nhóm trưởng: chạy `git check-ignore` trước khi lưu; nếu không bị bỏ qua thì thêm vào `.gitignore` trong PR; PR chỉ có tóm tắt (thời điểm, plan hash, trạng thái step, ID kết quả đã che bớt nếu cần) và cập nhật `evaluations/README.md`, `docs/MULTI-SERVICE-SCOPE.md`.

## Kết quả (agent thi công điền)

- PR: #48 (Telegram), #49 (sửa host Notion), #50 (Notion), #51 (workflow 4 service), #55 (Jira), nhánh `test/w3-07-google-live` (Google Sheets, Calendar).
- Service đã chạy thật / chưa chạy (và lý do):
  - **Telegram: xong (04/10/2026).** Nhóm thử nghiệm "ATI Test" (`-5405985621`, loại `group`), bot riêng cho dự án.
    1. `check` chỉ đọc (`getMe` + `getChat`): `telegram: OK - 1 allowlisted resources`.
    2. Ghi thật Telegram + Slack, người dùng duyệt đúng plan hash `dcc54de450356f23e3602f56214e1ae93dfb28171100e7266bbcbe71fc6ba801`:
       - plan do model thật lập trong 7,3 s, hai search đọc (`slack.search_channels`, `telegram.list_chats`);
       - `telegram.send_message` thành công, `messageId: 5`;
       - `slack.send_message` vào `#ati-test` thành công (`ts 1791074394.559019`), nội dung lấy `messageId` từ bước trước qua `$template`;
       - người dùng đối chiếu bằng mắt, vì bot không đọc lại được tin của chính nó.
    3. Ca lỗi thật không ghi: token giả đúng định dạng được gửi tới Telegram, server trả HTTP 401, hệ thống báo `AUTH_ERROR: Telegram request failed: AUTH_ERROR`; output không chứa token giả hay `api.telegram.org/bot`.
    4. Bằng chứng `plan.json`/`execution.json` ở `docs/ai-evidence/V3-LIVE-EXECUTION/2026-10-04T00-39-28-834Z/` (không commit).
  - **Notion: xong (04/10/2026).** Connection kiểu API token "ATI Workflow Test" (đọc, chèn nội dung), database "ATI Test Notes" có một data source với các cột `Name`, `Trạng thái` (Select: Mới/Đang làm/Xong), `Link`.
    1. `check` lần đầu báo `SERVER_ERROR`. Gọi trực tiếp API (chỉ in cấu trúc) cho thấy Notion trả URL với host `app.notion.com`, trong khi adapter chỉ chấp nhận `notion.so`. **Lỗi sản phẩm thật**, đã sửa qua #49 (TDD; chặn host giả mạo, `http`, URL có username/password). Sau sửa: `notion: OK`.
    2. Ghi thật Notion + Slack, người dùng duyệt plan hash `b6ccb160c9a90d4d5f5bb46312953d66778260daa54662c90c574d5f60790203`:
       - model thật lập plan trong 6,6 s;
       - `notion.create_page` thành công, page `3eff24d5-a6d3-812b-aeeb-e3205669c314` (`https://app.notion.com/p/…`);
       - `slack.send_message` thành công (`ts 1791079139.268289`), kèm link page qua `$template`.
    3. Đọc lại bằng `notion.query_database`: đúng ID, tiêu đề `Kiểm tra W3-07 Notion`, `Trạng thái: Mới`.
    4. Ca lỗi thật không ghi: token giả, Notion trả HTTP 401, hệ thống báo `AUTH_ERROR: Notion request failed with HTTP 401`; output không chứa token.
    5. Bằng chứng ở `docs/ai-evidence/V3-LIVE-EXECUTION/2026-10-04T01-58-31-111Z/` (không commit).
  - **Jira: xong (04/10/2026), có 2 phát hiện → [W3-09](W3-09-jira-live-findings.md).** Site Jira Cloud Free, project `ATIT` (team-managed), API token không scope.
    1. `check`: `jira: OK - 1 allowlisted resources`.
    2. Ghi thật Jira + Slack, người dùng duyệt plan hash `d328ee1ad816aad7d1dc1a8b756999528c9701060d9dc53ebe42d747dfad9d7c`:
       - model thật lập plan trong 7,8 s;
       - `jira.create_issue` thành công, `ATIT-4`;
       - `slack.send_message` thành công (`ts 1791094534.504529`), kèm key và link ticket.
    3. Đọc lại bằng `jira.search_issues`: query rỗng và query `Jira` thấy `ATIT-4 | Kiểm tra W3-07 Jira | To Do`. Query `W3` và nguyên tiêu đề lại trả rỗng, vì adapter thay `-` bằng khoảng trắng (phát hiện 1).
    4. Ca lỗi token sai: `jira: FAILED - NOT_FOUND`, không phải `AUTH_ERROR`. Probe trực tiếp cùng token giả: `/myself` trả 401, `/project/ATIT` trả 404, vì Jira coi Basic auth sai là ẩn danh và giấu project (phát hiện 2). Output không chứa token.
    5. Bằng chứng ở `docs/ai-evidence/V3-LIVE-EXECUTION/2026-10-04T02-17-44-125Z/` (không commit).
  - **Google Sheets và Google Calendar: xong (04/10/2026).** Một service account (không gán role IAM) dùng chung cho cả hai. Spreadsheet "ATI Test Tracker" (tab `Tasks`) và lịch riêng "ATI Test" được chia sẻ cho service account (Editor / Thay đổi sự kiện).
    1. `check`: `calendar: OK`, `sheets: OK` (token Google, tên spreadsheet, danh sách tab, thông tin lịch). Lần đầu chưa chạy vì `GOOGLE_CLIENT_EMAIL` còn nguyên chữ `<project-id>` trong mẫu hướng dẫn; phát hiện bằng kiểm định dạng trước khi gọi mạng.
    2. Ghi thật Calendar + Sheets + Slack, người dùng duyệt plan hash `1b44ecde5bf0bd3c01c12b3ec480a1e72e4b2488c40a8277181405a0b75ec05e`:
       - model thật lập plan trong 9,8 s, bốn search đọc;
       - `calendar.create_event` thành công: sự kiện `bvgrgtl3thh3jcvp44h619ssc0`, 05/10/2026 15:00–15:30 `+07:00`, không mời ai;
       - `sheets.append_rows` thành công: `Tasks!A2:C2`, link sự kiện qua `$ref`;
       - `slack.send_message` thành công (`ts 1791097770.439579`).
    3. Đọc lại bằng `calendar.list_events` và `sheets.read_range`: sự kiện đúng tiêu đề và giờ; dòng 2 chứa đúng link sự kiện (`rowLinksToEvent: true`).
    4. Ca lỗi thật không ghi: RSA key hợp lệ nhưng không thuộc service account, Google token endpoint trả HTTP 400 `invalid_grant`, hệ thống báo `AUTH_ERROR: Google service account authentication failed` cho cả hai; output không chứa key.
    5. Model ghi ngày `2026-10-05` thay vì `05/10/2026` như câu yêu cầu; Sheets vẫn hiểu là ngày. Link nằm ở cột thứ 3 (tiêu đề "Issue") vì câu yêu cầu không chỉ cột. Ghi nhận, không phải lỗi.
    6. Bằng chứng ở `docs/ai-evidence/V3-LIVE-EXECUTION/2026-10-04T07-08-55-415Z/` (không commit).
- Workflow nhiều service: **xong (04/10/2026), GitHub → Notion → Telegram → Slack** (2 service mới).
  - Model thật lập plan trong 8,4 s, 4 search đọc (repo, database, chat, channel) chạy song song.
  - Người dùng duyệt plan hash `057c0ab9826543b4035555d6915c032416763278b86b31cab54366d439173f16`. Cả 4 step `succeeded`:
    - `github.create_issue`: issue #3 `https://github.com/VinhDat267/ati-test/issues/3`;
    - `notion.create_page`: page `3eff24d5-a6d3-8192-a24e-cd326c8447fb`, `Trạng thái: Mới`, `Link` = URL issue qua `$template`;
    - `telegram.send_message`: `messageId 6`, nội dung có link issue và link page;
    - `slack.send_message`: `ts 1791079497.557269`, cùng nội dung.
  - Đối chiếu bằng tool đọc: `github.get_issue` trả issue #3 đúng tiêu đề; `notion.query_database` trả page có `Link` trùng URL issue (`linkMatchesIssue: true`).
  - Hai tin nhắn đối chiếu bằng mắt, vì bot Telegram không đọc lại được tin của chính nó.
  - Bằng chứng ở `docs/ai-evidence/V3-LIVE-EXECUTION/2026-10-04T02-04-30-538Z/` (không commit).
- Điều chưa làm hoặc khác với task card:
  - Ca lỗi dùng token sai thay cho thu hồi token thật, để không phải tạo lại bot.
  - Thêm `docs/ai-evidence/V3-LIVE-EXECUTION/` vào `.gitignore`, vì trước đó thư mục này chỉ được bỏ qua bằng `.git/info/exclude` ở máy nhóm trưởng.
  - `evaluations/README.md` và `docs/MULTI-SERVICE-SCOPE.md` cập nhật trong PR Google (đủ năm service).
