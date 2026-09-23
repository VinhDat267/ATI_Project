# AI Automation Platform

Đây là monorepo TypeScript cho prototype điều phối workflow có bước **xem trước → người dùng duyệt → thực thi → đối chiếu kết quả**. `ATI_Project`, `ati-*` và `@wap/*` là tên kỹ thuật/lịch sử được giữ để tương thích. Phạm vi sản phẩm hiện hành là **MVP v2 cho nhóm dịch vụ thiết kế/web**; nền B/local trước đó vẫn có trong repository để phát triển và đối chứng.

> **Trạng thái 23/09/2026:** owner isolation và UC1/UC3 đã qua API, PostgreSQL và Chromium với Sheets/Trello giả; UC2 approval đã qua API/DB/browser với Trello giả. Google Sheets/Trello thật, chất lượng AI provider trên bộ v2 và nghiệm thu người dùng đại diện **chưa chạy**. `PILOT_V2_WRITE_ENABLED` tắt mặc định; pilot vẫn `HANDOFF_BLOCKED`. Xem [baseline](docs/BASELINE.md) và [runbook](docs/PILOT-V2-RUNBOOK.md) trước khi diễn giải kết quả test.

## Team nên đọc gì trước?

1. [Baseline hiện hành](docs/BASELINE.md): phạm vi đã duyệt, điều gì đã triển khai và điều gì còn mở.
2. [Đặc tả MVP v2](docs/superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md): UC1–UC3, safety và tiêu chí đánh giá.
3. [Runbook pilot](docs/PILOT-V2-RUNBOOK.md): cấu hình, approval, xử lý kết quả ghi không chắc chắn.
4. [Kế hoạch SaaS live và AI quality](docs/plans/2026-09-22-mvp-v2-backend/07-SAAS-LIVE-AI-QUALITY-PLAN.md): thứ tự cổng, điều kiện dừng và bằng chứng cần có trước handoff.
5. [Execution contract](docs/EXECUTION-CONTRACT.md) trước khi sửa mã liên quan đến quyền, side effect hoặc recovery. Quy tắc agent cục bộ (nếu có) nằm ngoài Git và không thay thế hợp đồng này.

## Sản phẩm làm gì?

Mục tiêu MVP v2 là đọc **một Google Sheet được allowlist**, kiểm tra yêu cầu, chuẩn bị kế hoạch và bản xem trước, để đúng chủ run duyệt, tạo tối đa **một Trello card** trên board/list thử nghiệm được chỉ định, rồi lưu receipt và tra cứu lại card. UC1 kiểm tính đầy đủ/mâu thuẫn của yêu cầu; UC2 chuẩn bị và tạo việc sau approval; UC3 tra card đã liên kết bằng mã yêu cầu. Hai principal có lịch sử run riêng, không xem hoặc duyệt chéo.

MVP v2 **không** bao gồm ghi ngược Sheet, gửi Slack/email thật, scheduler, workflow editor, arbitrary tools, shared approval, multi-tenant production hoặc tự chạy lại write sau crash. Đăng nhập ứng dụng không tự cấp quyền đọc Google/Trello. [Functional requirements](docs/functional-requirements.md), [API contract](docs/API.md) và [dataset contract](docs/MVP-V2-DATASET.md) là các tài liệu chi tiết hơn.

### Trạng thái theo trục bằng chứng

| Trục | Đã được kiểm | Còn thiếu |
|---|---|---|
| Hợp đồng và UI pilot | API/DB integration cho approval, owner isolation, UC1/UC3; 7 ca Chromium với dịch vụ giả | Chưa chứng minh AI source-aware và SaaS thật trên đường sản phẩm |
| SaaS live | Adapter, policy và test giả lập | `SAAS_LIVE_NOT_RUN`: chưa GET Sheet/Trello thật hoặc tạo/đối chiếu một card thật |
| AI quality v2 | Dataset 20 tình huống × vi/en = 40 record; holdout 10 × vi/en = 20 record; test mô phỏng | `AI_QUALITY_NOT_RUN`: runner P6 không gọi provider và còn dùng oracle để chọn một số kết quả |
| Người dùng đại diện | Phạm vi và Design System đã được chủ project duyệt | `CUSTOMER_VALIDATED_NOT_RUN`; chưa có acceptance với người dùng đại diện |

`PASS` của unit/fixture không nâng trạng thái SaaS hoặc AI. Google connectivity probe của nền AI cũ chỉ chứng minh kết nối ở phạm vi probe, không đo chất lượng nghiệp vụ MVP v2. Chi tiết lỗi chặn và phần đã sửa nằm trong [audit P6](docs/plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md).

## Kiến trúc và thư mục

```text
apps/web              React/Vite UI; fixture mặc định và live-mode HTTP
apps/api              HTTP API, session/OIDC tùy chọn, /pilot/v2, worker
apps/mcp-task-hub     MCP stdio với 8 tool trên dữ liệu PostgreSQL local
packages/dsl          Workflow DSL, schema, validation, OpenAPI contract
packages/db           SQL migrations, Drizzle, seed, kết nối PostgreSQL
packages/engine       Controller/CLI, policy, gateway, AI, pilot adapters
testdata              Plan/dataset cho B/local và dataset v2 tái dựng
docs                  Baseline, spec, runbook, kế hoạch, báo cáo/evidence
scripts               Local launch và các cổng kiểm chứng
System Design         Design System và quyết định giao diện đã duyệt
```

