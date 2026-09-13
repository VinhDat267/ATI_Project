# Controller/engine — 13/09/2026

**IMPLEMENTED / VERIFIED:** plan tay b02 chạy qua controller thật: đọc → preview bất biến → một lần duyệt → append + notify local → trace. Dùng PostgreSQL và MCP stdio thật, có CLI chạy qua các process riêng. Người dùng đã đồng ý bước này sau G1 đợt đầu; giữ phạm vi B/local.

## Kết quả đã kiểm

| Kiểm chứng | Kết quả |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | Exit 0, cài 176 package từ lock |
| `npm run check:engine` | Exit 0; typecheck, build 4 package, sinh JSON Schema/OpenAPI/types |
| DSL | 39/39 test qua |
| DB + MCP receiver | 15/15 test qua, PostgreSQL + MCP thật |
| Controller/engine | 24/24 test qua, PostgreSQL + MCP thật và fault injection có giới hạn |
| Tổng test | **78/78**, không có test skipped trong lần chạy đầy đủ |
| Static artifacts | 11 schema, 36 OpenAPI refs, 14 SQL/Zod statuses, 154 local links; không có lỗi |
| Live demo read-only | PostgreSQL 16.15/pgvector 0.8.6, 3 migrations; hai container healthy, Redis PONG, MCP đọc đúng hai dòng; demo có 0 message/receipt |

Log và snapshot trong [thư mục bằng chứng](engine-evidence/2026-09-13/README.md). Mỗi suite tạo rồi dọn database `g1_it_*`/`engine_it_*` riêng. Không reset DB demo, không gọi Slack/Google Sheets thật, không dùng API key AI. `check:engine` ghi evidence mới riêng, không thay báo cáo G1 trước đó.

Kết quả b02 được so với dữ liệu độc lập: destination có đúng `["API","Done"]` và `["UI","Doing"]`; có đúng một message `Đã chép 2 dòng.` tại `#team`. Nguồn bị sửa sau preview nhưng dữ liệu ghi vẫn đúng snapshot đã duyệt. Run có một approval, hai receipt và ba attempt đã kết thúc với certainty confirmed; event seq liên tục, event cuối là run.finished. Đây là kiểm chứng một fixture nghiệp vụ dev, chưa phải độ chính xác của AI hoặc đánh giá nhu cầu người dùng.

## Phần đã xây

- `packages/engine`: facade, snapshot canonical SHA-256, local gateway, transactional store, prepare/decision/execute, attempts, cancel/recovery/reconcile và CLI.
- Gateway chỉ khởi chạy ba tool đã duyệt, đối chiếu server identity, live schemas, policy và hash catalog/lock/built receiver dependencies. Không nhận lệnh chạy server hoặc quyền write từ plan/MCP annotation.
- Preview lưu plan/version/user/run, inputs, runtime/timezone, read outputs, tool snapshot và resolved write actions. Một approval TTL 10 phút cho cả hai write; owner/hash/version/expiry được kiểm lại trong transaction và trước từng write.
- Worker tuần tự giữ PostgreSQL advisory lock bằng connection riêng. Concurrent execute, kể cả trên cùng instance, chỉ một lần claim; mất connection giữ khóa đóng MCP và chặn dispatch tiếp.
- Status/event/seq/outbox commit cùng transaction. CLI claim trực tiếp outbox prepare/execute. Không chuyển run terminal hoặc thêm event sau run.finished; attempt đã kết thúc không bị ghi đè.
- Read retry tối đa 3, exponential backoff với delay tối đa 30 giây. Không tự retry write/replan/resume. `reconcile` chỉ đọc receipt và kiểm đầy đủ approved identity/policy/args/hash/result.
- DB package dùng pool native postgres.js riêng với Drizzle vì ORM thay JSON/date codecs của client. Regression test kiểm cả JSON object/scalar, timestamp và Drizzle seed.

Không thêm migration: controller dùng ba migrations hiện có. Chi tiết thiết kế trong [spec](superpowers/specs/2026-09-13-controller-engine-design.md) và [kế hoạch thực hiện](superpowers/plans/2026-09-13-controller-engine.md).

## Các tình huống lỗi đã chạy

| Tình huống | Quan sát được |
|---|---|
| Sai owner/hash/version, quyết định trùng, preview/registry thay đổi, forged read | Không thực hiện write không được duyệt |
| Expiry/reject; lỗi insert execute outbox | Expiry/reject chặn write; lỗi outbox rollback cả decision/status/event |
| Source thay đổi sau preview | Dữ liệu ghi giữ đúng snapshot đã xem |
| Hai worker/instance cùng execute | Chỉ một execution, không thêm receipt/message trùng |
| Wrapper làm mất response sau **write MCP thật đã commit** | Run reconciliation_required, một receipt, notify chưa chạy; read-only reconcile xác nhận receipt |
| Child engine **process.exit(86)** sau receiver commit, trước lưu response | `recover` đóng attempt dở, đánh dấu reconciliation_required; không resume/notify, receipt vẫn đọc được |
| PostgreSQL ngắt đúng backend giữ advisory lock | Worker cũ không dispatch write tiếp |
| Cancel sau write, sau failure hoặc trước dispatch; cancel trong khoảng xử lý condition | Không gọi write kế tiếp; không thêm event sau terminal; trước dispatch giữ known_failed thay vì tạo unknown giả |
| Trigger DB làm hỏng đúng lần lưu attempt outcome đầu tiên sau reply | Read/write attempts được đóng cùng transaction kết thúc; read known_not_applied, write unknown, receipt đã commit vẫn đối chiếu được |
| Operation/receipt policy hoặc step bị sửa | Reconcile báo conflict, không xác nhận nhầm |

Fault wrappers và DB triggers chỉ dùng trong test. Process crash và advisory-backend termination được thực hiện thật trên database test; chưa đo mọi dạng OS kill/network partition hoặc triển khai đa máy. `known_not_applied` ở read diễn tả không có side-effect, không có nghĩa đã lưu được output đọc thành công.

Review độc lập phát hiện lỗi về lock, cancel/terminal event, trước dispatch, receipt binding và attempt completion; tất cả được tái hiện/sửa rồi kiểm lại. Chi tiết trong [review](engine-evidence/2026-09-13/review.md).

## Dùng ngay và bước tiếp theo

```powershell
npm run engine -- prepare-b02
```

Lệnh chỉ chuẩn bị preview. [Hướng dẫn CLI](../packages/engine/README.md) chỉ cách đọc preview, điền đúng run/approval/version/hash, duyệt rồi execute, trace/events và xử lý run không rõ kết quả. Không có auto-approve; tạo lại run mới có thể tạo ý định ghi mới, nên cần kiểm preview.

**NOT_IMPLEMENTED / NOT_RUN:** HTTP endpoints/session, hai màn hình UI/polling, browser E2E, LLM/provider/retrieval/query expansion/local replan, BullMQ dispatcher/startup daemon, registry/preset tổng quát, 5 task_hub tool còn lại và filesystem adapter 2 tool. Trace hiện lưu normalized result cùng snapshots/certainty, chưa lưu toàn bộ wire response. DB append-only grants và production authentication chưa làm.

G1 tổng thể vẫn **PARTIAL** vì catalog 8+2 và rubric chưa đủ; các invariant G2 đã có bằng chứng cho ba tool hiện tại. Bước tiếp theo theo kế hoạch là hoàn thiện phần catalog/filesystem và rubric còn thiếu, sau đó nối HTTP/session + hai màn hình polling tuần 3. Chưa chuyển sang LLM hoặc tuyên bố hoàn tất ứng dụng.
