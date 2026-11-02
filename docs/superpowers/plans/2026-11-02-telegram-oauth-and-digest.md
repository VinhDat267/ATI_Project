# Kết nối Telegram 1 chạm (OAuth-style Deep-Link Pairing), Nhận diện Chat Tự nhiên và Báo cáo Sáng Tự động Đa dịch vụ — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay thế cơ chế dán `botToken` và gõ tay `chatId` âm `-100...` bằng kết nối Telegram 1 chạm (`oauth_states` mode `connect_telegram` + Deep-Link `?start=ati_<state>` / `?startgroup=ati_<state>`), chọn từ 1 đến 10 chat/group bằng tên hiển thị rõ ràng, nâng cấp `TelegramAdapter` hiểu các cách gọi tự nhiên (`"Telegram của tôi"`, `"cá nhân"`, tên nhóm tiếng Việt không dấu), khóa `connections.telegram` vào `plan_hash`, và bổ sung chế độ lịch chạy tự động `auto_digest` gửi báo cáo sáng từ GitHub/Calendar/Sheets/Trello/Jira về đúng 1 chat Telegram đã khóa.

**Architecture:** Giữ nguyên dịch vụ `telegram` trong `SERVICE_REGISTRY` và giữ nguyên từng ký tự của `TELEGRAM_TOOLS` (`telegram.list_chats`, `telegram.send_message`) trong `packages/tool-schemas/src/telegram.ts` để tổng số tool cố định là 33 và mã băm SHA-256 của system prompt không đổi. Ở tầng máy chủ, người vận hành cấu hình 1 lần `TELEGRAM_BOT` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEB_CALLBACK_URL`), còn mỗi người dùng xác thực danh tính Telegram cá nhân (`telegramUserId`, `username`, `displayName`) qua phiên ghép nối một lần trong `oauth_states` (`mode = 'connect_telegram'`), lưu mã hóa trong `service_credentials` (`user_id = user.id`) kèm danh sách 1–10 chat đã chọn và khóa `connections.telegram` vào `plan_hash`. Với lịch chạy (`SCHEDULES_ENABLED=on`), thêm chế độ `approvalMode: 'manual' | 'auto_digest'` (`schedules.kind = 'telegram_digest'`) chỉ mở khi lịch chỉ đọc dữ liệu từ các dịch vụ nguồn đã kết nối và gửi báo cáo sáng về đúng 1 chat Telegram đã khóa.

**Tech Stack:** TypeScript, Express, PostgreSQL 16 (`pg`), Node `crypto` + `fetch`, React + Tailwind CSS, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-11-02-telegram-oauth-and-digest-design.md`](../specs/2026-11-02-telegram-oauth-and-digest-design.md)

---

## Bản đồ file tạo mới và chỉnh sửa

### Tạo mới
- `db/v3/0019_telegram_oauth_and_digest.sql` — Migration idempotent: mở rộng `oauth_states` thêm `'connect_telegram'`, xóa credential `telegram` dùng chung và thêm `service_credentials_telegram_owner_check`, tạo bảng `telegram_team_scope` + `telegram_team_chats` (tối đa 10 chat), mở rộng `schedules` (`kind`, `digest_config`, `digest_config_hash`, `digest_approved_at`) và `schedule_runs` (`digest_sent`, `digest_failed`, `delivery`).
- `apps/chat-api/src/db/repositories/telegram-team-repo.ts` — `TelegramTeamRepo` đọc/ghi danh sách tối đa 10 chat nhóm Telegram của nhóm.
- `apps/chat-api/src/services/telegram/bot-client.ts` — `TelegramBotClient` tạo URL Deep-Link (`?start=ati_<state>`, `?startgroup=ati_<state>`), xác minh sự kiện ghép nối (`verifyPairing`), lấy thông tin chat (`getChat`), kiểm tra thành viên (`getChatMember`), và khám phá danh sách chat ứng viên (`discoverChats`) với `AbortSignal` 10 giây.
- `apps/chat-api/src/services/telegram/connection-reference.ts` — `readTelegramConnection` và `TelegramConnectionReference` cho `ChatService` và `ScheduleService`.
- `apps/chat-api/src/routes/connections/telegram.ts` — Các route `/api/connections/telegram` (`GET /`, `POST /start`, `POST /callback`, `GET /candidate-chats`, `PUT /scope`, `DELETE /`).
- `apps/chat-api/src/services/schedules/telegram-digest-candidate.ts` — Đánh giá điều kiện `auto_digest` (`evaluateTelegramDigestCandidate`) và tính `computeTelegramDigestConfigHash`.
- `apps/chat-api/src/services/schedules/telegram-digest-runner.ts` — `TelegramDigestRunner` đọc dữ liệu từ các dịch vụ nguồn đã khóa, tóm tắt điểm nhấn bằng AI (có ranh giới an toàn) và gửi báo cáo văn bản thuần về đúng 1 chat Telegram đã khóa.
- `apps/chat-web/src/services/telegram-connection.ts` — Session guard, thông báo kết nối, thông báo lỗi tiếng Việt và kiểm tra `returnTo` cho Telegram.
- `apps/chat-web/src/views/TelegramCallbackView.tsx` — Màn hình `/connections/telegram/callback` hướng dẫn bấm Start trên Telegram và hoàn tất ghép nối 1 chạm.
- `apps/chat-web/src/pages/Settings/TelegramConnection.tsx` — Khối quản lý kết nối Telegram cá nhân và chọn 1–10 chat/group bằng tên hiển thị trong trang `/settings`.
- Tests tạo mới:
  - `apps/chat-api/tests/config/telegram-env.test.ts`
  - `apps/chat-api/tests/db/telegram-oauth-migration.test.ts`
  - `apps/chat-api/tests/db/telegram-team-repo.test.ts`
  - `apps/chat-api/tests/services/telegram-bot-client.test.ts`
  - `apps/chat-api/tests/routes/telegram-connections.test.ts`
  - `apps/chat-api/tests/routes/telegram-scope.test.ts`
  - `apps/chat-api/tests/routes/telegram-shared-credentials.test.ts`
  - `apps/chat-api/tests/services/telegram-planning.test.ts`
  - `apps/chat-api/tests/services/schedules/telegram-digest-proposal.test.ts`
  - `apps/chat-api/tests/services/schedules/telegram-digest-runner.test.ts`
  - `apps/chat-api/tests/sandbox/telegram-sandbox.test.ts`
  - `apps/chat-web/tests/telegram-connection.test.tsx`
  - `apps/chat-web/tests/schedule-digest-mode.test.tsx`
  - `apps/chat-web/tests/browser/telegram-oauth-and-digest.spec.ts`

