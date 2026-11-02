# JIRA-04 · OAuth Danh tính & Token Transport Đa Process Jira

**Trạng thái:** Chưa thi công; task card và kế hoạch chi tiết được lập sau khi JIRA-03 (PR #240) và Telegram (PR #247) đã tích hợp vào `main`. Không bật runtime Jira.
**Nhiệm vụ:** Xây dựng additive migration `0021_jira_oauth_token.sql` (nối tiếp sau `0020_telegram_update_inbox.sql` và `0019_jira_workspaces.sql`), client HTTP Atlassian 3LO OAuth bảo mật (chống rò rỉ secret, chặn redirect, giới hạn body 64KB, cấm override URL ở live, lọc container Jira và fail-closed khi cloudId xung đột), repository OAuth Jira chuyên biệt quản lý danh tính (`jira_accounts`), grant mã hóa AES-256-GCM (`jira_oauth_grants`), snapshot site kèm scopes (`jira_grant_sites`), bảo vệ `findGrantEvidence` của JIRA-03 chỉ chấp nhận grant active, state một lần 10 phút gắn phiên/browser/owner với băm SHA-256 256-bit, quản lý token đa process qua PostgreSQL với ghi nhận ý định refresh bền vững trước HTTP (`refresh_state = 'refreshing'`) không giữ khóa dòng cơ sở dữ liệu qua mạng, worker thứ hai chờ/poll có giới hạn thời gian (không ghi đè intent của worker thứ nhất), cập nhật CAS sau phản hồi bảo đảm Disconnect Wins, chính sách xử lý sự cố crash/timeout chuyển `reconnect_required` chống replay token xoay vòng, ngữ nghĩa tín hiệu hủy `AbortSignal` của caller không làm gián đoạn tiến trình lưu trữ nền, và các endpoint Express `/api/connections/myjira/*` có xác thực chủ sở hữu hội thoại `conversationOwner` theo đúng chuẩn DTO đã duyệt.
**Quyền lực chuẩn tắc:**
- Bổ sung thiết kế tích hợp: [Jira dùng workspace tổ chức chung](../../superpowers/specs/2026-11-02-jira-shared-workspace-amendment.md).
- Thiết kế nền tảng Jira: [Đặc tả Jira cá nhân và workspace ATI](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md) (Mục 5, 6, 7.1, 11, 12).
- Bằng chứng khả thi Provider: [JIRA-01 Provider Facts](../../ai-evidence/JIRA-01-PROVIDER-FACTS.md).
- Hợp đồng kiểu dữ liệu đã MERGE: `packages/tool-schemas/src/myjira-dto.ts`, `myjira-context.ts`, `myjira-policy.ts` (Commit `6c53436`, PR #232).
- Kế hoạch triển khai chi tiết: [JIRA-04 OAuth Token Implementation Plan](../../superpowers/plans/2026-11-02-jira-04-oauth-token.md).
**Vai trò phụ trách:** Backend Engineer (`db/v3`, `apps/chat-api`).
**Phụ thuộc:** JIRA-01 (Provider facts & probe), JIRA-02 (Contracts PR #232), JIRA-03 (Workspaces DB/API PR #240). JIRA-04 cung cấp token transport bảo mật cho JIRA-05 (Policy & native check), JIRA-06 (Adapters), JIRA-08 (Executor), JIRA-09 (UI).
**Nhánh thi công:** `longnguyen005/jira-04-oauth`.

---

## 1. Mục tiêu và phạm vi

### 1.1. Mục tiêu cốt lõi
Triển khai cơ chế xác thực Atlassian OAuth 2.0 (3LO) hai pha theo chuẩn phê duyệt của chủ dự án:
1. **Pha 1 (Identity-Only):** Người dùng kết nối danh tính cá nhân Atlassian (`mode = 'identity'`, xin scope `read:me` và `offline_access`). Xác thực account qua endpoint `/me`, lưu vào `jira_accounts` với khóa danh tính `atlassian_account_id` và trạng thái `status = 'connected'`. Ràng buộc chặt chẽ quan hệ 1:1 giữa tài khoản ATI và tài khoản Atlassian đang active.
2. **Pha 2 (Authorize Sites / Re-consent):** Người dùng cấp quyền truy cập các Jira sites (`mode = 'authorize_sites'`, xin scope `read:me`, `read:jira-work`, `write:jira-work`, `offline_access`). Xác thực danh tính khớp chính xác tài khoản đã kết nối (chặn account-swap), đọc danh sách `accessible-resources`, lọc container Jira hợp lệ (loại bỏ non-Jira container như Confluence), xử lý trùng lặp cloudId (cho phép deduplicate nếu thông tin hoàn toàn giống nhau; bắt buộc fail-closed từ chối nếu cloudId xung đột URL hoặc scopes theo provider facts JIRA-01), và lưu snapshot kèm scopes vào `jira_grant_sites`.
3. **Quản lý Token Đa Process Non-Blocking & Phục hồi sự cố:** Mã hóa token bằng AES-256-GCM qua payload object `{ token: string }`. Xoay vòng refresh token giữa các tiến trình worker theo nguyên tắc không giữ khóa dòng cơ sở dữ liệu qua cuộc gọi mạng:
   - Worker 1 khóa dòng ngắn hạn, ghi nhận ý định refresh bền vững (`refresh_state = 'refreshing'`, `refresh_attempt_id`, `refresh_started_at`) trong một transaction ngắn trước HTTP, commit và giải phóng kết nối DB.
   - Worker 2 chạy đồng thời thấy `refresh_state = 'refreshing'` và thời gian chưa vượt quá timeout thì **tuyệt đối không ghi đè intent hoặc gọi HTTP lặp lại**; worker 2 nhả lock và chờ/poll có giới hạn thời gian cho Worker 1 hoàn thành CAS hoặc reconnect, sau đó lấy token mới.
   - Worker 1 thực hiện gọi mạng tới Atlassian, rồi cập nhật CAS trên `(id, refresh_attempt_id, status = 'active')`.
   - Nếu xảy ra sự cố mạng không xác định hoặc crash tiến trình giữa chừng (vượt quá timeout), intent bị treo tự động chuyển grant sang `reconnect_required` (`CRASH_UNKNOWN_ROTATION`) mà không sử dụng lại token cũ.
   - Thao tác Disconnect luôn thắng (Disconnect Wins) trước mọi refresh đang chạy hoặc về muộn. Tín hiệu hủy `AbortSignal` của caller chỉ hủy lượt chờ của caller đó, không làm gián đoạn tiến trình lưu trữ nền.
4. **Bảo toàn Quyền Workspace JIRA-03:** Trạng thái danh tính `jira_accounts.status` giữ nguyên giá trị `'connected'` và `'disconnected'` theo thiết kế JIRA-03 để không phá vỡ chỉ mục partial unique index và điều kiện gia nhập workspace; trạng thái cần kết nối lại token được quản lý chuẩn xác tại `jira_oauth_grants.status = 'reconnect_required'`. Khi grant bị thu hồi hoặc lỗi token, cập nhật truy vấn `findGrantEvidence` của JIRA-03 chỉ chấp nhận grant active, đảm bảo tính năng site/project bị khóa an toàn (fail-closed).
5. **Bảo mật URL & Zero Secret Leakage:** State được gửi an toàn trong query của Authorization URL; provider callback URL tiếp nhận `code` và `state`. Hệ thống tuyệt đối không echo code, state, access token, refresh token hoặc client secret trong log, response lỗi hoặc dữ liệu lưu trữ công khai; client xóa sạch query params callback sau khi xử lý. Kiểm tra quyền sở hữu hội thoại `returnTo` thông qua `conversationOwner`. Không có backdoor override endpoint Atlassian ở môi trường live. Giữ nguyên cờ tắt `MYJIRA_ENABLED=off` và catalog hiện tại của main; không gọi Jira live trong task.

### 1.2. Phạm vi bao gồm (Scope In)
1. **Additive Migration (`db/v3/0021_jira_oauth_token.sql`):**
   - Đặt sau `0020_telegram_update_inbox.sql` và `0019_jira_workspaces.sql`. Chạy an toàn và idempotent khi migration runner duyệt lại toàn bộ chuỗi migration.
   - Mở rộng ràng buộc `oauth_states_mode_check` thêm các chế độ kết nối Jira: `'connect_jira_identity'` và `'connect_jira_sites'`.
   - Cập nhật `oauth_states_mode_owner_check` bắt buộc `user_id` và `session_id` NOT NULL cho hai mode Jira mới.
   - Cập nhật `oauth_states_return_to_check` hỗ trợ định dạng `/c/<uuid>` cho hai mode Jira mới.
   - Mở rộng bảng `jira_oauth_grants`:
     - Thêm cột `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconnect_required', 'revoked'))`.
     - Thêm cột `status_reason TEXT`.
     - Thêm cột `refresh_attempt_id UUID`.
     - Thêm cột `refresh_started_at TIMESTAMPTZ`.
     - Thêm ràng buộc check cho `refresh_state IN ('idle', 'refreshing', 'failed')`.
     - Thêm chỉ mục `idx_jira_oauth_grants_account ON jira_oauth_grants (account_id)`.
   - Mở rộng bảng `jira_grant_sites`:
     - Thêm cột `scopes TEXT[] NOT NULL DEFAULT '{}'`.
     - Thêm ràng buộc check `product_type = 'jira'`.
   - Giữ nguyên `jira_accounts.status CHECK (status IN ('connected', 'disconnected'))` để bảo toàn schema JIRA-03.

2. **Atlassian OAuth Client (`apps/chat-api/src/services/jira/jira-oauth-client.ts`):**
   - Quản lý cấu hình 3LO: `clientId`, `clientSecret`, `redirectUri`.
   - Ràng buộc môi trường: chế độ `live` nghiêm cấm tuyệt đối mọi override endpoint (luôn dùng `https://auth.atlassian.com` và `https://api.atlassian.com`). Chế độ `fixture` chỉ chấp nhận loopback HTTP `http://127.0.0.1:<port>` cho integration tests.
   - Tạo URL ủy quyền Atlassian:
     - `mode = 'identity'`: scope `read:me offline_access`.
     - `mode = 'authorize_sites'`: scope `read:me read:jira-work write:jira-work offline_access`.
     - Tham số chuẩn: `audience=api.atlassian.com`, `response_type=code`, `prompt=consent`, `state=<state>`. Tuyệt đối không gửi `client_secret` hay tham số Google/PKCE sai lệch lên authorization URL.
   - `exchangeCode(code, signal)`: POST `/oauth/token` trao đổi authorization code lấy cặp access/refresh token.
   - `refreshToken(refreshToken, signal)`: POST `/oauth/token` với `grant_type=refresh_token`.
   - `getProfile(accessToken, signal)`: GET `/me` đọc `account_id` duy nhất từ provider.
   - `getAccessibleResources(accessToken, signal)`: GET `/oauth/token/accessible-resources`, lọc bỏ tài nguyên không phải Jira (chỉ giữ scopes chứa Jira), kiểm tra tính hợp lệ của `cloudId` và URL `https://*.atlassian.net`, loại bỏ trùng lặp nếu giống hệt nhau, **fail-closed nếu phát hiện cùng cloudId nhưng xung đột URL hoặc scopes**.
   - Phòng vệ: Giới hạn kích thước body tối đa 64 KB, cấm forward `Authorization` header qua redirect, chuyển tiếp tín hiệu hủy `AbortSignal` thật tới `fetch`, chuẩn hóa mã lỗi Atlassian (`INVALID_GRANT`, `PROVIDER_AUTH`, `PROVIDER_TIMEOUT`, `PROVIDER_NETWORK`, `PROVIDER_RESPONSE`) và không bao giờ để lộ secret trong callstack/thông điệp lỗi.

3. **Jira OAuth Repository (`apps/chat-api/src/db/repositories/jira-oauth-repo.ts`):**
   - Đóng gói toàn bộ truy vấn dữ liệu tài khoản, grant, và site snapshot:
     - `saveIdentityGrant`: Ghi nhận danh tính trong transaction có khóa chống race condition. Bắt lỗi `ACCOUNT_CHANGED` nếu người dùng ATI cố tình liên kết tài khoản Atlassian khác trong khi tài khoản cũ chưa disconnect; bắt lỗi `ATLASSIAN_ACCOUNT_IN_USE` nếu tài khoản Atlassian này đã được gắn với người dùng ATI khác đang active. Mã hóa token bằng AES-256-GCM bọc trong payload object `{ token: string }`.
     - `saveSitesGrant`: Xác thực tài khoản Atlassian trả về phải khớp đúng `atlassian_account_id` hiện tại của người dùng. Cập nhật grant mới và lưu snapshot các Jira site kèm scopes vào `jira_grant_sites` trong cùng một transaction nguyên tử.
     - `getConnectionStatus`: Tính toán trạng thái kết nối `JiraConnectionState` theo tiêu chuẩn DTO: `'disconnected' | 'identity_connected' | 'scope_required' | 'reconnect_required' | 'connected'`. Map các trường DB sang DTO chuẩn: `cloud_id -> cloudId`, `site_name -> name`, `site_url -> url`, `last_verified_at -> lastVerifiedAt`.
     - `syncSites`: Làm mới snapshot các site được ủy quyền từ provider và cập nhật `last_verified_at`.
     - `disconnect`: Đánh dấu `jira_accounts.status = 'disconnected'`, tăng `identity_version`, thu hồi grant (`status = 'revoked'`), xóa token mã hóa, ghi nhật ký kiểm toán vào `jira_authorization_audit`.
   - Cập nhật `workspace-site-project-repo.ts` trong JIRA-03: `findGrantEvidence` yêu cầu `g.status = 'active'`.

4. **Multi-Process Durable Token Manager (`apps/chat-api/src/services/jira/jira-token-manager.ts`):**
   - Cơ chế xoay vòng token đa tiến trình an toàn qua PostgreSQL:
     - Đọc cache bộ nhớ (ngắn hạn, có tính đến thời gian lệch đồng hồ 60 giây).
     - Khi token hết hạn hoặc `forceRefresh: true`:
       - Transaction 1 (Khóa & ghi nhận ý định): Đọc grant với `FOR UPDATE`. Nếu grant đã có `token_version` mới hơn do worker khác vừa refresh xong thì trả về ngay. Nếu `status === 'revoked'`, ném lỗi auth. Nếu `status === 'reconnect_required'`, ném lỗi auth.
       - Nếu `refresh_state === 'refreshing'`: nếu `refresh_started_at` còn trong hạn `refreshTimeoutMs`, nhả lock, chờ/poll có giới hạn cho Worker 1 CAS; nếu quá hạn, chuyển `reconnect_required`. Nếu `idle`, ghi nhận ý định: `UPDATE jira_oauth_grants SET refresh_state = 'refreshing', refresh_started_at = clock_timestamp(), refresh_attempt_id = $attemptId WHERE id = $grantId`. Commit Transaction 1 và giải phóng kết nối database.
       - Gọi HTTP Atlassian: Gọi `client.refreshToken(oldRefreshToken, refreshTimeoutSignal)` ngoài phạm vi transaction/khóa cơ sở dữ liệu.
       - Transaction 2 (Cập nhật CAS kết quả):
         - Nếu thành công: Cập nhật CAS `UPDATE jira_oauth_grants SET encrypted_access_token = $newAcc, encrypted_refresh_token = $newRef, token_version = token_version + 1, expires_at = $newExp, refresh_state = 'idle', refresh_attempt_id = NULL, status = 'active' WHERE id = $grantId AND refresh_attempt_id = $attemptId AND status = 'active'`. Nếu 0 dòng bị cập nhật (do người dùng đã disconnect trong lúc gọi mạng), Disconnect Wins: token mới bị hủy bỏ ngay.
         - Nếu thất bại vĩnh viễn (400 `invalid_grant` / 401): Cập nhật `status = 'reconnect_required'`, `refresh_state = 'idle'`, xóa token, phát `onReconnectRequired`.
         - Nếu timeout hoặc crash không xác định: Đánh dấu `status = 'reconnect_required'` (`status_reason = 'CRASH_UNKNOWN_ROTATION'`) để ngăn chặn replay token xoay vòng đã bị hủy.
     - Xử lý tín hiệu hủy: Tín hiệu `signal` truyền vào từ caller chỉ ngắt thời gian chờ của caller đó; không hủy lệnh refresh đang chạy chung của tiến trình nền.

5. **Express Connection Routes & Server Wiring (`apps/chat-api/src/routes/connections/myjira.ts`, `apps/chat-api/src/app.ts`, `apps/chat-api/src/server.ts`):**
   - Triển khai đầy đủ router `/api/connections/myjira`:
     - Nhận `conversationOwner?: (conversationId: string) => Promise<string | null>` để kiểm tra quyền sở hữu conversation `returnTo`.
     - `POST /start`: Nhận `{ mode, returnTo }`. Kiểm tra quyền và phiên đăng nhập active. Xác minh `returnTo` qua `conversationOwner`. Sinh 256-bit random state và browser binding. Lưu vào `oauth_states` với TTL 10 phút. Thiết lập httpOnly cookie `ati_jira_browser`. Trả về `{ authUrl }`.
     - `POST /callback`: Nhận `{ code, state }`. Đọc cookie browser. Tiêu thụ state nguyên tử một lần (`consumeState`). Từ chối ngay nếu state hết hạn, sai người, sai phiên, sai browser hoặc đã dùng (replay). Gọi trao đổi code lấy token, đọc profile và/hoặc sites tùy theo mode. Trả về `JiraOAuthCallbackResponse` chuẩn DTO, không bao giờ lộ token ra ngoài.
     - `GET /`: Trả về `JiraConnectionStatusResponse` chứa thông tin tài khoản, trạng thái kết nối, và danh sách site đã snapshot.
     - `POST /sync-sites`: Thực hiện làm mới danh sách site trực tiếp từ access token hiện tại.
     - `DELETE /`: Ngắt kết nối, tăng `identity_version`, thu hồi grant và xóa secret. Trả về `JiraDisconnectResponse`.
   - Wiring trong `createApp`:
     - Bổ sung tùy chọn `jira?: JiraAppOptions` vào `AppOptions`.
     - Bật CORS cho cookie và đường dẫn `/api/connections/myjira`.
     - Giữ nguyên tính bất biến cờ tắt: khi không cấu hình hoặc cờ tắt, route trả về trạng thái `unconfigured` hoặc `503 Service Unavailable`.
   - Wiring trong `server.ts`:
     - Nạp cấu hình từ biến môi trường `JIRA_OAUTH_CLIENT_ID`, `JIRA_OAUTH_CLIENT_SECRET`, `JIRA_OAUTH_REDIRECT_URI`. Khai báo `MYJIRA_ENABLED: boolean` trong `EnvConfig`.

### 1.3. Ngoài phạm vi (Scope Out)
- **JIRA-05:** Tích hợp kiểm tra quyền native Atlassian (`/mypermissions`) cho người dùng thường và quyền quản trị site `ADMINISTER`, capability directory, bộ đệm SSE, re-validation nguồn dữ liệu hội thoại trong quá khứ.
- **JIRA-06:** Bộ chuyển đổi công cụ thực thi HTTP (`packages/tool-adapters/src/jira/` cho 5 tools `myjira.*`).
- **JIRA-07:** AI Planner routing, multi-site grounding prompts, working memory.
- **JIRA-08:** Khóa lease thực thi và executor guards trước khi chạy plan.
- **JIRA-09:** Giao diện người dùng Web React/Zustand.
- Tuyệt đối không chỉnh sửa các package ngoài phạm vi: `packages/tool-schemas`, `packages/tool-adapters`, `packages/planner`, `packages/executor`, `apps/chat-web`.
- Không kích hoạt cờ runtime `MYJIRA_ENABLED`, giữ nguyên catalog và registry hiện tại của main.

---

## 2. Danh mục File phụ trách

| File | Hành động | Mục đích |
|---|---|---|
| `db/v3/0021_jira_oauth_token.sql` | Tạo mới | Additive migration: mở rộng mode Jira trong `oauth_states`, các cột bền vững refresh intent và status trong `jira_oauth_grants`, `scopes` và product_type check trong `jira_grant_sites`, index account_id |
| `apps/chat-api/src/services/jira/jira-oauth-client.ts` | Tạo mới | Client HTTP Atlassian OAuth 3LO: tạo URL consent, exchange code, refresh token, đọc profile `/me`, đọc `accessible-resources`, chặn redirect, giới hạn body 64KB, dedup identical sites và fail-closed khi cloudId xung đột |
| `apps/chat-api/src/db/repositories/jira-oauth-repo.ts` | Tạo mới | Repository lưu trữ tài khoản `jira_accounts`, grant mã hóa AES-256-GCM qua object payload, snapshot site kèm scopes, kiểm tra ràng buộc danh tính 1:1, tính toán connection state |
| `apps/chat-api/src/db/repositories/workspace/workspace-site-project-repo.ts` | Cập nhật | Bảo vệ `findGrantEvidence`: bổ sung điều kiện `g.status = 'active'` để khóa chặt site/project linking khi grant bị revoked hoặc reconnect_required |
| `apps/chat-api/src/services/jira/jira-token-manager.ts` | Tạo mới | Quản lý token đa tiến trình qua PostgreSQL: intent trước HTTP không giữ lock mạng, worker 2 chờ poll (không ghi đè intent), CAS post-HTTP, crash-unknown reconnect_required, disconnect wins, AbortSignal |
| `apps/chat-api/src/routes/connections/myjira.ts` | Tạo mới | Express router cho `/api/connections/myjira`: start, callback, status, sync-sites, disconnect theo chuẩn DTO `packages/tool-schemas`, xác thực `conversationOwner` |
| `apps/chat-api/src/db/repositories/google-auth-repo.ts` | Cập nhật | Bổ sung các kiểu mode Jira `'connect_jira_identity'` và `'connect_jira_sites'` vào `OAuthMode` |
| `apps/chat-api/src/config/env.ts` | Cập nhật | Khai báo interface `JiraOAuthConfig` và cờ `MYJIRA_ENABLED: boolean` trong `EnvConfig` |
| `apps/chat-api/src/app.ts` | Cập nhật | Bổ sung `JiraAppOptions`, đăng ký router `/api/connections/myjira`, truyền `conversationOwner`, cấu hình CORS và cookie path |
| `apps/chat-api/src/server.ts` | Cập nhật | Khởi tạo `JiraOAuthClient`, `JiraOAuthRepo`, `JiraTokenManager` và truyền vào `createApp` |
| `apps/chat-api/tests/helpers/jira-oauth-test-fixture.ts` | Tạo mới | Test helper dựng HTTP mock server chuẩn Atlassian cho unit/integration tests (mã hóa, exchange, refresh, `/me`, sites, timeout/crash emulation, duplicate cloudId tests) |
| `apps/chat-api/tests/db/jira-oauth-migration.test.ts` | Tạo mới | Kiểm thử PostgreSQL thật qua `createIsolatedTestSchema`: tính idempotent của migration 0001–0021, ràng buộc mode Jira trong `oauth_states`, các cột mở rộng của `jira_oauth_grants` và `jira_grant_sites` |
| `apps/chat-api/tests/services/jira-oauth-client.test.ts` | Tạo mới | Kiểm thử client HTTP: tạo auth URL chuẩn, exchange code, refresh, parse profile/sites, dedup identical sites, fail-closed khi cloudId xung đột URL/scope, chặn redirect, body limit 64KB, cấm override live URL |
| `apps/chat-api/tests/db/jira-oauth-repo.test.ts` | Tạo mới | Kiểm thử repository trên PostgreSQL: save identity, save sites snapshot kèm scopes, chống đổi account (`ACCOUNT_CHANGED`), tranh chấp identity (`ATLASSIAN_ACCOUNT_IN_USE`), regression `findGrantEvidence` từ chối grant degraded |
| `apps/chat-api/tests/services/jira-token-manager.test.ts` | Tạo mới | Kiểm thử token manager: 2 worker pools PostgreSQL tranh chấp refresh qua barrier (worker 2 poll chờ, không ghi đè, chỉ 1 HTTP exchange), crash intent chuyển `reconnect_required`, disconnect wins, AbortSignal caller |
| `apps/chat-api/tests/routes/myjira-connection.test.ts` | Tạo mới | Kiểm thử toàn diện API routes: start/callback flow, state replay rejection, session/cookie mismatch rejection, account mismatch on site consent, `returnTo` foreign conversation rejection, sync-sites, disconnect, no secret echo |

---

## 3. Tiêu chí nghiệm thu (Checklist)

- [ ] **Migration Idempotence & Sequential Schema:** Migration `0021_jira_oauth_token.sql` chạy thành công sau `0020_telegram_update_inbox.sql` và `0019_jira_workspaces.sql`. Chạy lặp lại toàn bộ chuỗi migration 0001–0021 nhiều lần trong cùng transaction không phát sinh lỗi.
- [ ] **Dual-Phase OAuth Flow:**
  - Pha 1 (`mode = 'identity'`): Khởi tạo và callback thành công chỉ với scope `read:me` và `offline_access`. Trạng thái kết nối chuyển thành `'identity_connected'`.
  - Pha 2 (`mode = 'authorize_sites'`): Cho phép người dùng đã kết nối danh tính cấp bổ sung quyền truy cập Jira sites với các scope Jira. Snapshot các site hợp lệ kèm scopes được lưu bền vững vào `jira_grant_sites`. Trạng thái chuyển thành `'connected'` (nếu có >= 1 site) hoặc `'scope_required'` (nếu 0 site).
- [ ] **Strict Identity Binding & Anti-Swap:**
  - Một tài khoản ATI chỉ được gắn tối đa 1 Atlassian identity active. Cố gắng kết nối tài khoản Atlassian khác khi đang active bị từ chối với lỗi rõ ràng `ACCOUNT_CHANGED`.
  - Một tài khoản Atlassian active không thể bị chiếm dụng bởi người dùng ATI khác (`ATLASSIAN_ACCOUNT_IN_USE`), bảo vệ bằng chỉ mục unique và transaction lock.
  - Trong luồng cấp quyền site (`authorize_sites`), nếu tài khoản Atlassian trả về khác với tài khoản đã liên kết ở Pha 1, yêu cầu bị từ chối ngay lập tức.
- [ ] **State & Session Security:** State ngẫu nhiên 256-bit băm SHA-256, liên kết chặt chẽ với owner ATI, session ID đang hoạt động, và cookie `ati_jira_browser`. Hạn sử dụng đúng 10 phút. Tiêu thụ một lần duy nhất; callback lặp lại (replay) hoặc dùng sai phiên/browser bị từ chối mã lỗi `JIRA_STATE_INVALID`.
- [ ] **Return-To Authorization:** Tham số `returnTo` kiểm tra quyền sở hữu qua `conversationOwner`; chỉ chấp nhận định dạng `/c/<uuid>` của chính người gọi tạo ra; nếu chỉ định hội thoại của người khác hoặc URL tùy ý, từ chối với mã lỗi `RETURN_TO_INVALID`.
- [ ] **Encrypted Storage:** Access token và refresh token lưu trong cơ sở dữ liệu luôn được bọc trong object payload `{ token: string }` và mã hóa bằng AES-256-GCM qua hàm chuẩn của hệ thống; không bao giờ lưu trữ plaintext token.
- [ ] **Multi-Process Concurrency & Non-Blocking Refresh:** Khi 2 tiến trình worker cùng yêu cầu access token cho một grant đã hết hạn trên PostgreSQL thật, Worker 1 ghi nhận intent và nhả lock DB; Worker 2 thấy intent đang active thì nhả lock và poll chờ Worker 1 (không ghi đè intent hay gọi HTTP lặp lại); đúng 1 cuộc gọi HTTP được thực hiện tới Atlassian.
- [ ] **Durable Refresh Intent & Crash-Unknown Recovery:** Trước khi phát HTTP refresh, tiến trình ghi nhận trạng thái `refreshing` kèm ID và thời gian bắt đầu vào DB. Nếu xảy ra sự cố sập tiến trình hoặc lỗi mạng không xác định kết quả, grant tự động được đánh dấu chuyển sang `reconnect_required` với lý do rõ ràng, ngăn chặn việc sử dụng lại refresh token đã bị vô hiệu hóa.
- [ ] **Disconnect Wins:** Khi người dùng gửi yêu cầu `DELETE /api/connections/myjira`, hệ thống tăng `identity_version`, thu hồi grant, và xóa token. Nếu có một tiến trình refresh đang bay hoặc phản hồi về muộn sau khi ngắt kết nối, kết quả refresh mới bị hủy bỏ ngay lập tức và grant vẫn giữ trạng thái bị thu hồi.
- [ ] **AbortSignal Resilience:** Khi caller hủy request (ngắt kết nối client hoặc timeout caller), tín hiệu hủy ngắt caller nhưng không làm gián đoạn hoặc làm hỏng tiến trình refresh nền đang ghi dữ liệu vào PostgreSQL; caller thứ hai gọi vào vẫn nhận được token mới thành công.
- [ ] **Zero Secret Leakage:** Toàn bộ thông điệp lỗi, log hệ thống, response trả về client, và stack trace tuyệt đối không chứa client secret, access token, refresh token, hoặc authorization code. Query parameters chứa code/state trên callback URL được xóa sau khi xử lý.
- [ ] **JIRA-03 Fail-Closed Site/Project Protection:** Khi grant chuyển sang `reconnect_required` hoặc `revoked`, `findGrantEvidence` từ chối với `GRANT_NOT_FOUND`, bảo đảm không cho phép link site hoặc cấu hình project trên grant degraded.
- [ ] **Flag-Off & Catalog Invariant:** Giữ nguyên cờ tắt `MYJIRA_ENABLED=off` mặc định; không thực hiện bất kỳ cuộc gọi HTTP nào tới API Jira thật trong quá trình kiểm thử; catalog và registry của main giữ nguyên không đổi.

---

## 4. Lệnh kiểm tra dành cho Parent Codex

> **Quy chuẩn môi trường kiểm thử:**
> Toàn bộ kiểm thử chạy trên instance PostgreSQL chuyên dụng cổng `56534` (hoặc CI loopback `5432` trên database `ati_v3` hoặc `ati_jira04`). Không load `.env`. Parent Codex điều phối Git commits và chạy các lệnh kiểm tra thực tế.

### 4.1. Kiểm tra Migration Schema PostgreSQL:
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-oauth-migration.test.ts
```

### 4.2. Kiểm tra Atlassian OAuth HTTP Client & Fixture:
```bash
RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/services/jira-oauth-client.test.ts
```

### 4.3. Kiểm tra Repository Quản lý Grant & Danh tính:
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-oauth-repo.test.ts
```

### 4.4. Kiểm tra Concurrency Đa Process, Crash Recovery & Token Manager:
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/services/jira-token-manager.test.ts
```

### 4.5. Kiểm tra API Routes & HTTP Endpoints:
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/myjira-connection.test.ts
```

### 4.6. Kiểm tra Typecheck và Full Check toàn hệ thống:
```bash
npm run typecheck:v3
DATABASE_URL="$TEST_DATABASE_URL" npm run check
```

---

## 5. Kết quả

*(Phần này được để trống theo quy định. Agent thi công sẽ điền đầy đủ kết quả thực tế, bằng chứng chạy kiểm thử, tỷ lệ bắt đột biến và commit SHA sau khi hoàn thành).*
