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

**Ảnh chụp tiến độ 13/09 (lịch sử):** Đợt 1 đã hoàn thành toàn bộ 8 tool local của server `task_hub` và migration `0004_task_hub_cards.sql`; [trạng thái task_hub](TASK-HUB-STATUS-2026-09-13.md) ghi nhận 142/142 tests pass trên DB và MCP thật. [Controller/engine CLI](ENGINE-STATUS-2026-09-13.md) chạy plan tay qua một preview/approval, write, trace, cancel, fault injection (crash 86, lost response, concurrency) và recovery không resume. Tại mốc đó, G1 tổng thể là PARTIAL vì filesystem và rubric chưa hoàn tất.

**Trạng thái hiện hành 14/09:** FS-05 đạt **TECHNICAL PASS** cho E01–E14 với 8 public `task_hub` tools và 2 public `filesystem` tools; fresh FS-06 gate đạt **258 passed, 1 skipped**. G1 overall vẫn **PARTIAL** vì rubric chính thức và công việc nhóm đại diện `OPEN`; HTTP/session/UI, polling 2 giây và AI evaluation `NOT_RUN`. [Filesystem status và manual guide](G1-FILESYSTEM-STATUS-2026-09-13.md) ghi bằng chứng và giới hạn. Công việc kế tiếp phụ thuộc rubric là tiếp nhận nguồn/representative work; các lớp runtime kế tiếp là HTTP/session/UI/polling rồi AI theo kế hoạch, chưa được xem là đã triển khai.

## Cổng cắt phạm vi

- Cuối tuần 1 chưa có plan tay end-to-end: dành dự phòng làm luồng nhỏ; chưa mở LLM. Ghi lại estimate remaining. Không giả lập server rồi ghi là live discovery.
- Cuối tuần 2 không kiểm được unknown-write và approval: giảm UI trang trí/export; không cắt các invariant này.
- Cuối tuần 3 chưa có UI/API chạy thật: dùng UI tối thiểu theo wireframe, dừng mọi tính năng lịch sử nâng cao.
- Cuối tuần 4 thiếu quỹ: giảm số case/biến thể nghiên cứu được công bố trước khi mở holdout; ưu tiên semantic vs semantic+QE. Thay đổi bỏ local replan/QE phải cập nhật baseline và được nhóm chốt, không âm thầm cắt trọng tâm B.
- Tuần 5 không thêm feature. Có lỗi correctness chưa khắc phục thì báo limitation/failure, không đổi ngưỡng sau khi xem holdout.

Ngoài lịch: WebSocket, automatic resume, parallel execution, hybrid/BM25, GitHub, SaaS thật, partial/full replan. Không còn mục tuần 5 làm hybrid/GitHub trái với các lần cắt trước.
