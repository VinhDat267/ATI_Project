# P6 — Đính chính trạng thái sau audit

**Dự án:** AI Automation Platform (MVP v2)  
**Phạm vi:** BE-26..29, cập nhật ngày 25/09/2026
**Kết luận:** **APPROVAL_API_DB_TESTED / OWNER_ISOLATION_BROWSER_TESTED / UC1_UC3_API_DB_BROWSER_TESTED / SAAS_READ_CONFIRMED / SAAS_LIVE_EXERCISED / PROVIDER_LIMITED / AI_QUALITY_NOT_MEASURED / CUSTOMER_VALIDATED_NOT_RUN / HANDOFF_BLOCKED**

Các mục trước tiêu đề **“Bằng chứng SaaS Live 25/09/2026”** lưu ảnh chụp audit và cập nhật ngày 23/09, không phải trạng thái mới nhất; chỉ phiên sandbox ở mục 25/09 nâng nhãn SaaS. Probe Gemini không nâng nhãn AI quality; xem [artifact probe](../../ai-evidence/PILOT-V2-AI/PROBE-2026-09-25.md).

Báo cáo P6 trước đó ghi `PASS — 100%` và “sẵn sàng bàn giao”. Kết luận đó được rút lại sau audit đọc mã và kiểm thử ngày 23/09/2026. Có 11 unit test P6 pass (4 preflight, 5 UC2, 2 evaluation), nhưng test Sheets/Trello dùng `fetch` giả; runner đánh giá không gọi AI provider. `npm run check` ở commit trên cũng pass (DSL 44; engine 516 pass, 1 skip; API 79; web 138), chỉ chứng minh build và unit gate. Browser MVP v2, SaaS live và provider-backed quality vẫn `NOT_RUN` trong audit này.

## Trạng thái theo task

| Task | Có thể xác nhận | Chưa được xác nhận / lỗi chặn |
|---|---|---|
| BE-26 | `live-preflight.ts` và unit test hiện có. | Chưa chạy đọc Google Sheets/Trello thật. Runbook cũ gọi unit test giả làm preflight. |
| BE-27 | Runner UC2 và test giả lập hiện có. | Runner mặc định tự duyệt; không kiểm approval đã lưu; có thể POST lại intent đã `confirmed`; lỗi sau POST có thể kẹt `dispatched`. Không có receipt SaaS thật. |
| BE-28 | Dataset 40 biến thể và runner kiểm luật mô phỏng hiện có. | Runner suy kết quả từ `caseId`, `fault` và `expected`; token/chi phí là ước lượng. `AI_QUALITY_MEASURED=NOT_RUN`. |
| BE-29 | Tài liệu handoff và runbook đã có, nay được đính chính. | Handoff vận hành bị chặn cho đến khi sửa các lỗi trên và có evidence live riêng. |

Các runner P6 hiện không được export qua `packages/engine/src/index.ts` hoặc gọi bởi API pilot. API `/pilot/v2` dùng `executePilotWorkflow` khác. Bởi vậy không được dùng unit test của runner P6 làm chứng cứ cho hành vi API đang chạy.

## Phát hiện tại commit audit `9335620`

1. **P0 — fail closed:** `apps/api/src/main.ts` vẫn tạo pilot router khi `PILOT_V2_ENABLED` tắt hoặc cấu hình lỗi; `apps/api/src/pilot-router.ts` dùng policy mặc định `enabled: true` khi không được truyền policy. Cần test cấu hình tắt/lỗi trên đường HTTP thật.
2. **P0 — approval và dedupe:** `packages/engine/src/pilot/live-uc2-runner.ts` phải yêu cầu approval bền vững, từ chối dispatch khi thiếu/sai; reservation `confirmed` phải trả receipt cũ mà không POST.
3. **P0 — kết quả sau dispatch:** lỗi parse receipt hoặc `confirm()` sau POST phải chuyển sang trạng thái cần đối chiếu, không để `dispatched` trôi nổi.
4. **P1 — tích hợp sản phẩm:** API pilot hiện phân nhánh chủ yếu theo checklist thành `needs_input` hoặc `awaiting_approval` và dựng preview `trello.create_card`; UC1 refusal, UC3 lookup và AI source-aware chưa được chứng minh end-to-end qua API.
5. **P1 — evidence:** Chạy preflight đọc SaaS thật trước, rồi một UC2 được phê duyệt riêng với receipt và đối chiếu; đánh giá AI provider thật với freeze, holdout, rubric, budget, usage và price card. Không suy các kết quả đó từ mock hoặc provider connectivity probe lịch sử.

## Quy tắc cập nhật verdict

