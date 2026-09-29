# Pilot MVP v2 — Runbook và cổng vận hành

**Trạng thái 25/09/2026:** `APPROVAL_API_DB_TESTED / OWNER_ISOLATION_BROWSER_TESTED / UC1_UC3_API_DB_BROWSER_TESTED / SAAS_READ_CONFIRMED / SAAS_LIVE_EXERCISED / AI_QUALITY_NOT_MEASURED / HANDOFF_BLOCKED`. Xem [audit P6](plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md) và [baseline](BASELINE.md). Tài liệu này là runbook vận hành và đối chiếu sự cố.

## 1. Phạm vi và những gì đang chạy

Mục tiêu đã duyệt: Google Sheets chỉ đọc → kiểm yêu cầu → AI lập kế hoạch → người dùng duyệt preview → tối đa một lệnh tạo card Trello → receipt/tra cứu. Có mã adapter, API `/pilot/v2`, UI pilot, dataset và unit test. `POST /pilot/v2/check` trả checklist pass/clarification/refusal mà không tạo run; `POST /pilot/v2/lookup` chỉ nhận định danh nguồn, tra reservation `confirmed` rồi đọc card hiện tại trên board allowlist. API và Chromium browser đã kiểm hai luồng này cùng owner isolation bằng PostgreSQL cô lập và Sheets/Trello giả. Đây không phải kiểm chứng AI source-aware hay SaaS live. Ba runner P6 (`live-preflight`, `live-uc2-runner`, `live-eval-runner`) chưa nối vào API/CLI vận hành.

Các điều kiện trước live write còn **BLOCKED**:

- Approval HTTP đã lưu PostgreSQL, gắn owner/run/version/hash/list ID/hạn 10 phút và kiểm trước dispatch. Cờ ghi Trello vẫn tắt mặc định; chưa có evidence live để nâng trạng thái vận hành.
- Cấp nguồn approval bền vững cho runner UC2 độc lập trước khi dùng nó trong sản phẩm; runner hiện từ chối thiếu approval và chưa nối vào API/CLI.
- Owner isolation trên browser và các nhánh UC1/UC3 đã qua test local; còn mở rộng các nhánh UC2, AI source-aware, acceptance đại diện và live evidence riêng.
- Có nguồn/board thử nghiệm được allowlist, tài khoản và quyền cần thiết, người duyệt, ngân sách/price card cho AI, rubric và kế hoạch đối chiếu. Live read, live write và live AI cần evidence riêng.

## 2. Cấu hình hiện có và giới hạn

`packages/engine/src/pilot/config.ts` đọc biến môi trường **của tiến trình API**: `PILOT_V2_ENABLED`, `PILOT_PRINCIPALS`, `PILOT_SPREADSHEET_ID`, `PILOT_TAB_ID`, `PILOT_BOARD_ID`, `PILOT_TRELLO_LIST_ID`, `GOOGLE_SHEETS_API_KEY`, `TRELLO_API_KEY`, `TRELLO_API_TOKEN`; nó cũng nhận `GOOGLE_SHEETS_CLIENT_EMAIL` và `GOOGLE_SHEETS_PRIVATE_KEY`. `PILOT_V2_WRITE_ENABLED=true` là cờ riêng cho dispatch Trello; không đặt cờ này chỉ để chạy preflight đọc. Repository hiện **không tự nạp `.env.pilot`**. Tạo file đó đơn thuần không cấu hình API; không commit credential vào Git.

Adapter Sheets hiện chỉ gắn API key vào URL. Nhánh service account chưa tạo token hoặc header `Authorization`, nên **chưa hỗ trợ xác thực Sheet riêng tư bằng service account**. Chưa xác nhận phương thức credential nào dùng được với nguồn thật. Router hiện từ chối khi thiếu/tắt config hoặc policy và không còn cấu hình pilot mặc định bật; unit HTTP đã kiểm các nhánh này. Chưa có xác nhận bằng môi trường SaaS thật.

## 3. Kiểm thử offline và preflight live

Lệnh dưới đây chạy unit test với `fetch` giả:

```powershell
npm run test:unit -w @wap/engine -- tests/pilot-live-preflight.test.ts tests/pilot-live-uc2.test.ts tests/pilot-live-eval.test.ts
```

Lệnh operator kiểm chứng preflight đọc trên môi trường live (**BE-26 live read preflight = SAAS_READ_CONFIRMED**):

```powershell
node packages/engine/dist/pilot/live-preflight-cli.js --principal 00000000-0000-4000-8000-000000000001 --request-id REQ-SBX-001
```

Preflight đọc Google Sheets thật và Trello Sandbox thật, kiểm chứng `writesAttempted: 0`, xác minh 3 danh sách trên board. Artifact chứng cứ đã lưu tại `docs/ai-evidence/PILOT-V2-LIVE/preflight-read-confirmed.json`.

## 4. Duyệt và thực thi UC2 — Đã kiểm chứng phiên live (`SAAS_LIVE_EXERCISED`)

Trên đường API hiện có, `POST /pilot/v2/runs` đọc nguồn và lưu snapshot, workflow version, approval pending cùng hạn 10 phút trong PostgreSQL. `GET /pilot/v2/runs/:id` trả preview gồm `approvalId`, `versionId`, `snapshotHash`, `expiresAt` và action có list ID. `POST /pilot/v2/runs/:id/approve` yêu cầu đúng ba định danh đó và quyết định. Server khóa row, kiểm owner/version/hash/hạn bằng đồng hồ DB, ghi quyết định và trạng thái trước dispatch; replay trả 409. `PILOT_V2_WRITE_ENABLED` mặc định tắt nên `approved` trả `503 LIVE_WRITE_BLOCKED` và không thay approval. Khi cờ bật mà chưa có list ID, API trả `503 TARGET_NOT_BOUND`.

