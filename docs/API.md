# API B/local

[OpenAPI 3.1](openapi.yaml) là artifact sinh từ packages/dsl/scripts/emit-openapi.ts và schema Zod dùng chung. Chạy npm run api:generate. File type sinh ở packages/dsl/generated/api.d.ts. Không dùng đường dẫn api/openapi.yaml.

Đây là hợp đồng wire-format của HTTP local đã nối đến API-CATALOG. Routes hiện hành: POST /auth/login; GET /servers; GET /servers/catalog; POST /servers/check; GET/POST /runs; GET /runs/{runId}; GET /runs/{runId}/events?since_seq=; GET /runs/{runId}/trace; GET /runs/{runId}/reconciliation; POST /runs/{runId}/approval; POST /runs/{runId}/cancel. Mọi route trừ login cần authentication; mọi run cần owner check.

`GET /servers/catalog` là read-only và gọi `serverCatalog({ connect: false })`:
nó không launch hoặc ensure MCP connection. `POST /servers/check` là active
check duy nhất, gọi `serverCatalog({ connect: true })` qua các reviewed preset
cố định. Request body không có launch contract và bị bỏ qua nếu có; client
không thể truyền slug, executable hoặc args để thay đổi preset. Active check
rate-limit 5 giây theo authenticated demo principal, trả `429` cùng header
`Retry-After` integer khi chưa hết cooldown. Lỗi connection/config trả `503`
với thông báo tổng quát; lỗi của từng preset vẫn được biểu diễn riêng trong
catalog, không lộ raw error hay credential.

Client tạo run nhận 202 planning. Lúc này version/plan có thể null. Poll events mỗi 2 giây, tối đa 200 event/trang theo seq tăng dần. Dùng next_seq để lấy tiếp, bỏ duplicate seq; khi mất kết nối tiếp tục từ seq cuối. HTTP retry không được tạo lại POST /runs tự động vì endpoint này chưa có client idempotency contract.

- plan.ready có WorkflowPlan được kiểm kiểu.
- dryrun.ready báo id/expiry/count; UI GET RunDetail để lấy Approval.actions, version và snapshot hash.
- run.finished chỉ nhận trạng thái kết thúc, gồm refused, needs_input, reconciliation_required.
- Approval request gắn id+version+snapshot; stale/expired/already-decided trả 409. Không có API tách /approve và /reject thiếu payload.
- Không có nút dry-run độc lập, endpoint sửa plan hoặc WebSocket trong B. WS helper còn trong thư viện là legacy, không là cam kết route.

Sequence thành công: create → planning → validating → dry_running → awaiting_approval → decision → running → succeeded. Refusal/clarification kết thúc trước version. Hết hạn, reject, cancel và replan theo [execution contract](EXECUTION-CONTRACT.md). Sau replan UI hiển thị version/preview mới và chờ duyệt lại.

OpenAPI 3.1 dùng union với null. JSON Schema mô tả cấu trúc, không mã hóa đầy đủ Zod superRefine, graph, timezone hợp lệ hay authorization. Server vẫn phải gọi validators và transaction guards. Schema/type generation đã có thể chạy; HTTP compatibility cho catalog đã có focused loopback/integration coverage, còn frontend integration vẫn NOT_RUN. Đây không phải bằng chứng AI evaluation, LLM/retrieval/replan, BullMQ hoặc production multi-tenant readiness.

GET /runs/{runId}/trace trả TraceSchema: snapshots đầy đủ theo từng attempt (version/tool/policy/input/output schemas, args/result, operation và certainty). Phân trang tối đa 100, `next_cursor` opaque là payload `snapshot_id + offset` được HMAC ký và bind user/run; gọi lại không cursor để lấy snapshot mới. Legacy thiếu metadata được ghi evidence=legacy_unknown, không bịa dữ liệu.