- `CONTRACT_TESTED` chỉ áp dụng cho ca có test trực tiếp trên đường sản phẩm liên quan; pass của unit runner độc lập không đủ đóng toàn bộ backend v2.
- `SAAS_LIVE_EXERCISED`, `AI_QUALITY_MEASURED` và `CUSTOMER_VALIDATED` là ba trục riêng, hiện chưa có bằng chứng nâng trạng thái.
- Sau khi sửa, review diff và test lại các lỗi P0 trước bất kỳ live write nào. Không tạo thêm card để kiểm chứng trên tài nguyên thật khi chưa có quyền và kế hoạch đối chiếu.

## Cập nhật chặn P0 ngày 23/09/2026 (chưa có SaaS live)

- Router không còn policy/config mặc định bật; thiếu, tắt hoặc lệch config/policy đều bị từ chối. HTTP unit test đã kiểm thiếu và tắt.
- Sau audit, API đã nối approval PostgreSQL với owner/run/version/hash/list ID/TTL. Nhánh `approved` chỉ dispatch khi bật riêng `PILOT_V2_WRITE_ENABLED=true` và có `PILOT_TRELLO_LIST_ID`; mặc định vẫn trả `503 LIVE_WRITE_BLOCKED`. HTTP integration qua PostgreSQL và Trello giả đã kiểm replay, cạnh tranh, drift, hết hạn, lỗi không chắc chắn và từ chối. Đây chưa là evidence SaaS live.
- Runner BE-27 yêu cầu đọc approval theo run, owner, snapshot hash và hạn 10 phút; không có approval thì không reserve/write. Intent `confirmed` không dispatch lại. Store chỉ cho chuyển `reserved → dispatched`; PostgreSQL integration test đã kiểm không claim lại `confirmed`.
- Hai đường engine giữ `unknown`/`reconciliation_required` khi có lỗi sau khi gọi dispatch, kể cả lỗi receipt hoặc ghi DB. Nếu cập nhật `unknown` thất bại, trạng thái `dispatched` vẫn chặn reserve lại và kết quả yêu cầu đối soát. Không suy an toàn trước POST từ chuỗi lỗi.
- Runner BE-27 chưa có production caller hoặc approval store được nối vào; replay `confirmed` hiện không trả đủ receipt chuẩn. API approval đã qua HTTP integration; UC2 browser đã qua 4 ca trên API/PostgreSQL cô lập với Sheets/Trello giả. Owner isolation browser, UC1/UC3, SaaS và AI provider vẫn cần evidence riêng. `HANDOFF_BLOCKED` giữ nguyên.

## Bằng chứng bổ sung 23/09/2026 — owner isolation và UC1/UC3

Sau đoạn audit lịch sử ở trên, API approval production đã dùng intent key chuẩn `createIntentKey`; GET run tìm reservation theo intent key này và fallback đọc các reservation cũ theo `sourceKey`. Hai endpoint chỉ đọc được thêm: `/pilot/v2/check` trả checklist pass/clarification/refusal, còn `/pilot/v2/lookup` chỉ resolve card từ reservation `confirmed`, xác minh card qua Trello GET và không nhận `cardId` từ caller. Reservation chưa chắc chắn không gọi Trello; card không còn tìm thấy trả `unknown`.

Đã chạy pass 21 API integration tests cho UC1/UC3 và durable approval; browser Chromium pass 7 ca trong `pilot-approval.spec.ts` và `pilot-use-cases.spec.ts`, gồm hai principal với owner-only run access và direct cross-owner approval attempt trả 404. Integration phủ source-row prompt injection, reservation sai intent, reservation thiếu/đang đối chiếu và card Trello trả 404. Sheets/Trello được giả lập; không có SaaS live hoặc AI provider call. Vì vậy các mục browser owner isolation và UC1/UC3 local contract được đóng, trong khi `SAAS_LIVE_NOT_RUN`, `AI_QUALITY_NOT_RUN`, nghiệm thu người dùng và `HANDOFF_BLOCKED` giữ nguyên.

## Bằng chứng SaaS Live 25/09/2026 — `SAAS_READ_CONFIRMED` và `SAAS_LIVE_EXERCISED`

Thực hiện theo kế hoạch `docs/superpowers/plans/2026-09-23-pilot-v2-saas-live.md`:

1. **BE-26 Operator Read Preflight (`SAAS_READ_CONFIRMED`)**:
   - Chạy lệnh CLI đọc SaaS thật: `node packages/engine/dist/pilot/live-preflight-cli.js --principal 00000000-0000-4000-8000-000000000001 --request-id REQ-SBX-001`.
   - Kết quả: Đọc Google Sheets thật (Spreadsheet `1zqvWaShNfqQBUkypaGyFFlVBabW3qCrRqsdQg2mgSc0`, Tab `Requests`), đọc Trello board sandbox thật (`6ab4cce14cc901026198259b`), phát hiện 3 danh sách ("Cần làm", "Đang làm", "Đã xong").
   - Số thao tác ghi từ xa: `writesAttempted: 0`.
   - Bằng chứng đã được lưu và commit tại `docs/ai-evidence/PILOT-V2-LIVE/preflight-read-confirmed.json` (commit `becfd35`).

