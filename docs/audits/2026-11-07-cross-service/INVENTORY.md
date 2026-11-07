# Kiểm toán liên dịch vụ — bản đồ pha 0

**Ngày:** 07/11/2026. **Nhánh:** `docs/xsvc-01-cross-service-audit`. **HEAD lúc đọc:** `6e2d3bb9` trên `main` (bàn giao #279). **Chưa sửa mã sản phẩm.** Chưa gọi provider, chưa ghi dịch vụ thật.

Cách dựng: `node --import tsx` nạp `@wap/tool-schemas` (95 tên tool sau khi gộp trùng) và đối chiếu placeholder `${step.output.<khóa>}` trong `apps/chat-api/src/sandbox/scenarios.ts`. Khóa có dấu `?` là không nằm trong `required` của `outputSchema`. `resolveRef` (`packages/executor/src/resolver.ts`) ném lỗi khi khóa vắng hoặc `undefined`. Chuỗi rỗng vẫn được điền. Object bị `String()` thành `[object Object]`.

## 1. Mười hai dịch vụ trong registry runtime

| id | Kết nối | Khi nào planner thấy tool |
|---|---|---|
| trello | shared trong registry; OAuth cá nhân trên runtime | Có board đã chọn. Catalog gồm `TRELLO_TOOLS` + `TRELLO_OAUTH_TOOLS` |
| slack | shared | Credential + kênh trong scope. Live thêm `slack.read_messages` khi Slack có trong catalog |
| github | shared trong registry; OAuth cá nhân trên runtime | Có repo đã chọn. Catalog gồm `GITHUB_TOOLS` + `GITHUB_OAUTH_TOOLS`. Adapter ghi `html_url` của GitHub vào khóa `url` |
| sheets | shared, service account | Credential + spreadsheet trong scope. Bị **che** khi caller đã có `mysheets` |
| calendar | shared, service account | Credential + lịch trong scope. Bị **che** khi caller đã có `mycalendar` |
| notion | shared | Credential + database trong scope. Sandbox còn ghép `NOTION_OAUTH_TOOLS` |
| telegram | shared trong registry; bot cá nhân trên runtime | Có chat đã chọn |
| jira | shared | Credential + project trong scope. **Bị bỏ khỏi registry** khi `myjira` bật |
| gmail | personal | `GMAIL_ENABLED` và kết nối `active` của đúng người gọi |
| mycalendar | personal | Cờ bật và đã chọn ít nhất một lịch |
| mysheets | personal | Cờ bật và `allowedScope.spreadsheets` hoặc `selectedSpreadsheets` có ít nhất một phần tử. Cả tool Sheets lẫn Docs/Drive nằm trong cùng mảng |
| myjira | personal | Cờ bật và capability workspace có site |

`myslack` không có trong `serviceRegistryForRuntime`. `matchService` vẫn coi `myslack` là alias của `slack`. Stack Slack cá nhân không đi cùng catalog của sáu việc demo.

Nguồn: `packages/tool-schemas/src/registry/`, `apps/chat-api/src/config/gmail-tools-runtime.ts`, `apps/chat-api/src/services/registered-services.ts` (`getToolCatalogFor`).

## 2. Hai đường phối hợp

**Đường sandbox 4/5/9** (`fourServicePlan`, `fiveServicePlan`, `nineServicePlan`) dùng bản dùng chung: `calendar.create_event`, `jira.create_issue`, `github.create_issue`, `trello.create_card`, `notion.create_page`, `sheets.append_rows`, `gmail.send_message`, `telegram.send_message`, `slack.send_message`.

**Đường demo** (`CORE_JOBS` trong `apps/chat-web/src/services/job-readiness.ts`) dùng bản cá nhân:

| Việc | Dịch vụ card yêu cầu | Handoff dữ liệu cần có |
|---|---|---|
| OFF-02 | mycalendar, mysheets, gmail | `schedule_meet` → `meetLink`; `create_doc` → `url`; `gmail.send_message` → `id` |
| OFF-03 | mysheets, slack | `read_range` / `aggregate_rows` → renderer `sheet_summary` → `slack.send_message` `text` |
| PM-01 | trello, slack | `trello.create_card` → `url` trong tin Slack |
| PM-03 | myjira, slack | `myjira.search_issues` → renderer `jira_progress` → Slack; duyệt từng lượt |
| DEV-02 | github, slack | `github.list_pull_requests` → renderer `github_prs` → Slack |
| DEV-04 | github, slack | `github.list_issues` → renderer `github_issue_aging` → lịch Slack |

Playwright `nine_service` xanh không chứng minh sáu việc này.

## 3. Placeholder của plan sandbox

Mọi `${step_N.output.<khóa>}` trong ba plan đều có mặt trên `outputSchema` của tool nguồn. Không có placeholder mồ côi ở tầng schema.

| Plan | Cạnh | Schema |
|---|---|---|
| four | `jira.create_issue` → `key`, `url`; `notion.create_page` → `url`; `telegram.send_message` → `messageId` | có, và đều required |
| five | jira `key`/`url`; `github.create_issue` `url`; `trello.create_card` `url`; `sheets.append_rows` `updatedRange` | `url` của Trello là **optional** |
| nine | thêm `calendar.create_event` `url` (required), `gmail.send_message` `id` (required) | cùng lỗ `trello.create_card.url?` |

`packages/planner/src/slack-proposal-plan.ts` dùng cùng các khóa `url`, `id`, `updatedRange` cho lịch, GitHub, Gmail, Jira, Sheets, Trello.

## 4. Nguồn báo cáo

`REPORT_SOURCE_TOOLS` (`packages/tool-schemas/src/report-evidence.ts`) chỉ có bảy tool:

`github.list_pull_requests`, `github.list_issues`, `myjira.search_issues`, `jira.search_issues`, `mysheets.read_range`, `mysheets.aggregate_rows`, `sheets.read_range`.

`github.search_issues` có trong catalog đóng băng nhưng không phải nguồn báo cáo. `calendar.list_events`, `mycalendar.list_events`, `slack.read_messages`, `trello.search_cards` cũng không. Planner gỡ `reportEvidence` do model tự điền rồi bind từ observation (`packages/planner/src/planner.ts`). `myjira.search_issues` trả `{ issues: [...] }`; binder lấy `.issues` trước khi gọi renderer.

`ChatService` lúc lưu plan đặt `enforceReportGrounding: true` (`chat-service.ts`). `server.ts` tạo `ExecutionService` **không** truyền cờ này. Cổng duyệt chỉ kiểm evidence khi plan đã có `reportEvidence` hoặc khi cờ bật. Pha 1 phải chứng minh lượt lịch có đi qua đoạn lưu của `ChatService`.

## 5. Phát hiện đã thấy trên mã

Chưa có test mới. Chưa chạy live. Mức là đề xuất cho pha 1, chưa phải bug đã sửa.

### F1 — Docs/Drive chỉ mở khi đã chọn bảng tính

`getToolCatalogFor` thêm cả `MYSHEETS_TOOLS` chỉ khi `spreadsheets.length > 0` (`registered-services.ts` khoảng dòng 200). `personalMySheets` đặt `scope_required` với lý do "chưa chọn bảng tính" khi cả `selectedSpreadsheets` và `allowedScope.spreadsheets` rỗng (`services-routes.ts`). `workflow-context-guard.ts` vẫn nhận default chỉ có `folderId`.

OFF-02 cần `mysheets.create_doc` trong folder, không cần một bảng tính. Card việc sẽ báo cần chọn tài nguyên Sheets. Chọn một bảng không liên quan mới mở tool Docs. Đặc tả 04/11 mục 5 nói Docs/Drive phải có khi OAuth `drive.file` đã nối, kể cả chưa chọn spreadsheet. Handoff #277 ghi đã tách sáu tool Docs/Drive khỏi điều kiện đó; mã hiện tại không tách.

**Mức đề xuất:** P1. Không ghi nhầm đích. Chặn đúng cách thiết lập OFF-02. Workaround: chọn một bảng tính bất kỳ.

### F2 — Link thẻ Trello có thể là chuỗi rỗng

Schema `trello.create_card.url` không required. Adapter ghi `url: String(res.url || '')` (`packages/tool-adapters/src/trello/write-tools.ts`). `resolveRef` không ném lỗi với `''`. Bước Slack/Notion sau đó vẫn `succeeded` và gửi câu có link trống. Biên nhận Trello không hiện `url`, chỉ hiện member, checklist, hạn (`ReceiptMoment.tsx`).

**Mức đề xuất:** P1 cho PM-01 và plan five/nine. Cần một response fixture thiếu `url` để chứng minh chuỗi gửi. Chưa chạy fixture đó trong pha 0.

### F3 — `schedule_meet` có thể thành công mà không có `meetLink`

`mycalendar.schedule_meet` luôn gửi `conferenceData` (`personal-calendar-adapter.ts`). `normalizedEvent` chỉ gắn `meetLink` khi response có `hangoutLink` hoặc entry point video (`calendar-adapter.ts`). Schema đánh dấu `meetLink?`. Bước Gmail dùng `${...output.meetLink}` sẽ ném `Property 'output.meetLink' not found` **sau khi** sự kiện đã được tạo. Không có retry lệnh ghi đã thành công.

Ca composition OFF-02 (`evaluations/tests/current-flow-composition.test.ts`) giả định `meetLink` có mặt. Chưa thấy Google thật bỏ link.

**Mức đề xuất:** P1 nếu pha 1 tái hiện bằng response không có `hangoutLink`. Nếu adapter luôn nhận link từ fixture hiện có thì hạ P2.

### F4 — Biên nhận transition đọc khóa schema không có

`myjira.transition_issue` trả `status` (required), không có `newStatus`. `MyJiraReceiptMetrics` ưu tiên `out.newStatus`, rồi mới rơi xuống `out.status`. Nhánh `newStatus` không có dữ liệu schema. Trạng thái vẫn hiện qua nhánh sau.

**Mức đề xuất:** P2. Không làm sai lệnh ghi.

### F5 — Cửa sổ lịch tự nhiên vẫn dùng `timeMax` 23:59:59

`resolveNaturalWindowFromQuery` trong `personal-calendar-adapter.ts` đặt `timeMax` là `T23:59:59+07:00`. Calendar coi `timeMax` là cận trên loại trừ. Sự kiện bắt đầu đúng giây cuối ngày bị bỏ. Đã ghi ở CURRENT-STATE từ 18/10. Pha 0 chỉ xác nhận mã vẫn vậy.

**Mức đề xuất:** P2, không chặn sáu việc demo trừ khi câu demo hỏi "hôm nay" và sự kiện nằm ở giây cuối.

## 6. Việc pha 1 phải khóa bằng test

1. Catalog: OAuth mysheets active, `spreadsheets: []`, `folderId` hợp lệ → `mysheets.create_doc` có hoặc không có trong catalog. Kỳ vọng theo đặc tả là có. Kỳ vọng theo mã hiện tại là không.
2. Executor: output `trello.create_card` với `url: ''` → chuỗi Slack chứa link thật hoặc bị từ chối trước khi gửi.
3. Executor: `schedule_meet` không có `meetLink` → bước sau không gửi Gmail, và sự kiện đã tạo không bị gọi lại.
4. Dispatch: plan báo cáo không có `reportEvidence` đi qua `ExecutionService` của `server.ts` (cờ tắt) → duyệt bị từ chối hoặc được ghi là lỗ hổng.
5. Đột biến một khóa output (GitHub trả `htmlUrl` thay vì `url`) phải làm đúng ca truyền field fail.

## 7. Chưa xem

Live read + Hủy, browser `nine_service` đối chiếu `output_json`, và sáu persona thuộc pha 2. Notion 401 và Trello thiếu token giữ nguyên từ preflight 05/11. Không retry `OFF-03` `create_sheet`.

## Phụ lục — 95 tool và khóa output bậc một

Dấu `?` = không required. Mảng lồng (`events[]`, `issues[]`, `pages[]`) không liệt kê từng field con.

### Catalog đóng băng `ALL_TOOLS` (33)

| Tool | Effect | Output keys |
|---|---|---|
| `trello.search_boards` | read | id, name, url? |
| `trello.search_lists` | read | id, name, boardId |
| `trello.search_members` | read | id, fullName, username? |
| `trello.search_cards` | read | id, name, url?, listId?, boardId?, due?, dueComplete?, idMembers?, labels? |
| `trello.get_card` | read | id, name, desc?, url?, listId?, boardId?, due?, dueComplete?, idMembers?, labels?, checklists? |
| `trello.create_card` | write | id, name, url?, listId?, dueComplete? |
| `trello.update_card` | write | id, name, url?, listId?, dueComplete? |
| `trello.add_member` | write | id, idMembers |
| `trello.add_checklist` | write | id, name, items? |
| `slack.search_channels` | read | id, name, isPrivate? |
| `slack.send_message` | write | ts, channel |
| `github.search_repos` | read | id, name, fullName, url |
| `github.search_issues` | read | id, number, title, url, repo |
| `github.get_issue` | read | id, number, title, url, repo, body, labels |
| `github.create_issue` | write | id, number, title, url, repo |
| `github.add_label` | write | number, labels, repo, url |
| `sheets.list_spreadsheets` | read | id, title, url |
| `sheets.list_sheets` | read | id, title, spreadsheetId, headers? |
| `sheets.read_range` | read | range, values, truncated?, headers?, records?, totalDataRows? |
| `sheets.append_rows` | write | spreadsheetId, updatedRange, updatedRows, skippedDuplicates?, url |
| `calendar.list_calendars` | read | id, title, timeZone |
| `calendar.list_events` | read | events, truncated? |
| `calendar.create_event` | write | id, title, start, end, url |
| `notion.search_databases` | read | id, title, url |
| `notion.query_database` | read | pages, schema?, truncated? |
| `notion.create_page` | write | id, url |
| `notion.append_text` | write | pageId, blockIds, url |
| `telegram.list_chats` | read | id, title, type |
| `telegram.send_message` | write | messageId, chatId, date |
| `jira.search_projects` | read | key, id, name |
| `jira.search_issues` | read | issues |
| `jira.create_issue` | write | id, key, url |
| `jira.add_comment` | write | id, issueKey, url |

### OAuth và tool mở rộng

| Tool | Effect | Output keys |
|---|---|---|
| `github.get_pull_request` | read | id, number, title, url, repo, body, labels, state?, isPullRequest? |
| `github.update_issue` | write | id, number, title, url, repo, state, labels?, assignees? |
| `github.add_comment` | write | id, issueNumber, body, repo, url |
| `github.list_issues` | read | id, number, title, url, repo |
| `github.list_pull_requests` | read | id, number, title, url, repo, state, author?, draft? |
| `trello.add_comment` | write | id, cardId, text |
| `trello.create_list` | write | id, name, boardId |
| `trello.remove_member` | write | id, idMembers |
| `trello.update_checklist_item` | write | id, cardId, name, state |
| `trello.set_card_due_complete` | write | id, name, dueComplete |
| `telegram.read_messages` | read | messages |
| `sheets.search_rows` | read | sheet, headers, totalMatched, matches |
| `sheets.aggregate_rows` | read | sheet, totalRowsScanned, matchedRows, groups, totals |
| `sheets.update_rows` | write | spreadsheetId, updatedRange, updatedRows, updatedCells, unmatchedKeys?, url |
| `sheets.delete_rows` | write | spreadsheetId, sheet, deletedRows, deletedRowNumbers, url |
| `sheets.create_sheet` | write | id, title, spreadsheetId, headers?, url |
| `notion.get_page` | read | id, title, url, properties, content, blocks, lastEditedTime?, truncated? |
| `notion.update_page` | write | id, url, updatedProperties?, archived? |
| `slack.read_messages` | read | channel, messages |

### Cá nhân

| Tool | Effect | Output keys |
|---|---|---|
| `gmail.search_threads` | read | id, subject, from, to?, cc?, snippet, date, labels?, messageCount, unread, hasAttachment?, attachmentNames?, participants |
| `gmail.get_thread` | read | id, subject, participants, messages |
| `gmail.list_labels` | read | id, name, type |
| `gmail.send_message` | write | id, threadId |
| `gmail.reply` | write | id, threadId |
| `gmail.forward` | write | id, threadId |
| `gmail.create_draft` | write | id, messageId, threadId |
| `gmail.modify_thread_labels` | write | id, labelIds |
| `gmail.batch_modify_threads` | write | ids, labelIds |
| `gmail.trash_thread` | write | id |
| `gmail.create_label` | write | id, name |
| `mycalendar.list_calendars` | read | id, title, timeZone |
| `mycalendar.list_events` | read | events, truncated? |
| `mycalendar.get_event` | read | id, title, description?, start, end, url, location?, meetLink?, attendeesCount?, recurrence? |
| `mycalendar.find_free_slots` | read | calendarId, busyCount, freeSlots |
| `mycalendar.create_event` | write | id, title, start, end, url, location?, meetLink?, attendees?, attendeesCount?, recurrence? |
| `mycalendar.update_event` | write | id, title, start, end, url, location?, meetLink?, attendees?, attendeesCount?, recurrence? |
| `mycalendar.delete_event` | write | id, deleted |
| `mycalendar.schedule_meet` | write | id, title, start, end, url, location?, meetLink?, attendees?, attendeesCount?, recurrence? |
| `mysheets.list_spreadsheets` | read | id, title, url |
| `mysheets.list_sheets` | read | id, title, spreadsheetId, headers? |
| `mysheets.read_range` | read | range, values, truncated?, headers?, records?, totalDataRows? |
| `mysheets.search_rows` | read | sheet, headers, totalMatched, matches |
| `mysheets.aggregate_rows` | read | sheet, totalRowsScanned, matchedRows, groups, totals |
| `mysheets.append_rows` | write | spreadsheetId, updatedRange, updatedRows, skippedDuplicates?, url |
| `mysheets.update_rows` | write | spreadsheetId, updatedRange, updatedRows, updatedCells, unmatchedKeys?, url |
| `mysheets.delete_rows` | write | spreadsheetId, sheet, deletedRows, deletedRowNumbers, url |
| `mysheets.create_sheet` | write | id, title, spreadsheetId, headers?, url |
| `mysheets.list_drive_files` | read | id, title, mimeType, url |
| `mysheets.create_drive_folder` | write | id, title, mimeType?, url |
| `mysheets.create_doc` | write | id, title, url, folderId? |
| `mysheets.get_doc` | read | id, title, content, url, truncated? |
| `mysheets.append_doc_text` | write | id, title, url |
| `mysheets.move_drive_file` | write | id, folderId, url |
| `myjira.list_sites` | read | id, siteId, cloudId, name, url |
| `myjira.search_projects` | read | siteId, id, key, name |
| `myjira.search_issues` | read | issues |
| `myjira.create_issue` | write | siteId, id, key, url |
| `myjira.add_comment` | write | siteId, id, issueKey, url |
| `myjira.get_issue` | read | siteId, id, key, url, title, status, description, priority?, assignee?, issueType?, labels?, dueDate?, comments |
| `myjira.search_users` | read | id, siteId, accountId, displayName |
| `myjira.transition_issue` | write | siteId, id, key, status, url |
| `myjira.update_issue` | write | siteId, id, key, url |
