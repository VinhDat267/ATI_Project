# Controller/engine local

`@wap/engine` nhận plan tay và chạy **đọc → preview → một lần duyệt → ghi → trace** qua PostgreSQL và MCP stdio. Catalog công khai đã triển khai 10 tool: 8 tool của server `task_hub` (`read_sheet_range`, `append_sheet_rows`, `send_slack_message`, `list_cards`, `get_card`, `list_members`, `create_card`, `move_card`) và 2 tool của server `filesystem` (`read_file`, `write_file`). Tên Slack/Sheets/Cards chỉ biểu diễn dữ liệu local. Xem [filesystem status và manual guide](../../docs/G1-FILESYSTEM-STATUS-2026-09-13.md).

## Chạy demo

Từ root dự án, dùng Node >=22 và Docker đang bật:

```powershell
npm ci
npm run build
npm run db:up:g1
npm run db:migrate:g1
npm run db:seed:g1
```

Chuẩn bị plan tay (ví dụ `th-move.json` chuyển card `c1` sang `Done` hoặc plan dev `prepare-b02` chép dữ liệu sheet sang thông báo):

```powershell
# Chạy prepare và gán trực tiếp các trường định danh từ JSON trả về
$prepareJson = node packages/engine/dist/cli.js prepare testdata/dev-hand-plans/th-move.json
if ($LASTEXITCODE -ne 0) { throw 'Prepare failed; inspect the error before continuing.' }
$prep = ($prepareJson -join "`n") | ConvertFrom-Json
$runId = $prep.run_id
$approvalId = $prep.approval.id
$versionId = $prep.workflow_version_id
$snapshotHash = $prep.approval.snapshot_hash
```

Lệnh `prepare` đọc dữ liệu, lưu preview và tạo approval đang chờ (`awaiting_approval`); **chưa gọi write tool, chưa đổi card hoặc gửi thông báo**. Không gọi LLM, không tự duyệt. Với seed mẫu, preview gồm thao tác chuyển thẻ `c1` sang `Done` và thông báo tới kênh `#team`. Dữ liệu hiện có được giữ khi seed lại (không đặt lại `c1` về `Doing`).

Xem chi tiết preview các thao tác chuẩn bị thực thi:

```powershell
npm run engine -- preview $runId
```

Sau khi kiểm tra đúng dữ liệu đích và nội dung, duyệt chính xác snapshot đó, rồi thực thi:

```powershell
npm run engine -- approve $runId $approvalId $versionId $snapshotHash
npm run engine -- execute $runId
npm run engine -- detail $runId
npm run engine -- trace $runId
npm run engine -- events $runId 0
npm run engine -- reconcile $runId
```

Lệnh `trace` xuất các attempt cùng `outcome_certainty` thực tế; với demo thành công, mong đợi ba attempt `confirmed`. Các trường hợp mất phản hồi/crash vẫn giữ `unknown` trong trace. Để kiểm tra và đối chiếu các bản ghi receipt đã commit trong cơ sở dữ liệu, sử dụng lệnh `reconcile $runId`; không coi `trace` là bảng kết xuất trực tiếp các hàng receipt.

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

`G1_DATABASE_URL` và `G1_USER_ID` do launcher tin cậy đặt; mặc định DB demo loopback 55532 và demo user. `RUNTIME_TIME_ZONE` áp dụng cho lệnh `prepare`, mặc định `Asia/Ho_Chi_Minh`. Không lấy principal hay lệnh khởi chạy server từ plan. Các lệnh detail/preview/events/trace/cancel/recover/reconcile không cần khởi động MCP, nên có thể kiểm tra DB khi server MCP không chạy. Đây chưa phải HTTP authentication/session.

Filesystem local là capability tùy chọn của G1 và mặc định tắt. Chỉ bật sau khi tạo root demo đã được kiểm tra:

```powershell
npm run fs:demo:setup
$env:G1_FILESYSTEM_ENABLED = '1'
npm run engine -- prepare testdata/dev-hand-plans/fs-copy-notify.json
```

Lệnh trên mới tạo preview; phải lấy `run_id`, `approval.id`,
`workflow_version_id` và `approval.snapshot_hash` từ JSON lồng, xem `preview`,
dừng để người dùng kiểm tra rồi mới `approve`/`execute`. Dùng [manual guide đầy
đủ](../../docs/G1-FILESYSTEM-STATUS-2026-09-13.md); guide dọn
`G1_FILESYSTEM_ENABLED` trong `finally` và không được chạy trong lúc capture
evidence.

Khi bật, launcher tự dẫn xuất `runtime/filesystem/<G1_USER_ID>` từ principal tin cậy, kiểm tra marker `.ati-root.json`, preset đã review và fingerprint artifact trước khi mở process MCP thứ hai. Catalog công khai có thêm `filesystem.read_file` và `filesystem.write_file`; upstream `read_text_file` và `write_file` không được route trực tiếp. `write_file` chỉ chạy sau approval của snapshot và tạo durable dispatch reservation trong PostgreSQL trước khi gửi packet MCP. Reservation không phải receipt và không chứng minh rằng bytes đã được commit.

