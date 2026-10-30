# Jira OAuth cá nhân và workspace ATI — thiết kế, lộ trình đề xuất

**Ngày:** 30/10/2026 (Asia/Saigon). **Trạng thái:** DRAFT — chờ chủ dự án duyệt; chưa cho phép triển khai mã sản phẩm hoặc bật live.
**Task tài liệu:** [JIRA-00](../../handoff/tasks/JIRA-00-oauth-workspaces-design.md).
**Nền đối chiếu:** `origin/main` tại `fc12e3fbd683f9ffee53322b4f5fc132d50fc2ac`, không phải checkout SCHED-03 tại `91642f4`.
**Phạm vi của tài liệu:** bản thiết kế đủ chi tiết để đánh giá cùng lộ trình chia việc; task card thi công và các bước RED/GREEN cụ thể sẽ được lập sau khi thiết kế được duyệt.

## 1. Các quyết định của chủ dự án

1. Thao tác Jira dùng tài khoản Atlassian mà chính người dùng ATI kết nối.
2. Bản đầu hỗ trợ một người làm việc với nhiều Jira site; một workspace ATI chứa nhiều site.
3. ATI tự quản lý workspace; không đồng bộ workspace theo Atlassian Organization.
4. Người dùng kết nối danh tính trước, rồi xin gia nhập workspace và chờ duyệt.
5. Cần cả quyền phía Jira/Atlassian và duyệt thành viên phía ATI.
6. Chỉ quản trị viên hệ thống ATI được tạo workspace.
7. Workspace quản lý Jira trước; chưa áp dụng cơ chế workspace cho các dịch vụ khác.

“Jira site” là hệ thống ở một địa chỉ như `company.atlassian.net`; một site có nhiều project. Workspace ATI là nhóm do ATI quản lý, không phải site hay Organization của Atlassian.

Các nội dung gắn **Đề xuất** dưới đây là lựa chọn của người viết, chưa được coi là quyết định đã duyệt. Đặc biệt: nhiều site trong một kế hoạch, vai trò quản trị team, namespace `myjira`, phương thức mời và giới hạn bản đầu cần được đọc cùng khi duyệt tài liệu.

## 2. Mục tiêu, giới hạn và điều kiện nghiệm thu

### 2.1. Mục tiêu

- Một người kết nối danh tính Atlassian, xin vào team, được ATI duyệt, rồi chỉ truy cập Jira theo quyền thực tế của mình.
- Workspace quản lý nhiều site và danh sách project của từng site; kết nối của thành viên không được chia sẻ cho người khác.
- Giữ nghiệp vụ hiện có: tìm project, tìm issue, tạo issue, thêm comment. Thêm khả năng khám phá các site hợp lệ của workspace hiện tại.
- Một kế hoạch chờ duyệt thể hiện rõ người thao tác, workspace và site/project của từng bước; executor dùng đúng các ràng buộc đó.
- Luồng lỗi, mất quyền, token hết hạn và thu hồi thành viên có hành vi xác định, kiểm thử trên database/HTTP thật.

### 2.2. Ngoài bản đầu — đề xuất

- Đồng bộ Organization/group, mời hoặc cấp license Jira bằng API quản trị Atlassian; quản trị viên thực hiện các việc đó tại Atlassian.
- Webhook, đồng bộ nền, theo dõi mọi issue, tự chạy lệnh ghi; không mở rộng Jira thành toàn bộ public API.
- Chuyển trạng thái, gán người, xóa issue/comment, quản trị người dùng Jira, issue có parent/subtask và tự điền custom required fields.
- Nhiều tài khoản Atlassian đồng thời cho cùng một người ATI: bản đầu một danh tính cá nhân, có thể cấp quyền nhiều site.
- Hội thoại dùng chung giữa thành viên, chia sẻ transcript hoặc quyền đọc transcript cho quản trị viên team.
- Đặt lịch workflow có Jira cá nhân. Hệ thống phải từ chối rõ yêu cầu này, không chạy qua đường lịch thiếu workspace.
- Cô lập toàn bộ Slack/Trello/Gmail theo workspace. Workflow Jira → dịch vụ khác vẫn chịu cơ chế kết nối hiện có của dịch vụ đích, được ghi rõ trên preview.

### 2.3. Điều kiện “xong”

Nghiệm thu phải có hai site thật, hai người ATI, hai tài khoản Atlassian có quyền khác nhau, hai workspace ATI, trường hợp project/issue key trùng giữa site, quyền bị thu hồi và một workflow liên dịch vụ. Nếu chỉ có một site thật, ghi rõ MULTI_SITE_LIVE_NOT_RUN và chưa đóng tính năng nhiều site. Mỗi thao tác ghi phải được chủ dự án duyệt đúng kế hoạch/hash.

## 3. Hiện trạng và cách triển khai được đề xuất

Trên nền đối chiếu:

- `packages/tool-adapters/src/jira/jira-adapter.ts` dùng Basic auth email + API token, một site, allowlist project, chống chèn JQL, kiểm issue chuyển project và xử lý ghi `UNKNOWN`.
- `apps/chat-api/src/services/transports/jira.ts` và registry Jira dùng cấu hình chung. `AdapterFactory` cache adapter chung theo dịch vụ.
- `service_credentials` có unique `(service, user_id)`; hàm lưu có thể thay toàn bộ credential của cùng khóa. Không dùng một row này cho mọi site/grant mới.
- Gmail, MyCalendar, MySheets đã có kết nối cá nhân và binding trước hash. OAUTH-01 đã có quay về hội thoại. Slack mới có foundation contract, không phải token store/runtime sẵn dùng cho Jira.
- Chưa có workspace ATI, membership, invite hay ACL Jira theo workspace. Không nhầm workspace ATI với `SlackBinding.workspaceId` là workspace native Slack.

### 3.1. Các hướng đã cân nhắc

| Hướng | Lợi ích | Đánh đổi / quyết định |
|---|---|---|
| ATI tự quản lý workspace, mỗi người OAuth, Jira giữ quyền native | Đúng nhu cầu team và danh tính cá nhân; không cần giữ credential quản trị Organization | Chủ dự án chọn hướng này; ATI tự xây membership và phạm vi site/project |
| Đồng bộ workspace theo Atlassian Organization | Có thể bám cấu trúc tổ chức bên Jira | Cần tích hợp quản trị, credential và lifecycle riêng; không được chọn |
| Chia sẻ một connection cho cả team theo kiểu automation chung | Ít bước kết nối cho thành viên | Không đáp ứng yêu cầu thao tác bằng tài khoản từng người; loại |

**Đề xuất kỹ thuật:** tiếp tục REST API Jira, dùng confidential OAuth 2.0 authorization-code (3LO); không thêm MCP gateway hoặc dịch vụ trung gian vào ATI. Học cách phân quyền từ Claude/Atlassian và cách gắn connection với người dùng từ Pipedream, không sao chép mọi quyền hoặc tool của họ.

**Đề xuất tương thích:** thêm năm tool `myjira.*` sau cờ `MYJIRA_ENABLED=off` mặc định. Cờ tắt giữ runtime/catalog cũ. Cờ bật thì `jira.*` chung không vào planner và executor từ chối kế hoạch legacy Jira, ở cả sandbox/live; route test/lookup Jira chung cũng không được phát HTTP bằng Basic token. Không rơi về API token chung khi OAuth lỗi. UI gọi dịch vụ mới là “Jira”, namespace chỉ là chi tiết nội bộ. Không tự chuyển kế hoạch hoặc lịch legacy sang tài khoản cá nhân.

## 4. Quyền và mô hình team

### 4.1. Vai trò — đề xuất

| Vai trò | Quyền trong ATI | Giới hạn |
|---|---|---|
| Admin hệ thống | Tạo/archive workspace, chỉ định hoặc khôi phục admin team | Không được mượn token thành viên hoặc mặc nhiên đọc transcript |
| Admin workspace | Duyệt/từ chối/xóa thành viên; quản lý invite và site/project của team | Khi liên kết site phải chứng minh quyền `ADMINISTER` Jira bằng OAuth của chính mình |
| Thành viên | Xin tham gia, xem cấu hình team được phép, yêu cầu và duyệt workflow cá nhân | Chỉ dùng connection của mình, chỉ trong workspace có membership active |

Admin hệ thống tạo workspace và chỉ định admin đầu tiên bằng thao tác bootstrap có audit. Không cho tự duyệt một yêu cầu thành viên thông thường, tự nâng role hoặc xóa admin cuối cùng khi workspace còn hoạt động; admin hệ thống có đường khôi phục.

**Đề xuất:** một người có nhiều workspace; cùng một Jira site có thể liên kết nhiều workspace, mỗi workspace có phạm vi project riêng. Việc dùng chung site không chia sẻ token, hội thoại hay bộ nhớ giữa team.

### 4.2. Phép kiểm quyền bắt buộc

Một lời gọi Jira cần đồng thời: người ATI/phiên hợp lệ; workspace active; membership active; site được liên kết; project được team cho phép; OAuth đủ scope và còn dùng được; quyền native Jira cho đúng thao tác. Chạy ghi còn cần đúng plan/hash đã được người dùng duyệt.

Membership ATI và quyền native độc lập. Đã có quyền Jira thì không bắt chờ duyệt Jira lần nữa. `accessible-resources` là danh sách site được token cấp quyền, không phải bằng chứng quyền project hoặc trạng thái đơn xin vào Jira.