Đường **B/local** là controller nhận plan tay hoặc planner fixture, đọc qua MCP local, lưu snapshot/approval trong PostgreSQL rồi gọi write local sau duyệt. Tên tool như `send_slack_message` hoặc `append_sheet_rows` ở `task_hub` là hành vi **local**, không gửi tới Slack/Google thật. [Engine CLI](packages/engine/README.md) và [task_hub](apps/mcp-task-hub/README.md) mô tả đường này.

Đường **MVP v2** dùng `/pilot/v2` trong API, adapter Google Sheets/Trello và `business_reservations` trong PostgreSQL. UC2 dùng approval DB gắn owner, run, version, snapshot hash, list đích và TTL 10 phút; API chỉ cho dispatch khi cờ write riêng được bật. Timeout sau khả năng đã gửi POST được giữ ở `reconciliation_required`, không retry mù. Ba runner P6 (`live-preflight`, `live-uc2-runner`, `live-eval-runner`) hiện chưa là lệnh/API vận hành của sản phẩm; runner evaluation hiện chỉ mô phỏng.

Đường **AI B/local** có provider ports, retrieval semantic/QE, index pgvector và cơ chế approval/accounting. Pipeline đánh giá live của đường này có [runbook riêng](docs/ai-evidence/AI-LIVE/READINESS-RUNBOOK.md). Không dùng kết quả B/local để tuyên bố quality của MVP v2.

## Bắt đầu trên máy phát triển

Yêu cầu: Node.js `^22.12.0` hoặc `>=24`, npm theo lockfile; Docker chỉ cần cho các bước PostgreSQL/integration. Trên Windows, chạy lệnh từ root repository bằng PowerShell. Cổng loopback trong [compose.g1.yaml](compose.g1.yaml) là PostgreSQL `127.0.0.1:55532` và Redis `127.0.0.1:56379`; Redis hiện có trong compose nhưng queue MVP dùng PostgreSQL outbox.

### 1. Kiểm mã offline, không cần API key hoặc Docker

```powershell
npm ci
npm run check
```

`check` chạy typecheck, build, unit tests và sinh lại JSON Schema/OpenAPI. Nó **không** chứng minh SaaS live hay AI quality. Để chỉ xem UI với dữ liệu mô phỏng:

```powershell
npm run dev -w @wap/web
```

Mở `http://127.0.0.1:5173`. Build/dev mặc định dùng fixture và hiển thị nhãn dữ liệu mô phỏng; không cần khởi động API. Xem [web README](apps/web/README.md) cho các mode và test browser.

### 2. Khởi động hạ tầng và demo B/local

```powershell
npm run db:up:g1
npm run db:migrate:g1
npm run db:seed:g1
npm run check:engine
npm run engine -- prepare testdata/dev-hand-plans/th-move.json
```

`prepare` mới tạo preview, **chưa ghi**. Để xem, duyệt và execute đúng snapshot, lấy `run_id`, `approval.id`, `workflow_version_id`, `approval.snapshot_hash` từ JSON trả về và làm theo [hướng dẫn CLI](packages/engine/README.md). Seed thêm dữ liệu còn thiếu mà không reset volume; chạy lại một plan write vẫn có thể tạo side effect local mới. Test integration dùng database cô lập và dọn sau khi chạy; không dùng database demo làm database evaluator AI.

### 3. Chạy API và UI nối API khi cần

API yêu cầu `G1_DATABASE_URL`, `API_DEMO_EMAIL`, `API_DEMO_PASSWORD_HASH` và `API_CURSOR_KEY`. `API_PLANNER_MODE` mặc định `disabled`; `dev_fixture` chỉ nhận prompt mẫu. Chuẩn bị cấu hình theo [.env.example](.env.example) và [API README](apps/api/README.md), nạp biến vào **tiến trình chạy** rồi mở hai terminal:

```powershell
# Terminal API, sau khi nạp môi trường đã kiểm
npm run api:dev

# Terminal web riêng, dùng HTTP transport
npm run dev -w @wap/web -- --mode live
```

`.env.example` là mẫu, không tự được launcher nạp. API mặc định bind `127.0.0.1:3001`; web dev dùng `127.0.0.1:5173`. Mode `live` của UI nghĩa là nối HTTP API, **không** tự chứng minh SaaS hoặc AI provider đang live. OIDC là cấu hình tùy chọn; [API README](apps/api/README.md) và [OIDC preparation](docs/auth-evidence/OIDC-01/STAGING-PREP.md) nêu ranh giới của từng mode.

## Cấu hình pilot và API key

Các bước offline ở trên không cần Google/Trello/AI API key. Trước khi thử tài nguyên thật, đặt credential ở môi trường server, không đặt trong browser, prompt, README hoặc Git:

| Nhóm | Biến cần xem | Trạng thái/giới hạn |
|---|---|---|
| Pilot target | `PILOT_V2_ENABLED`, `PILOT_PRINCIPALS`, `PILOT_SPREADSHEET_ID`, `PILOT_TAB_ID`, `PILOT_BOARD_ID`, `PILOT_TRELLO_LIST_ID` | Chỉ dùng ID nguồn/board/list sandbox đã allowlist; bật pilot không tự bật write |
| Google Sheets read | `GOOGLE_SHEETS_API_KEY` **hoặc** `GOOGLE_SHEETS_CLIENT_EMAIL` + `GOOGLE_SHEETS_PRIVATE_KEY` | Adapter hiện gắn API key; nhánh service account **chưa tạo bearer token**, nên Sheet riêng tư cần hoàn thiện auth trước preflight live |
| Trello read/write | `TRELLO_API_KEY`, `TRELLO_API_TOKEN` | Cần quyền trên board/list thử nghiệm; write còn bị chặn bởi cờ riêng |
| Trello write gate | `PILOT_V2_WRITE_ENABLED=true` | Mặc định tắt; chỉ bật cho phiên một card đã được duyệt và có kế hoạch đối chiếu |
| AI B/local | `OPENAI_API_KEY` hoặc `GEMINI_API_KEY` theo provider/profile | Cấu hình provider ở server; không đồng nghĩa runner quality v2 đã hoạt động |
| AI evaluation | `AI_EVAL_DATABASE_URL`, approval, freeze, price card, budget | Evaluator B/local dùng DB riêng; v2 provider-backed evaluation còn nằm trong kế hoạch triển khai |

Repository hiện **không tự nạp `.env.pilot`**. Chỉ tạo file đó không cấu hình API. Cổng và trình tự cho SaaS/AI nằm trong [plan tổng hợp](docs/plans/2026-09-22-mvp-v2-backend/07-SAAS-LIVE-AI-QUALITY-PLAN.md), [plan SaaS](docs/superpowers/plans/2026-09-23-pilot-v2-saas-live.md) và [plan AI quality](docs/superpowers/plans/2026-09-23-pilot-v2-ai-quality.md). Chưa có lệnh operator đã kiểm chứng cho BE-26 live preflight; đừng dùng unit test P6 làm lệnh live.

## Kiểm thử và ý nghĩa kết quả

| Lệnh từ root | Kiểm gì | Cần gì |
|---|---|---|
| `npm run check` | Typecheck, build, unit, schema/OpenAPI | Node/npm; không cần key/Docker |
| `npm run check:backend` | `check` + MCP/engine/API integration | Docker PostgreSQL local; test DB cô lập |
| `npm run check:web` | Gate web và browser theo script | Chromium/Playwright và các dependency local của script |
| `npm run test:live -w @wap/web -- tests/live/pilot-approval.spec.ts tests/live/pilot-use-cases.spec.ts` | Browser API/DB cho UC1–3, approval, owner | PostgreSQL cô lập; Sheets/Trello là fixture |
| `npm run test:unit -w @wap/engine -- tests/pilot-live-preflight.test.ts tests/pilot-live-uc2.test.ts tests/pilot-live-eval.test.ts` | Contract của ba runner P6 | `fetch` giả; **không** phải live evidence |
| `npm run ai:eval:live -- preflight --offline` | Cổng offline của evaluator B/local | Không gọi provider; **không** đo quality v2 |

`npm run check:backend` và browser tests có thể mất thời gian và tạo database test tạm. Với lỗi port Docker trên Windows, kiểm tra bảng TCP excluded-port trước khi đổi mapping hoặc động tới volume. Dữ liệu và kết quả cũ trong `docs/*-evidence` là evidence của lần chạy được ghi ngày; đọc commit, điều kiện và nhãn trước khi trích dẫn.

## Cách team tiếp tục

1. Chọn việc từ [roadmap backend v2](docs/plans/2026-09-22-mvp-v2-backend/00-ROADMAP.md) và xác nhận nó thuộc MVP v2 hay nền B/local.
2. Giữ invariant trong [execution contract](docs/EXECUTION-CONTRACT.md): policy trước tool, preview bất biến, owner/version/hash/TTL trước write, kết quả không chắc chắn cần đối chiếu.
3. Viết test đúng tầng: unit/fixture cho hợp đồng, PostgreSQL/HTTP/browser cho runtime local, artifact remote riêng cho SaaS, ledger/provider thật riêng cho AI. Cập nhật nhãn `NOT_RUN` chỉ khi có bằng chứng tương ứng.
4. Với UI, theo [System Design đã duyệt](System%20Design/DESIGN.md); thay đổi thiết kế cần chủ project review. Với thao tác live, theo [runbook pilot](docs/PILOT-V2-RUNBOOK.md) và không bật write trước khi qua các cổng.

Mốc tiếp theo là hoàn thiện preflight chỉ đọc và các regression gate UC2, sau đó mới xác nhận tài nguyên thử nghiệm, một write SaaS có approval và phép đo AI provider có budget. **Không coi repository này đã sẵn sàng bàn giao SaaS live hoặc production.**
