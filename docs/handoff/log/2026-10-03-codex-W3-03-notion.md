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

## Review độc lập và một lượt sửa

- PR [#32](https://github.com/VinhDat267/ATI_Project/pull/32), chưa merge. Reviewer độc lập chạy lại immutable range `ab2c599..b3971d5`: check734v3+92eval, strict và browser12/12 exit0. Probes tại biên HTTP:16/20 đạt, bốn lỗi cùng I1; không gọi provider thật. CI của head b3971d5 xanh, nhưng chỉ là bằng chứng trước lượt sửa.
- I1 Important: query bỏ mất formula string/boolean, rollup, files, unique_id, place và verification. Regression RED8/55 (47 test cũ đạt) trước sửa; GREEN55/55 sau sửa. Giữ giá trị false/0, tên files (không URL tải ký số), mã ID, địa điểm, state/period/verifier; `[unsupported]`/`[unavailable]` phân biệt với giá trị rỗng.
- M1 đánh lại Important: relation.has_more bị bỏ có thể dẫn tới workflow thiếu dữ liệu. Sửa trong cùng pass bằng `[incomplete]`; rollup incomplete cũng có marker. Không truy vấn mở rộng property hoặc database liên quan, catalog mô tả snapshot có giới hạn. Chi phí nếu sai: marker ảnh hưởng consumer mong đợi chuỗi ID thuần. Không có minor hoãn lại.
- Không yêu cầu lượt review thứ hai; chủ task chịu trách nhiệm kiểm patch sửa, chạy lại toàn bộ bộ check và xác minh CI head cuối.

## Quyết định về phần reviewer không kết luận

| Phần reviewer chưa kết luận | Quyết định | Chi phí nếu sai |
| --- | --- | --- |
| 1. Provider/token/sharing/persistence/429/529 thật | W3-07, NOT_RUN; fixture không chứng minh live acceptance | Integration có thể chưa dùng được với tài khoản thật |
| 2. Model/Vietnamese/golden/semantic acceptance/rf06 | W3-06, NOT_RUN; chỉ ghi evidence offline hiện có | Model thực tế có thể hiểu sai yêu cầu |
| 3. Multi-source selector | Giữ quyết định chỉ một source vì input không có selector | Query/create từ chối database đa nguồn hợp lệ |
| 4. Select option mới/schema edit | Giữ quyết định chỉ option có sẵn, không thêm side effect | Một số yêu cầu create chưa hỗ trợ |
| 5. Regex gather | Theo common brief: service mới dùng llm search | Notion không được discovery trong regex mode |
| 6. Per-property pagination/synced/linked sources | Snapshot có giới hạn, có marker; không thêm fetch ngoài scope | Snapshot có thể chưa đầy đủ hoặc nguồn chưa đọc được |
| 7. Page bị di chuyển giữa parent read và PATCH | Giữ kiểm cha mới tại execution; không tuyên bố nguyên tử API ngoài | Page có thể bị di chuyển ra scope sau kiểm tra, trước ghi |
| 8. Throttle nhiều process/allowlist lớn/load | Limiter process-local, chưa benchmark production | Có thể vượt rate toàn integration hoặc chậm với allowlist lớn |
| 9. Auth/session/recovery/fencing toàn nền tảng | Ngoài diff service; regression không chứng nhận toàn hệ thống | Các rủi ro nền tảng hiện có vẫn tồn tại |
| 10. Lịch sử RED/mutation testing | RED do implementer ghi; reviewer chỉ rerun và probe độc lập | Provenance phụ thuộc log đã giữ; regression và commit bất biến bù lại |
| 11. CI/PR/merge/metadata | Root xác minh CI head cuối rồi Ready; chưa có yêu cầu merge32; state sửa sau merge | PR Ready có thể drift; metadata tiếp tục chờ merge/reviewer cập nhật |

## Kết quả sau sửa

- Commit sửa `c6b8d07`: property flattening và marker cùng tám regression mới. `npm run check` exit0: **742 v3 =44schema+204adapters+142planner+25executor+166API+161web**, **92 offline evaluations**; typecheck/build, production-secret scan, launcher1/local-env3 đạt. Strict test/harness typecheck exit0; full browser **12/12 exit0**.
- Browser lượt sau sửa đầu tiên dừng ở khởi động API với57P01 (terminating connection due to administrator command); container riêng ati-w303-pg đã dừng. Kiểm đúng ID ba308375b3ba7a5cc7104e04692b6ad5003f2ebc6c4c35bb5d361651dfb328e9 và nhãn ati.task=W3-03, khởi động lại, pg_isready đạt rồi chạy lại toàn bộ12/12. Không sửa source/guard, không restart database người dùng15433. Giữ cả failed log và rerun log riêng, không tính lần lỗi là PASS.
- Xác minh SHA256 năm file ngoài scope trên primary đều nguyên vẹn. Không commit .env/raw logs/provider details. CI cuối/Ready lấy theo [PR #32 checks](https://github.com/VinhDat267/ATI_Project/pull/32/checks); review độc lập không chạy lại, root chịu trách nhiệm patch sửa và CI đúng head trước Ready.
