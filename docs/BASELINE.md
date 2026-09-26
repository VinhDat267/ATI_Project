# Baseline hiện hành — MVP v2

**SCOPE_APPROVED — 21/09/2026:** chủ project duyệt
[đặc tả MVP v2](superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md).
Đây là phạm vi đích đã duyệt, không phải xác nhận live integration. Code/test
pilot v2 đã được thêm sau ngày duyệt; [audit P6 ngày 23/09](plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md)
ghi các lỗi chặn tại thời điểm audit. Một card sandbox thật đã được tạo và đối chiếu ngày 25/09/2026; AI live vẫn cần provider, quyền và ngân sách riêng.

| Thành phần | Phạm vi đích đã duyệt | Trạng thái thực thi v2 |
|---|---|---|
| Người dùng | Điều phối viên nhóm dịch vụ thiết kế/web; hai principal riêng, owner-only runs; cộng tác trên board ngoài | Mã và test owner-scope có; nghiệm thu với người dùng đại diện `OPEN` |
| Use case | Kiểm yêu cầu; duyệt/tạo một task thật; tra task đã tạo | UC1 checklist clarification/refusal và UC3 linked-card lookup đã qua API/PostgreSQL + Chromium với fixtures; UC2 có một ca sandbox thật đã được duyệt, tạo card và đối chiếu; AI source-aware chưa được chứng minh |
| Tích hợp | Google Sheets chỉ đọc + Trello đọc/tạo card; một nguồn và một board allowlisted | `SAAS_ONE_CARD_CONFIRMED` trên sandbox ngày 25/09/2026; chưa có acceptance nhiều ca hoặc vận hành liên tục |
| AI | Source snapshot có trước planning, checklist và bằng chứng; giữ semantic/QE/replan có giới hạn | Module source-aware có; chưa nối đầy đủ vào API pilot. Freeze mới `2011169` đạt 26/26 strict public PASS với 0 USD cap; holdout đã mở sau public gate nhưng execution `NOT_RUN` vì cả 20 fixture thiếu `tabId`. Semantic adjudication và user acceptance còn `OPEN`; trạng thái tổng thể `PARTIAL_NOT_MEASURED`. Xem [bằng chứng campaign mới](ai-evidence/PILOT-V2-AI/PROVIDER-PUBLIC-FOLLOWUP-2026-09-26.md) và [public evidence trước đó](ai-evidence/PILOT-V2-AI/PUBLIC-2026-09-26.md) |
| Engine | Một active run trong DB dùng chung, một worker tuần tự; TTL 10 phút; no auto-resume; unknown không retry mù | Approval API lưu PostgreSQL, gắn owner/run/version/hash/list ID/TTL; một lần write sandbox đã qua receipt và GET đối chiếu. Cờ live write vẫn tắt mặc định |
| Dedupe | Giữ operation gate; bổ sung business intent xuyên run/operator theo nguồn và board | Reservation PostgreSQL có; `claimDispatched` chỉ nhận `reserved`, runner không POST lại intent `confirmed`; integration test PostgreSQL đạt |
| UI | Giữ System Design đã duyệt; interaction mới phải review; mode fixture/live rõ | Owner isolation và UC1/UC3 browser local đã qua cùng 5 ca UC2 approval trên API/PostgreSQL cô lập; nghiệm thu với người dùng đại diện vẫn `OPEN` |
| Đánh giá | 20 tình huống tái dựng + holdout riêng; phân biệt contract/live/AI/customer | Dataset 40 biến thể + 20 holdout có; mô phỏng không phải AI quality; `CUSTOMER_VALIDATED=NOT_RUN` |

Không mở: email/Slack/WhatsApp thật, ghi ngược Sheet, scheduler/batch/loop,
workflow editor/reuse, arbitrary tool, shared run history/approval chéo,
workspace CRUD/multi-tenant, automatic resume, public staging/enterprise.
OIDC đăng nhập không thay authorization Google/Trello. Credential bắt buộc ở
server, không vào prompt/browser/trace/git; không xây self-service vault ở MVP.

FR v2 được ghi ở [functional requirements](functional-requirements.md),
wire-format hiện có và delta ở [API](API.md), dataset ở
[MVP-V2-DATASET](MVP-V2-DATASET.md), gate ở [lịch](KE-HOACH-6-TUAN.md).
Quy tắc bất biến của [execution contract](EXECUTION-CONTRACT.md) vẫn bắt buộc.

## Baseline triển khai B/local — giữ để đối chiếu, không còn là scope đích

Các mục B/local bên dưới mô tả hợp đồng/ảnh chụp trước v2. Những dòng loại SaaS,
một tài khoản demo hoặc người dùng trưởng nhóm môn học chỉ áp cho profile cũ;
phạm vi đích ở bảng trên có ưu tiên. Các số test là evidence lịch sử, không phải
kết quả chạy lại trong batch tài liệu này.

**CONFIRMED — 13/09/2026:** người dùng chọn B: ưu tiên AI, polling, task_hub local. Các lựa chọn A trong tài liệu cũ không còn là công việc của kế hoạch hiện hành. Đổi scope cần cập nhật file này, FR, API, dataset và lịch cùng lúc.

## Mục tiêu

Xây prototype giải thích được bởi hai thành viên: mô tả công việc → chọn tool → sinh plan → kiểm tra → xem preview → duyệt → chạy → kiểm kết quả và trace. Đo tác động của semantic retrieval/query expansion và sửa plan, không tuyên bố thay thế n8n/Zapier.

Người dùng giả định là trưởng nhóm dự án môn học. Công việc đại diện là chép các dòng tiến độ đã có sẵn trong bảng local sang bảng báo cáo và gửi thông báo local. Đây là giả thuyết công việc; phỏng vấn/đo thời gian làm tay còn OPEN.

## Phạm vi đã chọn

| Thành phần | B/local |
|---|---|
| UI | Sáu view: đăng nhập, tổng quan, tạo yêu cầu, lịch sử lần chạy, chi tiết lần chạy, công cụ & kết nối. Bốn mục điều hướng; poll 2 giây. Plan/preview/approval/trace dùng lại các panel đã thiết kế |
| AI | Semantic retrieval, query expansion có đối chứng, một planner, tối đa 3 lần planning tính cả lần đầu, local replan tối đa 2 |
| DSL | DAG tĩnh 1–30 steps; demo tối đa 5. Literal, reference, condition hẹp; không loop/map/min/sort/arithmetic/LLM transform |
| Engine | Một worker, thực thi tuần tự theo thứ tự topo; retry giới hạn và side-effect gate. Không tự resume run sau crash |
| Tools | task_hub 8 tool local; filesystem 2 tool local qua adapter được duyệt. Không có GitHub trong MVP |
| Integrations | Không gọi Trello/Slack/Sheets/Calendar thật. Tên send_slack_message/append_sheet_rows chỉ là hợp đồng local trong demo |
| Storage | PostgreSQL 16 + pgvector; SQL là nguồn schema. PostgreSQL outbox + worker tuần tự là queue MVP; BullMQ/Redis deferred theo quyết định AI-00 ngày 17/09/2026 |
| Auth | Một tài khoản demo, session và owner check. Không đăng ký/multi-tenant production hoặc kho credential bên thứ ba |
| Replan | Chỉ bước chưa hoàn tất, kết quả lần gọi chắc chắn không gây side-effect; validation lại và approval mới trước write |

**Ngoài phạm vi:** hybrid/BM25, WebSocket, resume tự động, parallel execution, partial/full replan, GitHub, tích hợp SaaS thật, lịch chạy định kỳ, sửa plan bằng UI, workflow editor, benchmark 50/100 tool tổng hợp và 10 run đồng thời.

**Điều chỉnh UI 15/09/2026:** sau khi người dùng đồng ý bước UX và giao WEB-00, dùng [sitemap sáu view](superpowers/specs/2026-09-15-platform-ux-design.md) để lập kế hoạch. Đây là tổ chức lại điều hướng, không thêm workflow CRUD/reuse/editor vào B. [ADR frontend](ADR-001-FRONTEND-STACK.md) chọn React + TypeScript + Vite; WEB-03 đã có bằng chứng browser fixture và live API/DB fixture. Visual Design System đã được người dùng chốt ngày 21/09/2026 tại [System Design](../System%20Design/DESIGN.md); representative-user UX acceptance vẫn `OPEN`. API wire-format và dataset nghiệp vụ giữ nguyên. Quỹ giờ được ước lượng lại trong [lịch](KE-HOACH-6-TUAN.md).

Giữ PostgreSQL full-text index từ migration gốc không có nghĩa đã làm BM25.
**Điều chỉnh queue 17/09/2026:** người dùng đồng ý giữ PostgreSQL outbox và một
worker tuần tự, defer BullMQ/Redis. Redis vẫn có trong compose hiện tại; quyết
định này không xóa service/volume hay chứng minh BullMQ đã được triển khai.
Các nhắc tới BullMQ `NOT_RUN` ở báo cáo cũ mô tả thiếu runtime evidence, không
còn là yêu cầu phải thêm broker để đóng MVP. API wire-format, dataset nghiệp
vụ, sequential execution và no-auto-resume không thay đổi. Xem
[AI plan](superpowers/plans/2026-09-17-ai-backend.md) cho lịch và evidence gates.