### Chỉnh sửa
- `packages/tool-schemas/src/registry/telegram.ts` — Đặt `credentialFields: []` (bỏ ô nhập `botToken` dùng chung).
- `packages/tool-schemas/tests/telegram.test.ts` — Cập nhật kỳ vọng `credentialFields: []`.
- `packages/tool-schemas/src/types.ts` — Thêm `PlanStep.chatId`, `PlanConnections.telegram`, `ScheduleApprovalMode`, `TelegramDigestSource`, `TelegramDigestConfig`, `TelegramDigestDelivery`, mở rộng `ScheduleProposalMetadata.digestCandidate`, `ScheduleView.kind` / `approvalMode` / `digest`, `ScheduleRunState` (`'digest_sent' | 'digest_failed'`), `ScheduleRunView.delivery`.
- `packages/tool-adapters/src/telegram/telegram-adapter.ts` — Hỗ trợ `baseUrl`, `knownChats`, `telegramUserId`, `username`, khớp tên chat tự nhiên (`"Telegram của tôi"`, `"cá nhân"`, tên nhóm tiếng Việt không dấu) và kiểm tra `chatId` nằm trong `allowedScope.chats` trước khi gọi HTTP.
- `packages/tool-adapters/tests/telegram-adapter.test.ts` — Bổ sung kiểm thử `baseUrl`, `knownChats`, khớp tên tự nhiên và chặn `chatId` ngoài phạm vi trước khi gọi HTTP.
- `apps/chat-api/src/config/env.ts` — Đọc và kiểm tra `TELEGRAM_BOT` (`botToken`, `botUsername`, `callbackUrl`, `apiBaseUrl`, `deepLinkBaseUrl`), chặn gọi `api.telegram.org` thật trong `sandbox`.
- `apps/chat-api/src/db/repositories/google-auth-repo.ts` — Mở rộng `OAuthMode` thêm `'connect_telegram'` và thêm `verifyState` kiểm tra state không phá hủy trước khi hỏi Telegram.
- `apps/chat-api/src/routes/services-routes.ts` — Chặn `410 Gone` cho `/api/services/telegram/credentials` và `/api/services/telegram/scope`; đính kèm `personalStatus`, `username`, `connectedAt` cho `telegram` trong `GET /api/services`.
- `apps/chat-api/src/services/registered-services.ts` — Bỏ `telegram` khỏi `SHARED_SERVICES`, bật `telegram` trong `getUserToolCatalog` khi có kết nối Telegram cá nhân hợp lệ.
- `apps/chat-api/src/config/gmail-tools-runtime.ts` — Chuyển `telegram` qua nhánh kiểm tra kết nối cá nhân giống `trello`.
- `apps/chat-api/src/services/adapter-factory.ts` — Thêm `telegramAdapter(context)` đọc credential cá nhân, kiểm tra `credentialId`, `chatIds` và `getChatMember` ở pha `execution`.
- `apps/chat-api/src/services/resource-labels.ts` — Giải tên hiển thị của chat Telegram từ `knownChats` / `selectedChats` của người dùng.
- `apps/chat-api/src/services/chat-service.ts` — Nhận `telegramConnection`, kiểm tra và khóa `connections.telegram` vào `plan_hash`, tính `digestCandidate` trong `prepareProposal`.
- `apps/chat-api/src/db/repositories/schedule-repo.ts` — Lưu và đọc `kind`, `digest_config`, `digest_config_hash`, `digest_approved_at`, `delivery`; thêm `finishDigestRun`, `lastScheduledDigestSentDueAt`; bỏ qua `lastThreeExpired` cho `kind = 'telegram_digest'`.
- `apps/chat-api/src/services/schedules/run-state.ts` — Hỗ trợ `digest_sent` và `digest_failed`.
- `apps/chat-api/src/services/schedules/schedule-service.ts` — Hỗ trợ `approvalMode: 'manual' | 'auto_digest'` trong `confirmProposal` và thêm `'digest_failed'` vào `REPLANNABLE`.
- `apps/chat-api/src/services/schedules/schedule-runner.ts` — Gọi `runTelegramDigest` cho lịch `kind = 'telegram_digest'`, kiểm tra lại `schedules.version` trước khi gửi và ghi `digest_sent` / `digest_failed` / `blocked` / `discarded`.
- `apps/chat-api/src/routes/schedule-routes.ts` — Truyền `approvalMode` từ body của `POST /conversations/:convId/schedule-proposals/:messageId/confirm`.
- `apps/chat-api/src/config/schedules-runtime.ts`, `apps/chat-api/src/app.ts`, `apps/chat-api/src/server.ts` — Nối `TelegramBotClient`, `TelegramTeamRepo`, `TelegramDigestRunner` và route `/api/connections/telegram`.
- `apps/chat-api/tests/integration/telegram-extension.test.ts` — Cập nhật kiểm thử tích hợp theo kiến trúc kết nối Telegram cá nhân mới.
- `apps/chat-web/src/routes.ts`, `apps/chat-web/src/hooks/use-route.ts`, `apps/chat-web/src/App.tsx`, `apps/chat-web/src/types.ts`, `apps/chat-web/src/services/api-client.ts`, `apps/chat-web/src/services/schedule-text.ts`, `apps/chat-web/src/pages/Settings/useSettings.ts`, `apps/chat-web/src/pages/Settings/SettingsPage.tsx`, `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`, `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`, `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`, `apps/chat-web/src/components/Cockpit.tsx`, `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`, `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`, `apps/chat-web/src/pages/History/ScheduleSection.tsx`.

