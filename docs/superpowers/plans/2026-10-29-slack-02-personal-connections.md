# Slack Personal Multi-Workspace OAuth & Token Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Triển khai hạ tầng xác thực OAuth cá nhân Slack đa workspace (Free/Pro), quản lý xoay token an toàn tuyệt đối trước sự cố crash tiến trình (crash-safe one-use refresh token), so khớp CAS trên database PostgreSQL, bảo vệ danh tính độc quyền và thiết lập ranh giới chấp thuận xử lý dữ liệu của tổ chức (F1).  
**Architecture:** 
- Tách biệt hoàn toàn khỏi bảng `service_credentials` cũ (vốn giới hạn 1 user : 1 service) bằng bảng chuyên dụng `slack_personal_connections` (hỗ trợ N workspace cho 1 tài khoản ATI) và bảng `slack_processing_consents` (lưu vết quyền tổ chức).
- Giữ nguyên Confidential Web Client với `user_scope`, không PKCE; xác thực danh tính sau callback bắt buộc qua `auth.test`.
- Quản lý xoay token dùng một lần qua PostgreSQL Transaction Advisory Lock kết hợp **durable refresh-attempt marker** ghi nhận vào database TRƯỚC KHI phát request ra ngoài, đảm bảo không bao giờ phát lại refresh token cũ sau crash.
- Giao diện Settings hiển thị danh mục nhiều workspace độc lập trong mục "Của riêng bạn".  
**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.8, Express 4, PostgreSQL 16 (với `pg.Pool`), Vitest 3, React 19, Tailwind CSS.  
**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md) (mục 4, 8, 9, 10).  
**Task Cards:** [SLACK-02 Parent Card](../../handoff/tasks/SLACK-02-personal-connections.md), [SLACK-02A (Contracts)](../../handoff/tasks/SLACK-02A-connection-contracts.md), [SLACK-02B (Backend)](../../handoff/tasks/SLACK-02B-oauth-backend.md), [SLACK-02C (Frontend)](../../handoff/tasks/SLACK-02C-connection-ui.md).  
**Status:** Kế hoạch sẵn sàng thực thi theo quy chuẩn TDD Red-Green-Refactor.

---

## Global Constraints & Architectural Rules

1. **Phạm vi Pilot (Free/Pro Scope):** Giới hạn ở workspace Free và Pro; các tính năng đặc thù Enterprise Grid (như org-level installation) thuộc backlog tương lai, không mở rộng trong SLACK-02.
2. **Độc quyền Danh tính Toàn Cục (Global Identity Exclusivity):** Một tài khoản Slack `(slack_app_id, workspace_id, slack_user_id)` chỉ được gắn với duy nhất 1 tài khoản ATI khi ở trạng thái non-revoked (`WHERE status <> 'revoked'`). Ngay cả khi connection cũ đang ở `reconnect_required`, tài khoản ATI khác cũng không thể kết nối đè.
3. **An toàn Refresh Token Dùng Một Lần (One-Use Rotation Safety):**
   - Refresh token của Slack xoay nguyên tử: mỗi lần gọi `grant_type: 'refresh_token'` sẽ tiêu thụ vĩnh viễn refresh token cũ và trả về cặp token mới.
   - Bắt buộc ghi `refresh_attempt_id` vào database trước khi gọi HTTP. Sau sự cố sập tiến trình (crash), tiến trình tiếp theo thấy attempt chưa hoàn thành thì chuyển sang `reconnect_required`, tuyệt đối không replay token cũ.
   - Refresh thành công cập nhật token mới nhưng **giữ nguyên `identity_version`**.
4. **Phân Biệt Hình Dạng Token (Exchange vs Refresh):**
   - Code exchange: User Token nằm trong `authed_user.access_token` (`xoxp-`), không dùng top-level bot token.
   - Refresh exchange: User refresh response có hình dạng phẳng (`token_type: 'user'`, `access_token`, `refresh_token`, `expires_in`).
5. **Ngắt Kết Nối & Thu Hồi Token (Disconnect Semantics):**
   - Ngắt kết nối cục bộ trước (`status = 'revoked'`, tăng `identity_version`, scrub tokens), sau đó gọi `auth.revoke` thu hồi riêng user token đó trong background; **tuyệt đối không gọi `apps.uninstall`**.
   - Ngắt kết nối của người này không ảnh hưởng đến người khác trong cùng workspace. Xung đột danh tính không được thu hồi token của người đang sở hữu hợp lệ.
