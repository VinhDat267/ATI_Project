# Phạm vi nền tảng workflow đa dịch vụ

**Cập nhật:** 29/09/2026. **Trạng thái:** đã triển khai GitHub làm dịch vụ thứ ba và kiểm chứng workflow ba dịch vụ trong sandbox + PostgreSQL; gate live và phục hồi vẫn mở.

> **Cập nhật 04/10/2026 (W3-07):** catalog có 8 service (Trello, Slack, GitHub, Google Sheets, Google Calendar, Notion, Telegram, Jira). Cả năm service mới đã chạy thật có kiểm soát qua `evaluations/live-execution/run.ts`, mỗi lệnh ghi theo plan người dùng đã duyệt đúng hash:
> - **Telegram:** gửi tin vào nhóm thử nghiệm.
> - **Notion:** tạo page; lần chạy thật phát hiện host `app.notion.com`, sửa qua #49.
> - **Jira:** tạo `ATIT-4`; hai phát hiện → W3-09.
> - **Google Calendar:** tạo sự kiện.
> - **Google Sheets:** thêm dòng có link sự kiện.
> - **Workflow 4 service:** GitHub → Notion → Telegram → Slack, 4/4 step thành công, đối chiếu bằng tool đọc.
>
> Mỗi service có một ca lỗi xác thực thật (Telegram 401, Notion 401, Jira 401/404, Google 400 `invalid_grant`). Chi tiết và hash ở [W3-07](handoff/tasks/W3-07-new-services-live.md); bảng gate bên dưới giữ nguyên lịch sử ngày 29/09, trừ dòng Live.

