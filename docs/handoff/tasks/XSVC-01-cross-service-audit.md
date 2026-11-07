# XSVC-01 · Kiểm toán liên dịch vụ

**Trạng thái:** Đọc live đã chạy, 0 plan và 0 execution step. F8 chưa sửa. · **Nhánh:** `docs/xsvc-01-cross-service-audit`

## Mục tiêu

Đối chiếu cách các dịch vụ truyền dữ liệu cho nhau và ghi bug có tái hiện. Không kiểm lại từng adapter. Không coi Playwright `nine_service` là đã đóng kiểm toán.

## Pha

- [x] **Pha 0.** Bản đồ 12 dịch vụ, 95 tool, placeholder của plan sandbox, và lệch với sáu việc demo. Xem [inventory](../../audits/2026-11-07-cross-service/INVENTORY.md).
- [x] **Pha 1, F1–F3.** Test đỏ rồi sửa.
- [x] **Pha 1, phần còn lại.** Cổng duyệt báo cáo mặc định bật. Resolver từ chối `htmlUrl` khi template hỏi `url`.
- [x] **Pha 2, browser.** `nine_service` pass sau khi sửa F7.
- [x] **Pha 2, đọc live.** Hai lượt chỉ đọc, 0 plan, 0 execution step. Không có preview để hủy. F8 chưa sửa.
- [ ] **Pha 3.** `FINDINGS.md` và `SEAM-MATRIX.md`. Chỉ sửa P0, hoặc P1 chặn demo, trên nhánh riêng.

## Kết quả pha 0 (07/11/2026)

- Ba plan sandbox không có placeholder nào thiếu khóa schema. `trello.create_card.url` là optional.
- F1: `mysheets.create_doc` chỉ vào catalog khi đã chọn ít nhất một bảng tính. UI `scope_required` cũng đòi bảng tính. Default `folderId` không đủ cho OFF-02.
- F2: adapter Trello đổi `url` thiếu thành `''`. Bước sau vẫn gửi được chuỗi rỗng.
- F3: `schedule_meet` có thể trả output không có `meetLink`. Template bước sau sẽ lỗi sau khi sự kiện đã tạo.
- F4: biên nhận transition tìm `newStatus`; schema có `status`.
- F5: `timeMax` 23:59:59 còn trong `resolveNaturalWindowFromQuery`.
- `ExecutionService` trong `server.ts` không bật `enforceReportGrounding`. `ChatService` bật lúc lưu plan. Pha 1 phải kiểm lượt lịch.
- Pha 0 commit `fa24e150`.

### 07/11/2026 — Pha 1, F1–F3

Test mới fail trước khi sửa, rồi pass.

- **F1.** OAuth MySheets còn active mà chưa chọn bảng tính: catalog có sáu tool Docs/Drive (`list_drive_files`, `create_drive_folder`, `create_doc`, `get_doc`, `append_doc_text`, `move_drive_file`) và không có `read_range`, `append_rows`, `create_sheet`. `bindConnections` nhận plan `create_doc`. `AdapterFactory` dựng adapter với `spreadsheets: []`. OFF-02 coi `scope_required` của mysheets là đủ; OFF-03 vẫn chưa sẵn sàng. Trạng thái API `scope_required` giữ nguyên.
- **F2.** `trello.create_card` thiếu `url` ném `UNKNOWN` sau khi Trello đã tạo thẻ. Không trả `url: ''`.
- **F3.** `mycalendar.schedule_meet` thiếu Meet link ném `UNKNOWN` sau khi sự kiện đã tạo.

Lệnh, đều exit 0:

- `npx vitest run tests/routes/mysheets-services.test.ts tests/services/adapter-factory.test.ts tests/services/mysheets-backend.test.ts --dir apps/chat-api` — 43 passed.
- `npx vitest run tests/trello-write.test.ts tests/calendar/personal-calendar-adapter.test.ts --dir packages/tool-adapters` — 32 passed.
- `npx vitest run tests/services/job-readiness.test.tsx --dir apps/chat-web` — 7 passed.

Chưa chạy `npm run check`, chưa chạy live, chưa làm F4/F5.

### 07/11/2026 — Pha 1, cổng duyệt và khóa `url`

- Test mới `constructed without the grounding flag` fail trước khi sửa: `approveAndStart` trả `success: true`, status 200. Sau khi mặc định `enforceReportGrounding` là bật và `server.ts` truyền `true`: trả 409, plan còn `pending`, adapter không được gọi.
- `report-evidence.test.ts`: 12/12 pass trên PostgreSQL loopback cổng 56534.
- Resolver: output chỉ có `htmlUrl` làm `${issue.output.url}` ném `property 'output.url' not found`. Test này xanh trước khi sửa resolver.
- `npm test -w @wap/chat-api` với `DATABASE_URL` cổng 56534: 2474 pass, 1 fail. Fail là timeout 5s của `conversation-history.integration.test.ts` ca phân trang 57 dòng. Chạy lại riêng file đó: 8/8 pass, ca đó 1397ms. Không phải hồi quy cổng báo cáo.
- `npx vitest run --dir packages/executor`: 56/56 pass.
- Ma trận và phát hiện: `docs/audits/2026-11-07-cross-service/SEAM-MATRIX.md`, `FINDINGS.md`.

### 07/11/2026 — Pha 2, browser nine_service

Sandbox, không gọi provider. Cổng API 3017 và web 5184 vì cổng 3000 đang có server. Test exit 1 trước nút duyệt. Lý do trên màn: Jira chưa có tài nguyên. Cùng màn nói Jira đã kết nối và mời gửi lại. Không gian Cá nhân. Chưa có bước thực thi nên chưa đối chiếu `output_json`. Đọc provider thật rồi Hủy chưa chạy.

### 07/11/2026 — F7

Ba kịch bản mẫu giữ `jira.create_issue` khi MyJira bật. Test catalog 9/9. Browser nine_service 1 passed, 11.2s, plan completed, biên nhận khớp output đã lưu.

### 07/11/2026 — Đọc live

Server live sẵn. Hai prompt chỉ đọc PR GitHub, không duyệt. Kết quả là `answer`, không phải plan. 0 execution step. Lượt có tên repository nói chưa tra được dữ liệu PR.
