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
2. Plan có ít nhất một step `unknown` chuyển thành `reconciliation_required`. Plan `approved` mà mọi step vẫn `pending` (chưa chạy step nào) cũng chuyển thành `reconciliation_required`, vì không biết lần chạy có bắt đầu hay chưa.
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
- [ ] Test: `getExecutionStatusDurable` trả `pausedStepId` là step `unknown` đầu tiên.
- [ ] Các test mới fail trước khi sửa (ghi output fail vào mô tả PR).
- [ ] `npm run test:v3`, `npm run test:eval:v3`, `npm run typecheck:v3` đạt; browser E2E 6/6.

## Lệnh

```bash
npm run db:up:v3
cd apps/chat-api && DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3 npx vitest run tests/integration
npm run test:v3
```

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
