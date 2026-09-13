# Kết quả sửa audit — 13/09/2026

Đã sửa mã thư viện và đồng bộ bộ tài liệu theo **B/local do người dùng xác nhận**. Phạm vi sửa là skeleton/documentation hiện có; không xem đây là hoàn thành nền tảng 6 tuần.

## Bằng chứng và bảo toàn

Trước sửa đã đối chiếu SHA-256 cả 40 file gốc với audit ngày 12/09: không có thay đổi xen vào. Bản gốc lưu trong [archive](archive/pre-fix-2026-09-13.zip). Audit/evidence cũ là lịch sử, không bị đổi thành kết quả mới. Các entry trùng ở gốc đã chuyển thành link tới docs chuẩn.

Vòng hồi quy đầu tiên tái hiện 15 lỗi trên source cũ. Sau đó thêm kiểm policy, approval và oracle fixture. Lệnh tổng hợp: npm ci; npm run check. Các lệnh này không gọi LLM/MCP/SaaS, không gửi tin nhắn ngoài. Chi tiết kết quả chạy cuối nằm trong fix-evidence/2026-09-13.

## Kết quả kiểm tra cuối

Sau npm ci từ lockfile, npm run check kết thúc exit 0: **38/38 tests**, root typecheck, DSL build, JSON Schema và OpenAPI type generation đều qua. Kiểm artifact xác nhận 11 API schemas, 9 operations, 36 internal schema refs hợp lệ; 14 run statuses SQL/Zod khớp. SQL enum match là kiểm tĩnh, không phải migration test.

Archive đã kiểm SHA-256 của **40/40 file gốc**, không sai khác. Kết quả máy đọc được và log: [evidence](fix-evidence/2026-09-13/README.md). Review độc lập sau sửa các điểm P2 không tìm thấy regression quan trọng trong các block đã rà lại.

## Xử lý từng phát hiện

| ID | Đã sửa | Giới hạn bằng chứng |
|---|---|---|
| F01 | Chốt B/local; một baseline, lịch 112h việc + 23h dự phòng; FR giữ 78 ID với cột B rõ ràng; bỏ WS/resume/hybrid/GitHub khỏi giao việc | Quỹ giờ vẫn là giả định, phải hiệu chỉnh ở G1; rubric chưa có |
| F02 | Demo chép mảng string[][] nguyên dạng; thêm output schema và plans/fixtures có expected payload; object interpolation sai bị chặn; unsupported min/loop/transform có refusal | Chứng minh executability offline, chưa chứng minh model lập đúng hoặc server chạy thật |
| F03 | validatePlanTools tra trusted registry/policy, bác forged read/unknown; validateToolCall chặn write trong dry-run và kiểm resolved args | Helpers CODE_TESTED; engine phải gọi đúng gates, owner/approval/atomic claim còn SPEC_ONLY |
| F04 | Hợp đồng operation id + payload hash + reserve/in-flight/unknown/receipt; migration tool_operations; cấm blind retry unknown và user/week-only dedupe | SPEC_ONLY; chưa có receiver transaction, fault injection hay exactly-once evidence |
| F05 | Cấm downstream tham chiếu output write trong một preview; Approval gắn version/hash/expiry; helper bác stale/expired/cancelled; replan phải duyệt lại | Helper/constraint CODE_TESTED; preview hashing, transactions và replan engine chưa triển khai |
| F06 | CreateRun/RunDetail chấp nhận trước-plan chưa có version; migration giữ source prompt/workflow/owner, thêm refusal/needs_input/reconciliation status | Schema được kiểm; SQL chưa thực thi trên PostgreSQL |
| F07 | Bỏ converter không tương thích, dùng Zod 4 native JSON Schema; test kiểm minItems/required và Ajv bác steps rỗng, nhận nested args hợp lệ | Provider-specific structured output chưa probe; Zod refinements vẫn phải chạy runtime |
| F08 | PlannerResult union plan/refusal/clarification; prompt không còn yêu cầu empty executable plan | Schema/prompt đã sửa; model behavior chưa đo |
| F09 | Validate key refs, malformed/unclosed refs, lỗi có path; tách warnings; resolver bác missing/prototype fields và object interpolation | Các counterexamples đã qua tests; refs trong tool args có thể deferred và bắt buộc validate sau resolve |
| F10 | Dataset B có 6 dev/4 holdout, read fixtures, writes/outputs oracle; test sai channel/mất row; manifest và metric phân biệt validity/correctness | Smoke dataset nhỏ, chưa final AI experiment; holdout cần thay nếu đã dùng tune |
| F11 | task_hub rõ local 8 tool; filesystem 2 adapter contracts, candidate pin/integrity; deny-all launch preset; outputSchema và MCP isError normalization | Raw tools/list/call, filesystem adapter/path confinement và MCP service đều NOT_RUN |
| F12 | README/lệnh kiểm đúng trạng thái; root typecheck/tests/lock; bỏ lệnh dev/migrate/seed/reset chưa có; chuẩn hóa đường dẫn docs | Không quảng cáo app đang chạy; không khởi tạo Git |
| F13 | Sửa mô tả Zapier/n8n, BullMQ, BM25 và tái lập; tách hypothesis/rubric chưa xác minh khỏi kết quả | Các claim so sánh cũ không còn là luận điểm dự án; user validation còn OPEN |
| F14 | OpenAPI 3.1 sinh từ shared schemas, typed plan/event/outcomes/approval, nullable đúng dialect; UI polling/fetch preview và 2 màn hình thống nhất | Type generation/contract checks khác với HTTP hoặc browser E2E, hiện chưa có server |

Bổ sung: timezone IANA mặc định Asia/Ho_Chi_Minh đã kiểm ranh giới 01:00 thứ Hai; toàn bộ catalog entry được encode/neutralize marker. Không gọi marker escaping là bằng chứng chống prompt injection.

## Kiểm chưa chạy và công việc kế tiếp đã ghi lịch

- Docker daemon không khả dụng (pipe dockerDesktopLinuxEngine không tồn tại). Migration 0001+0002 **NOT_RUN** trên PostgreSQL; không reset hoặc đụng dữ liệu DB có sẵn.
- apps/api, apps/web và apps/mcp-task-hub còn README skeleton; chưa có HTTP/worker/UI/MCP local service. Không có runtime receipt/approval/outbox/fault tests thật.
- Không gọi model, tạo MCP external connection, gửi Slack, sửa Sheets hoặc làm thao tác SaaS. Tên các tool trong fixture chỉ là hợp đồng local.
- Wireframe đã sửa nội dung/luồng; chưa là ứng dụng và không được báo là browser QA.
- Nguồn rubric, nhu cầu người dùng và ngưỡng AI cuối cùng còn OPEN. Kế hoạch tuần 1 quy định thu thập/đối chiếu trước kết luận.

Điểm bắt đầu triển khai tiếp theo là G1: một plan tay chạy hết luồng qua local MCP với fixture và receipt. Cổng này đã được mô tả cụ thể, không bị thay bằng unit tests của DSL.

## Review bổ sung

Review mã độc lập tìm thấy hai thiếu sót P2: profile B chưa chặn retry >3/backoff khác exponential và API chưa có endpoint lấy full attempt snapshots. Cả hai đã được sửa, có counterexample tests; prompt repair/replan cũng thống nhất PlannerResult envelope và cách chạy tuần tự. RunDetail bổ sung ràng buộc run thực thi phải có plan/version.
