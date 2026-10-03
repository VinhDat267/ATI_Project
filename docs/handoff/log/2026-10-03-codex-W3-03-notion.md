# 2026-10-03 · Codex · W3-03 Notion

- Task: W3-03-notion và W3-service-common; base `ab2c599` (PR #31 Calendar đã merge). Nhánh `vinhdat/feat-w3-03-notion`; chưa merge.
- Implementation `0b8086491cdf56c22d22dffce6d895c0a1261410`; snapshot riêng `c23e1aa94e63820c2121680a52b620174e7e55e7`.

## Thay đổi

- Bốn tool Notion: search_databases, query_database, create_page, append_text. Catalog27 tool/năm service cũ + Notion = sáu service;16 read/11 write. UUID compact/hyphen và hoa/thường chuẩn hóa về lowercase có hyphen, cả API credentials và adapter params.
- Token internal integration, fetch inject được, Notion-Version2026-03-11 trong mọi request. Allowlist giữ database ID; lấy database/data source/schema trước query hoặc create. Chỉ liệt kê tài nguyên trong allowlist, không dùng global search.
- Query POST là read: filter theo title property thực tế, tối đa20 pages, pagination có giới hạn20 request và chặn cursor lặp. Properties làm phẳng thành chuỗi. Tool query không listable; planner search llm, không thêm regex gather.
- Create kiểm title/content/properties, năm kiểu được hỗ trợ; content thành paragraph rich_text thuần ≤2000 ký tự/khối, không cắt đôi emoji surrogate pair. Title dùng schema thực tế. Append đọc page và data source cha trước kiểm allowlist, rồi mới PATCH block children.
- Rate limiter chung3request/giây/token; 429 wait Retry-After và retry đúng một lần, cancel ngăn lần ghi hai, wait>30giây dừng RATE_LIMIT. 429 public_api_request_blocked không retry. Lỗi ghi5xx/network/malformed response là UNKNOWN, không replay; readonly network retry2, server retry1, 529 readonly tôn trọng Retry-After. Lỗi sanitized, không có token/header/body thô.
- Transport, credentials mã hóa với PostgreSQL thật, catalog có điều kiện, connection check chỉ đọc database đầu tiên, factory, resource grounding, sandbox Notion→Slack, browser SQL output, live-services entry và tên env NOTION_TOKEN/LIVE_NOTION_DATABASE_IDS. Không dependency/SDK.

## Tài liệu API và phiên bản

Đọc tài liệu chính thức ngày03/10/2026: [upgrade2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03), [upgrade2026-03-11](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11), [database](https://developers.notion.com/reference/retrieve-database), [data source](https://developers.notion.com/reference/retrieve-a-data-source), [query](https://developers.notion.com/reference/query-a-data-source), [page create](https://developers.notion.com/reference/post-page), [page retrieve](https://developers.notion.com/reference/retrieve-a-page), [parent](https://developers.notion.com/reference/parent-object), [property schema](https://developers.notion.com/reference/property-object), [property values](https://developers.notion.com/reference/page-property-values), [append](https://developers.notion.com/reference/patch-block-children), [limits](https://developers.notion.com/reference/request-limits), [errors](https://developers.notion.com/reference/status-codes). Một số HTML endpoint không đọc được bằng browser; đã tải và đọc markdown chính thức qua llms.txt, giữ bản gốc ngoài repo. Header cố định2026-03-11; không dùng database query endpoint cũ hoặc archived/after.

## Bằng chứng

- Baseline check exit0:677v3+91eval. Foundation RED6/7 → GREEN14/14; adapter RED45/45 → GREEN45/45; property safety RED2/47 → GREEN47/47. API/sandbox/live config RED3/3 → GREEN3/3; browser Notion RED1/1 (thiếu plan approvable) → GREEN1/1.
- Final check exit0: **734v3 =44schema+196adapters+142planner+25executor+166API+161web**, **92 offline evaluations**; typecheck/build, production-secret scan, launcher1/local-env3. Strict test/harness typecheck exit0. Schema import được đổi sang named Ajv theo strict NodeNext; focused schema2/2 đạt.
- Browser **12/12 exit0**: default5,clarification1,partial_failure2,three_service1,sheets_slack1,calendar_slack1,notion_slack1. HTTP/SSE và PostgreSQL thật; planner/adapters sandbox. Notion→Slack kiểm saved plan, approval, status/output_json thật, URL page có trong output Slack.
- API test dùng schema riêng trên PostgreSQL: ciphertext lưu/đọc thật, HTTP không lộ token, metadata/connection check, factory, planner prefetch có id/title/url, query page output và validator từ chối database/page ID giả. Write timeout kiểm AbortSignal thật. Unit fetch chỉ giả tại biên API ngoài; không dùng mock boolean thay evidence database.
- Regression đầu: sáu assertion count/list catalog cũ và một missing-credentials expectation cần thêm Notion; chỉ tăng count/map/list, không bỏ kiểm hành vi. Routing test RED1/15 do đúng hai fallback full catalog.
- Logs, screenshot và bản docs API lưu ngoài repo trong Codex W3-03 evidence directory. Database test riêng ati-w303-pg,localhost5432; runner dùng target CI-compatible được guard cho phép, không sửa guard. Database người dùng localhost15433 giữ nguyên. Lỗi env PowerShell ban đầu nối nhiều key thành DATABASE_URL đã sửa tại nguồn, migration/provision rerun; không dùng lần lỗi làm evidence PASS.

## Snapshot riêng

Legacy catalog Trello/Slack/GitHub72/72 giữ nguyên. Full catalog70/72 giữ nguyên; hai câu thêm Notion vì fallback toàn catalog:

1. golden:rf03 — “Gửi email cho khách hàng về lịch bảo trì hệ thống”: không có service phù hợp đã đăng ký, fallback mở rộng; không tuyên bố hỗ trợ email.
2. freeform:ff15 — “Let the frontend team know the deploy finished”: không service keyword, fallback mở rộng.

Không đổi routing policy/prompt/label/ngoại lệ. rf06 vẫn full→Calendar và legacy→[], đúng quyết định đã chốt; model/label xử lý ở W3-06.

## Quyết định và giới hạn

1. Card/common làm brief trực tiếp vì card không có numbered task-start/task-done steps. Giữ ledger, log RED/GREEN và immutable commit range; chi phí nếu sai: bookkeeping script yếu hơn.
2. Metadata normalizeScopeEntry và một call generic trong API là thay đổi nhỏ cần để lưu UUID canonical. Không nhánh theo service trong core; toàn bộ suite cũ/generic scope đã chạy. Chi phí nếu sai: hồi quy chuẩn hóa service khác.
3. Query/create yêu cầu một data source duy nhất vì card không có selector. Ambiguous database trả VALIDATION trước ghi; append dùng source cụ thể của page. Chi phí nếu sai: database đa nguồn chưa dùng được cho query/create.
4. Select chỉ dùng option có sẵn vì tên mới có thể thay schema ngoài preview create-page. Chi phí nếu sai: không tạo option mới qua tool này; cần capability schema riêng.

Notion thật/provider NOT_RUN; read/write acceptance W3-07 và model W3-06 còn mở. Không sửa v2, frontend sản phẩm, prompt/policy router/executor, CURRENT-STATE hoặc ROADMAP. PR #28 metadata sau Calendar vẫn riêng; reviewer cập nhật state sau khi Notion merge. Review độc lập/CI head cuối được ghi bổ sung sau khi chạy, không dùng green suite thay live acceptance.
