# 2026-10-03 · Codex · W3-04 Telegram

- Task W3-04 và W3-service-common; base `fca384d88d066df55d7791ad9b7b667fddba249c` (Notion #32 đã merge). Nhánh `vinhdat/feat-w3-04-telegram`; PR [#33](https://github.com/VinhDat267/ATI_Project/pull/33), draft, chưa merge.
- Implementation `90529d26a4b9807052240893477f76d355825012`; snapshot riêng `bd304379ac3f1959d24c0ae343685916c7e96cec`.

## Thay đổi và phạm vi

- Hai tool Telegram: list_chats (read, discovers chat, listable) và send_message (write, medium, x-resource chat). Catalog **29 tools/7 services, 17 read/12 write**. Metadata scope chats, Chat ID signed numeric ≤20digits, botToken password, keyword chỉ telegram.
- List chỉ getChat trên allowlist, lọc title/query, limit≤10; output id/title/type. Send kiểm input và allowlist trước fetch, đọc getChat kiểm identity/type, gửi text thuần1–4096 codepoints, không parse_mode/entities, link_preview_options.is_disabled=true, allow_paid_broadcast=false. Chỉ xuất messageId/chatId/date đã kiểm kiểu và identity.
- Numeric scope chuẩn hóa BigInt/trim/leadingzero/dedup tại generic normalization hook và adapter; không chuyển allowlist sang Number. Bot API integer không safe hoặc ID không khớp bị từ chối; không tự chuyển nhóm theo migrate_to_chat_id.
- Token nằm trong URL chỉ tại biên fetch; error/network/abort không giữ URL, raw body, description, details hoặc cause. Redirect bị chặn. HTTP status ưu tiên; HTTP200 ok:false dùng error_code. Read network retry2/server retry1; write5xx/network/malformed/mismatched success UNKNOWN, không replay. 429 retry tối đa một lần, body retry_after ưu tiên, header fallback; delay không hợp lệ hoặc>30giây dừng RATE_LIMIT.
- Limiter thật chung per token/chat trong process: private/channel1giây, group/supergroup3giây để ≤20/phút; transport30request/giây/token. Message slot đặt cuối trước dispatch, retry dùng slot mới; wait hủy được bằng AbortSignal. Chưa có distributed throttle/benchmark.
- API transport/registry, encrypted credentials PostgreSQL, configured catalog, connection getMe, factory, llm search id/title grounding, sandbox Telegram→Slack, live entry và TELEGRAM_BOT_TOKEN/LIVE_TELEGRAM_CHAT_IDS. Không SDK/dependency; không sửa core planner/router/executor, v2, frontend sản phẩm, CURRENT-STATE/ROADMAP. Metadata PR #28 còn mở, độc lập với implementation này.

## API đã đọc

Ngày03/10/2026, nguồn chính thức: [Bot API](https://core.telegram.org/bots/api), [getMe](https://core.telegram.org/bots/api#getme), [getChat](https://core.telegram.org/bots/api#getchat), [sendMessage](https://core.telegram.org/bots/api#sendmessage), [Chat](https://core.telegram.org/bots/api#chat), [Message](https://core.telegram.org/bots/api#message), [ResponseParameters](https://core.telegram.org/bots/api#responseparameters), [rate FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this). Endpoint unversioned, JSON POST; không đặt version header không được hỗ trợ. Bản HTML giữ ngoài repo.

## Bằng chứng

- Baseline `npm run check` exit0:742v3+92eval trên main fca384d. Docker test riêng dùng tmpfs, không dùng DB người dùng localhost15433; .env synthetic bị ignore.
- Foundation RED7/8 vì registry/schema chưa có Telegram → GREEN8/8; thêm ca Telegram riêng sau đó trong fullcheck. Adapter RED43/43 vì adapter chưa export → GREEN43/43. API/sandbox/live config RED3/3 vì chưa đăng ký transport/fake/live entry → GREEN trong final suite.
- Browser Telegram RED1/1: không có kế hoạch duyệt trước scenario/fake → GREEN1/1. Full browser `npm run test:browser:v3` **13/13 exit0**: default5,clarification1,partial_failure2,three_service1,sheets_slack1,calendar_slack1,notion_slack1,telegram_slack1. Saved plan, approval HTTP/SSE, SQL status succeeded/succeeded và output_json thật; Slack text đúng bằng messageId Telegram step trước. Planner và provider adapters sandbox, không gửi ngoài.
- Final `npm run check` **exit0**, **797v3 =46schema+247adapters+148planner+25executor+170API+161web**, **93 offline eval**; typecheck/build, production-secret scan, launcher1/local-env3. Strict NodeNext test/harness typecheck exit0, gồm tests Telegram và live harness.
- SQL integration tạo schema w304 UUID riêng, bảng LIKE public.service_credentials: credential ghi/đọc ciphertext thật, HTTP metadata/health không lộ botToken, normalized scope, catalog/factory, prefetch id/title, validator chặn ID giả và adapter chặn write ngoài scope trước fetch. Planner compact cố ý không giữ type; adapter vẫn kiểm type thật khi gửi.
- Rate tests chạy GlobalRateLimiter thật với fake clock, hai adapter cùng token/chat, group21tin cần ít nhất60giây; abort dùng AbortController thật ở limiter wait và in-flight fetch. Fetch fixture chỉ ở biên provider.
- Generic catalog RED4 assertion count/list và routing RED1 trước cập nhật. Snapshot chỉ full-catalog golden rf03/freeform ff15 thêm Telegram; audit72/72legacy nguyên vẹn, rf06 không đổi, không sửa prompt/label/exception.

## Quyết định trong triển khai

| Quyết định | Chi phí nếu sai |
| --- | --- |
| Card không có bước task-start/task-done đánh số; dùng card/common brief, RED/GREEN có log và commit bất biến | Bookkeeping script yếu hơn, bù bằng evidence giữ riêng |
| Chuẩn hóa numeric Chat ID bằng BigInt qua hook có sẵn | Có thể thay spelling/resource matching; test signed IDs và identity bù lại |
| Fresh getChat trước send, giãn group3giây/private1giây trong process | Thêm một read mỗi lần gửi, không hỗ trợ burst; không chứng minh quota nhiều process |
| Giữ GitHub issue-keyword routing hiện có; câu “đã tạo issue” chọn GitHub + Telegram | Gather GitHub thừa, hoặc refusal khi GitHub chưa cấu hình; tense-sensitive intent cần task riêng |
| Kiểm bot token shape trước URL và chặn redirect | Token format tương lai có thể bị từ chối |
| Retry_after thiếu/sai/>30giây dừng RATE_LIMIT, không retry sớm | Ít tự phục hồi hơn; người dùng phải thử lại sau definite rejection |

## Giới hạn và trạng thái bàn giao

Bot/token/sharing/permission/live read/write thật **NOT_RUN**, thuộc W3-07. Model/provider/golden semantic acceptance thật **NOT_RUN**, thuộc W3-06. Không coi fixture hoặc CI là live acceptance. Allowlist lớn và nhiều process chưa benchmark; chưa mở rộng regex gather theo common brief. Independent whole-branch review và CI exact head cuối đang chờ; chỉ chuyển Ready khi có bằng chứng, không tự merge.