---

## Task 1: Cấu hình `TELEGRAM_BOT` trong `env.ts`

**Files:**
- Modify: `apps/chat-api/src/config/env.ts`
- Test: `apps/chat-api/tests/config/telegram-env.test.ts`

- [ ] **Step 1: Viết failing test `apps/chat-api/tests/config/telegram-env.test.ts`**
  Kiểm tra:
  1. Khi không khai báo biến `TELEGRAM_*`, `validateEnv` trả `config.TELEGRAM_BOT === undefined`.
  2. Khi khai báo đủ `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` (kể cả có `@` ở đầu), `TELEGRAM_WEB_CALLBACK_URL = 'http://localhost:5173/connections/telegram/callback'`, trả về `{ botToken, botUsername, callbackUrl, apiBaseUrl: 'https://api.telegram.org', deepLinkBaseUrl: 'https://t.me' }`.
  3. Từ chối `TELEGRAM_BOT_TOKEN` sai định dạng, `TELEGRAM_BOT_USERNAME` quá ngắn/sai ký tự, `TELEGRAM_WEB_CALLBACK_URL` sai pathname hoặc có query/fragment/userinfo hoặc HTTP không phải loopback (`config.TELEGRAM_BOT === undefined`).
  4. Trong `RUNTIME_MODE=sandbox`, nếu không truyền `TELEGRAM_API_BASE_URL` tường minh thì `config.TELEGRAM_BOT` là `undefined` (không bao giờ gọi `api.telegram.org` thật trong sandbox); khi truyền `TELEGRAM_API_BASE_URL = 'http://127.0.0.1:4100'` thì được phép.

- [ ] **Step 2: Chạy test để xác nhận RED**
  Run: `npx vitest run apps/chat-api/tests/config/telegram-env.test.ts`

- [ ] **Step 3: Cài đặt `TELEGRAM_BOT` trong `apps/chat-api/src/config/env.ts`**
  Thêm `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEB_CALLBACK_URL`, `TELEGRAM_API_BASE_URL`, `TELEGRAM_DEEPLINK_BASE_URL` vào `EnvSchema`, thêm interface `TelegramBotConfig` và hàm `telegramBotConfig(data)`.

- [ ] **Step 4: Chạy lại test để xác nhận GREEN và commit**
  Run: `npx vitest run apps/chat-api/tests/config/telegram-env.test.ts`

---

## Task 2: Migration `0019_telegram_oauth_and_digest.sql`, `TelegramTeamRepo` & `GoogleAuthRepo.verifyState`

**Files:**
- Create: `db/v3/0019_telegram_oauth_and_digest.sql`
- Create: `apps/chat-api/src/db/repositories/telegram-team-repo.ts`
- Modify: `apps/chat-api/src/db/repositories/google-auth-repo.ts`
- Test: `apps/chat-api/tests/db/telegram-oauth-migration.test.ts`
- Test: `apps/chat-api/tests/db/telegram-team-repo.test.ts`

