# P6 — Đính chính trạng thái sau audit

**Dự án:** AI Automation Platform (MVP v2)  
**Phạm vi:** BE-26..29, commit `9335620` ngày 23/09/2026
**Kết luận:** **UNIT_TESTED / LIVE_NOT_RUN / HANDOFF_BLOCKED**

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
