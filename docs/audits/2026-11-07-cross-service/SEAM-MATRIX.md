# Ma trận đường nối

Mỗi ô là một đường dữ liệu giữa hai bước. PASS là có lệnh exit 0 trên nhánh này, hoặc đối chiếu schema ở pha 0. NOT_RUN chỉ khi chưa chạy được vì thiếu credential hoặc chưa được phép ghi.

| Đường | Kết quả | Cách kiểm |
|---|---|---|
| Plan sandbox 4, 5, 9 bước: mọi `${step.output.<khóa>}` có trong `outputSchema` | PASS | Pha 0, script nạp `@wap/tool-schemas`, `missing: []`. `trello.create_card.url` là optional |
| `mycalendar` che `calendar`, `mysheets` che `sheets`, `myjira` bỏ `jira` | PASS | Đọc `runtimeToolCatalog` và `serviceRegistryForRuntime`. Chưa có test runtime mới |
| OFF-02: Google đã nối, chưa chọn bảng tính → `mysheets.create_doc` | PASS | Catalog, `bindConnections`, `AdapterFactory`, readiness. 43 + 7 test exit 0 |
| OFF-03: cùng trạng thái Sheets → chưa sẵn sàng, không có `read_range` | PASS | `job-readiness.test.tsx`, catalog không chứa `read_range` |
| PM-01: Trello tạo thẻ không có `url` → Slack không nhận link rỗng | PASS | `createCard` ném `UNKNOWN`. Bước sau không chạy vì bước nguồn không `succeeded` |
| OFF-02: `schedule_meet` không có `meetLink` → không báo thành công | PASS | Adapter ném `UNKNOWN` sau một request |
| GitHub trả `htmlUrl` thay vì `url` → template `${issue.output.url}` fail | PASS | `resolver.test.ts`. Xanh trên mã resolver trước pha 1 |
| Báo cáo không có `reportEvidence` lúc duyệt | PASS | `report-evidence.test.ts` 12/12 trên PostgreSQL `127.0.0.1:56534`. Ca không truyền cờ: đỏ `success: true`, rồi xanh `409` và plan còn `pending` |
| Lượt lịch lưu plan | PASS | `planScheduledRun` gọi `prepareResponse`. Đoạn đó đặt `enforceReportGrounding: true` trước khi ghi. Không có test lịch mới |
| Biên nhận transition Jira `status` | PASS | `jira-cockpit.test.tsx` 12/12. Output adapter `{ status: 'Done' }` hiện `🔄 Trạng thái: Done` |
| Calendar `timeMax` hết ngày | PASS | `personal-calendar-adapter.test.ts` 29/29. Live sau khi nạp lại: `mycalendar.list_events` cho "hôm nay", `resultCount` 0, 0 plan, 0 execution step |
| Đọc provider thật rồi Hủy | PASS | Sau F8 và nạp lại server live. `github.list_pull_requests` chạy, `resultCount` 0. 0 plan, 0 execution step. Không có lệnh ghi |
| Playwright `nine_service` đối chiếu `output_json` | PASS | Sau khi giữ `jira.create_issue` cho kịch bản mẫu. Sandbox API 3017, web 5184, PostgreSQL local 55533. 1 passed, 11.2s. Plan `completed`. Slack chứa các khóa bước trước. Biên nhận hiện mã Jira, mã thư, mã tin Telegram và phạm vi Sheets. Link lịch/Trello/Notion nằm trong khối chi tiết của output |
| Notion, Trello chỉ đọc | PASS | Server live. Trello `usedDirectory` gồm `trello`, 1 bảng. Notion `usedDirectory` gồm `notion`, 2 database. Mỗi lượt 0 plan, 0 execution step |
| Trello thẻ → Slack link | PASS | Plan live bị hủy trước khi ghi. Bước 1 `trello.create_card` trên danh sách Cần làm. Bước 2 `slack.send_message` dùng `${step_1.output.url}`. Status `rejected`, 0 execution step |
| Notion trang → Slack link | PASS | Plan live bị hủy trước khi ghi. `notion.create_page` trong database Notes, rồi `slack.send_message` dùng `${create_page.output.url}`. Status `rejected`, 0 execution step |
