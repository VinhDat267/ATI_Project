# W2-05 · Chạy tiếp plan bị gián đoạn khi không có step nào chưa rõ kết quả

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w2-05-continue-safe-plans` · **Phụ thuộc:** W2-01, W2-02, W2-04 (đã có trên `main` `e6ea708`)

## Vấn đề

Audit tuần 2 (01/10/2026) chạy probe trên PostgreSQL thật và thấy hai trường hợp người dùng bị kẹt sau khi server khởi động lại:

| Ca | Dữ liệu trước khi khởi động lại | Kết quả hiện tại | Vì sao sai |
|---|---|---|---|
| A. Chết giữa hai step | plan `approved`; step 1 `succeeded`, step 2 và 3 `pending` | plan `reconciliation_required`, `recoveryActions = ["stop"]`; Skip step 2 trả 409 "This reconciled execution can only be stopped" | Step 2, 3 chưa từng được gửi đi nhưng người dùng không chạy tiếp được, phải làm lại bằng tay |
| B. Chết sau step cuối, trước khi ghi trạng thái plan | plan `approved`; mọi step `succeeded` | plan `reconciliation_required`, chỉ được Stop; Stop xong plan thành `stopped` | Một lần chạy đã thành công trọn vẹn bị báo là bị dừng |

Hành vi này đúng với đặc tả hiện tại (mục 5.8: "Plan cần đối soát mà không có step `unknown` chỉ được Stop… cho đến khi có đặc tả tiếp tục riêng được duyệt"). Task này chính là đặc tả tiếp tục đó.

## Vì sao chạy tiếp là an toàn

`ExecutionController` ghi trạng thái `running` vào database (qua `onStepUpdate`, có `await`) **trước** khi gọi adapter; nếu ghi thất bại thì không gọi adapter. W2-01 đổi mọi step `running` thành `unknown` khi khởi động lại. Vì vậy, sau đối soát, một step còn `pending` chắc chắn **chưa từng được gửi** tới service. Toàn bộ lập luận dựa vào bất biến này, nên task phải có test khóa nó lại (xem tiêu chí nghiệm thu).

## Việc cần làm

1. **Đối soát khi khởi động (W2-01):** với plan `approved`/`executing`/`stopping`/`unknown` không có step `running` hay `unknown`:
   - số dòng `execution_steps` bằng số step của plan đã duyệt và mọi dòng là `succeeded` hoặc `skipped` → plan thành **`completed`**;
   - các trường hợp khác giữ như hiện tại (`reconciliation_required`).
2. **Hành động mới `continue`:** cho plan `reconciliation_required` khi snapshot đầy đủ (đủ dòng, khớp plan đã duyệt, hash hợp lệ), **không có** step `unknown`, `running` hay `failed`, và còn ít nhất một step `pending`.
   - API: `POST /api/executions/:planId/continue`, cùng quyền sở hữu và cùng cơ chế claim (`claimRecovery`, CAS theo `xmin`) như skip/stop của W2-02; dựng lại controller từ snapshot rồi chạy các step `pending`.
   - `GET /api/conversations/:convId/executions/latest` trả `recoveryActions = ["continue", "stop"]` cho trường hợp này.
3. **Frontend (W2-04):** trong `ReconciliationNotice`, khi có `continue`, hiện nút **"Chạy tiếp các bước còn lại"** và giải thích ngắn: không có bước nào chưa rõ kết quả; các bước còn lại chưa từng được gửi tới dịch vụ.
4. **Đặc tả:** sửa mục 5.8 của `docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md` theo đúng hai quy tắc trên, thay câu "chỉ được Stop… cho đến khi có đặc tả tiếp tục riêng được duyệt". Ghi rõ trong mô tả PR là có sửa đặc tả, để người dùng duyệt.

## Không làm trong task này

- Plan chưa có dòng nào trong `execution_steps` (chết giữa lúc duyệt và lúc tạo step) vẫn **chỉ Stop**: tuy cũng an toàn, việc tạo step khi khôi phục là một thay đổi riêng.
- Không đổi quy tắc của step `unknown` (chỉ skip, không retry) và step `failed` (retry hoặc skip).
- Không hỗ trợ nhiều API instance (vẫn chưa có lease/fencing).

## Tiêu chí nghiệm thu

- [ ] **Khóa bất biến:** test executor chứng minh adapter không được gọi khi việc ghi `running` chưa hoàn tất hoặc thất bại (thứ tự: `onStepUpdate(running)` xong rồi mới `execute`).
- [ ] Ca B trên PostgreSQL thật: plan `approved`, mọi step `succeeded` → sau đối soát plan `completed`, `recoveryActions = []`, adapter không được gọi.
- [ ] Ca B biến thể: mọi step `succeeded` hoặc `skipped` → `completed`. Thiếu một dòng step → **không** thành `completed`.
- [ ] Ca A trên PostgreSQL thật, mô phỏng khởi động lại (service mới trên cùng database): `recoveryActions = ["continue","stop"]`; gọi `continue` → step 2, 3 chạy đúng một lần mỗi step, `$ref` tới output đã lưu của step 1 resolve được, adapter không được gọi cho step 1, plan `completed`.
- [ ] `continue` bị từ chối (409, không gọi adapter) khi: có step `unknown`; có step `failed`; snapshot thiếu hoặc trùng dòng; hash plan không khớp; plan không ở `reconciliation_required`; người gọi không phải chủ hội thoại (403).
- [ ] Hai request `continue` đồng thời: đúng một request được chạy, request kia nhận 409, mỗi step chỉ gửi một lần.
- [ ] Component test: nút "Chạy tiếp các bước còn lại" chỉ hiện khi có `continue` và gọi đúng API; không hiện khi có step `unknown`.
- [ ] Browser E2E: plan bị đặt vào trạng thái ca A trong database → mở hội thoại → bấm "Chạy tiếp" → plan `completed`.
- [ ] Test mới fail trước khi sửa (dán output fail vào PR). `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Lệnh