2. **BE-27 & BE-29 Live SaaS Write & Reconciliation (`SAAS_LIVE_EXERCISED`)**:
   - Sửa lỗi định danh list trên board tiếng Việt: `packages/engine/src/pilot/adapters/trello-write.ts` ưu tiên tìm kiếm `listId` trực tiếp trước khi fallback so khớp tên danh sách; bổ sung unit test kiểm chứng tại `packages/engine/tests/pilot-trello-adapter.test.ts`.
   - Chạy runner phiên live có kiểm soát: `npx tsx scripts/execute-pilot-v2-live.ts`.
   - Kết quả xác minh:
     - **UC1 Intake Check**: Gọi `POST /pilot/v2/check` với Principal A, kết quả `checked`, `valid: true`, 0 thao tác ghi.
     - **UC2 Run Creation & Preview**: Gọi `POST /pilot/v2/runs` tạo run `7709153c-9f2e-4472-912b-33f7c6a54c56`, `status: awaiting_approval`, snapshot hash `cc35d00be9004ff86d632f42592991787e9025eeb3cf831f5eafec505d182d1d`, hạn TTL 10 phút.
     - **Owner B Isolation**: Principal B thực hiện `GET /pilot/v2/runs/:id` và `POST /pilot/v2/runs/:id/approve` trên run của Principal A đều nhận HTTP `404 Not Found`, 0 thao tác ghi.
     - **Single Approved UC2 Write**: Principal A duyệt run hợp lệ. Hệ thống dispatch chính xác 1 lệnh POST tạo card lên Trello Sandbox (`6ab4cce14cc901026198259b`, list `6ab4cce14cc90102619825a1`), nhận receipt card ID `6ab66fc11dcefdad6a08389f` (`https://trello.com/c/gNm8pWyM/2-c%E1%BA%ADp-nh%E1%BA%ADt-trang-ch%E1%BB%A7`). `pilot_approvals` chuyển `approved`, `business_reservations` chuyển `confirmed`.
     - **UC3 Remote Read-back & Reconciliation**: Đọc trực tiếp thẻ từ remote Trello API (`trelloGetCard`), đối chiếu thành công card ID `6ab66fc11dcefdad6a08389f`. Gọi `POST /pilot/v2/lookup` cho `REQ-SBX-001` trả về `status: "found"` cùng card ID liên kết.
     - **Replay Protection**: Gửi lại yêu cầu approve trên cùng run trả về HTTP `409 Conflict`.
     - **Tổng số lệnh ghi remote theo artifact của phiên**: 1; không suy rộng ra các phiên khác.
   - Bằng chứng đã được lưu và redact tại `docs/ai-evidence/PILOT-V2-LIVE/live-session-confirmed.json`. Script khởi tạo API cục bộ với token test tiêm cho hai principal, nên phiên này không chứng minh toàn bộ luồng đăng nhập production. Việc gán `liveWriteFlag = false` sau approval chỉ đổi biến cục bộ, không tắt cờ trên API đã khởi tạo; script đóng API ở `finally`. Không chạy lại để kiểm tài liệu hoặc tạo card mới nếu chưa duyệt riêng.

3. **Trạng thái cổng Cổng G4 / G5 / G6**:
   - **Cổng G4 (`SAAS_LIVE_EXERCISED`)**: **ĐẠT (PASSED)** — Đã có bằng chứng vận hành live thực tế trên Google Sheets và Trello Sandbox (commit `82d5e43`, artifact `live-session-confirmed.json`).
   - **Cổng G5 (`AI_QUALITY_MEASURED`)**: **GIỚI HẠN BỞI NHÀ CUNG CẤP (`AI_QUALITY_NOT_MEASURED / PROVIDER_LIMITED`)** — Đã khóa manifest Free Tier 0 USD (`f38282245ce0...`), tối ưu `thinking_level: 'low'` (6.6s latency, output hoàn chỉnh). Tuy nhiên, Google áp hạn mức 20 RPD trên `gemini-3.8-flash` (HTTP 429) và quá tải tạm thời trên `gemini-3.7-flash` (HTTP 503). Hệ thống dừng an toàn, bảo lưu trung thực (`docs/ai-evidence/PILOT-V2-AI/PROBE-2026-09-25.md`).
   - **Cổng G6 (`CUSTOMER_VALIDATED`)**: **CHƯA CHẠY (`NOT_RUN`)**.
   - **Bàn giao tổng thể**: **HANDOFF_BLOCKED** cho đến khi đo lường chất lượng AI và nghiệm thu khách hàng.