- [ ] **Step 1: Viết failing tests cho Migration và `TelegramTeamRepo`**
  Trong `apps/chat-api/tests/db/telegram-oauth-migration.test.ts`, kiểm tra trên PostgreSQL 16 thật:
  1. Chạy lại `0019_telegram_oauth_and_digest.sql` lần 2 không lỗi (idempotent).
  2. `oauth_states` chấp nhận `mode = 'connect_telegram'` với `user_id` + `session_id` và `return_to = '/c/<uuid>'`, từ chối `connect_telegram` thiếu `user_id` hoặc `return_to` sai định dạng; vẫn giữ nguyên `'connect_trello'`, `'connect_gmail'`, `'connect_mycalendar'`, `'connect_mysheets'`.
  3. `service_credentials` từ chối `service = 'telegram'` có `user_id IS NULL`.
  4. `schedules_kind_digest_check` chặn `kind = 'telegram_digest'` thiếu `digest_config` / `digest_config_hash` / `digest_approved_at`, và chặn `kind = 'plan'` có `digest_config` khác `NULL`.
  5. `schedule_runs_delivery_check` bắt buộc `status = 'digest_sent'` đi kèm `delivery IS NOT NULL` và các trạng thái khác có `delivery IS NULL`.
  Trong `apps/chat-api/tests/db/telegram-team-repo.test.ts`, kiểm tra `TelegramTeamRepo.get()`, `save()`, giới hạn tối đa 10 chat ở cả tầng ứng dụng và tầng DB trigger, cùng `GoogleAuthRepo.verifyState()` không đánh dấu `used_at` trước khi `consumeState()`.

- [ ] **Step 2: Chạy test để xác nhận RED**
  Run: `npx vitest run apps/chat-api/tests/db/telegram-oauth-migration.test.ts apps/chat-api/tests/db/telegram-team-repo.test.ts`

- [ ] **Step 3: Viết `db/v3/0019_telegram_oauth_and_digest.sql`, `telegram-team-repo.ts` và mở rộng `google-auth-repo.ts`**

- [ ] **Step 4: Chạy lại test để xác nhận GREEN và commit**
  Run: `npx vitest run apps/chat-api/tests/db/telegram-oauth-migration.test.ts apps/chat-api/tests/db/telegram-team-repo.test.ts`

---

## Task 3: `TelegramBotClient` (Deep-Link, `verifyPairing`, `getChat`, `getChatMember`, `discoverChats`)

**Files:**
- Create: `apps/chat-api/src/services/telegram/bot-client.ts`
- Test: `apps/chat-api/tests/services/telegram-bot-client.test.ts`

- [ ] **Step 1: Viết failing test `apps/chat-api/tests/services/telegram-bot-client.test.ts`**
  Kiểm tra:
  1. `deepLinkUrl(state)` và `groupDeepLinkUrl(state)` tạo đúng URL `https://t.me/<botUsername>?start=ati_<state>` và `?startgroup=ati_<state>`.
  2. `verifyPairing(state)`:
     - Khớp `/start ati_<state>` và `/start@BotName ati_<state>` từ người dùng thật (`from.is_bot !== true`), trả về `{ matched: true, telegramUserId, username, displayName, pairedChat, discoveredGroups }`.
     - Từ chối tin nhắn từ bot (`from.is_bot === true`).
     - Trả về `{ matched: false }` khi chưa có update khớp `state`.
     - Không bao giờ lộ `botToken` trong thông báo lỗi khi HTTP 401/500.
  3. `getChatMember(chatId, telegramUserId)` trả `true` cho `creator`, `administrator`, `member`, `restricted` (`is_member: true`), và trả `false` cho `left`, `kicked`, `restricted` (`is_member: false`) hoặc HTTP 400/403.
  4. Tôn trọng `AbortSignal` thật khi request treo quá hạn.

- [ ] **Step 2: Chạy test để xác nhận RED**
  Run: `npx vitest run apps/chat-api/tests/services/telegram-bot-client.test.ts`

- [ ] **Step 3: Cài đặt `apps/chat-api/src/services/telegram/bot-client.ts`**

- [ ] **Step 4: Chạy lại test để xác nhận GREEN và commit**
  Run: `npx vitest run apps/chat-api/tests/services/telegram-bot-client.test.ts`

---

## Task 4: Các Route Kết nối Telegram Cá nhân (`/api/connections/telegram/*`) & Khóa Đường Dán Token Dùng Chung (`410 Gone`)

**Files:**
- Create: `apps/chat-api/src/routes/connections/telegram.ts`
- Modify: `packages/tool-schemas/src/registry/telegram.ts`
- Modify: `packages/tool-schemas/tests/telegram.test.ts`
- Modify: `apps/chat-api/src/routes/services-routes.ts`
- Modify: `apps/chat-api/src/app.ts`
- Test: `apps/chat-api/tests/routes/telegram-connections.test.ts`
- Test: `apps/chat-api/tests/routes/telegram-scope.test.ts`
- Test: `apps/chat-api/tests/routes/telegram-shared-credentials.test.ts`

