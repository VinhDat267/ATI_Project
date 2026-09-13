# Review controller/engine và sửa hồi quy

Review độc lập chỉ đọc tập trung snapshot, claim, retry/uncertainty, trace và recovery. Reviewer không chạy test; người triển khai tái hiện trên PostgreSQL/MCP thật rồi sửa. Đây là review correctness có phạm vi, không phải security audit toàn hệ thống.

| Finding | Tái hiện / sửa |
|---|---|
| Worker dùng connection giữ lock không được theo dõi khi mất kết nối | Ngắt đúng PostgreSQL backend giữ advisory lock. Dùng dedicated connection, đánh dấu lease lost và đóng MCP, kiểm lock trước dispatch/recovery |
| Cancel đua với failure/condition có thể ghi event sau run.finished hoặc đổi terminal | Chèn barrier tại khoảng giữa các transaction. Store chặn post-terminal events/transitions; cancel giữ reconciliation_required nếu còn unknown |
| Cancel sau operation claim nhưng trước MCP bị ghi thành unknown | Barrier cancel trước startAttempt; BeforeDispatchError giữ known_failed/cancelled và không gọi write |
| Receipt đối chiếu thiếu approved policy/step binding | Sửa policy/step trong DB test; đối chiếu đầy đủ snapshot identity và tính lại payload hash, trả conflict |
| Lỗi persist completion sau call để attempt mở vĩnh viễn dù run terminal | PostgreSQL trigger lỗi đúng lần completion đầu, dùng sequence không rollback. Cả read và write fail trước sửa; closeOpenAttempts hoàn thiện rows còn mở trong transaction kết thúc/recovery |

Kiểm thêm từ người triển khai: hai execute trên **cùng Store** cùng vượt guard trước await khiến loser xóa lease của winner. Test thất bại với zero receipt thay vì hai; synchronous workerActive guard sửa lỗi, cả shared/separate workers đều qua. Cũng tái hiện lỗi Drizzle thay native postgres.js JSON/date codecs; tách pool và giữ regression DB integration.

Vòng review sau xác nhận bốn finding đầu đã được xử lý, phát hiện tiếp completion failure đã sửa nêu trên. Kết quả cuối trong [check-engine.log](check-engine.log): 39/39 DSL, 15/15 DB/MCP, 24/24 engine, typecheck/build/schema generation exit 0. Các test lỗi mới đã thất bại trước sửa và qua sau sửa; đầy đủ suite chạy lại sau thay đổi code cuối.

Giới hạn: chưa có HTTP/UI/LLM, DB role hardening hoặc kiểm mọi loại network/OS failure. Receiver receipt xác nhận mutation local đã commit; không cấp quyền retry/resume tự động và không chứng minh exactly-once cho MCP bất kỳ.
