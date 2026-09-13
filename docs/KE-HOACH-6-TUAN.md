# Kế hoạch 6 tuần — cấu hình B/local

B đã được người dùng chọn ngày 13/09/2026. Hai thành viên: A chịu backend/engine/storage; B chịu MCP local/data/UI/AI experiments; cả hai phải giải thích được luồng và cross-review. Đây là phân công vai trò, chưa gán tên người thật.

## Quỹ giờ và phạm vi

Giả định 14h/người/tuần, tổng 168h. Trần xây dựng 135h gồm **112h việc + 23h dự phòng**; tuần 6 dùng 28h báo cáo/demo, còn 5h đệm chung. Ước lượng chưa được hiệu chuẩn bằng tốc độ thực tế. Không dùng số Must hoặc số file để chứng minh vừa sức.

| Tuần | Việc và người phụ trách | Giờ việc A/B | Dự phòng | Cổng ra |
|---|---|---|---|---|
| 1 | A: DB contract + một plan tay; B: task_hub 8 tool/output fixture, rubric và mẫu việc thật; cả hai: filesystem pin/adapter | 10/10 | 3 | G1: local discovery/call, plan tay đọc→preview→duyệt→write có receipt; nguồn rubric và gaps ghi rõ |
| 2 | A: operation/approval/outbox/orphan; B: fixtures, fault injection và owner tests | 14/10 | 4 | G2: chặn forged read, double claim, đổi payload, timeout unknown; không blind retry |
| 3 | A: HTTP lifecycle/polling; B: hai màn hình và trace | 10/14 | 4 | G3: nhập→preview→decision→trace chạy thật, reconnect/expiry/cancel |
| 4 | A: semantic/QE + planner/repair; B: tích hợp UI, local replan + dev evaluation | 12/12 | 4 | G4: provider schema probe, refusal/clarification, đổi plan duyệt lại; cost/latency của mọi call |
| 5 | A: integration fixes; B: freeze manifests/holdout, chạy thí nghiệm và thống kê; cả hai: cross-review | 10/10 | 8 | G5: npm checks + local E2E/fault suite; kết quả đúng nghiệp vụ, catalog/data/model/prompt hashes |
| 6 | Hai người: phân tích kết quả, báo cáo, demo rehearsal và dự phòng demo offline | 14/14 | 0 | G6: bảng evidence rõ measured/NOT_RUN; demo từng người tự giải thích |

Các sửa thư viện trong FIX-REPORT đã có thể tái sử dụng, nhưng không bỏ G1/G2 chỉ vì unit tests qua. Hoạt động tuần 1 nằm trong quỹ chứ không tính là đã hoàn tất ứng dụng.

**Tiến độ 13/09:** [G1 đợt đầu](G1-STATUS-2026-09-13.md) đã đưa DB + read/append/send qua MCP thật. [Controller/engine CLI](ENGINE-STATUS-2026-09-13.md) tiếp tục chạy plan tay qua một preview/approval, write, trace, cancel, fault injection và recovery không resume; các kiểm engine dùng controller thật. G1 tổng thể chưa đạt: còn 5 task_hub tool, filesystem và rubric. G2 có bằng chứng ở luồng ba tool này, chưa phải nghiệm thu toàn catalog/HTTP. Bước kế tiếp là đóng các phần G1/G2 còn thiếu rồi HTTP/session/UI/polling tuần 3; chưa chuyển sang LLM.

## Cổng cắt phạm vi

- Cuối tuần 1 chưa có plan tay end-to-end: dành dự phòng làm luồng nhỏ; chưa mở LLM. Ghi lại estimate remaining. Không giả lập server rồi ghi là live discovery.
- Cuối tuần 2 không kiểm được unknown-write và approval: giảm UI trang trí/export; không cắt các invariant này.
- Cuối tuần 3 chưa có UI/API chạy thật: dùng UI tối thiểu theo wireframe, dừng mọi tính năng lịch sử nâng cao.
- Cuối tuần 4 thiếu quỹ: giảm số case/biến thể nghiên cứu được công bố trước khi mở holdout; ưu tiên semantic vs semantic+QE. Thay đổi bỏ local replan/QE phải cập nhật baseline và được nhóm chốt, không âm thầm cắt trọng tâm B.
- Tuần 5 không thêm feature. Có lỗi correctness chưa khắc phục thì báo limitation/failure, không đổi ngưỡng sau khi xem holdout.

Ngoài lịch: WebSocket, automatic resume, parallel execution, hybrid/BM25, GitHub, SaaS thật, partial/full replan. Không còn mục tuần 5 làm hybrid/GitHub trái với các lần cắt trước.
