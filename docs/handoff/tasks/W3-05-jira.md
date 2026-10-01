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
| `jira.search_issues` | read, `discovers: 'jira_issue'` | `projectKey` (`x-resource: 'project'`, `x-resource-field: 'key'`), `query` (tùy chọn), `limit` ≤ 20 | `{ issues: [{ key, summary, status, url }] }` |
| `jira.create_issue` | write, `riskLevel: 'medium'` | `projectKey`, `summary` (1–255), `description` (tùy chọn, văn bản thuần ≤ 4000), `issueType` (tùy chọn, mặc định `Task`) | `{ key, id, url }` |
| `jira.add_comment` | write, `riskLevel: 'medium'` | `issueKey` (`x-resource: 'jira_issue'`, `x-resource-field: 'key'`), `body` (1–4000) | `{ id, issueKey, url }` |

- **JQL do adapter dựng**, model không bao giờ gửi JQL: `project = "<KEY>" AND text ~ "<query đã escape>" ORDER BY updated DESC`. Escape `\` và `"`; có test chèn kiểu `x" OR project = OTHER OR text ~ "y`.
- `create_issue`: kiểm `issueType` có trong project (đọc danh sách issue type của project) trước khi ghi; không có → `VALIDATION`.
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
- [ ] Test JQL escape với chuỗi chèn; JQL gửi đi luôn có `project = "<KEY>"` thuộc allowlist.
- [ ] Test `add_comment` từ chối issue có tiền tố ngoài allowlist (số lần gọi `fetch` = 0) và issue đã chuyển sang project ngoài allowlist (không ghi).
- [ ] Test `create_issue` từ chối `issueType` không có trong project trước khi ghi.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Tài liệu API đã đọc (đường dẫn, ngày):
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
