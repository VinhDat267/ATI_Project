# AI Automation Platform

Tên sản phẩm hiện tại là **AI Automation Platform**. Các định danh kỹ thuật
`ATI_Project`, `ati-*` và `@wap/*` được giữ nguyên để tương thích với môi trường
hiện có; tên ATI trong báo cáo và evidence cũ là tên lịch sử.

**Scope đích đã duyệt ngày 21/09/2026:** hỗ trợ điều phối nhóm dịch vụ thiết kế/web,
Google Sheets chỉ đọc → AI lập kế hoạch → người dùng duyệt → tạo card Trello.
Xem [baseline MVP v2](docs/BASELINE.md), [roadmap backend](docs/plans/2026-09-22-mvp-v2-backend/00-ROADMAP.md) và [audit P6](docs/plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md).
API pilot đã lưu approval trong PostgreSQL và kiểm owner/run/version/hash/TTL trước dispatch; đường này đã được kiểm bằng HTTP với Trello giả lập. Ghi Trello mặc định vẫn khóa bằng `PILOT_V2_WRITE_ENABLED` và cần `PILOT_TRELLO_LIST_ID` cố định.
Live Sheets/Trello, chất lượng AI và nghiệm thu sản phẩm
vẫn `NOT_RUN`/`OPEN`; chưa bàn giao vận hành.

Nền kỹ thuật **B/local được chọn ngày 13/09/2026** vẫn được giữ:
retrieval + query expansion, replan cục bộ, polling 2 giây, task_hub dữ liệu local.
Các số G1/FS-06 bên dưới là evidence B/local, không phải nghiệm thu MVP v2.

Đọc [bắt đầu](docs/00-BAT-DAU.md), [baseline](docs/BASELINE.md), [kế hoạch 6 tuần](docs/KE-HOACH-6-TUAN.md) và [kết quả sửa audit](docs/FIX-REPORT-2026-09-13.md).

## Trạng thái thực tế

- MVP v2 có adapter Google Sheets/Trello, reservation trong PostgreSQL, API
  `/pilot/v2`, UI pilot và dataset tái dựng 40 biến thể + 20 biến thể holdout. API vẫn chưa
  chứng minh đủ UC1 refusal/UC3 lookup/AI source-aware end-to-end; các runner
  BE-26..28 chưa nối vào đường API. Unit test P6 pass trên mock, không có
  bằng chứng SaaS live hoặc AI quality. [Runbook](docs/PILOT-V2-RUNBOOK.md)
  hiện ghi `HANDOFF_BLOCKED` và các cổng phải đóng trước live.
