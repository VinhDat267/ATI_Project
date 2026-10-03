# W3-05 · Jira Cloud

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w3-05-jira` · **Phụ thuộc:** W3-00 đã merge · **Làm song song với:** W3-01, W3-02, W3-03, W3-04

Đọc trước: [yêu cầu chung cho task thêm service](W3-service-common.md). Card này chỉ ghi phần riêng của Jira.

## Lưu ý về API

Atlassian đã thay endpoint tìm kiếm cũ (`/rest/api/3/search`) bằng endpoint mới dùng JQL (`/rest/api/3/search/jql`). **Đọc tài liệu hiện hành**, dùng endpoint đang được hỗ trợ và ghi lại trong log. Nội dung mô tả và comment dùng Atlassian Document Format (ADF).

## Xác thực

- Jira Cloud (gói miễn phí), Basic auth bằng email + API token (người dùng tạo; xem W3-07).
- `credentialFields`: `siteUrl` (`text`), `email` (`text`), `apiToken` (`password`).
- **Chống SSRF:** `siteUrl` phải khớp chính xác `^https://[a-z0-9-]+\.atlassian\.net$` (không path, không cổng, không query). Sai dạng → từ chối khi lưu credentials và khi tạo adapter. Adapter chỉ gọi tới đúng host đó.

## Thiết kế service

- `id: 'jira'`, `name: 'Jira'`, `scopeKey: 'projects'`, `scopeLabel: 'Project key'`, `scopePattern: /^[A-Z][A-Z0-9_]{1,9}$/`.
- `intentKeywords`: `jira`, `ticket`. **Không** dùng `issue` (GitHub), `task`, `sprint`, `board`, `epic`, `story`: các từ này đã có trong câu mẫu Trello/GitHub (ví dụ "Phát hành Sprint từ Trello sang Slack" trong `MissionControlLaunchpad.tsx`) và sẽ làm câu Trello bị từ chối khi Jira chưa cấu hình.
- Entity key của issue Jira là `jira_issue` (không dùng `issue`, tránh lẫn với GitHub).
- `checkConnection`: `GET /rest/api/3/myself`.

| Tool | Loại | Input | Output |
|---|---|---|---|
| `jira.search_projects` | read, `discovers: 'project'`, `listable` | `query` (có thể rỗng), `limit` ≤ 10 | `{ key, id, name }` của project trong allowlist |
| `jira.search_issues` | read, `discovers: 'jira_issue'` | `projectKey` (`x-resource: 'project'`, `x-resource-field: 'key'`), `query` (tùy chọn), `limit` ≤ 20 | `{ issues: [{ id, key, title, status, url }] }` (`title` ← `summary`; thiếu `id` thì planner bỏ cả thực thể). Không `listable` (prefetch truyền `id` của project, không phải `key`) |
| `jira.create_issue` | write, `riskLevel: 'medium'` | `projectKey`, `summary` (1–255), `description` (tùy chọn, văn bản thuần ≤ 4000), `issueType` (tùy chọn) | `{ key, id, url }` |
| `jira.add_comment` | write, `riskLevel: 'medium'` | `issueKey` (`x-resource: 'jira_issue'`, `x-resource-field: 'key'`), `body` (1–4000) | `{ id, issueKey, url }` |

- **JQL do adapter dựng**, model không bao giờ gửi JQL: `project = "<KEY>" AND text ~ "<query đã escape>" ORDER BY updated DESC`. Escape `\` và `"`; có test chèn kiểu `x" OR project = OTHER OR text ~ "y`.
- `create_issue`: đọc danh sách issue type của project trước khi ghi. Có `issueType` mà không thuộc project → `VALIDATION`, thông báo kèm các tên hợp lệ. Không có `issueType` → dùng loại tên `Task` nếu project có, không thì loại chuẩn (không phải sub-task) đầu tiên; tên loại có thể khác nhau giữa các site, không viết cố định.
- `search_issues`: `query` rỗng thì bỏ điều kiện `text ~`. Ký tự đặc biệt của tìm kiếm văn bản (`+ - & | ! ( ) { } [ ] ^ ~ * ? \ :`) phải được escape hoặc bỏ để Jira không trả lỗi 400.
- `add_comment`: tiền tố của `issueKey` phải là project trong allowlist; ngoài ra đọc issue để xác nhận project thật (issue có thể đã bị chuyển project) **trước** khi ghi.
- Văn bản thuần chuyển thành ADF đơn giản (đoạn văn), không diễn giải wiki markup.
- Không có tool chuyển trạng thái, gán người, xóa issue hay comment.

