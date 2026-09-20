# `@wap/api`

API HTTP local của MVP B. API-01 cung cấp boundary chạy trên `127.0.0.1`, đăng nhập một tài khoản demo duy nhất, bearer session trong bộ nhớ và `GET /api/v1/servers`. API-02 nối `POST /api/v1/runs` (durable `202`) và worker planner bất đồng bộ qua PostgreSQL outbox. API-03 bổ sung `GET /api/v1/runs`, detail read model, polling events (tối đa 200), trace cursor HMAC trên snapshot REPEATABLE READ (100 attempt/trang, tối đa 10.000) và reconciliation projection chỉ đọc. API-04 nối approval/cancel qua HTTP, dispatcher execute outbox, startup orphan recovery và expiry maintenance theo đồng hồ PostgreSQL. API-05 có acceptance loopback cho task_hub và filesystem + task_hub, kèm frontend handoff. API-CATALOG bổ sung catalog reviewed sâu: `GET /api/v1/servers/catalog` chỉ đọc, không launch/ensure MCP; `POST /api/v1/servers/check` là active check duy nhất, dùng preset reviewed cố định, không nhận executable/slug/args từ client và rate-limit 5 giây mỗi principal.

## Cấu hình bắt buộc

Không có mật khẩu hay secret mặc định trong mã nguồn. Trước khi chạy cần đặt:

- `G1_DATABASE_URL`: PostgreSQL của workspace.
- `API_DEMO_EMAIL`: email tài khoản demo đã seed trong database.
- `API_DEMO_PASSWORD_HASH`: chuỗi scrypt theo định dạng `scrypt$16384$8$1$<salt-hex-32>$<key-hex-128>`.
- `API_CURSOR_KEY`: khóa 32 byte ở dạng base64 chuẩn (ký HMAC cho trace cursor).

Tuỳ chọn: `API_PORT` (mặc định `3001`), `API_SESSION_TTL_MS` (mặc định 8 giờ), `G1_USER_ID`, `API_PLANNER_MODE` (`disabled` hoặc `dev_fixture`), `API_NEW_RUNS_ENABLED` (`1` mặc định; đặt `0`/`off` để tạm ngắt nhận run mới), và `AI_PROVIDER_CALLS_ENABLED` (`1` mặc định; đặt `0`/`off` để chặn provider call trước credential/ledger/fetch). Tạo hash/key trong một phiên shell riêng hoặc secret manager; không truyền mật khẩu như command-line argument.

## Lệnh

Từ root workspace:

```text
npm run build -w @wap/api
npm run test:unit -w @wap/api
npm run test:integration -w @wap/api
npm run api:generate
npm run check:api
npm run api:dev
```

`check-api.mjs` writes a new sanitized evidence directory under
`docs/api-evidence/` and returns `0` only for a technical pass, `2` for an
honest partial gate (for example, a required negative matrix that has not been
established), and `1` for a command or cleanup failure. A partial result is
not a passing process exit. The runner consumes structured Vitest reports for
the H01–H20 matrix and independently compares owned database, temp-root and
project-process snapshots after every command.

Integration test tự tạo database tạm trong PostgreSQL local và xoá database đó khi kết thúc. API chỉ bind loopback; mọi request trả `x-request-id`, JSON strict và `Cache-Control: no-store`. `GET /health/live` không auth và chỉ phản ánh process; `GET /health/ready` không auth, kiểm tra DB qua `SELECT 1` khi chạy main và trả `503 NOT_READY` nếu dependency lỗi. `POST /auth/logout` yêu cầu bearer hợp lệ, xoá session hiện tại và trả `204`; restart vẫn xoá toàn bộ session vì store hiện còn in-memory. `API_PLANNER_MODE=disabled` giữ `POST /runs` ở trạng thái `503 PLANNER_UNAVAILABLE`; `dev_fixture` chỉ nhận đúng các prompt server-owned trong `testdata` và không phải AI evaluation. Trace snapshot hết hạn sau 15 phút; cursor sai owner/run, hết hạn hoặc bị sửa trả `400`.

Ở môi trường không phải test, API ghi một JSON log cho mỗi request với đúng
`event`, method, route template, status và `request_id`. Route template không
chứa UUID/query string; body, header, bearer token, prompt và secret không được
đưa vào log. Có thể inject `requestLogger` trong fixture để kiểm tra log mà
không bật console output.

`GET /api/v1/servers/catalog` yêu cầu bearer session và gọi
`serverCatalog({ connect: false })`; khi gateway manager chưa có connection,
route trả hai entry disconnected với `tools: []` mà không mở MCP. Chỉ
`POST /api/v1/servers/check` mới gọi `serverCatalog({ connect: true })` qua
callback launch reviewed cố định. Body nếu có được tiêu thụ và bỏ qua; nó
không thể chọn server, executable hay arguments. Active check trả `429` với
`Retry-After` integer nếu gọi lại trong 5 giây; lỗi config/connection được
sanitise thành `503`. Session vẫn in-memory; planner fixture không phải AI
evaluation, còn LLM/retrieval/replan, BullMQ và browser integration vẫn là
giới hạn ngoài technical catalog gate.
