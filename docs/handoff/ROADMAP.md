# Lộ trình đến cuối kỳ

Nguồn: mục 5.2 của báo cáo giữa kỳ. Hạn cuối kỳ dự kiến 11/11/2026. Trạng thái: `xong`, `đang làm` (ghi nhánh), `chờ` (đã có task card), `chưa có task card` (cần Claude Code lập kế hoạch trước khi giao).

Mốc 01/10/2026: `main` tại `1029e55` đã có W2-01 (#15/#16), W2-02 và W2-04 (#18/#20), W2-05 (#23). W2-03 vẫn chờ người dùng duyệt lệnh ghi thật.

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
| 3 (15–21/10) | Google Sheets: tool schema và adapter (service account, allowlist, chặn chèn công thức) | [W3-01](tasks/W3-01-sheets-adapter.md) | chờ |
| 3 | Google Sheets: đăng ký vào nền tảng (registry, scope, backend, planner, frontend, sandbox bốn service) | [W3-02](tasks/W3-02-sheets-platform-integration.md) | chờ (sau W3-01) |
| 3 | Google Sheets: golden set riêng, đo lại bộ cũ, chạy thật bốn service | [W3-03](tasks/W3-03-sheets-eval-and-live.md) | chờ (sau W3-02; người dùng chuẩn bị service account) |
| 4 (22–28/10) | Bộ đánh giá độc lập ≥ 30 câu do thành viên khác viết | [W4-01](tasks/W4-01-independent-eval-set.md) | chờ (khung làm ngay được; câu hỏi do con người viết) |
| 4 | Đánh giá hội thoại nhiều lượt: sửa plan, trả lời câu hỏi làm rõ | [W4-02](tasks/W4-02-multi-turn-eval.md) | chờ |
| 4 | Đo tỉ lệ plan dùng được với ≥ 20 lượt của người dùng thật | [W4-03](tasks/W4-03-usable-plan-study.md) | chờ (script làm ngay được; buổi thử do con người) |
| 4 | Đo latency qua frontend với ≥ 20 lượt | [W4-04](tasks/W4-04-frontend-latency.md) | chờ |
| 5 (29/10–04/11) | Ngừng thêm tính năng; môi trường demo dựng lại được theo hướng dẫn; đường LLM dự phòng qua Gemini API chính thức; 3 kịch bản demo chạy 3 lần liên tiếp không lỗi | — | chưa có task card |
| 6 (05–11/11) | Báo cáo cuối kỳ, slide, video demo dự phòng, diễn tập bảo vệ | — | chưa có task card |

W2-01/W2-02 áp dụng cho một API instance, executor cũ đã dừng; lease/fencing nhiều replica chưa có. Minor `text_*` streaming của frontend được hoãn: chưa tìm thấy production emitter, reachability chưa chứng minh; cần xử lý timestamp/finalized message trước khi nối producer này. Số liệu hiện tại và giới hạn review/live xem [CURRENT-STATE](CURRENT-STATE.md).

Có thể làm song song: W3-01 với W4-02, W4-04, và phần khung của W4-01, W4-03. W3-02 phải chờ W3-01; W3-03 phải chờ W3-02. Phần việc của con người nên bắt đầu sớm: tạo Google service account (W3-03), các thành viên viết câu hỏi (W4-01), hẹn người tham gia buổi thử (W4-03).

Thứ tự ưu tiên khi thiếu thời gian: bỏ Google Sheets (tuần 3) trước, không bỏ phục hồi và an toàn ghi (tuần 2).
