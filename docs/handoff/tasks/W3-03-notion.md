# W3-03 · Notion

**Trạng thái:** đang review · **Nhánh:** `vinhdat/feat-w3-03-notion` · **Phụ thuộc:** W3-00 đã merge · **Làm song song với:** W3-01, W3-02, W3-04, W3-05

Đọc trước: [yêu cầu chung cho task thêm service](W3-service-common.md). Card này chỉ ghi phần riêng của Notion.

## Lưu ý về phiên bản API

Notion đã đổi mô hình dữ liệu ở các phiên bản API gần đây (database tách thành "data source", endpoint query và `parent` của page thay đổi). **Đọc tài liệu hiện hành trước khi code**, chọn một giá trị header `Notion-Version` cụ thể, ghi cố định trong adapter và ghi lại trong log. Task card dùng chữ "database" theo nghĩa người dùng thấy trên giao diện; agent ánh xạ sang đúng đối tượng API của phiên bản đã chọn và ghi rõ trong PR.

## Xác thực

- Internal integration token (người dùng tạo integration trong Notion, rồi "Connect" database thử nghiệm với integration đó; xem W3-07).
- `credentialFields`: `token` (`password`). Header `Authorization: Bearer …`, `Notion-Version: <đã chọn>`.

## Thiết kế service

- `id: 'notion'`, `name: 'Notion'`, `scopeKey: 'databases'`, `scopeLabel: 'Database ID'`, `scopePattern`: UUID 32 ký tự hex, có hoặc không có gạch nối. `normalizeAllowedScope` chuẩn hóa về một dạng duy nhất (chữ thường, có gạch nối) để so sánh allowlist không bị lệch.
- `intentKeywords`: `notion`. `fallbackIntentKeywords`: `ghi chú`, `wiki`, `tài liệu`.
- **Không** dùng `trang`, `page`, `database`, `note`: quá chung, trùng với Sheets ("trang tính") và nội dung tin nhắn.
- `checkConnection`: lấy thông tin database đầu tiên trong allowlist.
- Rate limit: trung bình khoảng 3 request/giây cho mỗi integration; tôn trọng `Retry-After`.

| Tool | Loại | Input | Output |
|---|---|---|---|
| `notion.search_databases` | read, `discovers: 'database'`, `listable` | `query` (có thể rỗng), `limit` ≤ 10 | `{ id, title, url }` của database trong allowlist |
| `notion.query_database` | read, `discovers: 'page'` | `databaseId` (`x-resource: 'database'`), `query` (lọc theo tiêu đề, tùy chọn), `limit` ≤ 20 | `{ pages: [{ id, title, url, properties }] }`; `properties` làm phẳng thành chuỗi |
| `notion.create_page` | write, `riskLevel: 'medium'` | `databaseId`, `title` (≤ 200), `content` (tùy chọn, văn bản thuần ≤ 4000, tách thành đoạn ≤ 2000 ký tự/khối), `properties` (tùy chọn: tên thuộc tính → chuỗi) | `{ id, url }` |
| `notion.append_text` | write, `riskLevel: 'medium'` | `pageId` (`x-resource: 'page'`), `text` (≤ 2000) | `{ pageId, blockIds, url }` |

- `create_page.properties` chỉ hỗ trợ các kiểu `rich_text`, `select`, `date`, `url`, `number`. Adapter đọc schema của database rồi chuyển đổi; thuộc tính không tồn tại hoặc kiểu khác → `VALIDATION` trước lệnh ghi.
- `append_text`: adapter đọc page trước, lấy database cha, **kiểm cha nằm trong allowlist** rồi mới ghi. Page không thuộc database nào trong allowlist → `AUTH_ERROR`, không ghi.
- Văn bản đưa vào dạng `rich_text` thuần, không diễn giải markdown.
- Không có tool xóa/lưu trữ page, sửa thuộc tính page đã có, hay đổi quyền chia sẻ.

## Ca định tuyến dễ nhầm (thêm vào test)

