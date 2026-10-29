# SLACK-02B · Backend OAuth Đa Workspace, Token Rotation & CAS (Backend)

**Trạng thái:** chờ triển khai  
**Nhánh gợi ý:** `feat/slack-02b-oauth-backend` · **Nền:** `fc12e3fb`  
**Vai trò sở hữu:** Backend Engineer (sở hữu `apps/chat-api/`, `db/v3/` và scripts fixture `scripts/fake-slack-personal.*`)  
**Phụ thuộc:** SLACK-02A (`packages/tool-schemas` đã có các contracts của kết nối)  
**Task cha:** [SLACK-02-personal-connections](SLACK-02-personal-connections.md)  
**Kế hoạch chi tiết:** Tasks 2, 3, 4, 5 trong [Kế hoạch SLACK-02](../../superpowers/plans/2026-10-29-slack-02-personal-connections.md).

---

## 1. Mục tiêu và Phạm vi

Thi công toàn bộ tầng backend phục vụ kết nối Slack cá nhân đa workspace:
- Migration `0014_slack_personal_connections.sql` tạo bảng kết nối riêng với stable row per `(ati_user_id, slack_app_id, workspace_id)`, bảng lưu vết chấp thuận tổ chức và mở rộng `oauth_states`.
- Mở rộng HTTP provider fixture giả lập OAuth v2, code exchange, one-use rotating refresh token và revoke.
- `SlackOAuthClient` bảo mật (confidential web client, không PKCE, `user_scope`, gọi `auth.test`).
- `SlackConnectionRepo` & `SlackTokenManager` với PostgreSQL session advisory lock (`pg_advisory_lock` trên dedicated `PoolClient`) và **durable refresh-attempt marker** đảm bảo an toàn tuyệt đối trước sự cố crash khi dùng refresh token một lần.
- API endpoints Express 5.2.1 `/api/connections/myslack/...` sau cờ `MYSLACK_ENABLED` (mặc định `off`).

---

## 2. Chi Tiết Thực Hiện

### 2.1. Migration Database: `db/v3/0014_slack_personal_connections.sql`
1. Mở rộng `oauth_states`:
   - Thêm mode `'connect_myslack'` vào ràng buộc `oauth_states_mode_check`.
   - `oauth_states_mode_owner_check`: Bắt buộc có cả `user_id` và `session_id`.
   - `oauth_states_return_to_check`: Cho phép `return_to ~ '^/c/[0-9a-f-]{36}$'` đối với `mode = 'connect_myslack'`.
2. Tạo bảng `slack_personal_connections`:
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `ati_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
   - `slack_app_id TEXT NOT NULL`
   - `workspace_id TEXT NOT NULL`
   - `workspace_name TEXT NOT NULL`
   - `slack_user_id TEXT NOT NULL`
   - `slack_user_label TEXT NOT NULL`
   - `scopes TEXT[] NOT NULL`
   - `config TEXT NOT NULL` (Mã hóa AES-256-GCM qua `encryptCredentials`)
   - `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reconnect_required', 'revoked'))`
   - `status_changed_at TIMESTAMPTZ`
   - `identity_version INTEGER NOT NULL DEFAULT 1 CHECK (identity_version > 0)`
   - `token_expires_at TIMESTAMPTZ`
   - `token_rotated_at TIMESTAMPTZ`
   - `refresh_attempt_id UUID` (Durable attempt marker)
   - `refresh_attempt_at TIMESTAMPTZ`
   - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
3. Ràng buộc & Chỉ mục:
   - `ux_slack_personal_user_workspace`: `UNIQUE (ati_user_id, slack_app_id, workspace_id)` -> **Ràng buộc duy nhất toàn cục ổn định**: Mỗi user chỉ có duy nhất 1 dòng ổn định cho mỗi workspace (kể cả khi `reconnect_required` hay `revoked`). Reconnect thực hiện upsert trên dòng này và tăng `identity_version`.
   - `ux_slack_personal_non_revoked_identity`: `UNIQUE (slack_app_id, workspace_id, slack_user_id) WHERE (status <> 'revoked')` -> **Độc quyền danh tính toàn cục**: Không cho phép tài khoản ATI khác kết nối cùng tài khoản Slack trong cùng workspace khi connection cũ chưa `revoked` (kể cả khi đang `reconnect_required`).
4. Tạo bảng `slack_processing_consents` (Mục 4.4, F1):
   - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
   - `workspace_id TEXT NOT NULL UNIQUE`
   - `status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'revoked'))`
   - `policy_version TEXT NOT NULL`
   - `provider_id TEXT NOT NULL`
   - `retention_days INTEGER NOT NULL CHECK (retention_days >= 0)`
   - `authorized_by TEXT NOT NULL`
   - `evidence_ref TEXT NOT NULL`
   - `granted_at TIMESTAMPTZ`
   - `revoked_at TIMESTAMPTZ`

### 2.2. Mở rộng HTTP Provider Fixture (`scripts/fake-slack-personal.mjs`)
- Thêm endpoint `POST /api/oauth.v2.access`:
  - **Code exchange:** Trả về `{ ok: true, app_id, authed_user: { id, scope, access_token: 'xoxp-...', token_type: 'user', refresh_token: 'xoxe-...', expires_in: 43200 }, team: { id, name } }`.
  - **Refresh exchange:** Xử lý `grant_type: 'refresh_token'`. Trả về hình dạng phẳng của User Token: `{ ok: true, token_type: 'user', access_token: 'xoxp-new-...', refresh_token: 'xoxe-new-...', expires_in: 43200, scope, app_id }`.
  - **One-use enforcement:** Hủy token cũ ngay sau 1 lần gọi. Nếu gọi lại bằng refresh token cũ -> trả `{ ok: false, error: 'invalid_grant' }`.
- Thêm endpoint `POST /api/auth.revoke`:
  - Thu hồi token, trả về `{ ok: true, revoked: true }`.

### 2.3. Repository & Quản Lý Token với Crash-Safe Attempt Marker
1. **`SlackConnectionRepo`** (`apps/chat-api/src/db/repositories/slack-connection-repo.ts`):
   - Lưu kết nối với CAS: kiểm tra state hợp lệ trong `oauth_states`, khoá row người dùng `users FOR UPDATE`.
   - Quản lý stable row: Nếu workspace đã từng kết nối, cập nhật chính dòng đó và tăng `identity_version = identity_version + 1`.
   - Nếu Slack user ID bị trùng với một tài khoản ATI khác ở trạng thái non-revoked: ném lỗi `SLACK_IDENTITY_CONFLICT`, không ghi đè và không revoke token của người kia.
2. **`SlackTokenManager`** (`apps/chat-api/src/services/slack/token-manager.ts`):
   - Lấy dedicated client từ pool và acquire Session Advisory Lock:
     `SELECT pg_advisory_lock(hashtext('slack_token_refresh'), hashtext(connectionId))`.
   - Kiểm tra `refresh_attempt_id`: Nếu tồn tại marker chưa hoàn thành từ trước (tiến trình cũ bị crash giữa chừng):
     - Không replay token cũ!
     - Chuyển `status = 'reconnect_required'`, xóa marker, ném lỗi `AUTH_ERROR`.
   - Nếu chưa có attempt:
     - Ghi marker `refresh_attempt_id = randomUUID(), refresh_attempt_at = now()` vào DB trong transaction ngắn và COMMIT. Session advisory lock trên client vẫn được duy trì để chặn các process/request khác.
     - Gọi `client.refresh(refreshToken)`.
     - Xuất bản nguyên tử: `UPDATE ... SET config = newConfig, refresh_attempt_id = NULL WHERE id = connectionId AND refresh_attempt_id = attemptId AND identity_version = currentVersion`.
     - Giữ nguyên `identity_version` khi refresh token.
   - Finally: Giải phóng session advisory lock qua `pg_advisory_unlock` và release client về pool.

