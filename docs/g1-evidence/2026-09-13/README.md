# Bằng chứng G1 đợt đầu

- [npm-ci.log](npm-ci.log): cài lại từ lockfile, exit 0.
- [check-g1.log](check-g1.log): root typecheck/build, 39 tests offline, schema/OpenAPI và 14 tests PostgreSQL/MCP; exit 0.
- [migrate-rerun.log](migrate-rerun.log): ledger có 3 migrations; chạy lại applied=[]; exit 0.
- [runtime-check.log](runtime-check.log), [runtime-snapshot.json](runtime-snapshot.json): read-only kiểm trực tiếp services/database demo và MCP stdio; phiên bản, image ID, hashes và actual read.
- [mcp-observations.json](mcp-observations.json): tools/list thật và DB result của b02 trên isolated test database. Đây là observations, không tự thay verdict của full test log.
- [review.md](review.md): review độc lập, lỗi expiry khi chờ sheet lock, tái hiện và bản sửa.
- [artifact-verification.json](artifact-verification.json): đối chiếu OpenAPI/SQL/Zod và link tài liệu; script [verify-artifacts.mjs](verify-artifacts.mjs) bỏ qua ví dụ link nằm trong code Markdown, không sửa nội dung audit lịch sử.

MCP tests dùng synthetic controller fixture và process MCP thật. Không có evidence cho production controller/API/UI/engine/LLM, timeout unknown hoặc mất response. Xem [status](../../G1-STATUS-2026-09-13.md) để biết phạm vi chính xác. Bộ `docs/fix-evidence/2026-09-13` giữ nguyên ảnh chụp trước G1.

Chạy `npm run check:g1` cập nhật log khi được redirect; suite cập nhật observations nếu cả discovery và b02 đã chạy. `node scripts/g1-status.mjs` cập nhật runtime snapshot riêng, không ghi dữ liệu nghiệp vụ. Không chạy đồng thời nhiều suite vì chúng ghi cùng file observations.
