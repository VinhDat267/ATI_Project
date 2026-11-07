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
| Biên nhận transition Jira `newStatus` | FAIL | Schema có `status`. Chưa sửa. P2 |
| Calendar `timeMax` 23:59:59 | FAIL | Mã `personal-calendar-adapter.ts` vẫn vậy. P2 |
| Đọc provider thật rồi Hủy | NOT_RUN | Chưa mở app live |
| Playwright `nine_service` đối chiếu `output_json` | FAIL | Chạy sandbox trên cổng API 3017, web 5184, PostgreSQL local 55533. Banner: kế hoạch mẫu, không gọi dịch vụ thật. Không có nút duyệt. Lý do: "Jira chưa được kết nối hoặc chưa có tài nguyên được phép." Cùng màn: "Jira Đã kết nối" và "Jira đã được kết nối. Bạn có thể gửi lại yêu cầu." Không gian Cá nhân. Calendar và Sheets trên màn đó: Chưa kết nối. Chưa tới `output_json` |
| Notion, Trello credential thử | NOT_RUN | Preflight 05/11: Notion 401, Trello thiếu token |
