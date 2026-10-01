# Lộ trình đến cuối kỳ

Nguồn: mục 5.2 của báo cáo giữa kỳ. Hạn cuối kỳ dự kiến 11/11/2026. Trạng thái: `xong`, `đang làm` (ghi nhánh), `chờ` (đã có task card), `chưa có task card` (cần Claude Code lập kế hoạch trước khi giao).

Mốc 02/10/2026: nhóm chốt thêm năm service (Sheets, Calendar, Notion, Telegram, Jira); tuần 1–2 đã xong sớm nên tuần 3 bắt đầu ngay. Mốc 01/10/2026: `main` tại `1029e55` đã có W2-01 (#15/#16), W2-02 và W2-04 (#18/#20), W2-05 (#23). W2-03 vẫn chờ người dùng duyệt lệnh ghi thật.

| Tuần | Việc | Task card | Trạng thái |
|---|---|---|---|
| 1 (01–07/10) | Retry khi model timeout | — | xong (PR #13) |
| 1 | Kiểm tra thành viên đúng board | — | xong (PR #13) |
| 1 | Liệt kê bằng query rỗng thay vì đoán tên | — | xong (PR #13) |
| 1 | Ghi thời lượng từng step | — | xong (PR #13) |
| 1 | "Sửa qua Chat" hoạt động, plan preview không bị che | — | xong (PR #13) |
| 2 (08–14/10) | Đối soát các lần thực thi bị gián đoạn khi server khởi động lại | [W2-01](tasks/W2-01-reconcile-on-startup.md) | xong, đã vào `main` qua #15 (`35f454a`), thi công ở #16 |
| 2 | Tiếp tục hoặc dừng một plan sau khi đối soát | [W2-02](tasks/W2-02-resume-after-restart.md) | xong, #18 đã merge `main` tại `9c652c4` |
| 2 | Chạy thật các ca lỗi của service | [W2-03](tasks/W2-03-live-failure-cases.md) | chờ scope/plan live và người dùng duyệt lệnh ghi; chưa chạy live failure |
| 2 | Frontend: hiện trạng thái cần đối soát, sửa định dạng thời gian | [W2-04](tasks/W2-04-frontend-reconciliation-and-time.md) | xong, #20 merge vào #18 tại `c30604b`, đã vào `main` qua #18 |
| 2 | Chạy tiếp plan bị gián đoạn khi không có step chưa rõ kết quả; plan đã chạy xong thì thành `completed` (phát hiện khi audit tuần 2) | [W2-05](tasks/W2-05-continue-safe-plans.md) | xong, #23 tại `1029e55` |
| 3 (02–21/10) | Gỡ các chỗ viết cố định theo service: registry/transport/sandbox tách theo service, allowlist chung, router nêu tên service thiếu, test bất biến từ khóa | [W3-00](tasks/W3-00-generic-service-plumbing.md) | chờ (làm đầu tiên, chặn W3-01 → W3-05) |
| 3 | Google Sheets (gồm xác thực service account dùng chung cho Google) | [W3-01](tasks/W3-01-google-sheets.md) | chờ (sau W3-00) |
| 3 | Google Calendar | [W3-02](tasks/W3-02-google-calendar.md) | chờ (sau W3-01) |
| 3 | Notion | [W3-03](tasks/W3-03-notion.md) | chờ (sau W3-00) |
| 3 | Telegram | [W3-04](tasks/W3-04-telegram.md) | chờ (sau W3-00) |
| 3 | Jira Cloud | [W3-05](tasks/W3-05-jira.md) | chờ (sau W3-00) |
| 3 | Đánh giá planner với các service mới, đo lại bộ cũ, test định tuyến tất định | [W3-06](tasks/W3-06-new-services-eval.md) | chờ (sau mốc chốt catalog) |
| 3 | Chạy thật từng service mới và một workflow ≥ 4 service | [W3-07](tasks/W3-07-new-services-live.md) | chờ (từng service sau khi merge; người dùng chuẩn bị tài khoản) |
| 4 (22–28/10) | Bộ đánh giá độc lập ≥ 30 câu do thành viên khác viết | [W4-01](tasks/W4-01-independent-eval-set.md) | chờ (khung làm ngay được; câu hỏi do con người viết) |
| 4 | Đánh giá hội thoại nhiều lượt: sửa plan, trả lời câu hỏi làm rõ | [W4-02](tasks/W4-02-multi-turn-eval.md) | chờ |
| 4 | Đo tỉ lệ plan dùng được với ≥ 20 lượt của người dùng thật | [W4-03](tasks/W4-03-usable-plan-study.md) | chờ (script làm ngay được; buổi thử do con người) |
| 4 | Đo latency qua frontend với ≥ 20 lượt | [W4-04](tasks/W4-04-frontend-latency.md) | chờ |
| 5 (29/10–04/11) | Ngừng thêm tính năng; môi trường demo dựng lại được theo hướng dẫn; đường LLM dự phòng qua Gemini API chính thức; 3 kịch bản demo chạy 3 lần liên tiếp không lỗi | — | chưa có task card |
| 6 (05–11/11) | Báo cáo cuối kỳ, slide, video demo dự phòng, diễn tập bảo vệ | — | chưa có task card |

W2-01/W2-02 áp dụng cho một API instance, executor cũ đã dừng; lease/fencing nhiều replica chưa có. Minor `text_*` streaming của frontend được hoãn: chưa tìm thấy production emitter, reachability chưa chứng minh; cần xử lý timestamp/finalized message trước khi nối producer này. Số liệu hiện tại và giới hạn review/live xem [CURRENT-STATE](CURRENT-STATE.md).

Yêu cầu chung cho mọi task thêm service: [W3-service-common](tasks/W3-service-common.md).

Thứ tự và song song: W3-00 làm trước. Sau khi W3-00 merge, W3-01, W3-03, W3-04, W3-05 làm song song (mỗi task chỉ thêm file mới và một dòng ở các danh sách đăng ký); W3-02 chờ W3-01. W3-07 làm từng service ngay khi service đó merge. W4-02, W4-04 (phần công cụ) và khung của W4-01, W4-03 làm song song được với tuần 3.

**Mốc chốt catalog: 20/10/2026.** Service nào chưa merge đạt review trước mốc này thì không đưa vào phạm vi môn học (không đăng ký vào registry). W3-06 và các phép đo chính thức của tuần 4 (W4-01, W4-03, W4-04) chạy trên catalog đã chốt, để số liệu khớp với hệ thống đem đi bảo vệ.

Phần việc của con người nên bắt đầu ngay: tạo tài khoản và tài nguyên thử nghiệm cho năm service (W3-07), các thành viên viết câu hỏi (W4-01), hẹn người tham gia buổi thử (W4-03).

Thứ tự ưu tiên khi thiếu thời gian: không bỏ W3-00 (là bằng chứng cho tiêu chí mở rộng của đặc tả) và không bỏ phục hồi, an toàn ghi (tuần 2). Bỏ service theo thứ tự: Telegram, Jira (trùng nhóm với Slack, Trello), rồi Notion, Calendar, Sheets.