ATI hiển thị riêng: chưa kết nối danh tính; cần cấp thêm quyền Jira; chờ ATI duyệt; ATI từ chối; chưa có quyền Jira ở site/project; cần kết nối lại; sẵn sàng. Không suy ra “Jira đang chờ duyệt” hay “Jira đã từ chối” chỉ từ 401/403/404 hoặc danh sách site rỗng.

### 4.3. Xin gia nhập — đề xuất

Workspace riêng tư; admin tạo link/mã mời ngẫu nhiên ít nhất 256 bit, lưu hash, hạn mặc định 7 ngày, thu hồi được. Invite cho phép gửi yêu cầu, không tự kích hoạt membership. Không cung cấp directory công khai của mọi công ty/site.

Người đã kết nối danh tính mở invite, xem tên team và thông tin site tối thiểu, gửi yêu cầu. Membership `pending` không được tra project/issue, gọi model với nội dung Jira hoặc xem dữ liệu Jira của team. Quyết định `pending → active/rejected` phải dùng CAS SQL thật và chỉ một người duyệt thắng. Người bị `removed/rejected` chỉ xin lại bằng invite mới được admin chủ động cấp.

## 5. OAuth, nhiều site và quản lý token

### 5.1. Đăng ký và scope

**Đề xuất:** một app 3LO của ATI, cấu hình callback HTTPS và secret ở backend. Account-level grant phù hợp bản đầu nhiều site; chỉ dùng site mà token thực sự trả về. Nếu console/tài khoản pilot không cung cấp loại grant này, JIRA-01 phải ghi rõ và sửa thiết kế grant trước khi thi công.

User Identity API với `read:me` dùng nhận diện account; Jira platform dùng `read:jira-work`, `write:jira-work`; `offline_access` cho refresh. Bản đầu dùng `/me` và `/mypermissions` để tránh cần scope hồ sơ người dùng Jira. Không xin scope admin, webhook hoặc xóa người dùng. Các scope thực tế phải được kiểm với từng endpoint ở JIRA-01, không lấy nguyên bộ scope rộng của sản phẩm khác.

Backend giữ state ngẫu nhiên/hash, owner ATI, session/browser binding, mode/provider, hạn 10 phút và used_at. Consume một lần bằng transaction/CAS; chống callback lặp, nhầm phiên/người và open redirect. Chỉ quay về `/c/<uuid>` do chính người gọi sở hữu hoặc route nội bộ được server định nghĩa. Không tự gửi lại yêu cầu hay tự duyệt sau callback. Không mặc định tham số Google/PKCE dùng nguyên cho Atlassian; ghi rõ profile provider đã kiểm.

### 5.2. Cổng khả thi quan trọng: kết nối trước khi có quyền site

Yêu cầu của chủ dự án là kết nối danh tính trước khi xin vào team. **Đề xuất cần kiểm chứng:** bước đầu chỉ xin `read:me` và quyền giữ kết nối; khi đã có quyền Jira thì cấp bổ sung scope Jira và chọn/cấp quyền site. Trạng thái `identity_connected` không đồng nghĩa đã gọi được Jira.

JIRA-01 phải thử bằng tài khoản Atlassian chưa thuộc bất kỳ site nào: identity-only consent, `/me`, callback, sau đó thêm quyền site và re-consent. Tài liệu `/me` không đủ để tuyên bố luồng không-site đã được nghiệm thu.

Nếu Atlassian vẫn bắt chọn site ngay từ lần nối danh tính đầu tiên: dừng tại cổng này, báo kết quả thật cho chủ dự án và chốt ngoại lệ onboarding trước khi triển khai tiếp. Không giả lập thành công hoặc tự đổi thứ tự “kết nối rồi xin vào workspace”.

### 5.3. Thêm site và thay danh tính

Một account có thể cấp quyền thêm site qua các lượt consent; sau mỗi lượt đọc `/me`, scope và toàn bộ `accessible-resources` rồi đối chiếu, không tin site/account do browser gửi. Chỉ lọc container Jira; cùng cloudId ở loại sản phẩm khác không được coi mặc nhiên là Jira.

Không coi một site là một refresh token. Tách grant, danh tính, tập site được grant cấp quyền và mapping workspace–site. Site được trả về nhưng chưa thuộc workspace không xuất hiện trong directory của hội thoại đó.

**Đề xuất:** một danh tính Atlassian đang hoạt động chỉ gắn một người ATI. Đổi account cần thao tác ngắt/kết nối lại rõ ràng, làm tăng identityVersion và vô hiệu kế hoạch cũ. Email có thể thiếu hoặc thay đổi; khóa danh tính là accountId từ provider.

### 5.4. Refresh và disconnect

Access/refresh token được mã hóa. Refresh tuần tự theo grant bằng khóa PostgreSQL giữa các process, ghi cặp token mới nguyên tử với tokenVersion. Refresh thường không đổi identityVersion; reconnect/thay account có đổi. Request hủy chỉ ngừng chờ, không hủy refresh dùng chung của request khác; refresh có deadline độc lập.

Ghi trạng thái bắt đầu refresh bền vững trước HTTP để process chết giữa exchange và persist không khiến process mới dùng lại token cũ vô hạn. Lượt có kết quả không xác định dùng chính sách recovery đã kiểm trong JIRA-01; nếu không chứng minh phục hồi an toàn thì chuyển `reconnect_required`. Không dựa vào cửa sổ reuse của provider như cơ chế đồng bộ.

Disconnect đánh dấu kết nối vô hiệu, tăng identityVersion, xóa secret/cache, chặn lời gọi tiếp theo và giữ audit không chứa token. Không gọi một endpoint revoke chưa được Atlassian tài liệu hóa. UI phân biệt ngắt kết nối ATI với thu hồi grant tại Atlassian và hướng dẫn nơi thu hồi nếu cần. Gỡ site khỏi một workspace không xóa grant cá nhân dùng cho workspace khác.

## 6. Dữ liệu đề xuất

| Bảng/nhóm | Khóa và nội dung chính |
|---|---|
| `ati_workspaces` | UUID, slug unique, name, active/archived, version, created_by |
| `ati_workspace_memberships` | PK(workspace_id,user_id), role admin/member, pending/active/rejected/removed, version, requested/decided_at, decided_by |
| `ati_workspace_invites` | workspace, token_hash unique, expiry, revoked_at, issued_by; giới hạn tần suất dùng |
| `jira_accounts` | ID, ATI owner, Atlassian accountId, nhãn hiển thị, trạng thái, identityVersion; unique active owner/account |
| `jira_oauth_grants` | account, app/client, grant kind, encrypted access/refresh, scopes, expiry, tokenVersion, refresh state/attempt; ràng buộc owner qua account |
| `jira_grant_sites` | grant + cloudId, Jira URL/name/type, scope thực nhận, last_verified_at; đây không phải bảng membership Jira |
| `ati_workspace_jira_sites` | workspace + cloudId unique, active/disabled, policyVersion, người liên kết và bằng chứng kiểm ADMINISTER |
| `ati_workspace_jira_projects` | workspace + cloudId + numeric projectId unique; projectKey/name chỉ là nhãn có thể thay đổi |
| `jira_authorization_audit` | actor, workspace, connection, site, hành động/quyết định, version, request/plan ID, thời gian; không lưu secret hoặc toàn bộ nội dung issue |
| Bổ sung conversation/plan/message | conversation.workspace_id nullable; binding Jira trong plan; provenance source refs và version của dữ liệu do Jira tạo ra |

Các migration chọn số tiếp theo còn trống lúc tạo PR; nền hiện tại là 0001–0013, không đặt cứng 0014 nếu task khác đã dùng. Migration idempotent, không xóa cấu hình Jira chung hoặc tự gán hội thoại cũ vào team. Enum/state, foreign key và unique/CAS phải được test bằng SQL thật.

Conversation có workspace cố định sau khi tạo; đổi workspace thì mở conversation mới. Một conversation có thể dùng nhiều site của cùng workspace. Owner vẫn là một người ATI; API query theo cả owner và quyền workspace.

## 7. Contracts API và công cụ đề xuất

### 7.1. HTTP API

| Endpoint | Hành vi / quyền |
|---|---|
| `POST /api/admin/workspaces` | Chỉ admin hệ thống; tạo workspace và admin bootstrap trong một transaction |
| `GET /api/workspaces` | Chỉ workspace người gọi có liên hệ; không trả Jira content |
| `POST /api/workspace-join-requests` | Nhận invite; identity_connected; tạo membership pending, chống gửi lặp |
| `GET /api/workspaces/:id/members` | Admin workspace; danh sách và trạng thái, không có secret |
| `POST /api/workspaces/:id/members/:userId/decision` | Admin workspace; expectedVersion + approve/reject/remove; CAS, audit |
| `POST /api/workspaces/:id/invites` | Admin workspace; tạo/thu hồi invite qua API định nghĩa rõ |
| `POST /api/connections/myjira/start` | Owner; mode identity/authorize-sites; returnTo nội bộ hợp lệ |
| `POST /api/connections/myjira/callback` | State một lần; exchange ở server; trả nhãn/trạng thái, không trả token |
| `GET /api/connections/myjira` | Trạng thái danh tính và danh sách site cá nhân, chỉ cho owner |
| `POST /api/connections/myjira/sync-sites` | Owner yêu cầu kiểm lại site/scopes; không lấy site tùy ý từ body |
| `DELETE /api/connections/myjira` | Owner; disconnect có version/audit |
| `GET/POST/PATCH /api/workspaces/:id/jira-sites` | Thành viên xem metadata được phép; admin cấu hình site/policy, kiểm quyền native khi ghi |
| `GET/PUT /api/workspaces/:id/jira-sites/:siteId/projects` | Admin chọn project đã xác minh, optimistic version; không nhận wildcard |
| `GET /api/workspaces/:id/jira-capabilities` | Khả năng theo đúng người gọi và site; không tiết lộ issue của người khác |

Chuẩn hóa 401 phiên; 403 thiếu quyền ATI; 404 cho tài nguyên ATI không được phép biết; 409 version/race; 503 tính năng chưa sẵn sàng. Lỗi Jira upstream map theo category riêng, không trả response/token thô. GET route không chứa token/query bí mật. Thêm rate limit start/callback/invite/decision.

### 7.2. Năm tool bản đầu

| Tool | Input quan trọng | Kiểm soát |
|---|---|---|
| `myjira.list_sites` | query, limit | Chỉ site trong giao workspace và grant cá nhân; kết quả có siteId/cloudId/name/url |
| `myjira.search_projects` | siteId, query, limit | Chỉ project team cho phép và người dùng thấy được |
| `myjira.search_issues` | siteId, projectKey, query, limit | JQL cố định project, escape như adapter hiện tại; chỉ trả issue được Jira cho phép |
| `myjira.create_issue` | siteId, projectKey, summary, description?, issueType? | Grounding project; kiểm CREATE_ISSUES theo project; metadata loại issue; ADF thuần; cần plan approval |
| `myjira.add_comment` | siteId, issueKey, body | Grounding issue theo site; kiểm quyền issue thực và ADD_COMMENTS; kiểm project sau khi issue bị move |

siteId là handle của directory đã được backend xác minh, không là credentialId hoặc URL tùy ý. Mọi ID model chọn đều được đối chiếu context/server. Không cung cấp tool HTTP/JQL/method tùy ý.

Grounding và working memory dùng khóa tổng hợp workspace + cloudId + resource type + provider ID. Hai site có `ATI-12` không phải cùng issue. `$ref` từ issue site A không được dùng như issue thuộc site B chỉ vì key giống nhau. Output có nguồn site/project rõ để hiển thị, phân giải tham chiếu và audit.

## 8. Planner, preview, executor và lịch

**Đề xuất nhiều site trong một plan:** hỗ trợ ngay bản đầu. Mỗi bước Jira xác định site; workspace của conversation không đổi. Chỉ còn một site hợp lệ thì có thể chọn bằng context. Nhiều site khớp tên/project/issue thì hỏi lại, không đoán từ key hoặc chọn site đầu tiên.

Backend bỏ mọi `connections` do model sinh, rồi gắn binding thật trước hash, bao gồm owner ATI, workspaceId, membershipVersion, accountId, identityVersion, grantId, mapping stepId → cloudId/projectId/policyVersion. Binding không chứa token; token refresh không làm đổi nội dung đã được duyệt. Không nhận version từ browser/model như bằng chứng quyền.

Preview/receipt hiện người thao tác, workspace, site/project của từng bước và dịch vụ đích dùng connection nào. Không chỉ hiện chữ “Jira đã kết nối”. Callback trở lại đúng conversation; người dùng bấm gửi lại; không tự thực thi.

Executor kiểm lại binding lúc approve, lúc khởi chạy và trước từng lời gọi có tác động. Quyền thay đổi thì dừng các bước chưa chạy, giữ receipt bước đã xong; không tự thay site/token/connection. Giữ quy tắc hiện có: timeout/mạng/5xx sau khi gửi write có thể là UNKNOWN; không tự retry/replay write không rõ kết quả.

**Lịch:** bản đầu từ chối proposal lịch chứa `myjira`; không cho scheduler gọi adapter thiếu workspace/actor. Trước bật cờ phải kiểm kê, tạm dừng và báo chủ sở hữu các lịch legacy có `jira.*`. Không sửa chuỗi tác vụ rồi âm thầm chạy bằng OAuth mới.

## 9. Cô lập dữ liệu và thu hồi quyền

Kiểm quyền trước lượt đọc đầu tiên, không chỉ trước ghi. Cache adapter/token/directory phải có owner, account/grant, identityVersion, workspace và cloudId/policyVersion theo loại cache; không cache chỉ theo tên dịch vụ hoặc projectKey.

Conversation, gather memory, plan, kết quả, câu trả lời/tóm tắt và nhãn tài nguyên do Jira cung cấp mang source refs. Mỗi lượt mở lịch sử hoặc gửi model phải kiểm lại nguồn; không dùng nguyên transcript cũ để vượt quyền hiện tại. Nếu không thể kiểm do provider lỗi, che/bỏ phần phụ thuộc Jira và báo không xác minh được; không suy ra dữ liệu rỗng là không có kết quả.

Kết quả do model tạo mang tập nguồn của input đã dùng. Kiểm lại version/quyền trước persist và trước publish qua API/SSE; kết quả về muộn sau thu hồi không được ghi/hiện như còn hợp lệ. Không stream trực tiếp token nội dung phụ thuộc Jira khi chưa kiểm kết quả cuối; buffer nội dung, chỉ phát tiến độ không chứa dữ liệu nguồn trong lúc chờ. Mọi đường đọc raw output/plan/history và nhãn nguồn đều đi qua cùng policy, không chỉ component giao diện.

