# Pilot MVP v2 — Runbook và cổng vận hành

**Trạng thái 25/09/2026:** `APPROVAL_API_DB_TESTED / OWNER_ISOLATION_BROWSER_TESTED / UC1_UC3_API_DB_BROWSER_TESTED_WITH_FIXTURES / SAAS_READ_PREFLIGHT_CONFIRMED / SAAS_ONE_CARD_CONFIRMED / LIVE_WRITE_DEFAULT_OFF / AI_QUALITY_NOT_RUN / HANDOFF_BLOCKED`. Xem [audit P6](plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md) và [baseline](BASELINE.md). Một lần write sandbox không cấp phép chạy batch hoặc production.

## 1. Phạm vi và những gì đang chạy

Mục tiêu đã duyệt: Google Sheets chỉ đọc → kiểm yêu cầu → AI lập kế hoạch → người dùng duyệt preview → tối đa một lệnh tạo card Trello → receipt/tra cứu. Có mã adapter, API `/pilot/v2`, UI pilot, dataset và unit test. `POST /pilot/v2/check` trả checklist pass/clarification/refusal mà không tạo run; `POST /pilot/v2/lookup` chỉ nhận định danh nguồn, tra reservation `confirmed` rồi đọc card hiện tại trên board allowlist. API và Chromium browser đã kiểm hai luồng này cùng owner isolation bằng PostgreSQL cô lập và Sheets/Trello giả. Các test fixture không đo AI source-aware; một ca SaaS thật riêng được ghi bên dưới. `live-preflight` có CLI chỉ đọc; `live-uc2-runner` và `live-eval-runner` vẫn chưa nối vào API/CLI vận hành.

Các điều kiện trước khi mở rộng live write vẫn **BLOCKED**:

- Approval HTTP đã lưu PostgreSQL, gắn owner/run/version/hash/list ID/hạn 10 phút và kiểm trước dispatch. Cờ ghi Trello vẫn tắt mặc định; một card sandbox đã xác nhận nhưng chưa có bằng chứng đủ để nâng trạng thái vận hành rộng hơn.
- Cấp nguồn approval bền vững cho runner UC2 độc lập trước khi dùng nó trong sản phẩm; runner hiện từ chối thiếu approval và chưa nối vào API/CLI.
- Owner isolation trên browser và các nhánh UC1/UC3 đã qua test local; còn mở rộng các nhánh UC2, AI source-aware, acceptance đại diện và live evidence riêng.
- Nguồn/board sandbox và một write đã có evidence riêng. AI vẫn cần provider, ngân sách/price card, rubric, freeze và đối chiếu riêng.

## 2. Cấu hình hiện có và giới hạn

`packages/engine/src/pilot/config.ts` đọc biến môi trường **của tiến trình API**: `PILOT_V2_ENABLED`, `PILOT_PRINCIPALS`, `PILOT_SPREADSHEET_ID`, `PILOT_TAB_ID`, `PILOT_BOARD_ID`, `PILOT_TRELLO_LIST_ID`, `GOOGLE_SHEETS_API_KEY`, `TRELLO_API_KEY`, `TRELLO_API_TOKEN`; nó cũng nhận `GOOGLE_SHEETS_CLIENT_EMAIL` và `GOOGLE_SHEETS_PRIVATE_KEY`. `PILOT_V2_WRITE_ENABLED=true` là cờ riêng cho dispatch Trello; không đặt cờ này chỉ để chạy preflight đọc. Repository hiện **không tự nạp `.env.pilot`**. Tạo file đó đơn thuần không cấu hình API; không commit credential vào Git.

Adapter Sheets hiện chỉ gắn API key vào URL. Nhánh service account chưa tạo token hoặc header `Authorization`, nên **bị chặn trước GET**; Sheet riêng tư cần bearer-token path đã kiểm thử. API key đã đọc được Sheet sandbox được chia sẻ phù hợp trong preflight ngày 25/09/2026. Router hiện từ chối khi thiếu/tắt config hoặc policy và không còn cấu hình pilot mặc định bật; unit HTTP đã kiểm các nhánh này. Preflight CLI không xác nhận đường API sản phẩm end-to-end.