- [ ] **Step 1: Viết failing tests cho các route `/api/connections/telegram/*` và `/api/services/telegram/*`**
  Kiểm tra trên PostgreSQL 16 thật:
  1. `POST /api/connections/telegram/start` kiểm tra `returnTo` thuộc về chính người gọi, lưu `oauth_states` (`mode = 'connect_telegram'`), đặt cookie `ati_telegram_browser`, trả `{ url, state, botUsername, deepLinkUrl, groupDeepLinkUrl }`.
  2. `POST /api/connections/telegram/callback`:
     - Sai state / sai cookie / sai user → trả `400 TELEGRAM_STATE_INVALID` với `0` lời gọi HTTP tới Telegram.
     - Chưa bấm Start trên Telegram → trả `409 TELEGRAM_PAIRING_PENDING` và giữ nguyên `used_at IS NULL` để người dùng bấm lại thành công sau khi nhấn Start.
     - Khi đã nhấn Start → consume state nguyên tử 1 lần, kiểm tra `getChatMember` cho các nhóm, tự động chọn sẵn chat riêng `"Telegram của tôi (<displayName>)"` + nhóm hợp lệ (1–10 chat), lưu mã hóa vào `service_credentials` (`user_id = user.id`).
  3. `GET /api/connections/telegram`, `GET /api/connections/telegram/candidate-chats`, `PUT /api/connections/telegram/scope` (chấp nhận 1–10 chat hợp lệ, từ chối 0 chat, > 10 chat hoặc chat ngoài phạm vi thành viên của người gọi), `DELETE /api/connections/telegram`.
  4. `POST /api/services/telegram/credentials` và `PUT/POST /api/services/telegram/scope` trả `410 { error: 'Telegram dùng kết nối 1 chạm.' }`; `GET /api/services` trả `credentialFields: []` và đính kèm `personalStatus`, `username`, `connectedAt`.

- [ ] **Step 2: Chạy test để xác nhận RED**
  Run: `npx vitest run packages/tool-schemas/tests/telegram.test.ts apps/chat-api/tests/routes/telegram-connections.test.ts apps/chat-api/tests/routes/telegram-scope.test.ts apps/chat-api/tests/routes/telegram-shared-credentials.test.ts`

- [ ] **Step 3: Cài đặt `apps/chat-api/src/routes/connections/telegram.ts`, cập nhật `telegram.ts`, `services-routes.ts`, `app.ts`**

- [ ] **Step 4: Chạy lại test để xác nhận GREEN và commit**
  Run: `npx vitest run packages/tool-schemas/tests/telegram.test.ts apps/chat-api/tests/routes/telegram-connections.test.ts apps/chat-api/tests/routes/telegram-scope.test.ts apps/chat-api/tests/routes/telegram-shared-credentials.test.ts`

---

## Task 5: Nâng cấp `TelegramAdapter` (Hỗ trợ `baseUrl`, `knownChats`, Khớp Tên Tự nhiên & Chặn Ngoài Phạm vi Trước HTTP)

**Files:**
- Modify: `packages/tool-adapters/src/telegram/telegram-adapter.ts`
- Modify: `packages/tool-adapters/tests/telegram-adapter.test.ts`

- [ ] **Step 1: Viết thêm failing tests trong `packages/tool-adapters/tests/telegram-adapter.test.ts`**
  Kiểm tra:
  1. `telegram.list_chats` khớp tự nhiên `"Telegram của tôi"`, `"cá nhân"`, `"riêng"`, `"cho tôi"` với chat riêng (`type: 'private'`) của người dùng và trả về tiêu đề thân thiện `"Telegram của tôi (<displayName>)"`.
  2. `telegram.list_chats` khớp tên nhóm tiếng Việt không dấu (`"doi san pham"` khớp `"Đội Sản Phẩm"`) và bỏ từ đệm (`"nhóm Đội Sản Phẩm"` khớp `"Đội Sản Phẩm"`).
  3. Hỗ trợ `baseUrl` tùy chỉnh (không gọi `api.telegram.org` khi truyền `baseUrl` nội bộ).
  4. `telegram.send_message` chặn `chatId` nằm ngoài `allowedScope.chats` (hoặc khác `context.chatId`) trước khi gọi `fetchFn` (`0` lời gọi HTTP).

- [ ] **Step 2: Chạy test để xác nhận RED**
  Run: `npx vitest run packages/tool-adapters/tests/telegram-adapter.test.ts`

- [ ] **Step 3: Nâng cấp `packages/tool-adapters/src/telegram/telegram-adapter.ts`**

- [ ] **Step 4: Chạy lại test để xác nhận GREEN và commit**
  Run: `npx vitest run packages/tool-adapters/tests/telegram-adapter.test.ts`

---

## Task 6: Khóa `connections.telegram` vào `plan_hash`, `AdapterFactory.telegramAdapter` & `resourceLabels`

**Files:**
- Create: `apps/chat-api/src/services/telegram/connection-reference.ts`
- Modify: `packages/tool-schemas/src/types.ts`
- Modify: `apps/chat-api/src/services/registered-services.ts`
- Modify: `apps/chat-api/src/config/gmail-tools-runtime.ts`
- Modify: `apps/chat-api/src/services/adapter-factory.ts`
- Modify: `apps/chat-api/src/services/resource-labels.ts`
- Modify: `apps/chat-api/src/services/chat-service.ts`
- Modify: `apps/chat-api/src/server.ts`
- Modify: `apps/chat-api/tests/integration/telegram-extension.test.ts`
- Test: `apps/chat-api/tests/services/telegram-planning.test.ts`

