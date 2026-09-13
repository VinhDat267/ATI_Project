# Bắt đầu với cấu hình B/local

Quyết định B/local đã được người dùng xác nhận 13/09/2026. Thứ tự đọc:

1. [BASELINE](BASELINE.md): phạm vi và các điều kiện không được vi phạm.
2. [Yêu cầu](functional-requirements.md): mã FR và tiêu chí nghiệm thu của B.
3. [Kế hoạch 6 tuần](KE-HOACH-6-TUAN.md): mốc, quỹ giờ và điều kiện cắt phạm vi.
4. [Hợp đồng thực thi](EXECUTION-CONTRACT.md), [API](API.md), [database](../db/DATABASE.md).
5. [Dataset](../testdata/TESTDATA.md) và [thiết kế đánh giá](EVALUATION.md).
6. [Kết quả sửa audit](FIX-REPORT-2026-09-13.md).

7. [G1 đợt đầu](G1-STATUS-2026-09-13.md): DB và 3 MCP tool đã chạy, giới hạn kiểm chứng và bước tiếp theo.
8. [Controller/engine](ENGINE-STATUS-2026-09-13.md): luồng plan tay qua preview, approval, write, trace và kiểm thử lỗi. [Hướng dẫn CLI](../packages/engine/README.md).

`npm ci` và `npm run check` kiểm mã offline. Với Docker đang bật: `npm run db:up:g1`, `npm run db:migrate:g1`, `npm run db:seed:g1`, rồi `npm run check:engine` kiểm PostgreSQL/MCP/controller thật. `npm run engine -- prepare-b02` tạo preview cho plan tay. Xem README ở root để biết ports và commands.

Chưa có `npm run dev`. Luồng controller/engine đã có CLI; G1 tổng thể vẫn còn 5 task_hub tool, filesystem adapter và rubric. Sau khi đóng các phần G1/G2 còn thiếu, nối HTTP/session và hai màn hình polling theo tuần 3; LLM theo mốc tuần 4.
