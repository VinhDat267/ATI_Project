# Bàn giao ATI Project cho Antigravity

Người dùng chọn cách làm: Codex khảo sát/thiết kế/viết plan và review; Antigravity triển khai. Đợt đầu được chọn là **5 tool task_hub còn thiếu**, kèm lộ trình phần sau. Bộ tài liệu này chỉ là plan; không có code runtime, migration hoặc test mới được triển khai trong lần viết plan.

## Bắt đầu

Workspace: `D:\Môn học\ATI\ATI_Project`.

Trước khi stage/commit, tuân thủ [GIT-POLICY.md](../GIT-POLICY.md): chọn từng file thuộc task, kiểm nội dung staged diff, không tự stage toàn bộ workspace. Log mới mặc định ignore; chỉ thêm đúng file đã review. Không xóa hoặc ghi đè evidence lịch sử để làm sạch git status.

Git đã được thiết lập trên nhánh `main` từ checkpoint TH-02. Các ghi chú “chưa có Git” trong baseline/spec cũ mô tả thời điểm khảo sát. Trước task mới kiểm tra `git status`; giữ thay đổi hiện có và chỉ commit checkpoint đã được review. Không tự push hoặc force-push nếu chưa được giao. `.gitattributes` giữ nguyên bytes để không đổi checksum migration và evidence khi checkout.

1. Đọc [spec đợt 1](../superpowers/specs/2026-09-13-task-hub-completion-design.md).
2. Thực hiện [plan từng task](../superpowers/plans/2026-09-13-task-hub-completion.md), từ TH-01.
3. Dùng [baseline bàn giao](task-hub-handoff-baseline.json) để phát hiện code đã đổi sau lúc viết plan.
4. Cuối task điền [mẫu báo cáo](TASK-REPORT-TEMPLATE.md); gửi nội dung ngắn cho người dùng cùng đường dẫn log.

Plan đã chốt các lựa chọn nhỏ để executor không phải hỏi lại: schema, seed, filter ngày, timezone, giới hạn output, semantics move và task_count, thứ tự bật tool, checks và dữ liệu kỳ vọng. Các lựa chọn này là **PROPOSED_FOR_IMPLEMENTATION**; chỉ trở thành VERIFIED khi có kết quả thực thi. Yêu cầu làm task cụ thể từ người dùng cho phép triển khai task đó. Không tự mở rộng đợt 1 sang filesystem/API/UI/AI.

### Khảo sát đầu conversation (Bắt buộc)

Đầu mỗi conversation mới, Antigravity phải khảo sát toàn bộ repo gồm authored source, docs, config, tests (bỏ qua vendor `node_modules`, build output, binaries và không đọc/tiết lộ secrets). Audit mục đích, phạm vi, trạng thái thực tế và các invariants, nêu rõ các phần chưa xác minh và dừng chờ review từ người dùng/Codex trước khi nhận lệnh implementation.
*(Lưu ý: Conversation hiện tại đã hoàn tất bước khảo sát này ở checkpoint đầu nên không cần đọc lại toàn bộ repo ở mỗi task tiếp theo).*

Không cần cài superpowers hoặc plugin để đọc plan trên Antigravity. Những tên skill ở header là chỉ dẫn dành cho môi trường có skill đó; trên Antigravity dùng trực tiếp checkbox và test commands. Không tạo sub-agent hoặc chạy nhiều agent cùng sửa workspace trừ khi người dùng yêu cầu.

## Prompt dán vào Antigravity — task đầu

```text
Làm việc trong D:\Môn học\ATI\ATI_Project.

Hãy triển khai riêng TH-01 trong:
docs/superpowers/plans/2026-09-13-task-hub-completion.md

Đọc trước:
- docs/antigravity/README.md
- docs/superpowers/specs/2026-09-13-task-hub-completion-design.md
- docs/antigravity/task-hub-handoff-baseline.json
- CONTRIBUTING.md và docs/BASELINE.md

Đây là implementation theo plan đã được tôi giao. Tự xử lý các bước bình thường trong phạm vi TH-01, không hỏi lại để xác nhận từng edit/test. Thực hiện tuần tự, đọc file hiện tại trước sửa, giữ dữ liệu demo và bằng chứng lịch sử. Không init Git, không reset DB/volume, không thay scope B/local, không làm filesystem/API/UI/AI.

Viết test tái hiện đúng hành vi cần có, chạy để thấy failure liên quan, rồi triển khai và chạy lại. Không xóa/skip test hoặc thay expected chỉ để xanh. Không dùng PASS từ mock để kết luận MCP/PostgreSQL thật đã chạy.

Kết thúc TH-01: dừng, cập nhật checkbox đã thực sự hoàn tất; tạo báo cáo theo docs/antigravity/TASK-REPORT-TEMPLATE.md trong docs/task-hub-evidence/batch-01/TH-01.md. Nêu files changed, lệnh/exit code/test counts, bằng chứng dữ liệu, deviation và NOT_RUN. Không tự làm TH-02 trong lượt này. Nếu có xung đột làm thay hợp đồng hoặc không bảo toàn dữ liệu, ghi rõ file/bằng chứng và dừng phần phụ thuộc, không tự thiết kế lại.
```

