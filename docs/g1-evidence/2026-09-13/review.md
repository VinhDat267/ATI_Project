# Review G1 receiver — 13/09/2026

Review độc lập, read-only, trên packages/db, migration 0003, MCP server/service/contracts và tests; không có Git range vì thư mục không phải Git repo. Reviewer không chạy tests.

**P2 xác nhận:** expiry được kiểm trước khi append lấy khóa hub_sheets. Nếu khóa bị giữ quá expires_at, call có thể tiếp tục ghi với approval đã hết hạn.

**Tái hiện:** test giữ khóa destination trong một transaction riêng, cấp TTL 2 giây, chờ pg_stat_activity xác nhận MCP đang đợi khóa, giữ thêm 2,1 giây rồi nhả. Trước sửa test thất bại: isError là undefined, append vẫn thành công.

**Sửa:** receiver kiểm lại thời gian DB sau resource lock và trước mutation, rồi kiểm lần cuối sau receipt insert để rollback nếu thao tác DB kéo dài quá expiry. Test tương tự sau sửa trả isError và xác nhận sheet rỗng/receipt=0; full suite cuối cũng PASS.

**Khuyến nghị được ghi rõ:** receipt replay bằng write tool yêu cầu approval còn hợp lệ/run running/version hiện hành. Reconciliation read-only sau expiry/cancel là phần tiếp theo, không suy ra từ restart test.

Không có lỗi Critical/Important khác được reviewer nêu trong scope hẹp này. Verdict ban đầu “With fixes”; việc khắc phục đã được root xác minh bằng regression + full suite, không ghi là reviewer đã chạy hoặc review lại bản cuối.
