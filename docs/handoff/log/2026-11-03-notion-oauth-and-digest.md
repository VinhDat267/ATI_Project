# Bàn giao: Hoàn thiện Notion OAuth 1-Click, Multi-Workspace Scope & Scheduled AI Auto-Digest (`notion_digest`)

- **Ngày:** 03/11/2026 (Asia/Ho_Chi_Minh)
- **Nhánh:** `fix/migration-rerun-idempotency`
- **Phạm vi:** Hoàn thiện toàn trình Notion OAuth 2.0 (`2026-03-11`) cá nhân & đa workspace, quản lý phạm vi Database (bao gồm dán link/UUID Notion trực tiếp), tích hợp Planner + `plan_hash` + `AdapterFactory`, giao diện OAuth 1-Click trên `chat-web`, và Scheduled AI Auto-Digest (`notion_digest` + nguồn `notion` cho `telegram_digest`).

## 1. Các hạng mục đã hoàn thành

### Task 1: Database Migration `0020_notion_oauth_and_digest.sql` & `NotionConnectionRepo`
- Tạo migration [`db/v3/0020_notion_oauth_and_digest.sql`](../../../db/v3/0020_notion_oauth_and_digest.sql) (đồng bộ idempotency cho chuỗi `0009`..`0019`):
  - Mở rộng `oauth_states_mode_check` và `oauth_states_return_to_check` thêm `'connect_notion'`.
  - Tạo bảng `user_notion_connections` hỗ trợ đa workspace trên mỗi người dùng (`UNIQUE (user_id, workspace_id)`, partial unique index `idx_user_notion_connections_active_user` đảm bảo tối đa 1 workspace active mặc định cho mỗi user, `identity_version`, `selected_databases` JSONB 1–20 database).
  - Mở rộng `schedules_kind_check` thêm `'notion_digest'`.
- Tạo [`apps/chat-api/src/db/repositories/notion-connection-repo.ts`](../../../apps/chat-api/src/db/repositories/notion-connection-repo.ts) với kiểm soát đồng thời CAS (`expectedIdentityVersion`), chống trộm danh tính chéo user (`NotionConflictError`), và vô hiệu hóa callback in-flight khi ngắt kết nối.

### Task 2: Config, `NotionOAuthClient`, `NotionTokenManager` & Routes (`/api/connections/notion`, `/api/connections/mynotion`)
- Tạo [`apps/chat-api/src/config/notion-env.ts`](../../../apps/chat-api/src/config/notion-env.ts) và tích hợp vào [`apps/chat-api/src/config/env.ts`](../../../apps/chat-api/src/config/env.ts).
- Tạo [`apps/chat-api/src/services/notion/oauth-client.ts`](../../../apps/chat-api/src/services/notion/oauth-client.ts) (Basic Auth `client_id:client_secret`, header `Notion-Version: 2026-03-11`, `exchangeCode`, `refreshAccessToken`, `listCandidateDatabases`, `verifyDatabase`, `checkConnection`, `extractNotionDatabaseId` hỗ trợ cả UUID có dấu gạch ngang, chuỗi 32-hex và URL Notion).
- Tạo [`apps/chat-api/src/services/notion/token-manager.ts`](../../../apps/chat-api/src/services/notion/token-manager.ts) tự động xoay token khi gặp `401` (nếu có `refresh_token`) và chuyển sang `reconnect_required` khi token bị thu hồi.
- Tạo [`apps/chat-api/src/routes/connections/notion.ts`](../../../apps/chat-api/src/routes/connections/notion.ts) và mount tại `/api/connections/notion` cùng alias `/api/connections/mynotion` trong [`apps/chat-api/src/app.ts`](../../../apps/chat-api/src/app.ts).