6. **Ranh Giới Chấp Thuận Dữ Liệu (F1 Policy Boundary):**
   - Phải do Quản trị viên / Operator xác minh bằng chứng và cấp phép (`slack_processing_consents`), không cho phép người dùng thường tự cấp qua checkbox.
   - Mất chấp thuận lập tức chặn đưa dữ liệu vào model qua helper thuần `decideSlackModelUse`.
7. **Bảo Tồn Baseline Hiện Hữu:**
   - Chỉ thêm cờ `MYSLACK_ENABLED` (mặc định `off`).
   - `ALL_TOOLS` và `SERVICE_REGISTRY` tuyệt đối không thêm `myslack` trong SLACK-02 (dành cho SLACK-03).

---

## File Structure & Module Ownership

| File | Module Ownership | Trách Nhiệm Kỹ Thuật |
|---|---|---|
| `packages/tool-schemas/src/myslack-connection.ts` | Integration / AI | Interface DTOs cho connection, consent và public metadata |
| `packages/tool-schemas/src/index.ts` | Integration / AI | Export public contracts, bảo toàn catalog không có myslack |
| `packages/tool-schemas/tests/myslack-connection.test.ts` | Integration / AI | Test kiểm tra contract bất biến và validation |
| `db/v3/0014_slack_personal_connections.sql` | Backend | Migration idempotent: mở rộng `oauth_states`, tạo 2 bảng mới và unique index |
| `scripts/fake-slack-personal.mjs` | Backend / Integration | Provider HTTP fixture: hỗ trợ `oauth.v2.access` (code & refresh) và `auth.revoke` |
| `scripts/fake-slack-personal.test.mjs` | Backend / Integration | Test kiểm chứng hành vi provider giả lập |
| `apps/chat-api/src/db/repositories/slack-connection-repo.ts` | Backend | Quản lý kết nối đa workspace, CAS, atomic update và exclusive identity |
| `apps/chat-api/src/db/repositories/slack-consent-repo.ts` | Backend | Quản lý bằng chứng chấp thuận tổ chức |
| `apps/chat-api/src/services/slack/oauth-client.ts` | Backend | Confidential HTTP client cho Slack: `exchangeCode`, `refresh`, `authTest`, `revoke` |
| `apps/chat-api/src/services/slack/token-manager.ts` | Backend | Quản lý token, crash-safe attempt marker, transaction advisory lock |
| `apps/chat-api/src/routes/connections/myslack.ts` | Backend | Express routes: `start`, `callback`, `list`, `disconnect`, `consent` |
| `apps/chat-api/src/config/env.ts` | Backend | Khai báo và validate `MYSLACK_ENABLED`, client credentials, endpoint overrides |
| `apps/chat-api/src/app.ts`, `services-routes.ts` | Backend | Gắn routes khi cờ bật, thêm metadata vào `/api/services` |
| `apps/chat-api/tests/db/slack-connection-repo.test.ts` | Backend | Test concurrency PostgreSQL: CAS callback, crash simulation, identity conflict |
| `apps/chat-api/tests/services/slack-token-manager.test.ts`| Backend | Test serial refresh, crash recovery và timeout |
| `apps/chat-api/tests/routes/myslack-routes.test.ts` | Backend | Test HTTP routes, CSRF cookie, returnTo, error handling |
| `apps/chat-web/src/pages/Settings/PersonalMySlack.tsx` | Frontend | Component UI danh sách workspace cá nhân trong mục "Của riêng bạn" |
| `apps/chat-web/src/views/MySlackCallbackView.tsx` | Frontend | View xử lý callback OAuth, thông báo lỗi và chuyển hướng |
| `apps/chat-web/src/services/myslack-connection.ts` | Frontend | Helpers giao tiếp API kết nối Slack |
| `apps/chat-web/src/hooks/use-myslack-enabled.ts` | Frontend | Hook kiểm tra cờ `MYSLACK_ENABLED` từ runtime |
| `apps/chat-web/src/routes.ts`, `api-client.ts`, `App.tsx` | Frontend | Tích hợp route `/connections/myslack/callback` và API client methods |
| `apps/chat-web/tests/myslack-ui.test.tsx` | Frontend | Unit test UI: danh sách workspace, nút kết nối, modal ngắt kết nối |
| `apps/chat-web/tests/myslack-callback.test.tsx` | Frontend | Unit test Callback View: redirect và hiển thị lỗi |

---

## Detailed Task Breakdown

### Task 1: Schema Contracts cho Kết Nối & Chấp Thuận (@wap/tool-schemas)

**Files:**
- Create: `packages/tool-schemas/src/myslack-connection.ts`
- Create: `packages/tool-schemas/tests/myslack-connection.test.ts`
- Modify: `packages/tool-schemas/src/index.ts`

