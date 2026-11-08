# 2026-11-07 · XSVC-01 — cổng duyệt báo cáo

## Đã làm

`ExecutionService` mặc định bật `enforceReportGrounding`. `server.ts` truyền cùng cờ. Một plan báo cáo không có evidence không còn được duyệt chỉ vì caller quên cờ.

Lượt lịch vẫn đi qua `prepareResponse`, nơi cờ đã bật lúc lưu plan.

Resolver khóa trường hợp GitHub chỉ trả `htmlUrl` khi bước sau hỏi `url`.

## Kiểm tra

- Ca mới fail trước khi sửa với `success: true`, rồi pass 409 và plan `pending`.
- `report-evidence.test.ts` 12/12. Executor 56/56.
- chat-api 2474 pass, 1 timeout phân trang hội thoại khi chạy cả gói. File đó chạy lại 8/8. Không gắn timeout này với cổng báo cáo.
- Ma trận và phát hiện nằm trong `docs/audits/2026-11-07-cross-service/`.
