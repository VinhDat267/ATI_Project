# W2-02 · Tiếp tục hoặc dừng một plan sau khi đối soát

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w2-02-resume-after-restart` · **Phụ thuộc:** W2-01 đã merge

## Vấn đề

Sau W2-01, plan bị gián đoạn có trạng thái `reconciliation_required`, step đang chạy dở là `unknown`. Người dùng cần làm được hai việc sau khi tự kiểm tra trên Trello/Slack/GitHub:

- **Skip** step `unknown` (ví dụ đã thấy card được tạo, hoặc chấp nhận bỏ) rồi chạy tiếp các step `pending`;
- **Stop** plan, giữ nguyên các step đã chạy.

Hiện `continueStep` trong `apps/chat-api/src/services/execution-service.ts` cần controller trong bộ nhớ, nên sau khi server khởi động lại thì trả 409.

## Việc cần làm

1. Cho `ExecutionController` (`packages/executor/src/controller.ts`) khởi tạo được từ trạng thái đã lưu: trạng thái từng step và output của các step đã `succeeded` (để `$ref`/`$template` của step sau vẫn resolve được). Gợi ý: thêm tùy chọn kiểu `initialStates` / `initialOutputs` vào `ExecutionControllerOptions`.
2. Trong `ExecutionService`, khi retry, skip hoặc stop một plan không còn controller trong bộ nhớ: dựng lại controller từ `execution_steps` (cột `status`, `output_json`) và `plans.plan_json`, rồi đi theo luồng bình thường. Áp dụng cho cả plan `reconciliation_required` (sau W2-01) **và plan `partial`** (dừng ở step `failed` trước khi server khởi động lại).
3. Quy tắc giữ nguyên như hiện tại: step `unknown` **chỉ được skip**, không được retry (tránh ghi trùng). Step `failed` vẫn retry được. Step `succeeded` không bao giờ chạy lại.
4. Plan `reconciliation_required` phải cho phép skip/stop (hiện danh sách trạng thái "terminal" trong `continueStep` và `stop` đang chặn nó; cần tách "đã kết thúc" khỏi "cần đối soát").

## Tiêu chí nghiệm thu

- [ ] Test executor: controller khởi tạo với step 1 `succeeded` (có output) và step 2 `unknown`; skip step 2 → step 3 chạy và resolve được `$ref` tới output của step 1; adapter **không** được gọi lại cho step 1.
- [ ] Test trên PostgreSQL thật mô phỏng khởi động lại: service A bắt đầu thực thi với adapter treo ở step 2; tạo service B mới trên cùng database (như server mới), chạy đối soát của W2-01, gọi skip step 2 qua B → step 3 `succeeded`, plan `completed`, số lần gọi adapter cho step 1 vẫn là 1.
- [ ] Test: retry một step `unknown` sau khởi động lại bị từ chối (409) và không gọi adapter.
- [ ] Test: stop plan `reconciliation_required` → plan `stopped`, các step `pending` không chạy.
- [ ] Test: plan `partial` có step `failed`, sau khởi động lại retry step đó → adapter được gọi đúng một lần cho step đó, plan chạy tiếp.
- [ ] Test mới fail trước khi sửa; `npm run test:v3`, `npm run test:eval:v3`, `npm run typecheck:v3` đạt; browser E2E 6/6.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
