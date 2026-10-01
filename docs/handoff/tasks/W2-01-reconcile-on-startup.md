# W2-01 · Đối soát các lần thực thi bị gián đoạn khi server khởi động lại

**Trạng thái:** chờ · **Nhánh gợi ý:** `fix/w2-01-reconcile-on-startup` · **Phụ thuộc:** không

## Vấn đề

`ExecutionService` giữ controller, `activeRuns` và `executionOutcomes` trong bộ nhớ. Nếu server dừng giữa lúc thực thi:

- plan ở lại `approved` (hoặc `partial`) trong bảng `plans`;
- step đang chạy ở lại `running` trong `execution_steps`, không ai biết lệnh ghi đó đã tới service hay chưa;
- sau khi khởi động lại, `getExecutionStatusDurable` trả `reconciliation_required`, nhưng database vẫn ghi trạng thái cũ, và retry/skip trả 409 "execution controller is unavailable".

## Việc cần làm

Khi backend khởi động (trước khi nhận request), chạy một bước đối soát trên PostgreSQL:

1. Mọi step `running` của plan chưa kết thúc chuyển thành `unknown`, `error_json` ghi lý do (ví dụ `{"category":"UNKNOWN","message":"Server restarted while this step was running"}`), `completed_at` được ghi. Step `pending` giữ nguyên. Step `succeeded`/`skipped`/`failed` giữ nguyên.
2. Plan có ít nhất một step `unknown` chuyển thành `reconciliation_required`. Plan `approved` mà mọi step vẫn `pending`, **hoặc chưa có dòng nào trong `execution_steps`** (server dừng giữa lúc duyệt và lúc tạo step trong `executePlan`), cũng chuyển thành `reconciliation_required`, vì không biết lần chạy có bắt đầu hay chưa.
   Plan `partial` chỉ có step `failed` (lỗi đã rõ, không có `unknown`) **giữ nguyên `partial`**: kết quả đã rõ nên W2-02 sẽ cho retry hoặc skip bình thường.
3. Đối soát phải idempotent: chạy hai lần cho kết quả như chạy một lần.
4. Ghi log một dòng cho mỗi plan được đối soát (id plan, số step chuyển sang `unknown`); không ghi argument hay output.

Gợi ý vị trí: một hàm trong `apps/chat-api/src/services/` (hoặc repository) nhận `pg.Pool`, gọi từ `bootstrap()` trong `apps/chat-api/src/server.ts` khi có database. Nên làm trong một transaction.

## Không làm trong task này

- Không tự chạy lại step nào. Không tự tiếp tục plan. (Việc tiếp tục là W2-02.)
- Không đổi schema nếu không cần; nếu cần cột mới, thêm migration mới trong `db/v3/`, không sửa migration cũ.

## Tiêu chí nghiệm thu

- [ ] Test trên **PostgreSQL thật** (theo mẫu `apps/chat-api/tests/integration/postgres-docker.test.ts`): tạo plan `approved` với step `succeeded`, `running`, `pending` → sau đối soát: plan `reconciliation_required`, step `running` thành `unknown` có `error_json` và `completed_at`, hai step còn lại không đổi.
- [ ] Test: plan `completed`, `rejected`, `pending` không bị đụng tới.
- [ ] Test: chạy đối soát hai lần, kết quả như một lần.
- [ ] Test: plan `approved` chưa có dòng nào trong `execution_steps` → `reconciliation_required`.
- [ ] Test: plan `partial` chỉ có step `failed` → giữ nguyên `partial`, step không đổi.
- [ ] `getExecutionStatusDurable` hiện chỉ trả `{ status }`; sửa để trả thêm `pausedStepId` (step `unknown` đầu tiên, hoặc step `failed` đầu tiên với plan `partial`), có test.
- [ ] Các test mới fail trước khi sửa (ghi output fail vào mô tả PR).
- [ ] `npm run test:v3`, `npm run test:eval:v3`, `npm run typecheck:v3` đạt; browser E2E 6/6.

## Lệnh

```bash
npm run db:up:v3
cd apps/chat-api && DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3 npx vitest run tests/integration
npm run test:v3
```

## Kết quả (agent thi công điền)

- PR: [#16](https://github.com/VinhDat267/ATI_Project/pull/16), đặt trên `docs/agent-handoff` vì #15 chưa merge. Đổi base về `main` sau #15; trạng thái task chỉ đóng sau review, CI xanh và merge.
- Commit code/spec/test: `c8d122c916854707cb0da663a1b0e8a6a1cbb779`.
- Test đã chạy và kết quả (01/10/2026, PostgreSQL 16 riêng, sandbox): baseline `test:v3` 400/400 exit 0; RED test startup mới 9 fail / 7 pass (16), exit 1; GREEN 16/16 exit 0. `npm run check` exit 0: v3 416/416 (11+53+128+18+106+100), eval 66/66, typecheck/build exit 0, launcher 1/1, local-env 3/3. Browser E2E 6/6 exit 0. Reviewer độc lập chạy lại v3 416/416, eval 66/66 và typecheck, đều exit 0; kết luận kỹ thuật Đạt, không có blocker. Test thật chứng minh HTTP chờ row lock, transaction rollback và startup thất bại khi SQL lỗi, tiến trình bị kill giữa write, thứ tự step, giữ output/timestamp và idempotence.
- Điều chưa làm hoặc khác với task card: đồng bộ mục 5.8 của đặc tả với chính sách card (read/write `running` đều UNKNOWN, không auto retry). Không đổi schema. W2-02 còn controller rehydration và skip/stop/retry lỗi đã rõ; W2-04 còn frontend reload. Plan chưa có step hoặc chỉ có pending không được tạo UNKNOWN giả; luồng recovery Stop-only thuộc W2-02. Startup yêu cầu executor cũ đã dừng, chưa có lease/fencing nhiều replica. Không chạy live model/provider hoặc ghi dịch vụ bên ngoài trong task này. CI và merge được xác minh trên PR; không tự đóng task hoặc sửa CURRENT-STATE/ROADMAP trong PR thi công.
