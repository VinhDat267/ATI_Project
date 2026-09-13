# Controller/engine local

`@wap/engine` nhận plan tay và chạy **đọc → preview → một lần duyệt → ghi → trace** qua PostgreSQL và MCP stdio. Catalog đang chạy gồm `read_sheet_range`, `append_sheet_rows`, `send_slack_message`; tên Slack/Sheets chỉ biểu diễn dữ liệu local. Xem [trạng thái và bằng chứng](../../docs/ENGINE-STATUS-2026-09-13.md).

## Chạy demo

Từ root dự án, dùng Node >=22 và Docker đang bật:

```powershell
npm ci
npm run db:up:g1
npm run db:migrate:g1
npm run db:seed:g1
npm run build
npm run engine -- prepare-b02
```

`prepare-b02` lấy plan tay b02 thuộc dev dataset, đọc `source/Progress` và trả JSON có `run_id`, `workflow_version_id`, `approval.id`, `approval.snapshot_hash`. Nó lưu preview và **chưa ghi bảng đích hay gửi thông báo**. Không gọi LLM, không tự duyệt. Với seed mới, preview gồm hai dòng `["API","Done"]`, `["UI","Doing"]` và thông báo `Đã chép 2 dòng.` tới kênh local `#team`; dữ liệu hiện có được giữ khi seed lại.

Điền các giá trị từ JSON vào biến PowerShell, rồi xem preview:

```powershell
$runId = 'RUN_ID_TỪ_KẾT_QUẢ'
$approvalId = 'APPROVAL_ID_TỪ_KẾT_QUẢ'
$versionId = 'WORKFLOW_VERSION_ID_TỪ_KẾT_QUẢ'
$snapshotHash = 'SNAPSHOT_HASH_TỪ_KẾT_QUẢ'
npm run engine -- preview $runId
```

Sau khi kiểm tra đúng dữ liệu đích và nội dung, duyệt chính xác snapshot đó, rồi thực thi:

```powershell
npm run engine -- approve $runId $approvalId $versionId $snapshotHash
npm run engine -- execute $runId
npm run engine -- detail $runId
npm run engine -- trace $runId
npm run engine -- events $runId 0
```

Approval hết hạn sau 10 phút từ lúc preview được tạo; đồng hồ PostgreSQL quyết định. Dữ liệu nguồn thay đổi sau preview không thay payload đã duyệt. Build hoặc đổi catalog/receiver artifact giữa preview và execute làm snapshot cũ không còn phù hợp: tạo run mới để xem và duyệt lại. Một run đã claim không được execute lần nữa; chạy demo lần nữa tạo ý định ghi mới và có thể thêm dòng/thông báo mới.

## Lệnh còn lại

| Lệnh sau `npm run engine --` | Tác dụng |
|---|---|
| `prepare <plan.json> [inputs.json]` | Validate DSL, đọc dữ liệu và tạo preview cho plan tay |
| `reject <run_id> <approval_id> <version_id> <snapshot_hash>` | Từ chối đúng preview đang chờ |
| `cancel <run_id>` | Chặn bước tiếp theo; call đang chạy được xử lý trước khi kết thúc |
| `recover` | Đánh dấu các run đã claim nhưng mất worker; không dispatch hoặc resume |
| `reconcile <run_id>` | Chỉ đọc, đối chiếu receipt với operation và snapshot đã duyệt |
| `events <run_id> [since_seq]` | Trả tối đa 100 event; dùng `next_seq` cho lần đọc tiếp |
| `--help` | Xem cú pháp JSON |

`G1_DATABASE_URL` và `G1_USER_ID` do launcher tin cậy đặt; mặc định DB demo loopback 55432 và demo user. `RUNTIME_TIME_ZONE` áp dụng cho lệnh `prepare`, mặc định `Asia/Ho_Chi_Minh`. Không lấy principal hay lệnh khởi chạy server từ plan. Các lệnh detail/preview/events/trace/cancel/recover/reconcile không cần khởi động MCP, nên có thể kiểm tra DB khi server MCP không chạy. Đây chưa phải HTTP authentication/session.

## Hành vi khi lỗi

- Một worker giữ connection riêng với PostgreSQL advisory lock; các tool được gọi tuần tự. Mất connection giữ khóa sẽ đóng MCP và chặn dispatch tiếp.
- Read retry tối đa 3 lần theo DSL, exponential backoff với delay tối đa 30 giây. Write chỉ dispatch một lần trong run này.
- Write mất phản hồi hoặc worker dừng sau dispatch đưa run về `reconciliation_required`. Không suy ra rollback từ timeout và không tự thử lại.
- `recover` chỉ xử lý run dở đã được worker claim. Run đã duyệt nhưng chưa claim vẫn chờ `execute` kiểm expiry. Chưa có daemon tự gọi recovery khi startup.
- `reconcile` trả `confirmed`, `conflict` hoặc `not_observed`. Receipt được xác nhận không đổi trace lịch sử và không tự chạy bước sau; không thấy receipt cũng không chứng minh write thất bại.
- Plan có read phụ thuộc vào write bị từ chối ở phiên bản này vì một preview không thể bảo toàn đúng thứ tự đó. DSL vẫn cấm dùng output write trong args/condition/key của bước khác.

## Phát triển và kiểm chứng

```powershell
npm run check:engine
```

Lệnh chạy typecheck, build bốn package, DSL/schema/OpenAPI, DB/MCP receiver và engine integration. Tests tạo rồi dọn DB `g1_it_*`/`engine_it_*` riêng; không reset `wap_g1`. Evidence nằm trong [engine-evidence](../../docs/engine-evidence/2026-09-13/README.md). Không chạy nhiều suite cùng lúc vì chúng ghi chung thư mục evidence.

Facade `WorkflowEngine(db, gateway, userId)` dùng cho prepare/decide/execute; inspector có thể truyền `undefined` thay gateway. PostgreSQL lưu status, events, outbox, snapshot và attempts. Native SQL transaction và Drizzle dùng các pool riêng vì Drizzle thay JSON/date codecs; không trộn hai handle vào một transaction.

HTTP/UI/polling, session, LLM/retrieval/replan, BullMQ, 5 task_hub tool còn lại và filesystem adapter chưa được triển khai trong module này. Shared trace/event schemas đã dùng được cho lớp HTTP kế tiếp; OpenAPI hiện vẫn là hợp đồng dự kiến.