- [ ] **Step 1: Viết failing test `apps/chat-api/tests/services/telegram-planning.test.ts`**
  Kiểm tra:
  1. Khi người dùng chưa kết nối Telegram (hoặc `reconnect_required`), câu lệnh yêu cầu Telegram trả `refusal` với `unavailableServices: [{ id: 'telegram', name: 'Telegram' }]`.
  2. Khi người dùng đã kết nối nhưng chưa chọn chat nào (`needs_scope`), trả `refusal` hướng dẫn chọn chat.
  3. Khi người dùng đã kết nối và chọn chat hợp lệ, kế hoạch có bước `telegram.send_message` khóa `connections.telegram = { credentialId, telegramUserId, username, chatIds }` vào `plan_hash` và điền tên chat vào `resourceLabels`.
  4. Nếu kế hoạch nhắm tới `chatId` ngoài `connection.chatIds` → trả `refusal`.
  5. Ở pha `execution`, `AdapterFactory.telegramAdapter` chặn thực thi (`AUTH_ERROR`) nếu `credentialId` đã bị thay thế/ngắt kết nối, `chatId` bị bỏ khỏi phạm vi, hoặc người dùng không còn là thành viên của nhóm (`getChatMember === false`).

- [ ] **Step 2: Chạy test để xác nhận RED**
  Run: `npx vitest run apps/chat-api/tests/services/telegram-planning.test.ts`

- [ ] **Step 3: Cài đặt `connection-reference.ts` và tích hợp vào `types.ts`, `registered-services.ts`, `gmail-tools-runtime.ts`, `adapter-factory.ts`, `resource-labels.ts`, `chat-service.ts`, `server.ts`, cập nhật `telegram-extension.test.ts`**

- [ ] **Step 4: Chạy lại test để xác nhận GREEN và commit**
  Run: `npx vitest run apps/chat-api/tests/services/telegram-planning.test.ts apps/chat-api/tests/integration/telegram-extension.test.ts packages/planner/tests/read-answers.test.ts packages/planner/tests/schedules.test.ts`

---

## Task 7: Chế độ Lịch chạy `auto_digest` (`telegram-digest-candidate.ts`, `ScheduleService.confirmProposal`, `ScheduleRepo`)

**Files:**
- Create: `apps/chat-api/src/services/schedules/telegram-digest-candidate.ts`
- Modify: `apps/chat-api/src/db/repositories/schedule-repo.ts`
- Modify: `apps/chat-api/src/services/schedules/run-state.ts`
- Modify: `apps/chat-api/src/services/schedules/schedule-service.ts`
- Modify: `apps/chat-api/src/services/chat-service.ts`
- Modify: `apps/chat-api/src/routes/schedule-routes.ts`
- Test: `apps/chat-api/tests/services/schedules/telegram-digest-proposal.test.ts`

- [ ] **Step 1: Viết failing test `apps/chat-api/tests/services/schedules/telegram-digest-proposal.test.ts`**
  Kiểm tra trên PostgreSQL 16 thật:
  1. Đề xuất lịch đọc đa dịch vụ (`calendar` + `github` + `trello` → `telegram`) khi người dùng đã kết nối Telegram sinh `digestCandidate.canAutoDigest === true` kèm `config` (khóa đúng 1 `chatId`, `chatTitle`, `sources`) và `configHash`.
  2. Đề xuất lịch có từ khóa ghi dữ liệu (ví dụ *"tạo thẻ Trello rồi báo Telegram"*) hoặc gửi lên Slack có `digestCandidate.canAutoDigest === false` kèm `disabledReason` tiếng Việt.
  3. `confirmProposal` với `approvalMode: 'auto_digest'` lưu `kind = 'telegram_digest'`, `digest_config`, `digest_config_hash`, `digest_approved_at`; khi xác nhận đề xuất `update` đổi giờ chạy (`recurrence`), `digest_config_hash` được tính lại khớp với `recurrence` mới.
  4. Gửi `approvalMode: 'auto_digest'` cho đề xuất có `canAutoDigest === false` bị chặn với `409 AUTO_DIGEST_NOT_ALLOWED`.

- [ ] **Step 2: Chạy test để xác nhận RED**
  Run: `npx vitest run apps/chat-api/tests/services/schedules/telegram-digest-proposal.test.ts`

- [ ] **Step 3: Cài đặt `telegram-digest-candidate.ts` và mở rộng `schedule-repo.ts`, `run-state.ts`, `schedule-service.ts`, `chat-service.ts`, `schedule-routes.ts`**

- [ ] **Step 4: Chạy lại test để xác nhận GREEN và commit**
  Run: `npx vitest run apps/chat-api/tests/services/schedules/telegram-digest-proposal.test.ts apps/chat-api/tests/services/chat-service-schedules.test.ts`

---

## Task 8: `TelegramDigestRunner` & Tích hợp vào `ScheduleRunner`

**Files:**
- Create: `apps/chat-api/src/services/schedules/telegram-digest-runner.ts`
- Modify: `apps/chat-api/src/services/schedules/schedule-runner.ts`
- Modify: `apps/chat-api/src/config/schedules-runtime.ts`
- Modify: `apps/chat-api/src/server.ts`
- Test: `apps/chat-api/tests/services/schedules/telegram-digest-runner.test.ts`

