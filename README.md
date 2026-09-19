# ATI Workflow Automation Platform

Prototype nghiên cứu lập kế hoạch tool MCP có kiểm soát. **Cấu hình B/local đã được người dùng chọn ngày 13/09/2026**: retrieval + query expansion, replan cục bộ, polling 2 giây, task_hub dữ liệu local.

Đọc [bắt đầu](docs/00-BAT-DAU.md), [baseline](docs/BASELINE.md), [kế hoạch 6 tuần](docs/KE-HOACH-6-TUAN.md) và [kết quả sửa audit](docs/FIX-REPORT-2026-09-13.md).

## Trạng thái thực tế

- Có mã thư viện DSL, parser, validation, policy helpers, schema planner/API/event và kiểm thử hồi quy.
- Có DB package với runner 7 SQL migrations (qua `0007_ai_reviewed_catalog_index.sql`), Drizzle và seed thêm dữ liệu thiếu với `ON CONFLICT DO NOTHING`, không reset dữ liệu.
- MCP stdio `task_hub` chạy đủ 8 tool local: `read_sheet_range`, `append_sheet_rows`, `send_slack_message`, `list_cards`, `get_card`, `list_members`, `create_card`, `move_card`. Writes kiểm approval/owner/version/payload trong DB; mutation và receipt cùng transaction; destination lock và approval expiry được bảo toàn.
- Có controller/engine CLI nhận plan tay: đọc → preview bất biến → một approval → write tuần tự → trace. Có cancel, recovery đánh dấu orphan và đối chiếu receipt chỉ đọc; xem [cách chạy](packages/engine/README.md) và [trạng thái task_hub & engine](docs/TASK-HUB-STATUS-2026-09-13.md).
- FS-05 đạt **TECHNICAL PASS** cho controller hai server MCP thật. Catalog công khai có 10 tool: 8 `task_hub` và 2 `filesystem` (`read_file`, `write_file`); filesystem mặc định tắt và chỉ bật qua launch policy đã duyệt. Fresh FS-06 gate đạt **258 passed, 1 skipped** (P11 native file-symlink phụ thuộc capability host). Xem [filesystem status và manual guide](docs/G1-FILESYSTEM-STATUS-2026-09-13.md).
- G1 tổng thể vẫn **PARTIAL** (`TECHNICAL_PASS_OVERALL_PARTIAL`): backend API-GATE đã đạt `API_TECHNICAL_PASS`, nhưng rubric chính thức và công việc nhóm đại diện còn `OPEN`; browser nối live API/session, polling 2 giây và đánh giá AI còn `NOT_RUN`. `apps/web` mới có WEB-01B fixture shell ở trạng thái `PROVISIONAL_IMPLEMENTATION`; chưa có bằng chứng browser với API/DB/LLM runtime. Xem [system design](docs/superpowers/specs/2026-09-15-platform-system-design.md) trước khi mở rộng frontend.
- AI-00 có **offline slice đã triển khai và main-verified**; AI-01 đang **PARTIAL_MAIN_VERIFIED**: catalog 8+2 chỉ được lấy sau gateway review, index pgvector exact có provenance/atomic activation và test DB cô lập. AI-04 có offline synthetic harness/freeze/holdout riêng, nhưng live model, provider latency/quality và overall AI evaluation vẫn `AI_EVALUATION_NOT_RUN`; overall live gate chưa đóng. Xem [AI status](docs/AI-STATUS-2026-09-17.md), [AI design](docs/superpowers/specs/2026-09-17-ai-backend-design.md) và [AI plan](docs/superpowers/plans/2026-09-17-ai-backend.md).
- Không có kết quả thí nghiệm AI hoặc bằng chứng nhu cầu người dùng/rubric. Không coi SUCCEEDED là đúng nghiệp vụ.

## Lệnh dùng được

Node >=22. `npm ci` rồi `npm run check` kiểm typecheck, build package, DSL tests, JSON Schema và OpenAPI; không cần API key hoặc Docker. Fixture UI có thể chạy bằng `npm run dev -w @wap/web`; live API/polling vẫn chưa được nối.

Để chạy phần G1 với Docker đang bật:

```powershell
npm run build
npm run db:up:g1
npm run db:migrate:g1
npm run db:seed:g1
npm run fs:demo:setup
npm run check:engine
npm run engine -- prepare testdata/dev-hand-plans/th-move.json
```

PostgreSQL dùng `127.0.0.1:55532/wap_g1`, Redis dùng `127.0.0.1:56379`; compose project/volume riêng. Integration tests tạo và dọn database `g1_it_*`/`engine_it_*` riêng, không reset database demo. Fresh FS-06 `check:engine` kiểm 39 DSL, 92 engine unit pass + 1 skip, 64 MCP/DB integration và 63 engine integration — tổng **258 passed, 1 skipped**. `prepare testdata/dev-hand-plans/th-move.json` chuẩn bị preview chuyển card c1 sang Done: gán các biến định danh từ JSON trả về của prepare rồi duyệt bằng `npm run engine -- approve $runId $approvalId $versionId $snapshotHash` theo [hướng dẫn CLI](packages/engine/README.md). Demo filesystem write phải theo [manual guide có bước dừng trước approval](docs/G1-FILESYSTEM-STATUS-2026-09-13.md). Seed không ghi đè dữ liệu sửa đổi trước đó và không đặt lại card đã move về Doing. Fixture UI chạy bằng `npm run dev -w @wap/web`; live API/polling chưa được nối.

Bản gốc 40 file trước sửa nằm trong [archive](docs/archive/pre-fix-2026-09-13.zip). Audit ngày 12/09 là ảnh chụp lịch sử; đọc báo cáo sửa ngày 13/09 và [trạng thái task_hub](docs/TASK-HUB-STATUS-2026-09-13.md) để biết trạng thái mới.
