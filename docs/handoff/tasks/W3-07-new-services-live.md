# W3-07 · Chạy thật năm service mới

**Trạng thái:** chờ · **Nhánh gợi ý:** `test/w3-07-new-services-live` · **Phụ thuộc:** task service tương ứng đã merge; người dùng đã làm phần chuẩn bị của service đó · **Có phần việc của con người**

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
- [ ] Bằng chứng lưu `docs/ai-evidence/V3-LIVE-EXECUTION/` (**không commit**); PR chỉ có tóm tắt (thời điểm, plan hash, trạng thái step, ID kết quả đã che bớt nếu cần) và cập nhật `evaluations/README.md`, `docs/MULTI-SERVICE-SCOPE.md`.

## Kết quả (agent thi công điền)

- PR:
- Service đã chạy thật / chưa chạy (và lý do):
- Workflow nhiều service:
- Điều chưa làm hoặc khác với task card:
