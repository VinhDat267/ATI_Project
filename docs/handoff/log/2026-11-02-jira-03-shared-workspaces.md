# 02/11/2026 · JIRA-03 · Chính sách Jira trên workspace tổ chức chung

Task: [JIRA-03](../tasks/JIRA-03-workspaces.md). Nhánh `longnguyen005/jira-03-workspaces`; checkpoint `fe061bb`, `322d799`; tích hợp main `2c62565f` (PR #237). SHA tích hợp cuối và CI được ghi trong PR. Chưa merge; chủ dự án tự review/merge. Không sửa `CURRENT-STATE.md` hoặc `ROADMAP.md`.

## Quyết định và phạm vi

Chủ dự án chốt dùng workspace chung, giữ duyệt Jira riêng. [Bổ sung thiết kế](../../superpowers/specs/2026-11-02-jira-shared-workspace-amendment.md) thay phần workspace của thiết kế Jira 30/10. `ati_workspaces.id` là FK/PK của cùng tổ chức; không có UUID hay tên tổ chức sao chép độc lập. Membership và invite tổ chức không tự cấp quyền Jira. API riêng `/api/jira-workspaces`, `/api/admin/jira-workspaces`, `/api/jira-workspace-join-requests` giữ DTO/API tổ chức của #237.

Quản trị hệ thống vẫn có quyền vòng đời tạo/archive/khôi phục theo thiết kế gốc, không có quyền ngầm đọc hội thoại, quản trị site/project hay mượn token. Bật Jira trên tổ chức hiện hữu yêu cầu cả quản trị hệ thống và quản trị tổ chức đang active; bootstrap/recovery chọn admin tổ chức active. Archive chỉ đóng chính sách Jira. Danh sách trạng thái tham gia của chính người dùng hiển thị cả bốn trạng thái Jira khi user và membership tổ chức vẫn active; không cấp quyền dữ liệu từ việc thấy trạng thái.

Hội thoại tổ chức bình thường tiếp tục hoạt động. Cờ `jira_context` và scope được khóa sau khi tạo; không nâng lịch sử cũ thành Jira. Hai mode NULL personal/legacy giữ khả năng đọc lịch sử của #237; scope tổ chức không đọc NULL. Header tổ chức không được body ghi đè. Lỗi chọn workspace chung được kiểm tra trước khi tra tài nguyên giữ giao thức chung; tài nguyên Jira đã tra cứu dùng 404 riêng tư. Server giữ 503 cho tạo hội thoại Jira tới khi JIRA-05/08 có guard model/execution đầy đủ.

Chi phí của các lựa chọn triển khai: người dùng phải được duyệt tổ chức trước khi xin quyền Jira; API/UI các task Jira sau phải dùng tiền tố mới và cùng UUID; marker mới cố ý không cho chuyển lịch sử giữa scope. Các điều chỉnh này cần đổi thiết kế nếu chủ dự án muốn cơ chế khác.

## Mã thay đổi

- Migration `0019_jira_workspaces.sql`: phần chính sách cùng UUID, membership/invite, account/grant/site/project/audit, chỉ mục identity active, version và composite FK; cờ hội thoại và trigger bất biến. Giữ migration #237 chạy trước để backfill an toàn.
- Repository `apps/chat-api/src/db/repositories/workspace/`: transaction/authority hiện tại, bootstrap/recovery, SQL CAS, last effective admin, token 256-bit lưu hash, DB clock sau mọi chờ khóa và so sánh timestamp trong PostgreSQL.
- API, app/server và authority hội thoại: hai lớp quyền, rate limit, không fake capability khi thiếu native verifier; owner/scope trước history/plan/SSE/execution/schedule. Pool thất bại được đóng và bỏ khi chuyển sang memory sandbox.
- Hồi quy PostgreSQL, HTTP và sandbox thật; fixture canonical typecheck; cập nhật fixture lịch sử và database test theo cấu hình. Không sửa frontend/catalog/planner trong phần chênh lệch so với main #237.

## Bằng chứng

Các lệnh dùng PostgreSQL test riêng loopback cổng 56534, database `ati_jira03_shared`, sandbox, không load `.env`. Container test riêng đã kiểm tra; không dùng database runtime cổng 55533. CI dùng PostgreSQL ephemeral theo workflow.

- `node db/v3/migrate.mjs`: áp dụng 0001–0016, exit 0; các bài migration kiểm tra chạy lại và backfill #237.
- `npm run typecheck:v3`: API và web exit 0.
- `npm run check`: exit 0; **3.259 v3 PASS** = schemas 341 + adapters 456 + planner 381 + executor 42 + API 1.130 + web 909. API 126 file, không skip. **406 eval PASS**, **32 Node Jira probe PASS**, **1 launcher + 66 Node/env PASS**, build và build security đạt.
- Lượt tích hợp đầu: 42 ca mới có 37 FAIL/5 PASS; site/project 47 ca có 4 FAIL/43 PASS. Sau sửa, 47 site/project PASS và 144 ca ở các nhóm fixture cuối PASS. Hồi quy memory/database 9 PASS sau sửa pool lỗi. Bằng chứng pre-237 không được dùng thay kết quả sau tích hợp.
- **12/12 đột biến bị bắt**, exit 0. Mỗi ca chạy control, mutant, khôi phục đúng byte/SHA-256, rồi control xanh lại. Bao phủ: immutable binding, Jira marker, FK chung, connected identity, token cũ sau reject, admin hiệu lực cuối, thiếu verifier (tổng hợp 4 điểm chặn), private 404, Jira opt-in 503, user bị khóa sau chờ, hạn invite sau chờ account và quyền tổ chức. Test bất biến dùng UPDATE vẫn thỏa CHECK để thực sự kiểm tra trigger; không coi lỗi import/timeout là bắt được đột biến.

Các lỗi sửa có bằng chứng thật: scopeArg bị bỏ qua khi tiêu đề undefined; fixture UUID bị hiểu là title; bỏ sót membership/header chung; trả role trước kiểm tra user/membership; summary lộ sau thu hồi; báo conflict trước authority; pool đã lỗi vẫn được truyền vào guard. Không dùng boolean giả lập để chứng minh concurrency; barrier quan sát SUT bị khóa trong PostgreSQL.

## Review và bàn giao

Ba reviewer môđun độc lập kết luận spec PASS, quality APPROVED: core/database/HTTP, hội thoại, site/project. Không còn lỗi Critical/Important được các lượt này phát hiện. Comment đường dẫn cũ đã sửa; route schedule được app cấp authority/metadata, còn unit test service riêng có thể bỏ dependency đó. Bộ đột biến được chuẩn bị bởi worker riêng và chạy/đối chiếu output bởi bộ điều phối. Worker dùng Antigravity CLI `gemini-3.8-flash-high`, effort high và Superpowers; bộ điều phối thực hiện lệnh kiểm thử, sửa tích hợp nhỏ và Git. 9Router không được dùng lại.

Review toàn nhánh mới và CI gồm browser trên head cuối là bước tiếp theo của PR; kết quả được bổ sung trong mô tả PR, không suy diễn từ kiểm tra local. Giữ PR cho chủ dự án review/merge; reviewer sau merge mới cập nhật trạng thái chung.

JIRA-04 OAuth transport, JIRA-05 native/runtime policy, planner/executor/UI và nghiệm thu live còn thuộc task tiếp theo. Task này không gọi model/Jira live, không ghi Jira thật và không bật runtime Jira; catalog giữ 33 tools/8 services.

## Tích hợp tiếp main #238 (86b432f)

Sau khi tạo draft PR #240, GitHub báo xung đột với Sheets v2 vừa vào main. Giữ cả guard Jira và approvalMode trong route xác nhận lịch, kiểm tra quyền trước validation/body và tác dụng phụ. Đổi migration Jira sang **0017**, chạy sau Sheets 0016; không sửa migration Sheets hay mở runtime Jira.

Bằng chứng mới thay kết quả trước #238 ở trên: migrations **0001–0017**, typecheck API/web và **npm run check exit 0**; **3.278 v3 PASS** = schemas 341 + adapters 460 + planner 381 + executor 42 + API 1.143 (129 file, không skip) + web 911; 406 eval, 32 Node probe, 1 launcher + 66 Node/env, build/security đều đạt. Năm hồi quy mới xác nhận auto_digest thường hoạt động, quyền Jira bị gỡ trả 404 trước xác nhận/validation, user mất quyền tổ chức bị chặn và body sai không gọi service.

Chạy lại toàn bộ guard trên base mới: **13/13 đột biến bị bắt**, mỗi ca control xanh → assertion lỗi → khôi phục byte/SHA → control xanh. Ca mới bỏ guard hội thoại trước xác nhận auto_digest bị bắt bằng kiểm tra PostgreSQL/HTTP thật. Không dùng bằng chứng trước #238 làm nghiệm thu cuối. SHA mới, review toàn nhánh và CI/browser được cập nhật trong PR #240; giữ PR cho chủ dự án review/merge.

## Base cuối #239 (2d5f625)

Calendar v2 tiếp tục vào main trước push bản giải quyết xung đột. Ghép tự động server, giữ guard đã kiểm tra; Jira đánh số **0018** sau Sheets0016/Calendar0017. Sửa cùng hợp đồng scopeArg của memory repository sau test RED (undefined title làm mất personal mode), rồi 6/6 hồi quy memory/lịch GREEN.

Bằng chứng cuối thay các đợt trước: **npm run check exit 0**, **3.304 v3 PASS** = schemas341 + adapters464 + planner381 + executor42 + API1.159 (134 file, không skip) + web917; **406 eval**, 32 Node probe, 1 launcher +66 Node/env, build/security đạt. Migrations0001–0018 áp dụng thành công. Chạy lại 13 guard trên base cuối; control/mutant/khôi phục SHA/control được lưu trong bằng chứng riêng và cập nhật PR #240. Review toàn nhánh mới và CI/browser vẫn lấy theo head PR cuối, không tái dùng phán quyết trên base cũ.

## Bản vá cuối sau head5f: title/scope boundary

Mặc dù whole-branch review và CI/browser của5f đã đạt, rà soát bổ sung tìm thấy title object có thể bị overload repository hiểu thành ConversationScope. Hai test HTTP/PostgreSQL mới tái hiện201 thay400. Route chặn mọi title ngoài string/null/omitted, rồi chuẩn hóa riêng string hoặc undefined trước gọi repository. Native implementer thực hiện bản vá; 16 test nhóm hội thoại GREEN, gồm title chuỗi, null và JSON-text giữ nguyên scope.

Fullcheck sau vá exit0: **3.309 v3** = schema341 +adapter464 +planner381 +executor42 +API1.164/134file +web917;406eval,32Nodeprobe,1launcher+66Node/env,build/security đạt. Ma trận tăng lên14 đột biến; ca cuối bỏ cả type rejection và string-only normalization để tái tạo scope injection. Bộ điều phối chạy thật, khôi phục byte/SHA và kiểm tra control sau phục hồi. Scoped re-review của đúng delta và CI/browser trên head mới được ghi trong PR #240; không coi kết quả5f là nghiệm thu bản vá.


## Tích hợp main #241 và bằng chứng hiện tại

Main `956d213` thêm GitHub OAuth/digest và migration0018. Ghép cả tùy chọn GitHub và Jira trong AppOptions; giữ wiring pool, authority và cổng Jira 503 trong server. Jira chuyển sang **0019_jira_workspaces.sql**. PostgreSQL kiểm thử riêng áp dụng migrations0001–0019 thành công. `npm run check` exit0: **3.387 v3 PASS** = schemas341 + adapters466 + planner381 + executor42 + API1.228 (146 file, không skip) + web929; **406 eval**, 32 Node probe, 1 launcher +66 Node/env và build/security đạt. Chạy lại **14/14 đột biến**, tất cả bị assertion bắt, khôi phục đúng byte/SHA và control xanh. Các số liệu #238/#239/title ở trên là lịch sử; review delta và CI/browser trên SHA cuối được ghi tại PR #240.