Tài liệu này ghi nhận khoảng cách mã nguồn và backlog. Nguồn chuẩn tắc về hành vi và nghiệm thu vẫn là [đặc tả v3, mục 1.4](superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md#14-phạm-vi-đa-dịch-vụ-và-điều-kiện-hoàn-thành).

## Mục tiêu sản phẩm

Người dùng mô tả mục tiêu bằng ngôn ngữ tự nhiên; hệ thống chọn công cụ từ nhiều dịch vụ đã kết nối, lập kế hoạch có phụ thuộc dữ liệu, trình người dùng duyệt rồi thực thi và trả kết quả. Trello và Slack là đợt triển khai đầu tiên. Đóng hai adapter này không đồng nghĩa hoàn thành nền tảng.

Kịch bản đã chạy trong sandbox: tạo issue GitHub → tạo card Trello tham chiếu issue → gửi Slack chứa cả hai liên kết. Browser E2E đối chiếu plan, trạng thái từng bước và `output_json` trong PostgreSQL. GitHub là dịch vụ thứ ba; Google Sheets là ứng viên cho đợt sau.

Phạm vi là các tích hợp được đăng ký và cấp quyền, không phải tự gọi mọi website/API từ một yêu cầu chat. Mỗi kết nối phải xác định credential, tài nguyên được phép, các công cụ khả dụng và trạng thái lỗi. Cần phân biệt `registered`, `configured` và `verified`; có tên trong catalog không đồng nghĩa gọi được dịch vụ.

## Thay đổi mã nguồn đã kiểm chứng

| Vị trí | Hiện trạng mới | Bằng chứng |
|---|---|---|
| `packages/tool-schemas/src/services.ts` | Registry metadata cho Trello, Slack, GitHub: credentials, scope, intent và gather | Schema/planner tests |
| `packages/planner/src/router.ts`, `planner.ts` | Router/gather dùng catalog khả dụng và metadata; có test đăng ký một dịch vụ giả mới mà không sửa nhánh core | Planner tests |
| `packages/tool-adapters/src/github/` | Năm thao tác GitHub; repo allowlist, `AbortSignal`, phân loại write `UNKNOWN` | Adapter tests với injected fetch |
| `apps/chat-api/src/services/` và `routes/services-routes.ts` | Constructor/connection check theo registry; live planner chỉ nhận tool của dịch vụ có credentials + scope | API tests |
| `apps/chat-web/src/components/` | Form cấu hình tạo trường credentials từ API metadata; hiển thị GitHub | Component tests |
| `apps/chat-web/tests/browser/v3-sandbox.spec.ts` | Duyệt và chạy plan GitHub → Trello → Slack, xác nhận link truyền qua các bước trong DB | Browser E2E + PostgreSQL |

**Giới hạn:** bằng chứng runtime ba dịch vụ là sandbox. Adapter GitHub được kiểm tra transport qua injected fetch; chưa có bằng chứng credential thật, quyền GitHub thật, ghi issue thật hoặc workflow live qua ba provider. Không suy từ test sandbox ra production readiness.

## Kiến trúc đang triển khai

1. Dùng registry nội bộ được đăng ký khi khởi động, thay vì rải nhánh theo tên dịch vụ trong core. Registry bao gồm metadata, tool definitions, schema cấu hình, validator phạm vi và adapter factory. Không nạp code tùy ý từ người dùng.
2. Từ registry và quyền kết nối hiện tại, tạo catalog khả dụng cho planner. Không đưa secret vào prompt; không dùng metadata hiển thị thay cho kiểm tra quyền phía máy chủ.
3. Planner dùng mô tả công cụ và cơ chế tra cứu của tích hợp để chọn thao tác; executor nhận hợp đồng chung, phân giải phụ thuộc và lưu trạng thái như hiện tại.
4. API trả metadata không chứa bí mật để UI hiển thị dịch vụ và trạng thái. Các biểu mẫu đặc thù có thể thuộc module tích hợp; không buộc mọi kiểu xác thực vào form Trello/Slack.
5. Giữ kiểm tra tài nguyên phía adapter. Mỗi API có giới hạn, lỗi và semantics ghi riêng; chuẩn hóa giao diện không cho phép retry mọi lệnh ghi giống nhau.

Hợp đồng registry và tích hợp GitHub đã có trong mã nguồn; các bước trên là mô tả kiến trúc đang dùng. Không có chợ plugin hoặc tự sinh adapter bằng AI. Google Sheets, Gmail, Calendar và Notion tiếp tục ở lộ trình sau.

## Gate nghiệm thu còn mở

Các gói việc MS-01 → MS-06 nằm ở đầu [kế hoạch v3](superpowers/plans/2026-09-29-ai-workflow-platform-v3.md). Phần triển khai và sandbox đã có bằng chứng cục bộ; nghiệm thu live phải được lập bằng chứng riêng.

| Gate | Bằng chứng cần có | Trạng thái |
|---|---|---|
| Hợp đồng mở rộng | GitHub đăng ký; test dịch vụ giả mới trong router/gather | CONFIRMED cục bộ |
| Adapter thứ ba | Schema, credentials, repo scope, transport và lỗi được kiểm thử | CONFIRMED qua injected fetch; live NOT_RUN |
| Workflow ba dịch vụ | Kết quả bước trước được dùng ở bước sau; preview/approval/result và DB khớp nhau | CONFIRMED sandbox + PostgreSQL, 1 browser E2E |
| Giới hạn và lỗi | Thiếu cấu hình, ngoài scope, token hết hiệu lực, 429, timeout, `UNKNOWN`, dependency khi bỏ qua bước | PARTIAL; unit/integration fixture, live NOT_RUN |
| Live | Có kết quả API thật và đối chiếu tài nguyên cùng trạng thái DB; lưu evidence riêng với sandbox | CONFIRMED qua `run.ts` cho cả 8 service (04/10/2026, W3-07); đối chiếu bằng tool đọc, chưa đối chiếu DB của app vì không chạy qua frontend |

Giữ regression Trello/Slack. Test giả lập có giá trị kiểm tra hợp đồng, nhưng không đóng gate live hoặc chất lượng AI. Đạt một workflow ba dịch vụ là bằng chứng tối thiểu cho scope mở rộng, không phải cam kết hỗ trợ mọi dịch vụ.

## Cách báo cáo tiến độ

- **Đã có:** Trello/Slack/GitHub, registry, planner/executor/API/UI và 227/227 unit/integration tests cùng 5/5 browser E2E trên PostgreSQL cục bộ.
- **Còn thiếu:** bằng chứng live có kiểm soát qua ba provider, kiểm thử phục hồi sau crash và nghiệm thu production.
- **Không được suy ra:** “227 tests pass” hoặc “28 tasks xong” có nghĩa toàn bộ nền tảng đa dịch vụ đã hoàn thành.

Khi triển khai live, trạng thái và evidence của từng gate phải được cập nhật theo kết quả thực tế.
