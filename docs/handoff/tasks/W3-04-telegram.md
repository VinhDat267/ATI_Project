# W3-04 · Telegram

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w3-04-telegram` · **Phụ thuộc:** W3-00 đã merge · **Làm song song với:** W3-01, W3-02, W3-03, W3-05

Đọc trước: [yêu cầu chung cho task thêm service](W3-service-common.md). Card này chỉ ghi phần riêng của Telegram.

## Xác thực

- Bot token do @BotFather cấp (người dùng tạo bot, thêm bot vào một nhóm thử nghiệm; xem W3-07).
- `credentialFields`: `botToken` (`password`).
- **Token nằm trong đường dẫn URL** (`https://api.telegram.org/bot<token>/<method>`). Vì vậy không bao giờ đưa URL request vào lỗi, log hay output; lỗi `fetch` của Node có thể chứa URL, nên phải bắt và thay bằng thông báo không có URL. Có test riêng cho điều này.

## Thiết kế service

- `id: 'telegram'`, `name: 'Telegram'`, `scopeKey: 'chats'`, `scopeLabel: 'Chat ID'`, `scopePattern: /^-?\d{1,20}$/` (nhóm có ID âm).
- `intentKeywords`: `telegram`. **Không** dùng `tin nhắn`, `message`, `nhóm`, `chat`, `thông báo`: đó là từ khóa của Slack hoặc quá chung. Câu "gửi tin nhắn …" không nêu tên service vẫn đi Slack như hiện nay.
- `checkConnection`: `getMe`.
- Rate limit: khoảng 1 tin/giây cho mỗi chat, 20 tin/phút cho mỗi nhóm.

| Tool | Loại | Input | Output |
|---|---|---|---|
| `telegram.list_chats` | read, `discovers: 'chat'`, `listable` | `query` (có thể rỗng), `limit` ≤ 10 | `{ id, title, type }` của chat trong allowlist (gọi `getChat` cho từng ID) |
| `telegram.send_message` | write, `riskLevel: 'medium'` | `chatId` (`x-resource: 'chat'`), `text` (1–4096 ký tự) | `{ messageId, chatId, date }` |

- `send_message` gửi văn bản thuần: **không** đặt `parse_mode` (chặn chèn markup), tắt xem trước link.
- Telegram trả HTTP 200 với `ok: false` cho một số lỗi; phân loại theo `error_code` trong body (401/403/404/429 như quy tắc chung; 429 dùng `parameters.retry_after`).
- Không có tool sửa/xóa tin, ghim tin, hay quản lý thành viên.

## Ca định tuyến dễ nhầm (thêm vào test)

- "Gửi tin nhắn lên kênh ati-test" khi Telegram **chưa cấu hình** → Slack, không bị từ chối.
- "Báo nhóm Telegram ATI Test là đã tạo issue" → Telegram (+ GitHub nếu câu yêu cầu tạo issue).
- "Gửi thông báo lên cả Slack và Telegram" → cả hai.

## Sandbox

Kịch bản `telegram_slack`: gửi tin Telegram → báo Slack kèm `messageId` của step trước (kịch bản thử phụ thuộc dữ liệu, nội dung đơn giản).

## Tiêu chí riêng (ngoài tiêu chí chung)

- [ ] Test không lộ token: lỗi mạng giả lập có URL chứa token → `message` của `StepError` không chứa token hay chuỗi `api.telegram.org/bot`.
- [ ] Test phân loại lỗi khi HTTP 200 nhưng `ok: false`.
- [ ] Test body `send_message` không có `parse_mode`; `text` quá 4096 ký tự bị từ chối trước khi gọi API.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Tài liệu API đã đọc (đường dẫn, ngày):
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