**Interfaces:**
```ts
export type SlackConnectionStatus = 'active' | 'reconnect_required' | 'revoked';
export type SlackConsentStatus = 'pending' | 'granted' | 'revoked';

export interface SlackConnectionPublicInfo {
  id: string;
  workspaceId: string;
  workspaceName: string;
  slackUserId: string;
  slackUserLabel: string;
  status: SlackConnectionStatus;
  identityVersion: number;
  scopes: string[];
  connectedAt: string;
  consentStatus: SlackConsentStatus;
  processingReady: boolean;
}

export interface SlackStartConnectionResponse { url: string; }
export interface SlackCallbackResult {
  connectionId: string;
  workspaceId: string;
  workspaceName: string;
  slackUserId: string;
  returnTo?: string;
}

export function validateSlackConnectionPublicInfo(value: unknown): SlackConnectionPublicInfo;
```

- [ ] **Step 1 (Test RED):** Viết unit test trong `packages/tool-schemas/tests/myslack-connection.test.ts` kiểm tra tính bất biến, validation hợp lệ/không hợp lệ và xác minh `ALL_TOOLS`/`SERVICE_REGISTRY` không chứa `myslack`.
- [ ] **Step 2:** Chạy test xác nhận lỗi đỏ:
  ```sh
  npm test -w @wap/tool-schemas -- tests/myslack-connection.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt `myslack-connection.ts` và export từ `packages/tool-schemas/src/index.ts`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w @wap/tool-schemas -- tests/myslack-connection.test.ts
  npm run check:types
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add packages/tool-schemas/
  git commit -m "feat(slack): add personal connection schema contracts"
  ```

---

### Task 2: Database Migration 0014 & Repositories (PostgreSQL)

**Files:**
- Create: `db/v3/0014_slack_personal_connections.sql`
- Create: `apps/chat-api/src/db/repositories/slack-connection-repo.ts`
- Create: `apps/chat-api/src/db/repositories/slack-consent-repo.ts`
- Create: `apps/chat-api/tests/db/slack-migration.test.ts`
- Create: `apps/chat-api/tests/db/slack-connection-repo.test.ts`

**Key DB Signatures & Constraints:**
- `oauth_states_mode_check`: Thêm `'connect_myslack'`.
- `slack_personal_connections`: Có `refresh_attempt_id UUID`, `refresh_attempt_at TIMESTAMPTZ`, `identity_version INTEGER DEFAULT 1`.
- `ux_slack_personal_active_user_workspace`: `UNIQUE (ati_user_id, slack_app_id, workspace_id) WHERE (status = 'active')`.
- `ux_slack_personal_non_revoked_identity`: `UNIQUE (slack_app_id, workspace_id, slack_user_id) WHERE (status <> 'revoked')`.
- `slack_processing_consents`: `(workspace_id UNIQUE, status, policy_version, provider_id, retention_days, authorized_by, evidence_ref)`.

- [ ] **Step 1 (Test RED):** Viết test migration và test repository kiểm tra:
  - Ràng buộc mode `connect_myslack` trong `oauth_states`.
  - Kết nối nhiều workspace khác nhau cho cùng một ATI user.
  - Từ chối kết nối chéo tài khoản khi cùng 1 Slack user ID trong workspace (`SLACK_IDENTITY_CONFLICT`), kể cả khi connection cũ đang ở `reconnect_required`.
  - Disconnect đổi `status = 'revoked'`, tăng `identity_version`.
- [ ] **Step 2:** Chạy test xác nhận lỗi:
  ```sh
  npm test -w apps/chat-api -- tests/db/slack-connection-repo.test.ts tests/db/slack-migration.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Viết migration `0014_slack_personal_connections.sql` và thi công `SlackConnectionRepo`, `SlackConsentRepo`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh trên PostgreSQL thật:
  ```sh
  npm test -w apps/chat-api -- tests/db/slack-connection-repo.test.ts tests/db/slack-migration.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add db/v3/0014_slack_personal_connections.sql apps/chat-api/src/db/repositories/ apps/chat-api/tests/db/
  git commit -m "feat(slack): add personal connection database migration and repository"
  ```

---

### Task 3: Mở Rộng HTTP Provider Fixture (`scripts/fake-slack-personal.mjs`)

**Files:**
- Modify: `scripts/fake-slack-personal.mjs`
- Modify: `scripts/fake-slack-personal.test.mjs`

**Behavior:**
- Bổ sung `POST /api/oauth.v2.access`:
  - `grant_type === 'authorization_code'`: Trả về `{ ok: true, app_id, authed_user: { id, scope, access_token: 'xoxp-...', token_type: 'user', refresh_token: 'xoxe-...', expires_in: 43200 }, team: { id, name } }`.
  - `grant_type === 'refresh_token'`:
    - Nếu refresh token đã bị tiêu thụ hoặc sai: trả về `{ ok: false, error: 'invalid_grant' }`.
    - Hủy refresh token cũ ngay lập tức (one-use enforcement).
    - Trả về hình dạng phẳng của User Refresh: `{ ok: true, token_type: 'user', access_token: 'xoxp-new-...', refresh_token: 'xoxe-new-...', expires_in: 43200, scope: '...', app_id: '...' }`.
- Bổ sung `POST /api/auth.revoke`: Thu hồi token, trả về `{ ok: true, revoked: true }`.

- [ ] **Step 1 (Test RED):** Thêm test case vào `scripts/fake-slack-personal.test.mjs` kiểm tra exchange code, refresh token một lần, reject khi tái sử dụng refresh token cũ và token revoke.
- [ ] **Step 2:** Chạy test xác nhận đỏ:
  ```sh
  node --test scripts/fake-slack-personal.test.mjs
  ```
- [ ] **Step 3 (Implement GREEN):** Thêm router handling cho `oauth.v2.access` và `auth.revoke` vào `scripts/fake-slack-personal.mjs`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  node --test scripts/fake-slack-personal.test.mjs
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add scripts/fake-slack-personal.mjs scripts/fake-slack-personal.test.mjs
  git commit -m "test(slack): add oauth and rotation simulation to fake slack fixture"
  ```

---

### Task 4: Backend OAuth Client & Token Manager Crash-Safe

**Files:**
- Create: `apps/chat-api/src/services/slack/oauth-client.ts`
- Create: `apps/chat-api/src/services/slack/token-manager.ts`
- Create: `apps/chat-api/tests/services/slack-oauth-client.test.ts`
- Create: `apps/chat-api/tests/services/slack-token-manager.test.ts`

**Crash Safety Protocol:**
1. Transaction Advisory Lock trên `connectionId`.
2. Kiểm tra `refresh_attempt_id` trong DB. Nếu tồn tại attempt marker từ trước (crash giữa chừng):
   - Đánh dấu `reconnect_required`, xóa marker, trả về `AUTH_ERROR`.
   - **Tuyệt đối không replay refresh token cũ**.
3. Nếu chưa có attempt:
   - Ghi `attemptId = randomUUID()` vào `refresh_attempt_id` trong DB.
   - Gọi HTTP `client.refresh(refreshToken)`.
   - Cập nhật DB nguyên tử: so sánh `refresh_attempt_id` và `identity_version`.
   - Giữ nguyên `identity_version`.
4. Gọi `auth.test` sau code exchange xác minh owner/team.

- [ ] **Step 1 (Test RED):** Viết test trong `tests/services/` bao gồm:
  - Code exchange lấy đúng `authed_user.access_token` và gọi `auth.test`.
  - Serial refresh 5 requests song song chỉ tạo 1 HTTP call.
  - **Child-process crash test**: Spawn tiến trình con, terminate tiến trình ngay sau khi HTTP provider commit refresh, tiến trình sau khởi động phát hiện attempt marker, chuyển sang `reconnect_required` và chứng minh không gửi HTTP request thứ hai.
- [ ] **Step 2:** Chạy test xác nhận đỏ:
  ```sh
  npm test -w apps/chat-api -- tests/services/slack-token-manager.test.ts tests/services/slack-oauth-client.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt `SlackOAuthClient` và `SlackTokenManager`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w apps/chat-api -- tests/services/slack-token-manager.test.ts tests/services/slack-oauth-client.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add apps/chat-api/src/services/slack/ apps/chat-api/tests/services/
  git commit -m "feat(slack): implement confidential oauth client and serial token manager"
  ```

---

### Task 5: Backend Routes & Runtime Configuration

**Files:**
- Create: `apps/chat-api/src/routes/connections/myslack.ts`
- Create: `apps/chat-api/tests/routes/myslack-routes.test.ts`
- Modify: `apps/chat-api/src/config/env.ts`
- Modify: `apps/chat-api/src/app.ts`
- Modify: `apps/chat-api/src/routes/services-routes.ts`

**Routes:**
- `POST /api/connections/myslack/start`: Tạo state, gắn cookie `ati_slack_browser`, trả `{ url }`.
- `POST /api/connections/myslack/callback`: Consume state, exchange token, gọi `auth.test`, lưu connection, trả `{ connectionId, workspaceId, workspaceName, returnTo }`.
  - CAS per state: Hai state khác nhau cho 2 workspace khác nhau trong cùng session ATI đều kết nối thành công.