- [ ] **Step 1: Viết failing test `apps/chat-api/tests/services/schedules/telegram-digest-runner.test.ts`**
  Kiểm tra trên PostgreSQL 16 thật:
  1. Lượt chạy `telegram_digest` đọc dữ liệu từ các dịch vụ nguồn (`calendar`, `github`, `trello`), tóm tắt điểm nhấn bằng AI, gửi đúng 1 tin văn bản thuần (`<= 4000` ký tự, bắt đầu bằng `Bản tin tự động của ATI · thiết lập bởi @...`) về đúng `config.chatId`, ghi `status = 'digest_sent'`, `delivery`, và tạo message `assistant` `type: 'answer'` trong hội thoại của lượt chạy.
  2. Nếu `digest_config_hash` bị can thiệp trong DB hoặc người dùng đã ngắt kết nối Telegram / bỏ chọn `chatId` / rời nhóm → ghi `status = 'blocked'`, tự chuyển lịch sang `paused`, không gọi gửi tin Telegram.
  3. Nếu lịch bị sửa (`version` tăng) hoặc bị tạm dừng/hủy trong lúc đang đọc dữ liệu nguồn → dừng trước khi gọi Telegram và ghi `status = 'discarded'`.
  4. Lượt chạy thủ công (`trigger = 'manual'`) không làm dịch mốc `SINCE` của lượt chạy tự động (`trigger = 'scheduled'`) kế tiếp.
  5. Khi 3 lượt liên tiếp đều `digest_failed`, lịch tự chuyển sang `paused` với `pause_reason = '3 lượt liền gửi thất bại'`.

- [ ] **Step 2: Chạy test để xác nhận RED**
  Run: `npx vitest run apps/chat-api/tests/services/schedules/telegram-digest-runner.test.ts`

- [ ] **Step 3: Cài đặt `telegram-digest-runner.ts` và tích hợp vào `schedule-runner.ts`, `schedules-runtime.ts`, `server.ts`**

- [ ] **Step 4: Chạy lại test để xác nhận GREEN và commit**
  Run: `npx vitest run apps/chat-api/tests/services/schedules/telegram-digest-runner.test.ts`

---

## Task 9: Giao diện Web (`TelegramConnection`, `TelegramCallbackView`, `RefusalMoment`, `PlanMoment`, `ReceiptMoment`, `ScheduleMoment`, `ScheduleSection`)

**Files:**
- Create: `apps/chat-web/src/services/telegram-connection.ts`
- Create: `apps/chat-web/src/views/TelegramCallbackView.tsx`
- Create: `apps/chat-web/src/pages/Settings/TelegramConnection.tsx`
- Modify: `apps/chat-web/src/routes.ts`
- Modify: `apps/chat-web/src/hooks/use-route.ts`
- Modify: `apps/chat-web/src/App.tsx`
- Modify: `apps/chat-web/src/types.ts`
- Modify: `apps/chat-web/src/services/api-client.ts`
- Modify: `apps/chat-web/src/services/schedule-text.ts`
- Modify: `apps/chat-web/src/pages/Settings/useSettings.ts`
- Modify: `apps/chat-web/src/pages/Settings/SettingsPage.tsx`
- Modify: `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`
- Modify: `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`
- Modify: `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`
- Modify: `apps/chat-web/src/components/Cockpit.tsx`
- Modify: `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`
- Modify: `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`
- Modify: `apps/chat-web/src/pages/History/ScheduleSection.tsx`
- Test: `apps/chat-web/tests/telegram-connection.test.tsx`
- Test: `apps/chat-web/tests/schedule-digest-mode.test.tsx`

- [ ] **Step 1: Viết failing tests `apps/chat-web/tests/telegram-connection.test.tsx` và `apps/chat-web/tests/schedule-digest-mode.test.tsx`**
  Kiểm tra:
  1. `SettingsPage` hiển thị `TelegramConnection` trong mục **"Của riêng bạn"**, ẩn `telegram` khỏi danh sách dịch vụ dùng chung; cho phép bấm `#telegram-connect`, chọn 1–10 chat bằng tên hiển thị (`#telegram-edit-scope`, `#telegram-save-scope`) và ngắt kết nối (`#telegram-disconnect`).
  2. `TelegramCallbackView` hiển thị nút mở Telegram Deep-Link, xử lý trạng thái `TELEGRAM_PAIRING_PENDING` (cho phép bấm xác nhận lại sau khi nhấn Start trên Telegram), và điều hướng về `returnTo` (`/c/<uuid>`) hoặc `/settings#telegram`.
  3. `RefusalMoment` hiển thị nút `#telegram-connect` truyền `returnTo: '/c/<convId>'`.
  4. `ScheduleMoment` hiển thị 2 lựa chọn `#schedule-mode-manual` và `#schedule-mode-auto-digest`, gửi đúng `{ approvalMode }` khi bấm xác nhận; `ScheduleSection` hiển thị nhãn `Tự gửi Telegram` và trạng thái `Đã gửi` / `Gửi thất bại`.