```bash
npm run db:up:v3
npm run check
npm run test:browser:v3
```

## Kết quả (agent thi công điền)

- PR: [#23](https://github.com/VinhDat267/ATI_Project/pull/23), base `main`; chưa merge tại thời điểm bàn giao.
- Commit: implementation `40121e612a3c687d205841df180fbd9591dec6ac`; sửa review/SSE `257536033acd42ffa55a415601acf01f69888d3e`.
- Test đã chạy và kết quả (01/10/2026):
  - PostgreSQL 16 riêng: backend/executor RED **16 fail / 26 pass** (exit 1) trước sửa; GREEN **42/42** (exit 0), gồm đủ dòng success/skipped, thiếu/trùng/mismatch/hash, owner 403, safe pending `$ref`/`$template`, CAS hai Continue có đúng một 200 và một 409, không replay success.
  - Executor vốn đã `await` ghi running: thêm test chặn adapter khi ghi chưa xong hoặc thất bại. Mutation bỏ `await` có **1 fail**, khôi phục source rồi GREEN; không thay đổi executor production.
  - UI RED **2 fail / 12 pass**, GREEN **14/14**. Review độc lập tại `40121e6` chạy `npm run check` **500 v3 / 66 eval**, browser **8/8**, supplemental PostgreSQL **3/3**, exit 0; phát hiện **2 Important** SSE.
  - Sửa hai lỗi review một lượt: tracked SSE RED **2 fail / 17 pass** → affected suites **42/42**; giữ saved progress/output/timing khi Continue bắt đầu và nhận event theo execution identity dù có preview khác. `npm run check` cuối **503/503 v3** (11+53+128+25+143+143), **66/66 eval**, typecheck/build, launcher **1/1**, local-env **3/3**, exit 0. Browser cuối **8/8**, targeted Continue **1/1**, exit 0. Reviewer chưa chạy lại fixed head.
  - Browser dùng PostgreSQL riêng theo cấu hình CI tại `127.0.0.1:5432`, fixture account và sandbox; plan ca A được seed trong DB, mở lại hội thoại, Continue → completed, giữ nguyên success row, chỉ một POST Continue. Không dùng database hiện có hoặc service thật.
  - Baseline đầu tiên **14 API failures** (`relation does not exist`) do DB mới chưa migrate; đã chạy migration rồi các suite đạt. Không sửa source để che lỗi môi trường.
  - `git diff --check` đạt; output đầy đủ lưu cùng bằng chứng local của W2-05. CI được báo theo exact head trong PR sau khi chạy; không coi local hoặc CI lịch sử là CI của PR mới.
- Điều chưa làm hoặc khác với task card: đã sửa đặc tả v3 §5.8 theo task card và nêu rõ trong PR. Startup dùng kiểm tra hash/khớp step giống recovery để dữ liệu hỏng không bị đánh dấu completed. Một API instance, executor cũ đã dừng; zero-row vẫn Stop-only; UNKNOWN/failed giữ quy tắc cũ. Live provider/model **NOT_RUN**, không ghi Trello/Slack/GitHub thật. Không có Minor mới bị hoãn; không sửa CURRENT-STATE/ROADMAP. Task card một task không có header `Task N`, nên theo dõi ledger và chạy lệnh trực tiếp thay scripts task-start/task-done.
