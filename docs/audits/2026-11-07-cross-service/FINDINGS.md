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
| F4 | P2 | Biên nhận `myjira.transition_issue` tìm `newStatus`. Schema trả `status`. Nhánh sau vẫn hiện `status`. | Không chặn demo, không gửi sai đích |
| F5 | P2 | `resolveNaturalWindowFromQuery` đặt `timeMax` `T23:59:59+07:00`. Sự kiện bắt đầu đúng giây cuối ngày bị bỏ. | Đã biết từ 18/10. Không nằm trên sáu việc demo |
| F8 | P1 | Hai lượt live chỉ đọc, server `runtimeMode: live`, không bấm duyệt. Cả hai trả `answer`, 0 plan, 0 execution step. Lượt không nêu repo hỏi lại dù working memory đã có một repository. Lượt nêu đúng repository trả lời chưa có dữ liệu PR và không lập kế hoạch đọc. `validateAnswer` chấp nhận câu trả lời khi chỉ có prefetch thư mục, không cần `github.list_pull_requests`. | Chưa sửa. Không có preview để hủy |
| Notion, Trello token | — | Preflight 05/11: Notion 401, Trello thiếu token | Named blocker, không đóng bằng sandbox |

## Giới hạn của bằng chứng

`npm test -w @wap/chat-api` trên PostgreSQL loopback cổng 56534: 2474 pass, 1 timeout 5s ở phân trang hội thoại. Chạy lại file đó 8/8 pass. Chưa chạy `npm run check`. Browser `nine_service` đã pass sau F7. Hai lượt đọc live không tạo plan.