### Task 3: Tool Catalog, `ExecutionPlan.connections.notion` & `AdapterFactory`
- Cập nhật [`apps/chat-api/src/config/gmail-tools-runtime.ts`](../../../apps/chat-api/src/config/gmail-tools-runtime.ts) và [`apps/chat-api/src/services/registered-services.ts`](../../../apps/chat-api/src/services/registered-services.ts): chỉ mở `NOTION_TOOLS` khi kết nối Notion cá nhân đạt `status === 'connected'` (đã chọn 1–20 database) hoặc có shared credential hợp lệ.
- Cập nhật [`apps/chat-api/src/services/chat-service.ts`](../../../apps/chat-api/src/services/chat-service.ts) và [`apps/chat-api/src/services/resource-labels.ts`](../../../apps/chat-api/src/services/resource-labels.ts): tự động phân giải tên database tự nhiên sang UUID trong `selectedDatabases`, điền `resourceLabels` và khóa `connections.notion` (`credentialId`, `workspaceId`, `workspaceName`, `botId`, `identityVersion`, `databaseIds`) vào `plan_hash`.
- Cập nhật [`apps/chat-api/src/services/adapter-factory.ts`](../../../apps/chat-api/src/services/adapter-factory.ts): xác thực `credentialId`, `identityVersion` và `databaseIds` ở pha `execution`, đồng thời giữ tương thích ngược 100% với shared credentials.

### Task 4: Scheduled AI Auto-Digest (`notion_digest` & `telegram_digest` nguồn Notion)
- Tạo [`apps/chat-api/src/services/schedules/notion-digest-candidate.ts`](../../../apps/chat-api/src/services/schedules/notion-digest-candidate.ts) và [`apps/chat-api/src/services/schedules/notion-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/notion-digest-runner.ts): truy vấn các database Notion đã khóa, trích xuất trạng thái/độ ưu tiên/hạn chót của từng trang, tổng hợp bằng AI với `AbortSignal` thực tế và gửi báo cáo qua Slack hoặc Telegram.
- Mở rộng [`apps/chat-api/src/services/schedules/telegram-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/telegram-digest-runner.ts) hỗ trợ nguồn đọc `notion` (`notion.query_database` / `notion.search_databases`).

### Task 5: Giao diện Frontend (`apps/chat-web`)
- Tạo [`apps/chat-web/src/pages/Settings/NotionConnection.tsx`](../../../apps/chat-web/src/pages/Settings/NotionConnection.tsx) trong mục `Của riêng bạn` (`#heading-personal-services`): kết nối OAuth 1-Click (`#notion-connect`), chuyển đổi workspace (`#notion-workspace-select`), chọn phạm vi 1–20 database kèm ô dán link/UUID Notion trực tiếp (`#notion-paste-db-input`), kiểm tra sức khỏe kết nối (`#notion-check`) và ngắt kết nối (`#notion-disconnect`).
- Tạo [`apps/chat-web/src/views/NotionCallbackView.tsx`](../../../apps/chat-web/src/views/NotionCallbackView.tsx) xử lý `/connections/notion/callback` và `/connections/mynotion/callback` (hỗ trợ `returnTo` quay lại hội thoại `/c/<uuid>`).
- Cập nhật [`ResponseMoment.tsx`](../../../apps/chat-web/src/pages/Responses/ResponseMoment.tsx), [`PlanMoment.tsx`](../../../apps/chat-web/src/pages/Cockpit/PlanMoment.tsx), [`ReceiptMoment.tsx`](../../../apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx), [`ScheduleMoment.tsx`](../../../apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx) và [`schedule-text.ts`](../../../apps/chat-web/src/services/schedule-text.ts).

## 2. Bằng chứng Kiểm thử Thực tế (Quality Gate Evidence)
- `npm run typecheck:v3`: **PASS** (exit code 0).
- Bộ kiểm thử Backend & Frontend Notion (PostgreSQL 16 thật + jsdom):
  - `apps/chat-api/tests/db/notion-oauth-migration.test.ts` (4 tests PASS)
  - `apps/chat-api/tests/db/notion-connection-repo.test.ts` (3 tests PASS)
  - `apps/chat-api/tests/config/notion-oauth-env.test.ts` (4 tests PASS)
  - `apps/chat-api/tests/services/notion-oauth.test.ts` (2 tests PASS)
  - `apps/chat-api/tests/services/notion-token-manager.test.ts` (1 test PASS)
  - `apps/chat-api/tests/routes/notion-connections.test.ts` (1 test PASS)
  - `apps/chat-api/tests/services/notion-planning.test.ts` (1 test PASS)
  - `apps/chat-api/tests/integration/notion-extension.test.ts` (1 test PASS)
  - `apps/chat-api/tests/services/schedules/notion-digest.test.ts` (6 tests PASS)
  - `apps/chat-web/tests/notion-connection.test.tsx` (9 tests PASS)
  - `apps/chat-web/tests/github-connection.test.tsx` (12 tests PASS)
  - Tổng cộng: **11 test files, 44 tests PASS (exit code 0)**.