## Hành vi khi lỗi

- Một worker giữ connection riêng với PostgreSQL advisory lock; các tool được gọi tuần tự. Mất connection giữ khóa sẽ đóng MCP và chặn dispatch tiếp.
- Read retry tối đa 3 lần theo DSL, exponential backoff với delay tối đa 30 giây. Write chỉ dispatch một lần trong run này.
- Write mất phản hồi hoặc worker dừng sau dispatch đưa run về `reconciliation_required`. Không suy ra rollback từ timeout và không tự thử lại.
- `recover` chỉ xử lý run dở đã được worker claim. Run đã duyệt nhưng chưa claim vẫn chờ `execute` kiểm expiry. Chưa có daemon tự gọi recovery khi startup.
- Với `task_hub`, `reconcile` trả `confirmed`, `conflict` hoặc `not_observed`; receipt được xác nhận không đổi trace lịch sử và không tự chạy bước sau. Với filesystem, reconcile giữ `receipt: not_supported`, báo `dispatch_marker: present|absent` và không nâng thành success từ bytes hiện tại. Marker không phải receipt; không thấy receipt/marker cũng không tự chứng minh write thất bại.
- Plan có read phụ thuộc vào write bị từ chối ở phiên bản này vì một preview không thể bảo toàn đúng thứ tự đó. DSL vẫn cấm dùng output write trong args/condition/key của bước khác.

## Phát triển và kiểm chứng

```powershell
npm run check:engine
```

Lệnh chạy typecheck, build bốn package, DSL/schema/OpenAPI, DB/MCP receiver và engine integration. FS-05 đạt **TECHNICAL PASS** cho E01–E14. Fresh FS-06 gate chạy **258 tests passed, 1 skipped**: 39 DSL, 92 engine unit pass + 1 skip, 64 PostgreSQL/MCP receiver và 63 engine integration. Tests tạo rồi dọn DB `g1_it_*`/`engine_it_*` riêng; không reset `wap_g1`. Evidence nằm trong [FS-05 report](../../docs/task-hub-evidence/batch-02/FS-05/FS-05.md) và [FS-06 final gate](../../docs/task-hub-evidence/batch-02/FS-06/1789384630165-final-check/output.log). Engine integration mặc định dành 120 giây cho mỗi test/hook do các case filesystem khởi động MCP/CLI thật; có thể override bằng `ATI_ENGINE_INTEGRATION_TIMEOUT_MS`.

Facade `WorkflowEngine(db, gateway, userId)` dùng cho prepare/decide/execute; inspector có thể truyền `undefined` thay gateway. PostgreSQL lưu status, events, outbox, snapshot và attempts. Native SQL transaction và Drizzle dùng các pool riêng vì Drizzle thay JSON/date codecs; không trộn hai handle vào một transaction.

HTTP/UI/polling, session, LLM/retrieval/replan và BullMQ chưa được triển khai trong module này. Filesystem read/write, hai-server controller, CLI và crash/lost-response checks đã được nối qua launch policy và approval guard; E08, cả hai mode E10 và E14 đều PASS trong FS-05. Toàn bộ 8 tool của server `task_hub` và 2 public filesystem tools đã hoàn tất về mặt kỹ thuật. G1 overall vẫn `PARTIAL` vì rubric chính thức và công việc nhóm đại diện `OPEN`, còn HTTP/UI/polling và AI evaluation `NOT_RUN`. Shared trace/event schemas đã dùng được cho lớp HTTP kế tiếp; OpenAPI hiện vẫn là hợp đồng dự kiến.

## AI live-evaluation preparation

The evaluator-only CLI is available after the offline gate and never enables
the normal API runtime. From the repository root:

```powershell
npm run ai:eval:live -- preflight --offline
npm run ai:eval:live -- probe --profile <profile> --campaign <id> --approval <json> --execute
npm run ai:eval:live -- index --profile <profile> --campaign <id> --approval <json> --execute
npm run ai:eval:live -- run --phase smoke --profile <profile> --campaign <id> --approval <json> --execute
npm run ai:eval:live -- report --run <run-directory>
```

Probe/index/run require an explicitly approved scope and an isolated
`AI_EVAL_DATABASE_URL`; the evaluator rejects the application/demo database,
including loopback aliases and default ports. The campaign lock and journal
carry reservations across runs, and Ctrl+C propagates cancellation. Fake
transport/isolated-DB tests cover all four OpenAI/Google role combinations;
they do not establish live provider quality, pricing, latency or formal rubric
acceptance. Follow the [readiness runbook](../../docs/ai-evidence/AI-LIVE/READINESS-RUNBOOK.md)
and keep live status `NOT_RUN` until those external gates are approved.
