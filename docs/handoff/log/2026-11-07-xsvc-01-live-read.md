# 2026-11-07 · XSVC-01 — đọc live rồi hủy

## Đã chạy

Server đang chạy `runtimeMode: live`. Hai prompt chỉ đọc Pull Request GitHub, `LIVE_APP_CANCEL=1`, không bấm duyệt.

- Không nêu repository: câu trả lời hỏi lại repository. Working memory đã có một repo.
- Nêu repository: câu trả lời nói chưa có dữ liệu PR, cần tra cứu trước.

Cả hai hội thoại: 0 plan, 0 execution step. Không có bản xem trước để hủy.

## Chưa sửa

`validateAnswer` coi prefetch thư mục là đã có dữ liệu đọc. Một câu trả lời không gọi `github.list_pull_requests` vẫn được lưu.