- "Ghi một dòng vào trang tính ATI Test Tracker" → Sheets, không có Notion.
- "Tạo page trong Notion ghi biên bản họp rồi báo Slack" → Notion + Slack.
- "Gửi tài liệu hướng dẫn lên kênh ati-test" khi Notion **chưa cấu hình** → Slack, không bị từ chối (Slack khớp nên `fallbackIntentKeywords` của Notion không được dùng).

## Sandbox

Kịch bản `notion_slack`: tạo page trong database → báo Slack kèm `url` của page.

## Tiêu chí riêng (ngoài tiêu chí chung)

- [x] Test header `Notion-Version` có trong mọi request và bằng giá trị đã chọn.
- [x] Test chuẩn hóa ID (có/không gạch nối, chữ hoa/thường) cho cả allowlist và tham số tool.
- [x] Test `append_text` từ chối page có cha ngoài allowlist, số lệnh ghi = 0.
- [x] Test `create_page` từ chối thuộc tính không tồn tại hoặc kiểu không hỗ trợ trước khi ghi; tách `content` dài thành nhiều khối đúng giới hạn.

## Kết quả (agent thi công điền)

- PR: sẽ bổ sung sau khi tạo; chưa merge.
- Commit: implementation `0b8086491cdf56c22d22dffce6d895c0a1261410`; snapshot riêng `c23e1aa94e63820c2121680a52b620174e7e55e7`; base `ab2c599` (Calendar #31 đã merge).
- Tài liệu API đã đọc ngày 03/10/2026, `Notion-Version: 2026-03-11`: [upgrade 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03), [upgrade 2026-03-11](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11), [retrieve database](https://developers.notion.com/reference/retrieve-database), [data source](https://developers.notion.com/reference/retrieve-a-data-source), [query](https://developers.notion.com/reference/query-a-data-source), [create page](https://developers.notion.com/reference/post-page), [retrieve page](https://developers.notion.com/reference/retrieve-a-page), [parent](https://developers.notion.com/reference/parent-object), [properties](https://developers.notion.com/reference/page-property-values), [append blocks](https://developers.notion.com/reference/patch-block-children), [limits](https://developers.notion.com/reference/request-limits), [errors](https://developers.notion.com/reference/status-codes).
- Test: foundation RED6/7 → GREEN14/14 với generic scope; adapter RED45/45 → GREEN45/45; property safety RED2/47 → GREEN47/47; API/sandbox/live config RED3/3 → GREEN3/3; browser Notion RED1/1 → GREEN1/1. Final `npm run check` exit0: **734 v3** (44 schema,196 adapters,142 planner,25 executor,166 API,161 web), **92 offline evaluations**; typecheck/build, production-secret scan, launcher1/local-env3 đạt. Strict test/harness typecheck exit0. Full browser **12/12 exit0**: HTTP/SSE + PostgreSQL thật, planner/adapters sandbox; cả hai step Notion→Slack succeeded và Slack chứa URL từ output_json của create_page.
- Snapshot: legacy72/72 giữ nguyên; full catalog chỉ thêm Notion vào hai fallback `golden:rf03` và `freeform:ff15`, có commit riêng và giải thích trong log. Không đổi prompt, label hoặc ngoại lệ rf06.
- Khác biệt: database allowlist giữ Database ID; query/create ánh xạ qua data source có đúng một nguồn, database đa nguồn trả VALIDATION trước ghi. Generic metadata `normalizeScopeEntry` bổ sung để API lưu UUID canonical, không thêm nhánh Notion trong core. Select phải là option có sẵn để không âm thầm đổi schema. Mọi 5xx ghi (kể cả529) giữ UNKNOWN theo spec5.4; 429 retry đúng một lần, Retry-After dài dừng thay vì retry sớm. Giới hạn scope/version này ghi trong log và PR.
- Chưa làm: Notion thật/provider NOT_RUN, lệnh ghi thật thuộc W3-07; model campaign W3-06. Service dùng planner search llm, không thêm regex gather. Không SDK/dependency, không sửa v2, prompt, policy router, executor, frontend sản phẩm, CURRENT-STATE hoặc ROADMAP. Review độc lập và CI head cuối sẽ bổ sung sau khi chạy.
