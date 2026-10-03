# 2026-10-03 · Codex · W3-04 Telegram

- Task W3-04 và W3-service-common; base `fca384d88d066df55d7791ad9b7b667fddba249c` (Notion #32 đã merge). Nhánh `vinhdat/feat-w3-04-telegram`; PR [#33](https://github.com/VinhDat267/ATI_Project/pull/33), chưa merge.
- Implementation `90529d26a4b9807052240893477f76d355825012`; snapshot riêng `bd304379ac3f1959d24c0ae343685916c7e96cec`.

## Thay đổi và phạm vi

- Hai tool Telegram: list_chats (read, discovers chat, listable) và send_message (write, medium, x-resource chat). Catalog **29 tools/7 services, 17 read/12 write**. Metadata scope chats, Chat ID signed numeric ≤20digits, botToken password, keyword chỉ telegram.
- List chỉ getChat trên allowlist, lọc title/query, limit≤10; output id/title/type. Send kiểm input và allowlist trước fetch, đọc getChat kiểm identity/type, gửi text thuần1–4096 codepoints, không parse_mode/entities, link_preview_options.is_disabled=true, allow_paid_broadcast=false. Chỉ xuất messageId/chatId/date đã kiểm kiểu và identity.
- Numeric scope chuẩn hóa BigInt/trim/leadingzero/dedup tại generic normalization hook và adapter; không chuyển allowlist sang Number. Bot API integer không safe hoặc ID không khớp bị từ chối; không tự chuyển nhóm theo migrate_to_chat_id.
- Token nằm trong URL chỉ tại biên fetch; error/network/abort không giữ URL, raw body, description, details hoặc cause. Redirect bị chặn. HTTP status ưu tiên; HTTP200 ok:false dùng error_code. Read network retry2/server retry1; write5xx/network/malformed/mismatched success UNKNOWN, không replay. 429 retry tối đa một lần, body retry_after ưu tiên, header fallback; delay không hợp lệ hoặc>30giây dừng RATE_LIMIT.
- Limiter thật chung per token/chat trong process: private/channel1giây, group/supergroup3giây để ≤20/phút; transport30request/giây/token. Message slot đặt cuối trước dispatch, retry dùng slot mới; wait hủy được bằng AbortSignal. Chưa có distributed throttle/benchmark.
- API transport/registry, encrypted credentials PostgreSQL, configured catalog, connection getMe, factory, llm search id/title grounding, sandbox Telegram→Slack, live entry và TELEGRAM_BOT_TOKEN/LIVE_TELEGRAM_CHAT_IDS. Không SDK/dependency; không sửa prompt/executor, v2, frontend sản phẩm, CURRENT-STATE/ROADMAP; router chỉ sửa I1 như bên dưới. Metadata PR #28 còn mở, độc lập với implementation này.

## API đã đọc

Ngày03/10/2026, nguồn chính thức: [Bot API](https://core.telegram.org/bots/api), [getMe](https://core.telegram.org/bots/api#getme), [getChat](https://core.telegram.org/bots/api#getchat), [sendMessage](https://core.telegram.org/bots/api#sendmessage), [Chat](https://core.telegram.org/bots/api#chat), [Message](https://core.telegram.org/bots/api#message), [ResponseParameters](https://core.telegram.org/bots/api#responseparameters), [rate FAQ](https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this). Endpoint unversioned, JSON POST; không đặt version header không được hỗ trợ. Bản HTML giữ ngoài repo.

## Bằng chứng

- Baseline `npm run check` exit0:742v3+92eval trên main fca384d. Docker test riêng dùng tmpfs, không dùng DB người dùng localhost15433; .env synthetic bị ignore.
- Foundation RED7/8 vì registry/schema chưa có Telegram → GREEN8/8; thêm ca Telegram riêng sau đó trong fullcheck. Adapter RED43/43 vì adapter chưa export → GREEN43/43. API/sandbox/live config RED3/3 vì chưa đăng ký transport/fake/live entry → GREEN trong final suite.
- Browser Telegram RED1/1: không có kế hoạch duyệt trước scenario/fake → GREEN1/1. Full browser `npm run test:browser:v3` **13/13 exit0**: default5,clarification1,partial_failure2,three_service1,sheets_slack1,calendar_slack1,notion_slack1,telegram_slack1. Saved plan, approval HTTP/SSE, SQL status succeeded/succeeded và output_json thật; Slack text đúng bằng messageId Telegram step trước. Planner và provider adapters sandbox, không gửi ngoài.
- Trước review `npm run check` **exit0**, **797v3 =46schema+247adapters+148planner+25executor+170API+161web**, **93 offline eval**; typecheck/build, production-secret scan, launcher1/local-env3. Strict NodeNext test/harness typecheck exit0, gồm tests Telegram và live harness. Kết quả cuối sau sửa ở bên dưới.
- SQL integration tạo schema w304 UUID riêng, bảng LIKE public.service_credentials: credential ghi/đọc ciphertext thật, HTTP metadata/health không lộ botToken, normalized scope, catalog/factory, prefetch id/title, validator chặn ID giả và adapter chặn write ngoài scope trước fetch. Planner compact cố ý không giữ type; adapter vẫn kiểm type thật khi gửi.
- Rate tests chạy GlobalRateLimiter thật với fake clock, hai adapter cùng token/chat, group21tin cần ít nhất60giây; abort dùng AbortController thật ở limiter wait và in-flight fetch. Fetch fixture chỉ ở biên provider.
- Generic catalog RED4 assertion count/list và routing RED1 trước cập nhật. Snapshot chỉ full-catalog golden rf03/freeform ff15 thêm Telegram; audit72/72legacy nguyên vẹn, rf06 không đổi, không sửa prompt/label/exception.

## Quyết định trong triển khai

| Quyết định | Chi phí nếu sai |
| --- | --- |
| Card không có bước task-start/task-done đánh số; dùng card/common brief, RED/GREEN có log và commit bất biến | Bookkeeping script yếu hơn, bù bằng evidence giữ riêng |
| Chuẩn hóa numeric Chat ID bằng BigInt qua hook có sẵn | Có thể thay spelling/resource matching; test signed IDs và identity bù lại |
| Fresh getChat trước send, giãn group3giây/private1giây trong process | Thêm một read mỗi lần gửi, không hỗ trợ burst; không chứng minh quota nhiều process |
| Ban đầu giữ GitHub issue-keyword routing hiện có; reviewer bác quyết định này ở I1, đã thay bằng xử lý payload có giới hạn | Đã tái hiện refusal/gather thừa và sửa; giới hạn grammar mới được kiểm bằng regression |
| Kiểm bot token shape trước URL và chặn redirect | Token format tương lai có thể bị từ chối |
| Retry_after thiếu/sai/>30giây dừng RATE_LIMIT, không retry sớm | Ít tự phục hồi hơn; người dùng phải thử lại sau definite rejection |

## Giới hạn và trạng thái bàn giao

Bot/token/sharing/permission/live read/write thật **NOT_RUN**, thuộc W3-07. Model/provider/golden semantic acceptance thật **NOT_RUN**, thuộc W3-06. Không coi fixture hoặc CI là live acceptance. Allowlist lớn và nhiều process chưa benchmark; chưa mở rộng regex gather theo common brief. Chỉ chuyển Ready khi CI exact head cuối đạt, không tự merge.

## Review độc lập và một lượt sửa

- Astra dispatch gặp usage limit, không có verdict. Reviewer thay thế với context mới review toàn immutable range `fca384d..75bf090`, 28files; chạy lại check797v3+93eval, strict và browser13/13 exit0. Probes ở biên14/17 đạt;3assertion lỗi chỉ ra I1/I2. Probe loopback HTTP xác nhận redirect target không bị gọi. Không có provider thật.
- Verdict ở75bf090: NEEDS WORK, C0/I2/M0. Root giữ cả hai là Important theo ảnh hưởng người dùng; không coi disclosure của ruling cũ là cách nghiệm thu.
- I1: notification đúng card bị refusal khi chỉ có Telegram, providerCalls0. Test routing và SQL/planner tái hiện trước sửa. Router giờ chỉ bỏ payload sau “là/rằng đã tạo” trong một notification có tên service trước payload; giữ các action sau “rồi/và/sau đó”, sau dấu câu và ở dòng tiếp theo. Không nhánh riêng theo service; original message/model input giữ nguyên, câu tạo issue thật thiếu GitHub vẫn refusal. Ruling mới thay ruling cũ; chi phí nếu sai: grammar có giới hạn có thể giữ/bỏ sai một service mention.
- I2: HTTP429+ok:true/Message làm gửi hai lần; HTTP400+success thành VALIDATION. Test HTTP400/401/403/404/429 tái hiện UNKNOWN guard còn thiếu; HTTP503 đã an toàn. Adapter kiểm success-envelope mâu thuẫn trước phân loại4xx/retry429, giữ UNKNOWN không replay. Definite429/body/header retry và AbortSignal trong wait vẫn đạt.
- Fix commit `743df4bb9382db0421aef2a48f29363b549ec461`. Một pass, không review lại. RED10/65 → GREEN80/80 gồm15test golden routing; tất cả72legacy rows và rf06 vẫn nguyên vẹn, snapshot không đổi thêm.
- Final `npm run check` **exit0:812v3 =46schema+255adapters+155planner+25executor+170API+161web**, **93offline eval**. Strict NodeNext exit0; full browser **13/13 exit0**. Typecheck/build/secret scan/launcher/local-env đạt. Root chịu trách nhiệm patch và [CI final head](https://github.com/VinhDat267/ATI_Project/pull/33/checks), chỉ Ready khi xanh; không tự merge.
- Không có minor hoãn lại. Năm file riêng trên primary đã kiểm SHA256 nguyên vẹn. Raw logs/.env/report ngoài repo; chỉ fixture synthetic trong tests, không token provider thật.

## Quyết định về12 phần reviewer không kết luận

| Phần reviewer không kết luận | Quyết định của root | Chi phí nếu sai |
| --- | --- | --- |
| 1. Bot/token/quyền/chat/delivery/429 thật | W3-07, NOT_RUN; không gọi provider trong task này | Adapter có thể còn khác biệt với tài khoản thật |
| 2. Model/golden/semantics/rf06 | W3-06, NOT_RUN; chỉ xác nhận routing deterministic và fixture | Model thật có thể lập kế hoạch sai |
| 3. Readback và text fidelity sau gửi | Giữ hai tool và output messageId/chatId/date; không tuyên bố readback | Chưa chứng minh text lưu bên provider đúng từng byte |
| 4. Grapheme/surrogate/normalization/token tương lai | Giữ codepoint contract và token kiểm local; chưa chạy provider matrix | Ký tự có thể bị provider chuẩn hóa hoặc token mới bị từ chối |
| 5. Topic/business/alias/edit/delete/member/paid/migration | Giữ phạm vi hai tool numeric chat; không thêm hành vi ngoài input | Các tính năng này chưa dùng được |
| 6. Discovery trong regex | Theo common brief, service mới chỉ llm search | Regex mode không khám phá Telegram |
| 7. Thay đổi ngoài giữa getChat/send | Giữ kiểm fresh identity/scope; không tuyên bố giao dịch nguyên tử | Trạng thái provider đổi có thể làm ghi thất bại hoặc UNKNOWN |
| 8. Distributed/load/fairness/allowlist lớn | Limiter process-local; chưa benchmark hay chứng minh quota nhiều replica | Có thể gặp 429, chờ lâu hoặc tăng bộ nhớ |
| 9. Cache/revoke/auth/UI/injection ngoài diff | Không mở rộng workstream nền tảng; regression chỉ chứng minh phần đã chạy | Rủi ro nền tảng hiện có vẫn còn |
| 10. Crash/fencing/durable SSE | Không đổi core recovery; không chứng nhận recovery khi process mất | Hành vi dưới crash/multi-replica chưa được chứng minh trong task |
| 11. Dựng lại toàn bộ RED lịch sử | Giữ log RED của root, commit bất biến và rerun/probe độc lập | Provenance không được reviewer tái dựng toàn bộ |
| 12. Cost/CI/Ready/merge/metadata | Root kiểm CI head cuối, chỉ Ready; chưa merge, state sửa sau merge | HEAD có thể drift hoặc handoff stale nếu bỏ gate |
