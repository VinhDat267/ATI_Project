# 28/10/2026 · Xử lý review thiết kế Slack cá nhân

**Task:** [OAUTH-04](../tasks/OAUTH-04-slack-personal.md).
**Nhánh:** `docs/slack-oauth-design` · **Nền sửa:** `4bc42c7d832c550b16ecac5aa5e800fe5a4fc938`.
**Ủy quyền:** chủ dự án trả lời `ok` cho bốn hướng giải quyết đã đề xuất sau [review F1–F4](2026-10-28-slack-oauth-design-review.md). Cập nhật tài liệu theo các hướng đó, chưa triển khai sản phẩm.

## Điều chỉnh

| Finding | Đã ghi vào thiết kế | Bằng chứng triển khai còn phải có |
|---|---|---|
| F1 · P1 | Mục 4.4: pilot ở workspace có quyền thử nghiệm; chấp thuận xử lý theo tổ chức/workspace; provider không huấn luyện và retention phù hợp; kiểm mọi đường gửi nguồn vào model kể cả planner ở mode luật | Kiểm gate thật, điều kiện provider và căn cứ chấp thuận cho live; hiện chưa có |
| F2 · P2 | Mục 4.5 và 8: binding từ lookup qua memory/grounding tới step; nguồn và revision; hỏi khi mơ hồ, fanout có chủ đích và có nhãn | Ca trùng tên/ID ở hai workspace, đổi generation và tham chiếu sai workspace; chưa triển khai |
| F3 · P2 | Mục 9.1: sourceRef và phụ thuộc trong history/answer/plan/memory, tombstone chặn ngay rồi purge bền vững, ACL từng người, retention/backup và metadata biên nhận tối thiểu | Mở lại/nhắn tiếp không phục hồi dữ liệu bị thu hồi; purge khi cờ off và race worker; chưa triển khai |
| F4 · P2 | Mục 9.2 và 5: ingress/lifecycle riêng với cờ automation, ACK/bỏ nội dung khi tắt, vẫn vô hiệu nguồn và xử lý revoke/uninstall, mốc bật lại và trạng thái subscription | Bật/tắt/bật, delayed/retry, lỗi lưu lifecycle và xác nhận khôi phục subscription; chưa chạy provider thật |

Thiết kế bổ sung bảng ca nghiệm thu F1–F4 và cập nhật chia đợt tương ứng. Phạm vi user token, Free/Pro, nhiều workspace, đủ ba mode cấu hình riêng và duyệt trong ATI giữ theo lựa chọn đã thống nhất.

## Nguồn và kiểm tra

- Đọc lại task, handoff hiện hành và ba log mới nhất liên quan; đối chiếu báo cáo review gốc.
- Tra trực tiếp Slack API Terms, Developer Policy và Events API về điều kiện dữ liệu/phân phối, failure limits và khôi phục event deliveries. Link nguồn nằm cạnh các quyết định trong [thiết kế](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md).
- Fresh builder check trên bản sửa: **F1–F4 được trả lời ở mức thiết kế**, không thấy mâu thuẫn trọng yếu; kết luận `nothing important left`. Agent đọc cả thiết kế và review gốc, chỉ đọc, không sửa file hay chạy provider.
- Kiểm tài liệu trước commit: **PASS**, exit 0; bốn file UTF-8/whitespace hợp lệ, **10 liên kết tương đối** tồn tại; staged đúng bốn file của task, `git diff --cached --check` exit 0. Đây là kiểm tài liệu, không phải test runtime.
- Test code/browser/PG/model, OAuth và provider live: **NOT_RUN**, vì thay đổi chỉ là tài liệu.

## Bàn giao

Chỉ sửa thiết kế/task OAUTH-04 và thêm log xử lý; đưa log review gốc vào cùng commit để người nhận có đủ finding/đối chiếu. Giữ nguyên log brainstorm cũ, bốn log review PR #180 chưa theo dõi và thay đổi có sẵn ở checkout chính. Không sửa CURRENT-STATE/ROADMAP, không tạo app, không bật cờ, không push/merge hay ghi Slack.

Chủ dự án đã chấp thuận hướng sửa; không suy ra đã nghiệm thu runtime hoặc đã duyệt toàn văn bản sửa. Sau kiểm tra và commit, gửi lại tài liệu cụ thể; không lặp lại câu hỏi về bốn hướng đã được đồng ý.