## Những ràng buộc bắt buộc

1. Registry policy do ứng dụng duyệt quyết định read/write, không phải LLM hoặc MCP annotation. Không policy → không gọi. Mỗi call kiểm lại resolved args và output schema.
2. Dry-run chỉ chạy read. MVP cấm args/condition/key của bước khác tham chiếu output write. Thứ tự sau write vẫn được phép nếu payload không cần output đó.
3. Preview lưu inputs, runtime/timezone, outputs đọc, plan version, tool/policy snapshot và mọi write args đã resolve. Duyệt đúng snapshot, TTL 10 phút. Không đọc lại dữ liệu rồi âm thầm thay payload.
4. Write timeout, mất phản hồi hoặc worker crash sau dispatch → reconciliation_required nếu chưa chứng minh được kết quả. Không tự retry/replan write chưa rõ. Chi tiết trong EXECUTION-CONTRACT.
5. Từ chối/hỏi lại là planner outcome riêng. Không tạo version plan rỗng, không tiêu vòng repair để ép tạo plan.
6. Runtime.now là timestamp UTC; today/week/month là ngày theo timezone IANA được lưu cùng run, mặc định Asia/Ho_Chi_Minh. Ngày end là ngày bao gồm; adapter chuyển thành khoảng [start, ngày kế tiếp end) theo timezone đó.
7. Cùng plan chỉ tái lập cùng kết quả khi cố định inputs, runtime, tool/policy version và dữ liệu/phản hồi ngoài. Không hứa cùng plan luôn cùng kết quả trên dịch vụ đang thay đổi.

## Trạng thái và cổng kiểm chứng

CODE_TESTED áp dụng cho thư viện DSL. DB có 9 migrations; 8 public `task_hub` tools, 2 public `filesystem` tools và controller/engine hai server đã có kiểm chứng PostgreSQL/MCP thật. FS-05 đạt **TECHNICAL PASS** cho E01–E14; fresh FS-06 gate đạt **258 passed, 1 skipped**. Luồng CLI tạo một preview/approval, write tuần tự, trace, cancel và recovery không resume đã triển khai. API-01–05 đạt **API_TECHNICAL_PASS** cho loopback HTTP/session/lifecycle với planner fixture và hai receiver local; gate 2026-09-17 ghi H01–H20 `PASS`, sáu command exit `0` và cleanup delta `PASS`. API-CATALOG đã nối DTO strict, catalog read no-launch, active reviewed-preset check có rate-limit và bằng chứng loopback/live 8+2. WEB-03 đạt **WEB_BROWSER_EXERCISED_PASS** cho typecheck, unit, strict-mode, fixture browser, live API/DB browser, polling latency, bundle và cleanup. Visual Design System đã được người dùng chốt. AI-01 có snapshot reviewed 8+2, index pgvector exact/provenance và tests PostgreSQL/MCP cô lập; durable API provider authorization/accounting đã nối theo run/user, còn recall/p95 và live quality chưa đo. Live-freeze CLI yêu cầu approval scope, ngân sách, price card và active-index evidence không placeholder trước native run. Session vẫn là bộ nhớ tiến trình, còn run/outbox/attempt state bền vững nằm trong PostgreSQL. Provider-backed LLM/live evaluation/replan, BullMQ, rubric chính thức và representative-user acceptance vẫn `NOT_RUN` hoặc `OPEN`. G1 tổng thể vẫn **PARTIAL** (`TECHNICAL_PASS_OVERALL_PARTIAL`). Xem [API status](API-STATUS-2026-09-15.md), [WEB status](WEB-STATUS.md), [filesystem status](G1-FILESYSTEM-STATUS-2026-09-13.md) và [rubric map](G1-RUBRIC-MAP.md).

Engine hiện tại từ chối read phụ thuộc vào write vì một preview không bảo toàn thứ tự đó; write vẫn có thể phụ thuộc điều khiển vào write trước nếu không dùng output của nó. Đây là giới hạn của implementation plan tay, chưa mở rộng DSL hoặc thay phạm vi B. Retry đọc tối đa 3, delay tối đa 30 giây; write không tự retry. Rubric và model/provider phải xác nhận bằng nguồn thực tế trước khi dùng trong báo cáo.

Filesystem package `@modelcontextprotocol/server-filesystem@2026.8.31` đã được pin, kiểm installed bytes/dependency closure, live discovery và gọi thật trong root cô lập. Launch policy chỉ publish `filesystem.read_file` và `filesystem.write_file`, mặc định tắt và fail closed nếu preset, artifact, principal root hoặc marker drift. Durable filesystem marker là reservation trước packet, không phải receipt; không có cam kết rollback hoặc exactly-once cho arbitrary MCP writes.
