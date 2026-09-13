# Báo cáo task Antigravity

Sao chép file này thành `docs/task-hub-evidence/batch-01/TH-01.md` cho task đầu; các task sau dùng đúng ID task tương ứng. Thay nội dung hướng dẫn bằng kết quả thực tế, không đánh dấu PASS trước khi có evidence.

## Nhận diện

- Task ID và tên:
- Thời gian UTC:
- Trạng thái: NOT_STARTED / IN_PROGRESS / VERIFIED / BLOCKED.
- Spec/plan đã dùng, checkpoint trước đó:
- Source baseline có drift không; drift nào liên quan:

## Đã thay đổi

| File | Thay đổi phục vụ yêu cầu nào |
|---|---|

## Kiểm chứng

| Lệnh | Exit code | Passed/failed/skipped | Đường dẫn log |
|---|---|---|---|

- Red test đã quan sát trước implementation: tên + actual/expected hoặc lỗi thiếu implementation.
- Oracle độc lập: rows/receipt/output/side-effect cụ thể đã so sánh.
- Runtime thật đã chạy: PostgreSQL / MCP / controller / CLI; ghi rõ loại nào.
- Kiểm chỉ static/mock: liệt kê riêng.
- Dữ liệu test tạo/dọn thế nào; dữ liệu demo hoặc evidence lịch sử có bị thay không.

## Deviations và phần còn thiếu

- Khác plan: quyết định, lý do, file/contract bị ảnh hưởng. Nếu không có thì ghi Không.
- NOT_RUN: test/đường chạy và lý do. Nếu không có trong task thì ghi Không.
- OPEN/BLOCKED: bằng chứng tối thiểu, điều kiện cần để tiếp tục; không gửi secret.
- Task tiếp theo đã đủ điều kiện bắt đầu chưa, căn cứ.

## Tóm tắt gửi Codex

Tối đa 12 dòng: task/phạm vi, files quan trọng, test counts/exit codes, evidence path, finding hoặc deviation cần review. Không paste toàn bộ source hay toàn bộ log vào chat.