## 3. Kiểm thử offline và preflight live

Lệnh dưới đây **chỉ chạy unit test với `fetch` giả**, không đọc Google Sheets/Trello thật và không chứng minh zero write trên SaaS:

```powershell
npm run test:unit -w @wap/engine -- tests/pilot-live-preflight.test.ts tests/pilot-live-uc2.test.ts tests/pilot-live-eval.test.ts
```

CLI operator đã có kiểm thử với transport giả. Đặt biến môi trường cho đúng Sheet, board, list, principal và credential trong tiến trình; giữ `PILOT_V2_WRITE_ENABLED=false`. Từ root repo, chạy một lần với đường dẫn evidence mới, ngoài Git nếu chứa định danh riêng:

```powershell
npm run build -w @wap/engine
$pilotPrincipal = Read-Host 'Exact allowlisted principal ID'
$pilotRequestId = Read-Host 'Exact Sheet request ID'
$evidencePath = Join-Path $env:TEMP ('pilot-v2-preflight-' + (Get-Date -Format 'yyyyMMddHHmmss') + '.json')
node packages/engine/dist/pilot/live-preflight-cli.js --principal $pilotPrincipal --request-id $pilotRequestId --output $evidencePath
```

CLI yêu cầu Git HEAD, giữ độc quyền file output trước network, không ghi đè file cũ và thoát khác 0 khi config/read thất bại. Artifact gồm HEAD, trạng thái dirty của worktree, principal, Sheet/tab/board/list, hash cấu hình, source revision, tóm tắt Trello và lỗi đã che query/secret; code path chỉ thực hiện GET. HEAD riêng lẻ không định danh chính xác mã đang chạy nếu worktree dirty. `writesAttempted: 0` là bằng chứng từ đường CLI/transport, chưa thay cho audit HTTP remote. **BE-26 live read preflight đã passed** lúc 01:28:47 UTC ngày 25/09/2026 trên Sheet `Requests`, request `REQ-SBX-001` và Trello sandbox. Artifact cục bộ `%TEMP%\pilot-v2-preflight-20260925082846.json` ghi HEAD `0d833c4`, `workingTreeDirty: false`, `writesAttempted: 0` (ngoài Git). Đây là bằng chứng đọc của CLI, chưa chứng minh live write hoặc luồng API end-to-end. API key chỉ dùng được khi Sheet được chia sẻ phù hợp; service account hiện bị chặn.

## 4. Duyệt và thực thi UC2 — chưa mở live

### Tạo preview API từ sandbox thật, không ghi Trello

`scripts/pilot-preview-sandbox.mjs` mở API loopback trong cùng tiến trình, tạo mật khẩu demo ngẫu nhiên trong bộ nhớ, đọc Sheet và list Trello thật, lưu run/approval vào PostgreSQL sandbox, GET preview rồi đóng API. Script **không** gọi endpoint approve, ép `pilotLiveWriteEnabled: false` và từ chối môi trường có `PILOT_V2_WRITE_ENABLED=true`. Dùng database riêng đã migrate và seed với tên `wap_pilot_preview_YYYYMMDD`; không dùng database production/demo chung. Nạp credential và ID sandbox vào tiến trình, rồi chạy từ root:

```powershell
$env:PILOT_TRELLO_LIST_ID = [Environment]::GetEnvironmentVariable('PILOT_TRELLO_LIST_ID', 'User')
$env:PILOT_V2_WRITE_ENABLED = 'false'
$env:PILOT_PREVIEW_DATABASE_URL = 'postgresql://wap:wap@127.0.0.1:55532/wap_pilot_preview_20260925'
$evidencePath = Join-Path $env:TEMP ('pilot-v2-preview-' + (Get-Date -Format 'yyyyMMddHHmmss') + '.json')
node scripts/pilot-preview-sandbox.mjs --request-id REQ-SBX-001 --output $evidencePath
```

