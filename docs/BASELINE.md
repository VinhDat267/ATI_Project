# Baseline B/local — nguồn chuẩn về phạm vi

**CONFIRMED — 13/09/2026:** người dùng chọn B: ưu tiên AI, polling, task_hub local. Các lựa chọn A trong tài liệu cũ không còn là công việc của kế hoạch hiện hành. Đổi scope cần cập nhật file này, FR, API, dataset và lịch cùng lúc.

## Mục tiêu

Xây prototype giải thích được bởi hai thành viên: mô tả công việc → chọn tool → sinh plan → kiểm tra → xem preview → duyệt → chạy → kiểm kết quả và trace. Đo tác động của semantic retrieval/query expansion và sửa plan, không tuyên bố thay thế n8n/Zapier.

Người dùng giả định là trưởng nhóm dự án môn học. Công việc đại diện là chép các dòng tiến độ đã có sẵn trong bảng local sang bảng báo cáo và gửi thông báo local. Đây là giả thuyết công việc; phỏng vấn/đo thời gian làm tay còn OPEN.

## Phạm vi đã chọn

| Thành phần | B/local |
|---|---|
| UI | Hai màn hình: nhập yêu cầu + plan/preview/approval; chi tiết run + trace/lịch sử. Poll 2 giây |
| AI | Semantic retrieval, query expansion có đối chứng, một planner, tối đa 3 lần planning tính cả lần đầu, local replan tối đa 2 |
| DSL | DAG tĩnh 1–30 steps; demo tối đa 5. Literal, reference, condition hẹp; không loop/map/min/sort/arithmetic/LLM transform |
| Engine | Một worker, thực thi tuần tự theo thứ tự topo; retry giới hạn và side-effect gate. Không tự resume run sau crash |
| Tools | task_hub 8 tool local; filesystem 2 tool local qua adapter được duyệt. Không có GitHub trong MVP |
| Integrations | Không gọi Trello/Slack/Sheets/Calendar thật. Tên send_slack_message/append_sheet_rows chỉ là hợp đồng local trong demo |
| Storage | PostgreSQL 16 + pgvector; SQL là nguồn schema. BullMQ/Redis là hàng đợi dự kiến; outbox bảo toàn giao nhận |
| Auth | Một tài khoản demo, session và owner check. Không đăng ký/multi-tenant production hoặc kho credential bên thứ ba |
| Replan | Chỉ bước chưa hoàn tất, kết quả lần gọi chắc chắn không gây side-effect; validation lại và approval mới trước write |

**Ngoài phạm vi:** hybrid/BM25, WebSocket, resume tự động, parallel execution, partial/full replan, GitHub, tích hợp SaaS thật, lịch chạy định kỳ, sửa plan bằng UI, workflow editor, benchmark 50/100 tool tổng hợp và 10 run đồng thời.

Giữ PostgreSQL full-text index từ migration gốc không có nghĩa đã làm BM25. BullMQ Flows hỗ trợ parent/child dependencies; phần tự xây ở đây là DSL, validation, approval và trace.

## Những ràng buộc bắt buộc

1. Registry policy do ứng dụng duyệt quyết định read/write, không phải LLM hoặc MCP annotation. Không policy → không gọi. Mỗi call kiểm lại resolved args và output schema.
2. Dry-run chỉ chạy read. MVP cấm args/condition/key của bước khác tham chiếu output write. Thứ tự sau write vẫn được phép nếu payload không cần output đó.
3. Preview lưu inputs, runtime/timezone, outputs đọc, plan version, tool/policy snapshot và mọi write args đã resolve. Duyệt đúng snapshot, TTL 10 phút. Không đọc lại dữ liệu rồi âm thầm thay payload.
4. Write timeout, mất phản hồi hoặc worker crash sau dispatch → reconciliation_required nếu chưa chứng minh được kết quả. Không tự retry/replan write chưa rõ. Chi tiết trong EXECUTION-CONTRACT.
5. Từ chối/hỏi lại là planner outcome riêng. Không tạo version plan rỗng, không tiêu vòng repair để ép tạo plan.
6. Runtime.now là timestamp UTC; today/week/month là ngày theo timezone IANA được lưu cùng run, mặc định Asia/Ho_Chi_Minh. Ngày end là ngày bao gồm; adapter chuyển thành khoảng [start, ngày kế tiếp end) theo timezone đó.
7. Cùng plan chỉ tái lập cùng kết quả khi cố định inputs, runtime, tool/policy version và dữ liệu/phản hồi ngoài. Không hứa cùng plan luôn cùng kết quả trên dịch vụ đang thay đổi.

## Trạng thái và cổng kiểm chứng

CODE_TESTED áp dụng cho thư viện DSL. DB 5 migrations, 8 public `task_hub` tools, 2 public `filesystem` tools và controller/engine hai server đã có kiểm chứng PostgreSQL/MCP thật. FS-05 đạt **TECHNICAL PASS** cho E01–E14; fresh FS-06 gate đạt **258 passed, 1 skipped**. Luồng CLI tạo một preview/approval, write tuần tự, trace, cancel và recovery không resume đã triển khai. API-01–05 đạt **API_TECHNICAL_PASS** cho loopback HTTP/session/lifecycle với planner fixture và hai receiver local. Browser UI, polling trong frontend, LLM/retrieval/replan và BullMQ vẫn `NOT_RUN`. G1 tổng thể vẫn **PARTIAL** (`TECHNICAL_PASS_OVERALL_PARTIAL`): rubric chính thức và công việc nhóm đại diện còn `OPEN`; chưa có browser E2E hoặc kết quả AI. Xem [API status](API-STATUS-2026-09-15.md), [filesystem status](G1-FILESYSTEM-STATUS-2026-09-13.md) và [rubric map](G1-RUBRIC-MAP.md).

Engine hiện tại từ chối read phụ thuộc vào write vì một preview không bảo toàn thứ tự đó; write vẫn có thể phụ thuộc điều khiển vào write trước nếu không dùng output của nó. Đây là giới hạn của implementation plan tay, chưa mở rộng DSL hoặc thay phạm vi B. Retry đọc tối đa 3, delay tối đa 30 giây; write không tự retry. Rubric và model/provider phải xác nhận bằng nguồn thực tế trước khi dùng trong báo cáo.

Filesystem package `@modelcontextprotocol/server-filesystem@2026.8.31` đã được pin, kiểm installed bytes/dependency closure, live discovery và gọi thật trong root cô lập. Launch policy chỉ publish `filesystem.read_file` và `filesystem.write_file`, mặc định tắt và fail closed nếu preset, artifact, principal root hoặc marker drift. Durable filesystem marker là reservation trước packet, không phải receipt; không có cam kết rollback hoặc exactly-once cho arbitrary MCP writes.