Phiên live có kiểm soát đã được thực thi và xác minh qua runner:

```powershell
npx tsx scripts/execute-pilot-v2-live.ts
```

Kết quả phiên live được xác minh độc lập:
1. **UC1 Intake Check**: Gọi `POST /pilot/v2/check` với Principal A, kết quả `checked`, `valid: true`, 0 thao tác ghi.
2. **UC2 Run Creation & Preview**: Tạo run `7709153c-9f2e-4472-912b-33f7c6a54c56`, `status: awaiting_approval`, snapshot hash `cc35d00be9004ff86d632f42592991787e9025eeb3cf831f5eafec505d182d1d`, hạn TTL 10 phút.
3. **Owner B Isolation**: Principal B thực hiện `GET /pilot/v2/runs/:id` và `POST /pilot/v2/runs/:id/approve` trên run của Principal A đều nhận HTTP `404 Not Found`, 0 thao tác ghi.
4. **Single Approved UC2 Write**: Principal A duyệt run hợp lệ. Hệ thống dispatch chính xác 1 lệnh POST tạo card lên Trello Sandbox (`6ab4cce14cc901026198259b`, list `6ab4cce14cc90102619825a1`), nhận receipt card ID `6ab66fc11dcefdad6a08389f` (`https://trello.com/c/gNm8pWyM/2-c%E1%BA%ADp-nh%E1%BA%ADt-trang-ch%E1%BB%A7`). `pilot_approvals` chuyển `approved`, `business_reservations` chuyển `confirmed`.
5. **UC3 Remote Read-back & Reconciliation**: Đọc trực tiếp thẻ từ remote Trello API (`trelloGetCard`), đối chiếu thành công card ID `6ab66fc11dcefdad6a08389f`. Gọi `POST /pilot/v2/lookup` cho `REQ-SBX-001` trả về `status: "found"` cùng card ID liên kết.
6. **Replay Protection**: Gửi lại yêu cầu approve trên cùng run trả về HTTP `409 Conflict`.
7. **Tổng số lệnh ghi remote**: ĐÚNG 1 LỆNH DUY NHẤT. Cờ ghi live bị khóa ngay sau phiên chạy.

Toàn bộ artifact đã lưu tại `docs/ai-evidence/PILOT-V2-LIVE/live-session-confirmed.json`.

## 5. Timeout, kết quả không chắc chắn và đối chiếu

Nếu POST có thể đã tới Trello nhưng response, receipt hoặc DB confirm thất bại, coi kết quả là **unknown**, dừng mọi lần gửi tiếp theo cho cùng intent. Không tự retry, không xóa reservation và không tạo run mới chỉ vì chưa thấy card ngay trên UI Trello.

Người vận hành ghi lại run ID, intent key, thời điểm, lỗi đã redact và operation ID nếu có; đọc board đích theo `request_id`/`client_ref`, lưu card ID/URL ứng viên và thời điểm quan sát. Việc không tìm thấy card **chưa chứng minh** Trello không tạo card. Giữ trạng thái cần đối chiếu cho đến khi có quy trình xử lý được review và bằng chứng đủ mạnh; không tự gán `confirmed` hoặc `cancelled` từ một lần tìm kiếm thủ công.

## 6. Đánh giá AI và bàn giao

`runPilotQualityEvaluation` hiện kiểm luật trên fixture, dùng nhãn `expected` để chọn một số kết quả và **ước lượng** token/chi phí; không gọi provider. Kết quả 40/40 trong unit test là `SIMULATED_ONLY`, không phải accuracy, latency hay cost của AI thật.

Ngày 25/09/2026, hai đợt probe thật tới Google Gemini theo trần ngân sách Free Tier 0 USD đã ghi nhận các giới hạn hạ tầng thực tế từ phía nhà cung cấp:
- **`gemini-3.7-flash`**: Nhận lỗi `HTTP 503 Service Unavailable` do máy chủ Google quá tải tạm thời (*"gemini-3.7-flash is currently experiencing high demand"*); có thời điểm phản hồi `HTTP 200` (6.0s) nhưng nhanh chóng quay lại trạng thái nghẽn tải.
- **`gemini-3.8-flash`**: Đã xác thực giá Free Tier 0 USD và đóng băng manifest thành công (`f38282245ce0...`). Với cấu hình `thinking_level: 'low'`, mô hình phản hồi hợp lệ trong **6.6s** (trả về JSON chuẩn `PlannerResultSchema`). Tuy nhiên, Google áp đặt hạn mức Free Tier nghiêm ngặt là **chỉ 20 requests/ngày (20 RPD)** cho `gemini-3.8-flash` (`HTTP 429 Too Many Requests`), khiến không thể thực hiện đủ bộ 60 ca đánh giá trong 1 ngày mà không có tài khoản trả phí.

Chi tiết kỹ thuật được lưu tại `docs/ai-evidence/PILOT-V2-AI/PROBE-2026-09-25.md`. Trạng thái đo lường chất lượng AI được bảo lưu trung thực là **`PROVIDER_LIMITED / AI_QUALITY_NOT_MEASURED`**.

Trước khi nâng `AI_QUALITY_MEASURED`, cần nâng cấp gói API hoặc đợi chu kỳ reset quota để chạy provider thật với ledger usage, báo đủ từng ca và mọi lời gọi. `CUSTOMER_VALIDATED` chỉ nâng sau nghiệm thu với người dùng đại diện. Bàn giao pilot tiếp tục duy trì **`HANDOFF_BLOCKED`** cho đến khi đo lường chất lượng AI và nghiệm thu hoàn tất.