- Có mã thư viện DSL, parser, validation, policy helpers, schema planner/API/event và kiểm thử hồi quy.
- Có DB package với runner migrations, Drizzle và seed thêm dữ liệu thiếu với `ON CONFLICT DO NOTHING`, không reset dữ liệu; migration pilot mới nhất là `0011_business_reservations.sql`.
- MCP stdio `task_hub` chạy đủ 8 tool local: `read_sheet_range`, `append_sheet_rows`, `send_slack_message`, `list_cards`, `get_card`, `list_members`, `create_card`, `move_card`. Writes kiểm approval/owner/version/payload trong DB; mutation và receipt cùng transaction; destination lock và approval expiry được bảo toàn.
- Có controller/engine CLI nhận plan tay: đọc → preview bất biến → một approval → write tuần tự → trace. Có cancel, recovery đánh dấu orphan và đối chiếu receipt chỉ đọc; xem [cách chạy](packages/engine/README.md) và [trạng thái task_hub & engine](docs/TASK-HUB-STATUS-2026-09-13.md).
- FS-05 đạt **TECHNICAL PASS** cho controller hai server MCP thật. Catalog công khai có 10 tool: 8 `task_hub` và 2 `filesystem` (`read_file`, `write_file`); filesystem mặc định tắt và chỉ bật qua launch policy đã duyệt. Fresh FS-06 gate đạt **258 passed, 1 skipped** (P11 native file-symlink phụ thuộc capability host). Xem [filesystem status và manual guide](docs/G1-FILESYSTEM-STATUS-2026-09-13.md).
- G1 tổng thể vẫn **PARTIAL** (`TECHNICAL_PASS_OVERALL_PARTIAL`): backend API-GATE đã đạt `API_TECHNICAL_PASS`; WEB-03 đã đạt `WEB_BROWSER_EXERCISED_PASS` với fixture browser, live API/DB browser E2E, polling và bundle/cleanup gate. Rubric chính thức và công việc nhóm đại diện còn `OPEN`; application-level provider-backed LLM E2E/quality evaluation vẫn `NOT_RUN`. Visual Design System đã được người dùng chốt tại [System Design](System%20Design/DESIGN.md); representative-user UX acceptance vẫn `OPEN`. Xem [system design](docs/superpowers/specs/2026-09-15-platform-system-design.md) trước khi mở rộng frontend và [web status](docs/WEB-STATUS.md).
- AI-00 có **offline slice đã triển khai và main-verified**; AI-01 đang **PARTIAL_MAIN_VERIFIED**: catalog 8+2 chỉ được lấy sau gateway review, index pgvector exact có provenance/atomic activation và test DB cô lập. API AI mode hiện đã có durable PostgreSQL authorization/accounting theo run/user; application-level live provider E2E, latency/quality và overall AI evaluation vẫn `AI_EVALUATION_NOT_RUN` (Google connectivity probe đã pass riêng). Live-freeze CLI hiện khóa theo approval budget, price card và index evidence thật, không chấp nhận placeholder. Xem [AI status](docs/AI-STATUS-2026-09-17.md), [AI design](docs/superpowers/specs/2026-09-17-ai-backend-design.md) và [AI plan](docs/superpowers/plans/2026-09-17-ai-backend.md).
- Chưa có kết quả chất lượng AI cấp ứng dụng MVP v2 hoặc bằng chứng nhu cầu người dùng/rubric chính thức. Không coi `SUCCEEDED` là đúng nghiệp vụ.

## Lệnh dùng được

Node >=22. `npm ci` rồi `npm run check` kiểm typecheck, build package, DSL tests, JSON Schema và OpenAPI; không cần API key hoặc Docker. `npm run check:web` kiểm browser fixture + live API/DB fixture, polling, bundle và cleanup; `npm run check:full` chạy cả backend và web gate.

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

PostgreSQL dùng `127.0.0.1:55532/wap_g1`, Redis dùng `127.0.0.1:56379`; compose project/volume riêng. Integration tests tạo và dọn database `g1_it_*`/`engine_it_*` riêng, không reset database demo. Fresh FS-06 `check:engine` kiểm 39 DSL, 92 engine unit pass + 1 skip, 64 MCP/DB integration và 63 engine integration — tổng **258 passed, 1 skipped**. `prepare testdata/dev-hand-plans/th-move.json` chuẩn bị preview chuyển card c1 sang Done: gán các biến định danh từ JSON trả về của prepare rồi duyệt bằng `npm run engine -- approve $runId $approvalId $versionId $snapshotHash` theo [hướng dẫn CLI](packages/engine/README.md). Demo filesystem write phải theo [manual guide có bước dừng trước approval](docs/G1-FILESYSTEM-STATUS-2026-09-13.md). Seed không ghi đè dữ liệu sửa đổi trước đó và không đặt lại card đã move về Doing. Fixture UI chạy bằng `npm run dev -w @wap/web`; live browser evidence xem [WEB-STATUS](docs/WEB-STATUS.md).

Bản gốc 40 file trước sửa nằm trong [archive](docs/archive/pre-fix-2026-09-13.zip). Audit ngày 12/09 là ảnh chụp lịch sử; đọc báo cáo sửa ngày 13/09 và [trạng thái task_hub](docs/TASK-HUB-STATUS-2026-09-13.md) để biết trạng thái mới.
