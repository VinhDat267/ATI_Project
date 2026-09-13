# G1 phần đầu — database và ba tool local

Người dùng đã đồng ý bước kế tiếp: database + read_sheet_range, append_sheet_rows, send_slack_message. Áp dụng BASELINE B/local và EXECUTION-CONTRACT; không mở rộng thành toàn bộ engine/UI/LLM hoặc đủ 8+2 tools trong lần này.

## Thiết kế

- Môi trường Docker riêng `ati-g1`, PostgreSQL 16/pgvector tại 127.0.0.1:55432, Redis tại 127.0.0.1:56379. Volume riêng; không reset dữ liệu/container khác. Redis chỉ kiểm hạ tầng, chưa có worker.
- `packages/db`: postgres.js + Drizzle; SQL hiện có là nguồn DDL. Migration runner dùng advisory lock, checksum và ledger; 0002 chạy enum additions autocommit rồi body+ledger cùng transaction. Seed insert-only cho một owner demo, bảng source/Progress và dest/Report, kênh #team. Không reset khi seed lại.
- Migration 0003 thêm local sheets/channels/messages/receipts. Mọi row có user_id. MCP principal lấy từ cấu hình tiến trình, không từ args model.
- `apps/mcp-task-hub`: server stdio, SDK pin 1.30.0, chỉ advertise đúng 3 tool đã triển khai. Input/output schema khớp catalog B/local. Output structuredContent; validation/domain lỗi trả isError; stdout chỉ dành JSON-RPC.
- Write context ở MCP request `_meta["ati/authorization"]`: approval_id, operation_id, snapshot_hash. Server đọc approval/run/operation từ DB, yêu cầu approved/running và kiểm owner, expiry, version, snapshot hash và action/payload hash. Pending bị chặn. Không thêm operation_id vào args business hay để metadata tự cấp quyền.
- Receipt có khóa (user_id,operation_id), fingerprint server/tool/policy/args. Transaction khóa approval/run và operation, rồi tra receipt; mutation + receipt atomic. Gọi cùng operation/hash trả receipt khi approval còn hợp lệ; khác args/tool bị chặn. Reconciliation read-only sau expiry/cancel là bước sau. Consumer phải tạo/claim operation và approval trước call; engine tạo/duyệt preview vẫn là bước sau. Kiểm lại expiry sau resource lock và sau insert receipt để rollback nếu chờ DB quá TTL.

## Ngữ nghĩa local

read_sheet_range hỗ trợ vùng A1 hữu hạn như Progress!A1:B2, không full-column hoặc công thức. Giới hạn 1.000 rows × 100 columns/call. Chỉ trả rows hiện có, cells thiếu trong vùng thành chuỗi rỗng. Không tính/biến đổi dữ liệu.

append_sheet_rows thêm nguyên mảng string[][] vào sheet đã tồn tại, tối đa 1.000 rows và 100 cells/row. Server khóa sheet để hai operation khác nhau không ghi đè nhau. send_slack_message chỉ insert vào bảng messages local của channel đã tồn tại; optional thread_ts phải là message id thuộc cùng owner/channel. Không gọi Slack/Google.

## Nghiệm thu lần này

Test PostgreSQL thật: migration sạch/lặp/checksum drift; constraints version/owner; seed không xóa dữ liệu. Test MCP thật: tools/list/schema, read range, write chưa duyệt/expiry/wrong owner/wrong hash bị chặn, append/send đúng dữ liệu, replay và concurrent replay không trùng, hai append khác nhau không mất dữ liệu, payload conflict, failed mutation không để receipt, receipt còn sau restart server. Test kiểm DB sau call, không chỉ kiểm JSON response.

Test tạo approval/operation bằng fixture rõ ràng để mô phỏng controller đã được duyệt. Điều này kiểm receiver boundary, không chứng minh production approval controller hoặc end-to-end engine/UI đã có. Artifacts lưu discovery và kết quả kiểm; không gọi model hoặc dịch vụ SaaS.
