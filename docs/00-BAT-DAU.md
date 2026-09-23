# Bắt đầu với cấu hình B/local

Tài liệu này dẫn vào nền B/local lịch sử. Trạng thái MVP v2 ngày 23/09/2026
nằm ở [README](../README.md), [baseline](BASELINE.md) và [audit P6](plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md);
các nhãn WEB/AI cũ bên dưới không phải verdict MVP v2.

Quyết định B/local đã được người dùng xác nhận 13/09/2026. Thứ tự đọc:

1. [BASELINE](BASELINE.md): phạm vi và các điều kiện không được vi phạm.
2. [Yêu cầu](functional-requirements.md): mã FR và tiêu chí nghiệm thu của B.
3. [Kế hoạch 6 tuần](KE-HOACH-6-TUAN.md): mốc, quỹ giờ và điều kiện cắt phạm vi.
4. [Hợp đồng thực thi](EXECUTION-CONTRACT.md), [API](API.md), [database](../db/DATABASE.md).
5. [Dataset](../testdata/TESTDATA.md) và [thiết kế đánh giá](EVALUATION.md).
6. [Kết quả sửa audit](FIX-REPORT-2026-09-13.md).

7. [Trạng thái task_hub](TASK-HUB-STATUS-2026-09-13.md): báo cáo ngày 13/09 cho 8 tool task_hub và 4 migrations; đây là mốc lịch sử trước filesystem.
8. [Filesystem status và manual guide](G1-FILESYSTEM-STATUS-2026-09-13.md), [rubric map](G1-RUBRIC-MAP.md) và [FS-05 evidence](task-hub-evidence/batch-02/FS-05/FS-05.md): trạng thái hiện hành của controller hai server, 10 public tools và verdict có điều kiện.
9. [Controller/engine](ENGINE-STATUS-2026-09-13.md) & [Hướng dẫn CLI](../packages/engine/README.md): luồng plan tay qua preview, approval, write, trace và kiểm thử lỗi; dated status là ảnh chụp lịch sử, README của engine có hướng dẫn hiện hành.

`npm ci` và `npm run check` kiểm mã offline. Với Docker đang bật: `npm run build`, `npm run db:up:g1`, `npm run db:migrate:g1`, `npm run db:seed:g1`, rồi `npm run check:engine` kiểm PostgreSQL/MCP/controller thật. Fresh FS-06 gate đạt **258 passed, 1 skipped**. `npm run engine -- prepare testdata/dev-hand-plans/th-move.json` tạo preview cho plan tay chuyển card `c1` sang `Done`; filesystem demo phải dùng manual guide có `G1_FILESYSTEM_ENABLED=1` và dừng trước approval. Xem README ở root để biết ports và commands.

WEB-01B hiện có fixture UI shell nhưng đang `PROVISIONAL_IMPLEMENTATION`; browser nối live API/session, frontend polling 2 giây và AI evaluation còn `NOT_RUN`. FS-05 đạt **TECHNICAL PASS** với 8 public `task_hub` tools và 2 public `filesystem` tools. API-01–05 đạt **API_TECHNICAL_PASS** cho loopback HTTP/session/lifecycle với planner fixture; H01–H20 và cleanup delta đã pass ở gate 2026-09-17. G1 tổng thể vẫn **PARTIAL** vì rubric chính thức và công việc nhóm đại diện còn `OPEN`. Đọc [system design](superpowers/specs/2026-09-15-platform-system-design.md) trước khi mở rộng frontend.