Mất membership workspace chặn toàn bộ API hội thoại thuộc workspace. Mất quyền một issue/project thì không đưa phần nội dung phụ thuộc nguồn đó vào phản hồi/model; nếu không tách được chính xác, che cả message/kế hoạch phụ thuộc. Nội dung người dùng tự nhập không được coi tự động là nguồn provider đã xác minh.

Thu hồi tại ATI dùng version và cùng quy tắc khóa với lời gọi outbound. **Đề xuất:** lấy token trước, sau đó giữ authorization lease/row lock có deadline trong lúc kiểm quyền và gửi request; revocation cập nhật các row tương ứng phải chờ lease kết thúc. Thứ tự khóa cố định, không khóa row rotation token theo cách gây deadlock. Chốt thiết kế SQL ở JIRA-02 và chứng minh bằng hai client PostgreSQL thật trước nối executor.

Giới hạn thực tế: thao tác đã gửi sang Jira có thể hoàn tất trước lúc thu hồi có hiệu lực; không hứa thu hồi đảo ngược thao tác đó. Khi thu hồi ATI commit, không được bắt đầu request mới theo quyền cũ. Quyền native do Jira kiểm ở request thực; ATI không thể làm một transaction nguyên tử xuyên PostgreSQL và Jira.

Không log token/code, không đưa token vào browser/prompt, không theo redirect sang host khác với Authorization. API base cố định `api.atlassian.com`; URL mở ticket lấy từ site đã xác minh. Privacy/guide ghi đúng việc dữ liệu Jira đi qua model provider hiện có, không mặc định đã có chính sách mới cho cả nền tảng.

## 10. Giao diện cần có — đề xuất hành vi

- Admin hệ thống: tạo/archive workspace và chỉ định admin team.
- Người dùng: kết nối danh tính Jira; cấp thêm quyền site; xem tài khoản và trạng thái; kết nối lại/ngắt.
- Gia nhập: mở invite, gửi yêu cầu, theo dõi duyệt ATI và trạng thái quyền Jira riêng biệt.
- Admin team: duyệt thành viên; quản lý invite; liên kết site; chọn project; nhìn thấy lỗi thiếu quyền quản trị Jira khi cấu hình.
- Cockpit: chọn workspace của conversation; hiển thị site rõ trong lookup/preview/receipt; hỏi lại khi không xác định đích.
- Lỗi/mất quyền: phân biệt chưa vào team, thiếu quyền Jira, cần cấp scope, cần reconnect, mạng/provider lỗi và tính năng tắt.

Theo design system Agentic hiện hữu, thanh điều hướng chung FE-12 và trợ năng không đổi hình thức. Kiểm 1440/375, sáng/tối. Không sửa prototypes trong docs để hợp thức hóa app.

## 11. Lộ trình chia việc và phụ thuộc

Đây là phân rã thiết kế đề xuất, chưa phải giao triển khai. Sau duyệt mới sinh task card chính thức theo mẫu repo; mỗi card một nhánh/PR và reviewer độc lập. Không ghi task “xong” chỉ vì merge phần nền.

| Mã dự kiến | Chủ module | Phụ thuộc | Sản phẩm và cổng đạt |
|---|---|---|---|
| JIRA-01 · khả thi provider | Integration, phối hợp chủ dự án cho tài khoản/app thử | Duyệt thiết kế | Kiểm identity không-site, consent thêm site, refresh/reconnect, scope từng endpoint, quyền ADMINISTER; ghi facts và điều còn NOT_RUN. Chưa vượt cổng nếu onboarding không đáp ứng |
| JIRA-02 · contracts | Integration sở hữu tool-schemas; Backend/AI/FE cùng review | 01 | Kiểu workspace/membership/grant/binding/source refs, API errors, 5 tool, grounding tổng hợp, version/lock semantics và flag-off contract; merge contract trước consumer |
| JIRA-03 · workspace và dữ liệu | Backend: db/v3, apps/chat-api | 02 | Migration, repository, admin-only create, bootstrap, invite, pending/decision CAS, scope site/project, audit; SQL integration đạt |
| JIRA-04 · OAuth và token | Backend: apps/chat-api | 01,02; dùng migration phối hợp 03 | Start/callback, identity/scopes/sites, owner binding, rotation đa process/crash/disconnect; HTTP fixture + PG thật đạt |
| JIRA-05 · policy và nguồn | Backend: apps/chat-api | 03,04 | Workspace authorization, native checks, capability directory, cache isolation, history/source revalidation và revocation lease; không leak giữa user/site/team |
| JIRA-06 · adapter HTTP | Integration: tool-adapters | 02; fake boundary thống nhất với 04 | Bearer + cloudId, 5 tool, JQL/ADF/metadata, moved issue, deadlines/rate-limit/UNKNOWN; giữ regression adapter cũ |
| JIRA-07 · planner nhiều site | AI: planner, prompts, evaluations | 02,05,06 | Routing “Jira”, hỏi lại đích, memory/site grounding, không kế thừa dữ liệu bị mất quyền; label bộ đo đăng ký trước |
| JIRA-08 · binding và executor | Backend: executor, apps/chat-api | 03–07 | Server binding trước hash, approve/run/per-step guards, receipt, no legacy fallback, chặn lịch Jira; test đường API → executor thật |
| JIRA-09 · giao diện | Frontend: apps/chat-web | Contract 02; tích hợp 03–08 | Các hành vi mục 10, callback một lần, không auto-send/approve, responsive và browser fixture |
| JIRA-10 · hồi quy/model | AI phụ trách eval; từng owner sửa module của mình | 07–09 | Đo ×3 với model chuẩn, routing/core/services flag-off không đổi, multi-site/multi-user tests, mutations, full check/browser |
| JIRA-11 · nghiệm thu và bật cờ | Backend điều phối; chủ dự án cấp quyền/duyệt live; reviewer độc lập | 01–10 | Hai site thật, tài khoản quyền khác, multi-service, readback sau write, khôi phục lỗi; PR bật cờ chỉ sau mọi gate đạt |

