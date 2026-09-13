# Database — B/local

Nguồn DDL: migrations/0001_init.sql (lịch sử), 0002_audit_contracts.sql (sửa hợp đồng), 0003_task_hub_local.sql (receiver local). Cả ba đã chạy trên PostgreSQL 16 trong G1 ngày 13/09/2026; ghi nhận Docker không khả dụng ở FIX-REPORT là trạng thái trước đợt này. Xem [G1 status](../docs/G1-STATUS-2026-09-13.md).

0001 có 14 bảng và schema cũ. 0002 thêm tool_operations, run_outbox, nullable pre-plan version, source prompt/workflow/owner relationship, planner outcome, timezone, policy/output schema, version/snapshot approval và attempt tool snapshot. Thêm run statuses refused/needs_input/reconciliation_required đồng bộ Zod. Cần chạy enum additions ngoài transaction chứa thao tác dùng giá trị mới, rồi transaction còn lại.

0002 giữ idempotency_records chỉ để xem lịch sử; không dùng user+key legacy để quyết định write mới. Pending/approved legacy chuyển superseded vì thiếu payload binding. Trước khi áp trên DB có dữ liệu, backup và kiểm ảnh hưởng này; không coi người dùng đã duyệt payload mới. Không backfill tool snapshot lịch sử bằng plan hiện tại.

Vòng đời và transaction bắt buộc nằm trong [EXECUTION-CONTRACT](../docs/EXECUTION-CONTRACT.md). JSONB plan chỉ được ghi sau Zod + policy/graph validation; nullable version chỉ dành giai đoạn trước executable plan hoặc các terminal outcome không có plan. composite FK buộc run version cùng workflow và run owner cùng owner workflow.

Mỗi local receiver write phải có receipt atomic với mutation; tool_operations ở orchestrator không thay transaction của receiver. Unknown external write cần reconciliation. Controller CLI đã có owner checks, claim outbox, attempt completion và explicit orphan recovery; HTTP/session, DB append-only grants, BullMQ dispatcher và startup daemon chưa triển khai. Không coi bất biến ở application là quyền DB đã được siết.

Runner `packages/db/src/migrate.ts` dùng một connection/advisory lock, ledger SHA-256 và transaction cho migration + ledger. Kiểm toàn bộ checksum lịch sử trước DDL mới. 0002 có enum prelude autocommit riêng; không sửa migration đã áp dụng, thêm migration mới. Seed thêm user/sheets/channels thiếu với ON CONFLICT DO NOTHING, không xóa receipt hay reset sheet.

Đã kiểm tích hợp: apply/rerun/checksum drift, seed bảo toàn sửa tay, planning/refused không version, bác running thiếu version và run khác owner workflow. [Engine suite](../docs/ENGINE-STATUS-2026-09-13.md) kiểm thêm owner/version/hash/expiry, concurrent claim, mất response, process crash, seq/outbox, mất connection giữ khóa và lỗi lưu attempt outcome. Tests dùng DB g1_it_*/engine_it_* do từng suite tạo; không reset volume hay DB demo.

0003 thêm hub_sheets, hub_channels, hub_messages, hub_receipts. Drizzle layer đã map các bảng receiver; SQL vẫn là nguồn schema, không dùng ORM push/generate để thay migrations. G1 receiver kiểm atomic receipt bằng lỗi DB sau mutation, concurrency và restart; controller/engine dùng lại ba migrations hiện có, không cần migration mới.

`openDatabase` có hai pool lazy riêng: `client` cho native postgres.js và `db` cho Drizzle. Drizzle thay JSON/date codecs của client truyền vào; chia pool ngăn lỗi serialization trong SQL transaction khi cùng process đã dùng ORM. Không trộn hai handle vào một transaction. `createWorkerClient` tạo connection riêng cho advisory lock, caller chịu trách nhiệm đóng. Có regression test JSON object/scalar, timestamp và Drizzle seed; `close` đóng cả hai pool chung.

HNSW/1536 chiều được giữ. GIN tsvector là PostgreSQL full-text, không phải BM25; hybrid nằm ngoài B.

Hạ tầng riêng: `npm run db:up:g1` dùng compose.g1.yaml, project ati-g1, volume ati-g1_g1_pgdata; PostgreSQL 55432, Redis 56379, chỉ bind loopback. `db:migrate:g1` và `db:seed:g1` dùng G1_DATABASE_URL hoặc URL demo mặc định. `docker compose -f compose.g1.yaml stop` dừng services và giữ dữ liệu. Compose cũ là lịch sử; không reset hay đổi volume services khác. Redis PING được kiểm, BullMQ chưa tích hợp.
