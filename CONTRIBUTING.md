# Làm việc với ATI Project

Trước khi stage/commit, đọc [quy tắc chọn file](docs/GIT-POLICY.md). Stage từng file thuộc task, review staged diff; không dùng git add . hoặc git commit -a. Log mới chỉ thêm theo đường dẫn cụ thể sau khi kiểm nội dung; giữ evidence lịch sử đang tracked.

Đọc docs/BASELINE.md và docs/ENGINE-STATUS-2026-09-13.md trước khi thay đổi; docs/G1-STATUS-2026-09-13.md là đợt receiver trước đó. Có DSL, DB package, 3 MCP tool và controller/engine CLI; API/web còn skeleton. Git đã được khởi tạo trên nhánh main; xem docs/task-hub-evidence/batch-01 để biết kết quả các checkpoint mới.

npm ci cài từ lock; npm run check kiểm mã offline. npm run check:engine thêm toàn bộ integration tests PostgreSQL/MCP/controller, cần Docker G1 đang chạy; mỗi suite tự tạo/dọn database g1_it_* hoặc engine_it_* riêng. npm run check:g1 chỉ kiểm đến receiver. Không chạy nhiều bản integration suite đồng thời vì ghi chung evidence. Mặc định integration suite ghi observations vào runtime/test-evidence (đã ignore), không đụng vào evidence đề ngày: docs/engine-evidence/2026-09-13 và docs/g1-evidence/2026-09-13 có hash trong docs/antigravity/filesystem-handoff-baseline.json nên phải giữ bất biến. Muốn lưu evidence cho một checkpoint thì set ATI_EVIDENCE_DIR trỏ vào một thư mục batch dưới docs/task-hub-evidence. Mã schema ở packages/dsl/src là nguồn chuẩn, scripts/emit-openapi.ts sinh docs/openapi.yaml; npm run api:generate sinh API types. Không sửa tay OpenAPI/generated files. Thay đổi hành vi phải kèm counterexample có kết quả kỳ vọng độc lập.

DB package dùng pool riêng cho native postgres.js và Drizzle để không chia sẻ JSON/date codecs bị ORM thay thế. Không trộn db.client transaction với db.db transaction. Worker giữ advisory lock trên connection riêng, không trả lock về pool rồi tiếp tục dispatch. Đổi catalog, lock hoặc built tool artifacts làm preview cũ không còn hợp lệ; không sửa snapshot để chạy lại.

Đừng ghi credential vào prompt/log/fixture. Không gọi tool write thật khi đang kiểm offline. Không đánh dấu HTTP/DB/MCP/LLM PASS từ kết quả test thư viện. Báo cáo mỗi lần sửa cần ghi lệnh, kết quả, điều gì chưa chạy.

Backend dự kiến phải thực hiện EXECUTION-CONTRACT: owner/status/version/hash check nguyên tử, operation claim/receipt/reconciliation, output-schema validation và event/outbox. validateToolCall không thay approval và không tự gọi MCP.
