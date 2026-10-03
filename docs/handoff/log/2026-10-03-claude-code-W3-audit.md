# 2026-10-03 · Claude Code · Audit độc lập W3 (PR #29 → #36)

- **Phạm vi:** `main` `247af5f`. Các PR W3 do Codex vừa thi công vừa review, nên đây là lượt kiểm độc lập đầu tiên.
- **Kết luận:** **Đạt có điều kiện.** Code năm adapter chất lượng tốt, đúng task card và yêu cầu chung. Có một lỗi mức trung bình và ba lỗi mức thấp, gom vào task card W3-08. Không có lỗi an toàn ghi hay lộ bí mật.

## Chạy lại

- `npm run check` exit 0:
  - v3 874 = 47 schema + 301 adapters + 167 planner + 25 executor + 173 API + 161 web;
  - eval offline 151;
  - quét bản build PASS.
- `test-v3-browser.mjs` 14/14 trên PostgreSQL tạm riêng (cổng 55533, xóa sau khi chạy): 9 kịch bản cũ và `sheets_slack`, `calendar_slack`, `notion_slack`, `telegram_slack`, `jira_slack`.

## Đọc code (đối chiếu task card và `W3-service-common.md`)

| Adapter | Kết quả |
|---|---|
| Sheets | allowlist trước mạng; chặn công thức `\s*[=+\-@]`; A1 cục bộ; lệnh ghi lỗi mạng/5xx → UNKNOWN; chỉ retry ghi sau 429 |
| Calendar | 403 rate limit nhận diện theo `reason`; escape HTML mô tả; không `attendees`, `sendUpdates=none`; kiểm thời gian chặt |
| Notion | `Notion-Version` cố định; trang con phải thuộc data source có database cha trong allowlist trước PATCH; `defineProperty` chặn `__proto__`; link chỉ chấp nhận host `notion.so` |
| Telegram | token chỉ nằm trong URL, mọi lỗi dùng thông báo chung; `getChat` trước khi gửi; văn bản thuần; `redirect: 'error'` |
| Jira | `siteUrl` khớp chính xác `https://<tên>.atlassian.net`; JQL escape hai lớp; comment đọc lại project thật; body lỗi có `id` khi ghi → UNKNOWN |

## Mutation test (19 lần chạy trong worktree riêng: 17 bị bắt, 1 lọt, 1 không hợp lệ)

- Bị bắt (17): chặn công thức; allowlist Sheets/Telegram; UNKNOWN của lệnh ghi (Sheets, Telegram, Jira); Telegram `parse_mode`; JQL escape; comment Jira chỉ tin tiền tố key; kiểm `siteUrl` trong adapter (7 test fail); parent check của Notion; option select mới; `sendUpdates=none`; escape mô tả; cache token bỏ fingerprint key; router chặn service chưa cấu hình (10 test fail); allowlist chung mặc định chặn (3 test fail; đây là test cố ý giữ hành vi cũ).
- Lọt (1): Calendar coi mọi 403 là rate limit → W3-08 mục 2.
- Không hợp lệ (1): sửa `JIRA_SITE_PATTERN` trong `tool-schemas` của worktree không có hiệu lực, vì adapter import package từ thư mục chính. Chạy lại bằng cách sửa trong adapter thì bị bắt.

## Probe

- **Kích thước kết quả đọc:** một `sheets.read_range` hợp lệ (10 dòng × 300 cột × 5.000 ký tự) tạo prompt search khoảng 15 triệu ký tự → W3-08 mục 1.
- **HTTP thật + PostgreSQL** (API sandbox, database tạm, service admin):
  - 7 `siteUrl` Jira độc hại (domain khác, `.atlassian.net.evil.com`, `@evil.com`, `http`, chữ hoa, `/` cuối, có cổng) đều bị 400; giá trị hợp lệ 200;
  - project key viết thường, chat ID `@channel`, Notion ID sai đều bị 400;
  - người không phải admin bị 403 trước bước kiểm dữ liệu;
  - bí mật không xuất hiện trong `GET /api/services`, log server, và không lưu dạng gốc trong `service_credentials`.
- `evaluations/live-execution` chỉ in tên biến env và lỗi đã làm sạch.

## Ghi nhận khác

- `ff15` (bộ 18 câu) 0/3 vì workspace đánh giá có cả Slack `#frontend` và Telegram `frontend`, nên model hỏi lại. Đây là hành vi đúng theo đặc tả; W3-06 đã ghi trung thực, không sửa label.
- Hai việc còn mở từ W3-06 (latency services p95 31 s; chính sách yêu cầu chỉ đọc) chưa có task card. Cần lập sau khi đọc kỹ bằng chứng W3-06.
- Môi trường máy nhóm trưởng: container `ati-v3-postgres-1` map cổng 15433, trong khi compose và guard E2E dùng 55533. Không ảnh hưởng CI.