Đường phụ thuộc chính: 01 → 02 → (03 + 04) → (05 + 06) → (07 + 08 + 09) → 10 → 11. Trong cụm vẫn tôn trọng phụ thuộc từng hàng; FE có thể dựng theo contract 02 nhưng không kết luận tích hợp đạt trước backend thật. Agent chỉ sửa module được giao; chỉnh interface qua owner tool-schemas.

Không đưa ngày hoàn thành thiếu căn cứ. Mốc ngừng thêm tính năng 04/11 hiện có không tự thay đổi bởi bản nháp này; chủ dự án quyết định phạm vi bảo vệ sau JIRA-01. Nếu chưa đạt thì giữ cờ tắt, không bỏ kiểm quyền/thu hồi/multi-site để đổi lấy demo xanh.

## 12. Ma trận kiểm thử bắt buộc

| Nhóm | Bằng chứng cần có |
|---|---|
| OAuth | State lặp/hết hạn/nhầm owner, logout giữa flow, 2 callback race, thiếu scope, callback không lộ token, returnTo của người khác/địa chỉ ngoài bị từ chối |
| Onboarding | Account không có site, account đã có một site, thêm site thứ hai; không gắn nhãn ready khi chỉ có identity |
| Membership | Member không tạo workspace; invite không auto-approve; 2 admin duyệt cùng lúc chỉ 1 CAS thắng; pending/rejected/removed không gọi Jira/model với nguồn team |
| Site/project | User A/B scope khác nhau; hai site trùng project/issue key; cùng site trong hai workspace; guessed siteId/projectId bị từ chối; cấu hình ADMINISTER thiếu bị chặn |
| Refresh | Hai process manager + PG thật + HTTP fixture kiểm số exchange và token mới; crash giữa exchange/persist; disconnect/reconnect thắng refresh về muộn; AbortSignal thực |
| Planner | Thiếu đích hỏi lại; grounded đúng composite key; cross-site ref giả fail; prompt injection trong summary/comment không thành chỉ thị; lookup mất quyền không lấy dữ liệu cũ |
| Executor | Binding/hash bị sửa, account đổi, scope/member bị thu hồi sau preview, revoke giữa hai bước, revoke khi request đang chạy; nguồn Jira không lọt qua fallback dùng chung hoặc legacy service test route |
| Transport | Token chỉ đi đúng host, redirect bị chặn, 401/403/404 phân loại đúng, 429/timeout có AbortSignal; ambiguous write không retry; readback theo receipt thật |
| History | Raw history/API, directory, gather memory, model input, plan labels/receipt và bản tóm tắt không trả nguồn mất quyền; một nguồn mất quyền làm che toàn bộ message phụ thuộc nếu cần; model về muộn và SSE delta không vượt guard persist/publish |
| UI/browser | Connect → xin team → duyệt → cấp quyền Jira → gửi lại → preview → duyệt → kết quả; 1440/375 sáng/tối; refresh/reload/tab trễ/đổi user không dùng nhầm connection |
| Regression | Cờ tắt catalog/prompt/routing cũ không đổi; Gmail/MyCalendar/MySheets/Slack foundation đạt; cờ bật chặn `jira.*` legacy và lịch legacy không được tự chuyển |

Mỗi gate quan trọng có mutation cố ý bỏ guard và phải làm test fail: owner binding, pending membership, site/project intersection, workspace namespace, composite grounding, binding trước hash, refresh lock/CAS, stale source filter, legacy fallback, no-auto-send và no-replay-UNKNOWN.