- [ ] **Step 2: Chạy test để xác nhận RED**
  Run: `npx vitest run apps/chat-web/tests/telegram-connection.test.tsx apps/chat-web/tests/schedule-digest-mode.test.tsx`

- [ ] **Step 3: Cài đặt các component và cập nhật routes, `apiClient`, `ScheduleMoment`, `ScheduleSection`**

- [ ] **Step 4: Chạy lại test để xác nhận GREEN và commit**
  Run: `npx vitest run apps/chat-web/tests/telegram-connection.test.tsx apps/chat-web/tests/schedule-digest-mode.test.tsx`

---

## Task 10: Sandbox, Browser E2E, Tổng kiểm tra Toàn bộ Test Suite & Handoff Log

**Files:**
- Modify: `apps/chat-api/src/sandbox/fake-results/telegram.ts`
- Create: `apps/chat-api/tests/sandbox/telegram-sandbox.test.ts`
- Create: `apps/chat-web/tests/browser/telegram-oauth-and-digest.spec.ts`
- Create: `docs/handoff/log/2026-11-02-telegram-oauth-and-digest.md`

- [ ] **Step 1: Viết failing test `apps/chat-api/tests/sandbox/telegram-sandbox.test.ts` và E2E spec `apps/chat-web/tests/browser/telegram-oauth-and-digest.spec.ts`**
  Kiểm tra trong sandbox:
  1. Thực thi `telegram.list_chats` và `telegram.send_message` với kết nối cá nhân hợp lệ không gọi `api.telegram.org` thật.
  2. Thực thi không có kết nối cá nhân bị từ chối với `AUTH_ERROR` và không rơi về credential dùng chung.

- [ ] **Step 2: Chạy test để xác nhận RED, cập nhật `apps/chat-api/src/sandbox/fake-results/telegram.ts` và `server.ts` cho sandbox**

- [ ] **Step 3: Chạy toàn bộ test suite trên tất cả các package (`tool-schemas`, `tool-adapters`, `planner`, `executor`, `chat-api`, `chat-web`) và kiểm tra TypeScript build**

- [ ] **Step 4: Viết báo cáo bàn giao `docs/handoff/log/2026-11-02-telegram-oauth-and-digest.md` và commit**

---

## Nhật ký Phản biện & Đối chiếu Kế hoạch với Codebase (Plan Audit Loop)

| Vòng | Hạng mục đối chiếu | Phát hiện khi soi từng dòng với Codebase | Cách xử lý trong Kế hoạch | Mức độ còn lại |
|---|---|---|---|---|
| **Vòng 1** | `packages/tool-schemas/tests/telegram.test.ts` dòng 26 | Test hiện có kiểm tra `credentialFields: [{ key: 'botToken', type: 'password' }]`. Khi đổi `TELEGRAM_SERVICE.credentialFields = []`, test này sẽ đỏ nếu không cập nhật trong Task 4. | Đưa `packages/tool-schemas/tests/telegram.test.ts` vào danh sách file chỉnh sửa của Task 4 để kiểm tra `credentialFields: []`. | **0 lỗi (Không còn P1/P2/P3)** |
| **Vòng 1** | `apps/chat-api/tests/integration/telegram-extension.test.ts` | Test tích hợp cũ tạo credential `telegram` dùng chung (`user_id IS NULL`) qua `POST /api/services/telegram/credentials` — vi phạm constraint mới `service_credentials_telegram_owner_check` và route `410 Gone`. | Đưa `apps/chat-api/tests/integration/telegram-extension.test.ts` vào Task 6 để kiểm thử theo luồng credential cá nhân + `getUserToolCatalog` + `connections.telegram`. | **0 lỗi (Không còn P1/P2/P3)** |
| **Vòng 2** | `apps/chat-api/src/db/repositories/google-auth-repo.ts` | Bảng `oauth_states` dùng cột `used_at` (không phải `consumed_at`), và `consumeState` đánh dấu `used_at` ngay lập tức. Với Telegram Deep-Link, nếu người dùng bấm kiểm tra trước khi nhấn Start trong Telegram thì không được làm mất `state`. | Thêm phương thức `verifyState` trong `GoogleAuthRepo` (Task 2) kiểm tra đầy đủ `state_hash`, `browser_binding_hash`, `user_id`, `session_id`, `used_at IS NULL`, `expires_at > now` trước khi hỏi Telegram, và chỉ gọi `consumeState` sau khi `verifyPairing` tìm thấy update `/start ati_<state>`. | **0 lỗi (Không còn P1/P2/P3)** |
| **Vòng 2** | `apps/chat-web/src/components/Cockpit.tsx` | `ReceiptMoment` được gọi từ `Cockpit.tsx` (dòng 162) và hàm `resourceDestination` nằm tại `Cockpit.tsx` (dòng 44). | Đưa `apps/chat-web/src/components/Cockpit.tsx` vào Task 9 để truyền `telegramConnection={plan?.connections?.telegram}` xuống `ReceiptMoment` và phân giải tên chat từ `step.chatId` trong `resourceDestination`. | **0 lỗi (Không còn P1/P2/P3)** |