Lần chạy ngày 25/09/2026 tạo một run `awaiting_approval` cho `REQ-SBX-001` với checklist pass, một action `trello.create_card` vào list `Cần làm`, `writesAttempted: 0`; artifact cục bộ `%TEMP%\pilot-v2-preview-20260925094801.json` ghi worktree dirty và hạn 10 phút. Preview hết hạn cần tạo lại và đối chiếu nguồn/snapshot mới; nó không cấp quyền ghi Trello. Trước run creation, API đọc list theo ID, gắn tên đã xác minh vào workflow version và snapshot. Nếu list đổi tên/đóng trước dispatch, adapter từ chối POST; cần preview/approval mới thay vì sửa snapshot cũ.

### Ca live một card đã xác nhận

Ngày 25/09/2026, chủ project cho phép tạo card theo preview trên. Vì preview cũ hết hạn, script `scripts/pilot-create-approved-card.mjs` tại commit `ed66ecd` đã dựng lại snapshot từ run cũ trong DB, đối chiếu nguồn và toàn bộ action với preview mới, kiểm board không có card cùng tên rồi gửi **một** quyết định approval qua API. Run `81fbbc5a-64e5-4d74-80e9-337a211447cd` đạt `succeeded`; approval DB là `approved`, business reservation là `confirmed`, và GET Trello xác minh ID/board/list/tên/mô tả/ngày hạn. Card: [Cập nhật trang chủ](https://trello.com/c/xnkPoAMa/1-c%E1%BA%ADp-nh%E1%BA%ADt-trang-ch%E1%BB%A7), ID `6ab60b4b91c37a7b0123ccf7`, list ID `6ab4cce14cc90102619825a1`. Artifact cục bộ `%TEMP%\pilot-v2-one-card-20260925124854.json` lưu HTTP 200, source revision không đổi, receipt và `remoteVerified: true`; file nằm ngoài Git. Database sandbox có đúng một reservation. Biến `PILOT_V2_WRITE_ENABLED` ở scope User/Process vẫn false sau lệnh. **Không chạy lại script để tạo card thứ hai**; nếu receipt hoặc trạng thái bị nghi ngờ, chỉ dùng tra cứu/đối chiếu đọc.

Trên đường API hiện có, `POST /pilot/v2/runs` đọc nguồn và lưu snapshot, workflow version, approval pending cùng hạn 10 phút trong PostgreSQL. `GET /pilot/v2/runs/:id` trả preview gồm `approvalId`, `versionId`, `snapshotHash`, `expiresAt` và action có list ID. `POST /pilot/v2/runs/:id/approve` yêu cầu đúng ba định danh đó và quyết định. Server khóa row, kiểm owner/version/hash/hạn bằng đồng hồ DB, ghi quyết định và trạng thái trước dispatch; replay trả 409. `PILOT_V2_WRITE_ENABLED` mặc định tắt nên `approved` trả `503 LIVE_WRITE_BLOCKED` và không thay approval. Khi cờ bật mà chưa có list ID, API trả `503 TARGET_NOT_BOUND`.

HTTP integration đã kiểm trên PostgreSQL cô lập với Trello `fetch` giả: duyệt một lần, đồng thời, replay qua API instance mới, operator B không xem/duyệt run A, version/source/list drift, hết hạn, từ chối, cờ tắt, receipt Trello thiếu ID, DB confirm thất bại và kết quả không chắc chắn. Các nhánh không chắc chắn giữ `unknown` và tối đa một POST. Approval hết hạn được đóng khi có yêu cầu API tiếp theo; run `running` cũ hơn 15 phút được chuyển `reconciliation_required` theo hướng không tự gửi lại. Đây là xử lý theo yêu cầu, chưa có cron sweep hay bằng chứng crash ở tiến trình thật. Không dùng runner P6 độc lập để tạo card: nó chưa nối vào approval store sản phẩm.

Browser Chromium đã qua 4 ca tại `apps/web/tests/live/pilot-approval.spec.ts` với API HTTP và PostgreSQL cô lập: tạo run/preview/từ chối trên UI; cờ ghi tắt trả `503` và giữ approval pending; approval hết hạn bị khóa; receipt chỉ hiện sau duyệt và một POST Trello giả, còn replay trả `409` kể cả sau khi tải lại trang. Test dùng nguồn Sheets giả và chặn mọi HTTPS ngoài Trello giả trong ca write; không chứng minh Google Sheets/Trello thật hoặc AI provider. Lệnh tái chạy: `npm run test:live -w @wap/web -- pilot-approval.spec.ts`.

Browser Chromium hiện có 7 ca tại `apps/web/tests/live/pilot-approval.spec.ts` và `apps/web/tests/live/pilot-use-cases.spec.ts`: năm ca approval/owner (gồm A xem run của mình, B nhận 404 với run của A), UC1 clarification và refusal không tạo run/approval/reservation/outbox hoặc gọi dịch vụ ngoài, và UC3 lấy card hiện tại từ reservation xác nhận bằng đúng một Trello GET, không gửi `cardId` từ browser và không có POST. Chạy bằng `npm run test:live -w @wap/web -- tests/live/pilot-approval.spec.ts tests/live/pilot-use-cases.spec.ts`. API integration đã kiểm check/lookup, payload thừa `cardId`, link chưa xác nhận và card bị Trello trả 404. Trong browser tests, Sheets/Trello vẫn là fixture; ca SaaS thật ở mục trên chạy qua API riêng.

Receipt chỉ hiện trên GET sau khi chính run đó đạt `succeeded`; `business_reservations` lưu list ID Trello thật để trả receipt khi một run được duyệt và tái sử dụng intent đã xác nhận. Dữ liệu confirmed cũ thiếu list ID được giữ để đối chiếu, không dựng list ID giả hoặc gửi lại card. Nếu run bị chuyển sang `reconciliation_required` trong lúc POST còn chờ, HTTP không báo `succeeded` dù Trello trả receipt muộn.

Khi các cổng ở mục 1 được đóng và một buổi live write được cho phép, người vận hành cần đối chiếu **nguồn, board/list, nội dung card, owner, snapshot hash và hạn 10 phút** trước quyết định. Ghi lại request/run/intent ID và receipt Trello; `succeeded` hoặc HTTP 200 riêng lẻ không chứng minh đúng nghiệp vụ. Nếu preview sai hoặc hết hạn, không duyệt và không cố tạo card bằng đường khác.

## 5. Timeout, kết quả không chắc chắn và đối chiếu

Nếu POST có thể đã tới Trello nhưng response, receipt hoặc DB confirm thất bại, coi kết quả là **unknown**, dừng mọi lần gửi tiếp theo cho cùng intent. Không tự retry, không xóa reservation và không tạo run mới chỉ vì chưa thấy card ngay trên UI Trello.

Người vận hành ghi lại run ID, intent key, thời điểm, lỗi đã redact và operation ID nếu có; đọc board đích theo `request_id`/`client_ref`, lưu card ID/URL ứng viên và thời điểm quan sát. Việc không tìm thấy card **chưa chứng minh** Trello không tạo card. Giữ trạng thái cần đối chiếu cho đến khi có quy trình xử lý được review và bằng chứng đủ mạnh; không tự gán `confirmed` hoặc `cancelled` từ một lần tìm kiếm thủ công.

## 6. Đánh giá AI và bàn giao

`runPilotQualityEvaluation` hiện kiểm luật trên fixture, dùng nhãn `expected` để chọn một số kết quả và **ước lượng** token/chi phí; không gọi provider. Kết quả 40/40 trong unit test là `SIMULATED_ONLY`, không phải accuracy, latency hay cost của AI thật. Contract runner mới tách oracle khỏi input, dùng nguồn/checklist và giữ output tại ranh giới model port trước validation/repair local để phát hiện write không an toàn; chưa chứng minh payload mạng thô của provider. Phase gate của nó chỉ cho chạy port mô phỏng và từ chối campaign measured. Chưa có pilot-specific retrieval index được duyệt, ledger bền vững, grader độc lập hoặc provider campaign. Google connectivity probe lịch sử cũng không thay thế đánh giá ứng dụng MVP v2.

Trước khi nâng `AI_QUALITY_MEASURED`, khóa dataset/holdout, prompt, model, catalog, price card, ngân sách và rubric; chạy provider thật với ledger usage, báo đủ từng ca và mọi lời gọi. `CUSTOMER_VALIDATED` chỉ nâng sau nghiệm thu với người dùng đại diện. Bàn giao pilot vẫn `HANDOFF_BLOCKED` cho đến khi có review và evidence cho từng cổng liên quan.