Lệnh dùng khi thi công: `npm run db:migrate:v3`; `npm run test -w @wap/tool-schemas`; `npm run test -w @wap/tool-adapters`; `npm run test -w @wap/chat-api`; `npm run test -w @wap/planner`; `npm run test -w @wap/executor`; `npm run test -w @wap/chat-web`; `npm run check`; `npm run test:browser:v3`. Chỉ chạy với environment sandbox/DB riêng đã kiểm cổng; không nạp `.env` live vào runner hoặc in secret. Theo card cuối cùng cho tham số test có chọn lọc, không gọi suite xanh là bằng chứng live.

Golden set đề xuất tối thiểu 24 câu: một site, chọn trong nhiều site, mơ hồ, cross-site, trùng key, thiếu native quyền, membership pending/removed, reconnect, injection và Jira → dịch vụ khác. Đăng ký label trước provider calls; báo riêng tool/args/site accuracy, clarification accuracy và latency, giữ mọi lỗi thật. Không tự đặt ngưỡng xanh mới để khớp số đo.

## 13. Phát hành và khôi phục

1. Duyệt thiết kế; JIRA-01 chứng minh provider; duyệt contracts và task card trước consumer.
2. Merge từng phần sau cờ tắt, migration thêm mới; giữ dữ liệu legacy. Không đổi CURRENT-STATE/ROADMAP trong PR thi công.
3. Pilot bằng environment riêng, site/project do chủ dự án cho phép, tài khoản cá nhân và model chuẩn. Mỗi write có plan/hash được duyệt và readback đúng site.
4. Trước bật cờ: scan lịch/plan legacy, tạm dừng lịch Jira cũ và báo owner; không có token cá nhân nào được dùng thay ngầm.
5. PR bật cờ chỉ khi CI đúng head xanh, review độc lập đạt, model/browser/live đạt và ngoại lệ nào còn mở được ghi rõ. Chưa đủ hai site thì giữ gate multi-site mở.
6. Rollback bằng tắt cờ, dừng request mới và xử lý lượt đang chạy theo receipt; personal plan cũ không chạy qua legacy adapter. Trước khôi phục Jira chung phải kiểm lại lịch/plan, không tự resume. Không drop bảng/token để rollback code.

## 14. Điểm cần chủ dự án đọc kỹ khi duyệt

- Đề xuất hỗ trợ nhiều site trong cùng plan, chỉ một workspace cho mỗi conversation; thiếu đích thì hỏi lại.
- Đề xuất admin hệ thống chỉ định admin team; admin team cần ADMINISTER Jira khi liên kết site; invite không thay duyệt.
- Đề xuất một account Atlassian/ATI user, token riêng; cùng một native identity không gắn hai người ATI.
- Đề xuất `myjira.*`, cờ tắt mặc định; khi bật thì không dùng Jira chung; không tự di chuyển lịch/kế hoạch.
- Đề xuất không có lịch Jira cá nhân, webhook hoặc tool Jira mới ngoài năm tool nói trên ở bản đầu.
- Workspace hiện chỉ là ranh giới Jira; dịch vụ khác trong workflow vẫn có thể dùng kết nối chung hiện hữu và phải hiển thị trung thực.
- Kết nối danh tính trước khi có site là cổng khả thi chưa chạy, không phải capability đã xác nhận.

## 15. Nguồn và trạng thái bằng chứng

Nguồn chính thức đã đối chiếu 30/10/2026:

- [Atlassian OAuth 3LO](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/): app, identity, grant/site, authorize/token và refresh.
- [Jira OAuth scopes](https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/): scope không thay quyền native.
- [Jira permissions](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/): kiểm quyền theo global/project/issue; dùng đúng context.
- [Zapier Jira connection](https://help.zapier.com/hc/en-us/articles/38815673973133-How-to-get-started-with-Jira-Software-Cloud-on-Zapier), [sharing](https://help.zapier.com/hc/en-us/articles/8496326497037-Share-app-connections-with-members-of-your-Team-or-Enterprise-account): tham khảo UX, không dùng shared connection cho danh tính cá nhân ATI.
- [Pipedream Jira](https://pipedream.com/apps/jira): tham khảo owner/connection/site tách biệt.
- [Claude connectors](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities), [Atlassian MCP controls](https://support.atlassian.com/security-and-access-policies/docs/configure-atlassian-mcp-server-permissions/): tham khảo quyền tổ chức và cá nhân; không coi chính sách MCP là API 3LO của ATI.

Đây là tài liệu kế hoạch; chưa tạo app Atlassian, migration/runtime/UI, token, provider probe, model campaign hay live write. Không dùng kết quả test lịch/Slack/Google trên main làm bằng chứng Jira OAuth đã chạy. Kết quả kiểm tài liệu và builder check nằm trong task/log của phiên.