### 2.4. Routes & API Endpoints (`apps/chat-api/src/routes/connections/myslack.ts`)
- `POST /start`: Tạo state, gắn cookie `ati_slack_browser`, trả về link authorization với `user_scope`.
- `POST /callback`:
  - Consume state theo đúng stateId của request (cho phép 2 workspace kết nối song song trong 1 session ATI qua 2 state độc lập).
  - Exchange code lấy user token từ `authed_user`.
  - Gọi `auth.test` xác minh danh tính.
  - Lưu vào database. Trả về `{ connectionId, workspaceId, workspaceName, slackUserId, ...(consumed.return_to ? { returnTo: consumed.return_to } : {}) }`.
- `GET /`: Trả về `{ connections: SlackConnectionPublicInfo[] }` với `consentStatus` và `processingReady` (tính toán đầy đủ dựa trên connection active + consent granted + bằng chứng evidenceRef/authorizedBy hợp lệ + provider verified & noTraining).
- `DELETE /:id`:
  - Ngắt kết nối cục bộ trước: đặt `status = 'revoked'`, tăng `identity_version`, xóa token trong config.
  - Gọi `auth.revoke` trong background; không bao giờ gọi `apps.uninstall`.
- `POST /api/admin/connections/myslack/:workspaceId/consent`:
  - Route tin cậy dành cho Quản trị viên / Operator cấp phép xử lý dữ liệu (yêu cầu session admin `role === 'admin'`).

---

## 3. Các Bài Kiểm Thử Concurrency & Race Cases Bắt Buộc

1. **Browser Cookie CSRF & Session Tamper:**
   - Thiếu hoặc sai cookie `ati_slack_browser` -> từ chối `SLACK_STATE_INVALID`.
   - State thuộc session hoặc user khác -> từ chối, không consume.
2. **Child-Process Crash Simulation (One-Use Refresh Safety):**
   - Tạo kết nối xoay token có thời hạn.
   - Spawn child-process thực hiện refresh; HTTP provider nhận request và ghi nhận token cũ đã dùng; child process bị terminate (`process.kill('SIGKILL')`) TRƯỚC khi commit kết quả vào DB.
   - Tiến trình chính khởi tạo lại manager: kiểm tra thấy `refresh_attempt_id` treo, đánh dấu `reconnect_required`, và **chứng minh không có cuộc gọi HTTP thứ hai** nào được gửi tới provider.
3. **Concurrent Callback (Two Workspaces vs Duplicate State):**
   - Hai request callback với 2 state khác nhau cho 2 workspace khác nhau trong cùng 1 session ATI -> cả hai đều thành công.
   - Hai request callback trùng 1 state -> đúng 1 request thành công, request thứ hai trả `SLACK_STATE_INVALID`.
4. **Stale Callback Same-Workspace Race:**
   - Callback cũ mang generation cũ không được đè lên connection đã được cập nhật bởi callback mới hơn.
5. **Identity Exclusivity Conflict:**
   - User A đã kết nối workspace T, Slack user U.
   - User B thử kết nối cùng workspace T, Slack user U -> User B bị từ chối `SLACK_IDENTITY_CONFLICT`, token của User A vẫn an toàn và không bị revoke.
6. **Disconnect Race & Shared Installation:**
   - Tiến trình gọi disconnect trong lúc refresh đang chạy -> Disconnect thành công, kết nối trở thành `revoked`, refresh bị bỏ qua và không làm hồi sinh kết nối.
   - User A ngắt kết nối không làm gián đoạn User B trong cùng workspace.
7. **Secret Redaction:**
   - Mọi log hệ thống, response lỗi và body trả về không chứa access token, refresh token hay client secret.

---

## 4. Tiêu Chí Nghiệm Thu
- [ ] Migration `0014_slack_personal_connections.sql` chạy idempotent, tương thích ngược 0001–0013.
- [ ] Tất cả các test trong `apps/chat-api/tests/db/`, `tests/services/`, `tests/routes/` đều PASS trên PostgreSQL 16 thật.
- [ ] Test crash-safety chứng minh không bao giờ gửi lại refresh token đã bị tiêu thụ sau crash.
- [ ] Không rò rỉ token, client secret hay body trong log/error.
- [ ] Khi `MYSLACK_ENABLED=off`, `/api/health` không có `myslackEnabled`, mọi route `/api/connections/myslack` trả 503.
- [ ] `npm run typecheck` đạt exit code 0.
