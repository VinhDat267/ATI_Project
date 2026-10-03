# W3-04 · Telegram

**Trạng thái:** đã triển khai, chờ review/CI · **Nhánh:** `vinhdat/feat-w3-04-telegram` · **Phụ thuộc:** W3-00 đã merge · **Làm song song với:** W3-01, W3-02, W3-03, W3-05

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

- [x] Test không lộ token: lỗi mạng giả lập có URL chứa token → `message` của `StepError` không chứa token hay chuỗi `api.telegram.org/bot`.
- [x] Test phân loại lỗi khi HTTP 200 nhưng `ok: false`.
- [x] Test body `send_message` không có `parse_mode`; `text` quá 4096 ký tự bị từ chối trước khi gọi API.

## Kết quả (agent thi công điền)

- PR: [#33](https://github.com/VinhDat267/ATI_Project/pull/33), draft, chưa merge.
- Commit: implementation `90529d26a4b9807052240893477f76d355825012`; snapshot riêng `bd304379ac3f1959d24c0ae343685916c7e96cec`.
- Tài liệu API đã đọc ngày03/10/2026: [Bot API](https://core.telegram.org/bots/api), [sendMessage](https://core.telegram.org/bots/api#sendmessage), [getChat](https://core.telegram.org/bots/api#getchat), [getMe](https://core.telegram.org/bots/api#getme), [ResponseParameters](https://core.telegram.org/bots/api#responseparameters), [limits FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this). Endpoint unversioned; JSON POST qua fetch, không SDK.
- Test: baseline check742v3+92eval exit0. Foundation RED7/8, adapter RED43/43, API/sandbox/live config RED3/3; browser Telegram RED1/1 → GREEN1/1. Final `npm run check` exit0: **797v3+93eval**; strict NodeNext exit0; browser đầy đủ **13/13 exit0**. PostgreSQL/HTTP/SSE thật, planner/provider sandbox. Review độc lập và CI head cuối đang chờ.
- Khác card: getChat trước gửi; group/supergroup được giãn3giây/tin (20/phút), private/channel1giây/tin, limiter chung trong process. Chuẩn hóa ID bằng BigInt; kết quả provider phải là integer an toàn và khớp ID. Retry_after thiếu/sai/>30giây dừng RATE_LIMIT, không clamp xuống để retry sớm; token shape kiểm trước URL, chặn redirect.
- Routing có giới hạn sẵn: câu “đã tạo issue” vẫn chọn GitHub + Telegram vì keyword issue; GitHub chưa cấu hình có thể bị từ chối. Giữ router theo common brief, không sửa semantics core.
- Provider/bot/live send **NOT_RUN** (W3-07); model/golden thật **NOT_RUN** (W3-06). Không sửa v2/frontend sản phẩm/prompt/policy executor/CURRENT-STATE/ROADMAP.
- Bàn giao: [nhật ký W3-04](../log/2026-10-03-codex-W3-04-telegram.md).
