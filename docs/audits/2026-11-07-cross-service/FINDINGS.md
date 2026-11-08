# Kiểm toán liên dịch vụ — phát hiện

**Nhánh:** `docs/xsvc-01-cross-service-audit`. Nguồn bản đồ: [INVENTORY.md](INVENTORY.md). Ma trận: [SEAM-MATRIX.md](SEAM-MATRIX.md).

Mức là mức còn lại sau pha 1. F1–F3 và cổng duyệt đã có test đỏ rồi sửa trên nhánh này.

## Đã đóng trên nhánh

| ID | Việc đã khóa | Bằng chứng |
|---|---|---|
| F1 | OAuth MySheets chưa chọn bảng tính vẫn có sáu tool Docs/Drive. Tool bảng tính không vào catalog. OFF-02 sẵn sàng. OFF-03 không. | `mysheets-services.test.ts`, `adapter-factory.test.ts`, `mysheets-backend.test.ts`, `job-readiness.test.tsx` |
| F2 | `trello.create_card` thiếu `url` là `UNKNOWN` sau khi thẻ đã tạo. Không trả chuỗi rỗng. | `trello-write.test.ts` |
| F3 | `schedule_meet` thiếu Meet link là `UNKNOWN` sau khi sự kiện đã tạo. | `personal-calendar-adapter.test.ts` |
| F6 | Duyệt một plan báo cáo không có `reportEvidence` bị từ chối cả khi caller không truyền cờ. Mặc định `enforceReportGrounding` là bật. `server.ts` truyền `true`. Lượt lịch đi qua `prepareResponse`, đoạn lưu plan cũng bật cờ. | `report-evidence.test.ts`, test "constructed without the grounding flag" fail trước khi sửa (`success: true`) rồi pass |
| F7 | Ba kịch bản sandbox 4/5/9 giữ `jira.create_issue` và route `jira` khi MyJira bật. | `jira-runtime-catalog.test.ts` 9/9. Browser `nine_service` 1 passed, 11.2s |

`html_url` không được nhận là `url`. Resolver ném lỗi khi khóa `url` vắng. Test này xanh ngay trên resolver cũ: hành vi đã có, pha 1 chỉ khóa lại.

## Còn mở

| ID | Mức | Việc | Vì sao chưa sửa |
|---|---|---|---|
| F4 | đã đóng | Biên nhận chuyển trạng thái Jira đọc `status` của adapter. Fixture cũ `newStatus` vẫn hiện. | `jira-cockpit.test.tsx` 12/12. Ca output chỉ có `status` fail trước khi sửa vì pill là `🏷️`, rồi hiện `🔄 Trạng thái: Done` |
| F5 | đã đóng | Cửa sổ lịch tự nhiên dùng `timeMax` là 00:00 ngày hôm sau, vì Calendar coi mốc đó là cận trên loại trừ. | `personal-calendar-adapter.test.ts` 29/29. Ca `hôm nay` fail trước khi sửa với `T23:59:59+07:00` |
| F8 | đã đóng | Câu trả lời về Pull Request cần `github.list_pull_requests` thành công. Prefetch repository không đủ. | `read-answers.test.ts` 20/20. Live sau khi nạp lại server: tool `github.list_pull_requests`, `resultCount` 0, 0 plan, 0 execution step. Câu trả lời nói repository không có PR đang mở |
| Notion, Trello | đã đọc | Preflight 05/11 hết hiệu lực sau khi cấu hình lại. Live chỉ đọc: Trello 1 bảng, Notion 2 database. 0 plan, 0 execution step. | Không tạo thẻ, không tạo trang |

## Giới hạn của bằng chứng

`npm run check` một lệnh duy nhất trên PostgreSQL kiểm thử sạch cổng 56534: PASS, exit 0 (`typecheck:v3` pass; schemas 579, adapters 638 + probe 32, planner 555, executor 56, API 2554, web 1198; evaluations 500 pass / 1 preflight skip; build/security/launcher 1/Node 66 pass). Browser `nine_service` đã pass sau F7. Các lượt xem trước live trên ma trận đều bấm Hủy trước khi ghi (`0 execution step`).
