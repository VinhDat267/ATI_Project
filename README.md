# ATI Workflow Automation Platform

Prototype nghiên cứu lập kế hoạch tool MCP có kiểm soát. **Cấu hình B/local đã được người dùng chọn ngày 13/09/2026**: retrieval + query expansion, replan cục bộ, polling 2 giây, task_hub dữ liệu local.

Đọc [bắt đầu](docs/00-BAT-DAU.md), [baseline](docs/BASELINE.md), [kế hoạch 6 tuần](docs/KE-HOACH-6-TUAN.md) và [kết quả sửa audit](docs/FIX-REPORT-2026-09-13.md).

## Trạng thái thực tế

- Có mã thư viện DSL, parser, validation, policy helpers, schema planner/API/event và kiểm thử hồi quy.
- Có DB package với runner 3 SQL migrations, Drizzle và seed thêm dữ liệu thiếu, không reset dữ liệu.
- MCP stdio task_hub chạy được 3 tool local: read_sheet_range, append_sheet_rows, send_slack_message. Writes kiểm approval/owner/version/payload trong DB; mutation và receipt cùng transaction.
- Có controller/engine CLI nhận plan tay: đọc → preview bất biến → một approval → write tuần tự → trace. Có cancel, recovery đánh dấu orphan và đối chiếu receipt chỉ đọc; xem [cách chạy](packages/engine/README.md) và [trạng thái engine](docs/ENGINE-STATUS-2026-09-13.md).
- apps/api, apps/web còn skeleton. HTTP/session/UI/polling, 5 task_hub tool còn lại, filesystem adapter và LLM/replan chưa triển khai. Bài kiểm tra receiver G1 dùng fixture; suite engine dùng controller thật.
- Không có kết quả thí nghiệm AI hoặc bằng chứng nhu cầu người dùng/rubric. Không coi SUCCEEDED là đúng nghiệp vụ.

## Lệnh dùng được

Node >=22. `npm ci` rồi `npm run check` kiểm typecheck, build bốn package, DSL tests, JSON Schema và OpenAPI; không cần API key hoặc Docker.

Để chạy phần G1 với Docker đang bật:

```powershell
npm run db:up:g1
npm run db:migrate:g1
npm run db:seed:g1
npm run check:engine
npm run engine -- prepare-b02
```

PostgreSQL dùng `127.0.0.1:55432/wap_g1`, Redis dùng `127.0.0.1:56379`; compose project/volume riêng. Integration tests tạo và dọn database `g1_it_*`/`engine_it_*` riêng, không reset database demo. `check:engine` kiểm cả DSL, DB/MCP và controller; `check:g1` chỉ kiểm đến receiver. `prepare-b02` chưa thực hiện write: xem và duyệt snapshot theo [hướng dẫn CLI](packages/engine/README.md). Chưa có `npm run dev` hoặc UI.

Bản gốc 40 file trước sửa nằm trong [archive](docs/archive/pre-fix-2026-09-13.zip). Audit ngày 12/09 là ảnh chụp lịch sử; đọc báo cáo sửa ngày 13/09 để biết trạng thái mới.
