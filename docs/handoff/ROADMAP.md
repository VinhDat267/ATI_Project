# Lộ trình đến cuối kỳ

Nguồn: mục 5.2 của báo cáo giữa kỳ. Hạn cuối kỳ dự kiến 11/11/2026. Trạng thái: `xong`, `đang làm` (ghi nhánh), `chờ` (đã có task card), `chưa có task card` (cần Claude Code lập kế hoạch trước khi giao).

Mốc 01/10/2026: PR #17 đã merge metadata vào `docs/agent-handoff` tại `adf472c`, rồi PR #15 đưa handoff và W2-01 vào `main` tại `35f454a`. PR #18 (W2-02) vẫn OPEN, đã đổi base về `main`; W2-04 đang triển khai trên nhánh đặt trên W2-02. Trạng thái bên dưới phân biệt đã vào `main` với code/test trên các nhánh chưa merge.

| Tuần | Việc | Task card | Trạng thái |
|---|---|---|---|
| 1 (01–07/10) | Retry khi model timeout | — | xong (PR #13) |
| 1 | Kiểm tra thành viên đúng board | — | xong (PR #13) |
| 1 | Liệt kê bằng query rỗng thay vì đoán tên | — | xong (PR #13) |
| 1 | Ghi thời lượng từng step | — | xong (PR #13) |
| 1 | "Sửa qua Chat" hoạt động, plan preview không bị che | — | xong (PR #13) |
| 2 (08–14/10) | Đối soát các lần thực thi bị gián đoạn khi server khởi động lại | [W2-01](tasks/W2-01-reconcile-on-startup.md) | xong, đã vào `main` qua #15 (`35f454a`), thi công ở #16 |
| 2 | Tiếp tục hoặc dừng một plan sau khi đối soát | [W2-02](tasks/W2-02-resume-after-restart.md) | đang làm (`vinhdat/fix-w2-02-resume-after-restart`); PR #18 OPEN, base `main`, head `31670bc`, CI xanh; chưa merge |
| 2 | Chạy thật các ca lỗi của service | [W2-03](tasks/W2-03-live-failure-cases.md) | chờ |
| 2 | Frontend: hiện trạng thái cần đối soát, sửa định dạng thời gian | [W2-04](tasks/W2-04-frontend-reconciliation-and-time.md) | đang làm (`vinhdat/feat-w2-04-reconciliation-ui`, đặt trên nhánh W2-02 theo yêu cầu người dùng); chưa nghiệm thu/merge |
| 3 (15–21/10) | Google Sheets làm service thứ tư: tool, adapter, xác thực, allowed scope, UI cấu hình, test liên service; một workflow qua bốn service, sandbox và chạy thật | — | chưa có task card |
| 4 (22–28/10) | Đánh giá: ≥ 30 câu mới do thành viên khác viết; ≥ 20 lượt người dùng thật duyệt plan để đo tỉ lệ plan dùng được; ≥ 20 lượt đo latency qua frontend; đo lại hành vi khi lịch sử có plan cũ | — | chưa có task card |
| 5 (29/10–04/11) | Ngừng thêm tính năng; môi trường demo dựng lại được theo hướng dẫn; đường LLM dự phòng qua Gemini API chính thức; 3 kịch bản demo chạy 3 lần liên tiếp không lỗi | — | chưa có task card |
| 6 (05–11/11) | Báo cáo cuối kỳ, slide, video demo dự phòng, diễn tập bảo vệ | — | chưa có task card |

Thứ tự ưu tiên khi thiếu thời gian: bỏ Google Sheets (tuần 3) trước, không bỏ phục hồi và an toàn ghi (tuần 2).