- `GET /api/connections/myslack`: Danh sách kết nối của user kèm `consentStatus` và `processingReady`.
- `DELETE /api/connections/myslack/:id`: Ngắt kết nối cục bộ (`status = 'revoked'`, tăng `identity_version`), sau đó gọi `auth.revoke` background. Không gọi `apps.uninstall`.
- `POST /api/admin/connections/myslack/:workspaceId/consent`: Đặt quyền chấp thuận tổ chức (yêu cầu quyền admin).
- Cờ: `MYSLACK_ENABLED` (mặc định `'off'`). Khi tắt, routes trả 503, `/api/health` không có `myslackEnabled`.

- [ ] **Step 1 (Test RED):** Viết test routes:
  - Start, callback 2 workspace đồng thời, callback duplicate state trả 400.
  - Ngắt kết nối A không ảnh hưởng B trong cùng workspace.
  - Cờ tắt trả 503.
- [ ] **Step 2:** Chạy test xác nhận đỏ:
  ```sh
  npm test -w apps/chat-api -- tests/routes/myslack-routes.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt `myslack.ts`, cấu hình `env.ts`, gắn router trong `app.ts` và tích hợp `services-routes.ts`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w apps/chat-api -- tests/routes/myslack-routes.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add apps/chat-api/src/routes/connections/myslack.ts apps/chat-api/src/config/env.ts apps/chat-api/src/app.ts apps/chat-api/src/routes/services-routes.ts apps/chat-api/tests/routes/
  git commit -m "feat(slack): add personal connection routes and configuration flags"
  ```

---

### Task 6: Frontend Settings UI & Callback View (apps/chat-web)

**Files:**
- Create: `apps/chat-web/src/pages/Settings/PersonalMySlack.tsx`
- Create: `apps/chat-web/src/views/MySlackCallbackView.tsx`
- Create: `apps/chat-web/src/services/myslack-connection.ts`
- Create: `apps/chat-web/src/hooks/use-myslack-enabled.ts`
- Create: `apps/chat-web/tests/myslack-ui.test.tsx`
- Create: `apps/chat-web/tests/myslack-callback.test.tsx`
- Modify: `apps/chat-web/src/pages/Settings/SettingsPage.tsx`
- Modify: `apps/chat-web/src/routes.ts`
- Modify: `apps/chat-web/src/types.ts`
- Modify: `apps/chat-web/src/services/api-client.ts`
- Modify: `apps/chat-web/src/App.tsx`
- Modify: `scripts/test-v3-browser.mjs` (bổ sung test group cho Slack callback & Settings, bảo toàn các group cũ)

**UI Flow:**
- Settings mục "Của riêng bạn" hiển thị danh sách các workspace đã kết nối.
- Mỗi workspace có tên, logo, tài khoản Slack, badge trạng thái (Đã kết nối, Chờ cho phép xử lý, Cần kết nối lại) và nút Ngắt kết nối (kèm modal CockpitDialog).
- Nút "Kết nối Workspace Slack" để thêm workspace mới.
- Trang Callback hiển thị trạng thái đang kết nối, chuyển hướng về `returnTo` hoặc `/settings#myslack`.

- [ ] **Step 1 (Test RED):** Viết unit tests cho `PersonalMySlack` và `MySlackCallbackView`.
- [ ] **Step 2:** Chạy test xác nhận đỏ:
  ```sh
  npm test -w apps/chat-web -- tests/myslack-ui.test.tsx tests/myslack-callback.test.tsx
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt các components, services, hook và cập nhật `SettingsPage.tsx`, `App.tsx`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w apps/chat-web -- tests/myslack-ui.test.tsx tests/myslack-callback.test.tsx
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add apps/chat-web/ scripts/test-v3-browser.mjs
  git commit -m "feat(slack): add multi-workspace settings and callback view"
  ```

---

## Verification & Operational Gates

Trước khi tuyên bố hoàn tất SLACK-02:
1. Chạy toàn bộ kiểm tra hệ thống:
   ```sh
   npm run check
   ```
   *Yêu cầu:* 2.558+ tests PASS, typecheck PASS, build PASS, exit code 0.
2. Kiểm tra Browser Tests:
   ```sh
   node scripts/test-v3-browser.mjs
   ```
   *Yêu cầu:* Toàn bộ các kịch bản trình duyệt trên 1440px và 375px đều đạt.
3. Không bật cờ `MYSLACK_ENABLED=on` trong production hoặc file cấu hình commit.
4. Mọi task con được review độc lập trước khi merge.
