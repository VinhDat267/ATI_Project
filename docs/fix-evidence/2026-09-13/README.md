# Evidence sửa audit — 13/09/2026

- [npm-ci.log](npm-ci.log): cài mới dependency theo lock, exit 0.
- [npm-check.log](npm-check.log): typecheck/build/38 tests/schema/API types, exit 0.
- [artifact-verification.json](artifact-verification.json): OpenAPI local references, compilation/schema samples, run status SQL/Zod, FR inventory, markdown links; failures=[] khi kiểm cuối.
- [archive-verification.json](archive-verification.json): 40 file trong zip trước sửa khớp SHA-256 của audit gốc.
- [verify-artifacts.mjs](verify-artifacts.mjs): chạy từ bất kỳ cwd sau npm run check; kiểm cấu trúc, không gọi dịch vụ ngoài.

Tái lập tại project root: npm ci; npm run check; node docs/fix-evidence/2026-09-13/verify-artifacts.mjs. Runtime đã dùng Node 24.19.0, npm 11.17.0; lock lưu phiên bản dependency thực tế. Timestamp JSON là UTC; tên thư mục/ngày báo cáo theo Asia/Ho_Chi_Minh.

Audit ban đầu tái hiện 15 test thất bại; các chức năng policy/approval/trace mới đều có test thất bại trước sửa. Không dùng log PASS làm chứng cứ ứng dụng end-to-end. Docker daemon không chạy; PostgreSQL migration, HTTP/API server, UI, MCP local/live and LLM provider tests NOT_RUN. Kiểm OpenAPI ở đây bỏ format validation để tập trung shape/refs; Zod datetime/refinements và engine guards vẫn cần ở runtime.