Sau khi TH-01 đạt, giao TH-02 bằng cùng prompt và đổi đúng ID/phạm vi/file báo cáo. Có thể giao liên tiếp TH-02 đến TH-05 sau khi từng checkpoint xanh; nếu gặp lỗi lặp lại hoặc cần thay interface, gửi báo cáo về Codex trước khi tiếp tục phần phụ thuộc. TH-06 và TH-07 là các mốc review controller và nghiệm thu riêng.

## Cách dùng Codex tiết kiệm context

- Khi nhận plan: đưa đường dẫn spec + plan + ID task cho Antigravity. Nếu cùng máy/folder thì không cần paste toàn bộ code hoặc sao chép workspace.
- Nếu khác máy: chuyển đúng workspace cùng lockfile và baseline hash. Không chuyển node_modules; executor cài bằng npm ci. Không chuyển credential.
- Khi quay lại Codex: gửi ID task, báo cáo ngắn, lỗi cụ thể nếu có và đường dẫn workspace. Codex có thể đọc file thay vì bạn paste hàng nghìn dòng terminal.
- Không cần yêu cầu Codex review mọi dòng scaffolding. Các mốc review hữu ích là sau TH-03 (read/timezone), TH-05 (hai write + receipt), TH-06/07 (controller và full tests).
- Chưa chạy được test thì ghi NOT_RUN và lý do. Confidence của model hoặc tên model không thay thế kết quả kiểm thử.
- Mỗi task giữ một mục tiêu; task mới dùng trạng thái thật của task trước, không dựa vào lời kể “đã xong”.

Prompt gửi lại Codex:

```text
Antigravity đã làm TH-03 theo plan task_hub. Hãy review riêng kết quả task này, kiểm spec và các rủi ro hồi quy. Chỉ đưa kết luận/finding và plan sửa cho Antigravity; không implement.
Workspace: D:\Môn học\ATI\ATI_Project
Báo cáo: docs/task-hub-evidence/batch-01/TH-03.md
```

## Lộ trình những đợt sau

Đây là thứ tự dự kiến, không phải yêu cầu implement thêm trong đợt 1. Viết plan chi tiết đợt kế tiếp sau khi đã đọc kết quả đợt trước để tránh giao một bản thiết kế dựa trên code cũ.

| Đợt | Đầu vào bắt buộc | Sản phẩm bàn giao | Điều kiện qua |
|---|---|---|---|
| 1 — task_hub | Controller CLI hiện có, 3 tool đã chạy | Đủ 8 tool local, migration/seed, tests và evidence theo plan này | 8 live schemas khớp catalog; read/preview/approve/write/trace đúng dữ liệu; bộ regression cũ vẫn qua |
| 2 — filesystem + G1 | Đợt 1 được nghiệm thu; candidate package/policy hiện hành được kiểm lại | Adapter read_file/write_file trong root local cho phép; mở rộng gateway/snapshot nhận server thứ hai | Kiểm path traversal/symlink/root confinement, output/size/encoding, approval và unknown write; ít nhất một case hai server thật |
| 3 — API/session/worker | Hợp đồng engine ổn định và kết quả fault tests | HTTP lifecycle, một demo session, owner checks, job dispatch/outbox + recovery startup nếu dùng BullMQ | Request/decision/execute/events/trace chạy thật; restart không dispatch lại unknown write; timeout/expiry/cancel có HTTP evidence |
| 4 — UI/polling | API chạy thật | Hai màn hình yêu cầu/preview/duyệt và run/trace/lịch sử, polling 2 giây | Browser E2E với dữ liệu thật, reconnect, stale approval, cancellation; trạng thái UI không vượt trạng thái server |
| 5 — AI | UI/API/tools ổn định; provider/model/key có thật do user cấu hình | Semantic retrieval, query expansion, planner/refusal/clarification, bounded repair/local replan | Mọi call có cost/latency, schema probe, không thêm tool ngoài registry; replan phải duyệt lại và không lặp write đã hoàn tất |
| 6 — đánh giá/báo cáo | Manifest được freeze, rubric thật, dev/holdout hợp lệ | Thí nghiệm, dữ liệu kết quả, phân tích, demo và báo cáo môn học | Phân biệt correctness nghiệp vụ với status succeeded, công bố lỗi/NOT_RUN và giới hạn dataset |

Rubric và mẫu công việc thật là đầu vào từ nhóm/người dùng; executor có thể tiếp tục code local khi thiếu, nhưng không được tự bịa tiêu chí môn học hoặc đóng G1 tổng thể. B/local vẫn giữ semantic/QE/local replan; không chuyển sang GitHub/SaaS/WebSocket/BM25/parallel execution.
