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

- PR: [#18](https://github.com/VinhDat267/ATI_Project/pull/18), base `docs/agent-handoff` tại merge #16 (`1a0b623`). Chưa merge W2-02; #15 còn OPEN khi bàn giao, `main` chưa chứa W2-01.
- Commit: code/spec/test `eca39896c95f156556a91c33bb656aef30b0946f`; sửa hai finding review `8282826323086b4b2c521fc5ad198f845d8867fd`.
- Test đã chạy và kết quả (01/10/2026, source tại `8282826`):
  - Baseline v3 416/416, exit 0. Trước production: executor recovery RED 5 fail / 5, API PostgreSQL/HTTP recovery RED 13 fail / 2 pass (15), exit 1; GREEN 5/5 và 15/15, exit 0. Crash test kill tiến trình executor A thật trước đối soát và phục hồi B; row-lock SQL thật cho hai request, một 200 / một 409 / đúng một dispatch. Output success và `$ref`/`$template` được giữ; UNKNOWN retry bị từ chối, Stop không chạy pending, partial failed retry đúng một lần.
  - Review độc lập tại `eca3989` đọc diff và chạy lại v3 436/436, eval 66/66, typecheck, exit 0; kết luận chưa đạt với hai lỗi Important. Đã sửa trong một lượt TDD: memory fallback snapshot RED 2 fail → 2/2 GREEN; malformed plan table RED 3 fail / 1 pass → 4/4 GREEN. Hai bộ API recovery cuối cùng 21/21, exit 0. Không tuyên bố reviewer chạy lại fixed head.
  - `npm run check`: exit 0; v3 **442/442** (11 schema + 53 adapter + 128 planner + 23 executor + 127 API + 100 web), eval **66/66**, typecheck/build exit 0, launcher 1/1, local-env 3/3.
  - `npm run test:browser:v3`: **6/6**, exit 0; sandbox và PostgreSQL 16 riêng. Không gọi model thật hoặc ghi service thật.
- Điều chưa làm hoặc khác với task card:
  - Thêm endpoint owner-scoped `GET /api/conversations/:convId/executions/latest` cho W2-04: plan/execution/steps/output/timing/recoveryActions. Invalid/thiếu progress vẫn đọc được bằng chứng và Stop-only; plan JSON/text bị hỏng không được dùng để authorize continuation.
  - Restore mới kiểm tra approved hash/text/JSON, matching đầy đủ step, SQL CAS owner/hash/status/xmin rồi đọc lại progress. Stop idle dùng CAS, không cần controller; giữ nguyên UNKNOWN evidence. Plan `reconciliation_required` không có UNKNOWN là Stop-only theo spec 5.8.
  - Executor cũ phải đã dừng, một API instance; chưa có distributed lease/fencing. Sandbox memory vẫn mất dữ liệu khi process chết. Không đổi schema, frontend, planner/prompt/provider; W2-03 live failure và W2-04 UI chưa chạy trong task này.
  - PR chờ review/người dùng merge theo handoff protocol. Reviewer cập nhật CURRENT-STATE/ROADMAP sau merge; agent thi công không sửa hai file đó. Nhật ký: [2026-10-01-codex-W2-02.md](../log/2026-10-01-codex-W2-02.md).