## Ca định tuyến dễ nhầm (thêm vào test)

- "Tạo issue trong repo ati-test" → GitHub, không có Jira.
- "Phát hành Sprint từ Trello sang Slack" khi Jira **chưa cấu hình** → Trello + Slack, không bị từ chối.
- "Tạo ticket Jira cho lỗi đăng nhập và báo Slack" → Jira + Slack.
- "Tạo issue Jira …" → có Jira (router có thể chọn cả GitHub vì chữ `issue`; ghi nhận hành vi, golden set W3-06 sẽ đo model có chọn đúng Jira không).

## Sandbox

Kịch bản `jira_slack`: tạo issue Jira → báo Slack kèm `key` và `url` của step trước.

## Tiêu chí riêng (ngoài tiêu chí chung)

- [ ] Test `siteUrl`: chấp nhận đúng dạng; từ chối `http://`, có path, có cổng, host khác (`evil.com`, `x.atlassian.net.evil.com`), có `@`.
- [ ] Test JQL escape với chuỗi chèn và ký tự đặc biệt; `query` rỗng không có `text ~`; JQL gửi đi luôn có `project = "<KEY>"` thuộc allowlist.
- [ ] Test `add_comment` từ chối issue có tiền tố ngoài allowlist (số lần gọi `fetch` = 0) và issue đã chuyển sang project ngoài allowlist (không ghi).
- [ ] Test `create_issue` từ chối `issueType` không có trong project trước khi ghi; chọn loại mặc định đúng khi project không có `Task`.
- [ ] Test grounding: `projectKey`/`issueKey` lấy theo `x-resource-field: 'key'` được chấp nhận khi đã xuất hiện trong kết quả search, bị từ chối khi chưa.

## Kết quả (agent thi công điền)

- PR: [#34](https://github.com/VinhDat267/ATI_Project/pull/34), chưa merge; CI/Ready theo trạng thái PR trên commit cuối.
- Commit: feature `89266ad`, snapshot riêng `8bd61e5`, hai lớp JQL `a6a5a8f`, sửa grounding `979a196`; base `4a4553b` sau Telegram#33. Task/log cuối đi cùng PR.
- Tài liệu API đã đọc03/10/2026: [Issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/), [Issues](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/), [Projects](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/), [Comments](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/), [Basic auth](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/), [Rate limits](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/), [ADF](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/), [official OpenAPI](https://dac-static.atlassian.com/cloud/jira/platform/swagger-v3.v3.json). Endpoint mới search/jql, create metadata issueTypes phân trang.
- Test đã chạy: foundation RED5/7→GREEN7/7; adapter RED43/43→GREEN43/43; SQL integration RED1/1→GREEN1/1; sandbox/live RED2/2→GREEN2/2; browser Jira RED1/1→GREEN1/1; JQL RED2/44→GREEN44/44. Final check sau sửa review exit0 **874v3+94offline eval**, strict NodeNext tsc exit0; full browser **14/14 exit0** với PostgreSQL thật và key/URL step trước đi vào Slack output_json. Extra LF/CRLF site tests đã đạt từ trước; không ghi là fix RED/GREEN.
- Review độc lập Astra/xhigh ở `4a4553b..a550681`: C0/I1/M0, check868+94/strict/browser14 đạt, probes16/17. I1: planner chưa unwrap `{issues}` nên comment bị từ chối dù đã search. Root sửa một lượt TDD: RED6fail25pass→GREEN31/31, generic outputSchema collection extraction; SQL/factory/adapter/planner search→comment thật, user không nhập key, key giả vẫn bị từ chối. Root chạy lại nguyên probes trong thư mục riêng:17/17, native redirect không chuyển credentials và aborted201 body UNKNOWN không replay. Không review lượt hai; không có Minor hoãn.
- Điều chưa làm/khác card: live Jira/token/permission/custom required fields và model acceptance NOT_RUN (W3-07/W3-06), không live write; llm search, không regex gather theo common. Generic credential pattern thêm để chặn domain trước save/catalog, constructor độc lập. Subtask không hỗ trợ parent; metadata cap10x50, không partial default; shared5requests/sec process-local,429>30s dừng; Lucene punctuation bỏ theo card và quote/backslash escape hai lớp. Parent GET/comment không nguyên tử, allowlist lớn/đa process chưa benchmark. Không sửa v2/CURRENT-STATE/ROADMAP/UI sản phẩm/dependencies. Chi tiết và evidence trong [log](../log/2026-10-03-codex-W3-05-jira.md).
