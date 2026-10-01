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

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
