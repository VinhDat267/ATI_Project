# GMAIL-01 · Kết nối Gmail riêng của từng người (backend)

**Trạng thái:** chờ, giao nhóm trưởng (`VinhDat267`) ngày 13/10/2026 · **Nhánh gợi ý:** `feat/gmail-01-personal-connection` · **Phụ thuộc:** không · **Mốc:** trước **18/10/2026**
**Đặc tả:** mục 3.1–3.8, 3.10, 3.11, 6.2 và phần 1 của 6.3. **Quy tắc chung và hợp đồng:** [GMAIL-common](GMAIL-common.md), đọc trước.

## Mục tiêu

Khi `GMAIL_ENABLED=on`, sau task này:
- một người đã đăng nhập kết nối được Gmail của chính mình (OAuth qua máy chủ Google giả), xem trạng thái qua `GET /api/services`, và ngắt kết nối được;
- token được làm mới đúng cách;
- planner và executor biết ai đang dùng, và chỉ dùng kết nối của chính người đó.

Task này **chưa** làm tool Gmail chạy được. Adapter thật và adapter giả thuộc GMAIL-02, nên `server.ts` chưa đưa Gmail vào catalog và danh sách dịch vụ của planner. Khi cờ tắt, hệ thống không đổi gì (GMAIL-common mục 2).

## Việc cần làm

1. **Tool schemas** (`packages/tool-schemas`):
   - thêm các kiểu ở GMAIL-common mục 4.1;
   - `src/gmail.ts` có `GMAIL_TOOLS`: 10 tool theo đặc tả mục 4.1, đủ `inputSchema`/`outputSchema`, mô tả tiếng Anh như các tool hiện có;
   - `to`, `cc`, `bcc`: mảng chuỗi có `'x-recipient': true`, tối đa 20 người nhận gộp cả ba trường;
   - `threadId` có `x-resource: 'thread'`; id nhãn có `x-resource: 'label'`;
   - tool đọc dùng `observedFields: ['id', 'participants']`; đầu ra dùng `subject`, không dùng `title` hay `name`;
   - `search_threads` không `listable`; `list_labels` có `listable: true`, `discovers: 'label'`;
   - `src/registry/gmail.ts` có `GMAIL_SERVICE`: `connection: 'personal'`, `credentialFields: []`, `scopes: ['https://www.googleapis.com/auth/gmail.modify']`, `scopeKey: 'mailbox'`, `scopeLabel: 'Hộp thư Gmail của bạn'`, từ khoá và cụm theo đặc tả mục 4.1 (không có chữ `thư` đứng riêng);
   - export cả hai từ `index.ts`. **Không** thêm vào `ALL_TOOLS`, `TOOL_MAP`, `SERVICE_REGISTRY`.
2. **Executor:** catalog của `isWriteTool` (`packages/executor/src/runner.ts`) gồm `ALL_TOOLS` và `GMAIL_TOOLS`, bất kể cờ. Không đổi interface `StepRunnerOptions` (đặc tả mục 11).
3. **Cấu hình** (`apps/chat-api/src/config/env.ts`):
   - `GMAIL_ENABLED` nhận `on`/`off`, mặc định `off`; giá trị khác là lỗi cấu hình;
   - đọc `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI`. Redirect phải là URL web có path `/connections/gmail/callback`, không query, không fragment; HTTPS ở live trừ loopback;
   - chỉ ngoài live: `GMAIL_OAUTH_AUTH_URL`, `GMAIL_OAUTH_TOKEN_URL`, `GMAIL_OAUTH_REVOKE_URL`, `GMAIL_API_BASE_URL`. Ở live các biến này bị bỏ qua, dùng endpoint thật của Google;
   - `on` mà thiếu biến hoặc thiếu PostgreSQL: live từ chối khởi động, sandbox tắt Gmail (route trả 503);
   - thêm các biến vào `.env.example` với giá trị trống.
4. **Migration** `db/v3/0009_gmail_personal_connections.sql`, đúng đặc tả mục 3.3:
   - `oauth_states.mode` thêm `connect_gmail`; CHECK mới: `login` không có user/phiên, `link` và `connect_gmail` bắt buộc có cả hai;
   - `service_credentials` thêm `status` (`active`/`reconnect_required`, mặc định `active`), `status_changed_at`, và `CHECK (service <> 'gmail' OR user_id IS NOT NULL)`;
   - migration chạy được trên DB đã có dữ liệu của 0001–0008.
5. **Repository:**
   - `GoogleAuthRepo` (hoặc repo mới cho Gmail) nhận state `connect_gmail`. Callback đăng nhập/liên kết từ chối state `connect_gmail`; callback Gmail từ chối state `login`/`link`;
   - `CredentialRepo` thêm:
     - `getPersonalCredentials(service, userId)`: ném lỗi khi thiếu `userId`, không rơi về khoá chung, chỉ trả bản ghi `active`;
     - `getPersonalConnectionStatus(service, userId)`: trả bản ghi ở mọi trạng thái hoặc `null`;
     - `markReconnectRequired(service, userId, credentialId)`: chỉ đổi khi `id` còn khớp, đặt `status_changed_at`;
   - `ServiceCredentialRow` thêm `status`, `status_changed_at`.
6. **Routes kết nối:** `apps/chat-api/src/routes/connections/gmail.ts`, theo khuôn `routes/auth/google.ts`:
   - hợp đồng ở GMAIL-common mục 4.2; cookie riêng `ati_gmail_browser`;
   - `start`: state một lần, PKCE S256, `access_type=offline`, `prompt=consent`, scope chỉ `gmail.modify`;
   - `callback`: tiêu thụ state trong `UPDATE … RETURNING` kèm kiểm phiên còn sống như `consumeState` hiện có. Đổi code lấy token; không lưu gì khi thiếu `refresh_token` hoặc thiếu `gmail.modify`; lấy địa chỉ từ `users/me/profile`; lưu bằng `saveCredentials('gmail', config, userId)` với `config` mã hoá gồm `refreshToken`, `email`, `scopes`, `connectedAt`; xoá token và adapter trong bộ nhớ của người đó;
   - `DELETE`: gọi revoke trong 10 s (lỗi không chặn, log không có token), xoá bản ghi, xoá token và adapter trong bộ nhớ;
   - mọi request tới Google không theo redirect và có `AbortSignal`.
7. **Quản lý token** `apps/chat-api/src/services/gmail/token-manager.ts`, cài `GmailAccessTokenProvider` (GMAIL-common mục 4.4):
   - cache access token trong bộ nhớ theo `userId` và `credentialId`; làm mới khi còn dưới 60 s hoặc khi `forceRefresh`;
   - một lượt làm mới cho mỗi người tại một thời điểm. Lượt chung có thời hạn riêng 10 s; mỗi người gọi chờ bằng `signal` của mình, người này huỷ không huỷ lượt của người khác;
   - `invalid_grant`: gọi `markReconnectRequired`, xoá cache, ném `AUTH_ERROR`. Mạng, hết thời gian, 5xx: `NETWORK`/`SERVER_ERROR`, không đổi trạng thái.
8. **Danh sách dịch vụ và chặn dùng nhầm** (`services-routes.ts`, `/api/health`):
   - `GET /api/services`: thêm `connection` cho mọi dịch vụ, và hàng Gmail khi cờ bật (GMAIL-common mục 4.2);
   - `POST /api/services/gmail/credentials`, `PUT /api/services/gmail/scope`, `POST /api/services/gmail/test` trả 400 với câu "Gmail do mỗi người tự kết nối";
   - `GET /api/health` thêm `gmailEnabled`.
9. **Planner và executor theo người dùng:**
   - `ProcessMessageInput.actor?: { userId: string }`. `AIPlanner` chuyển nguyên `actor` vào `GatherSearchRequest`, không đọc nó;
   - `ChatService.executePlannerPipeline` truyền `actor: { userId }`;
   - `AdapterFactory.getAdapterForService(serviceName, context?)` theo GMAIL-common mục 4.4:
     - dịch vụ chung giữ hành vi cũ;
     - Gmail bắt buộc `context.userId`, đọc `getPersonalCredentials`, cache theo `gmail:<userId>`;
     - ở `phase: 'execution'`, so `credentialId` hiện tại với `context.connections.gmail`; thiếu hoặc khác thì lỗi `AUTH_ERROR` với câu "Kết nối Gmail đã thay đổi, hãy lập lại kế hoạch", trước khi tạo adapter;
     - `createRuntimeAdapterFactory` chuyển `context` ở cả live và sandbox;
   - `ExecutionService` lấy `userId` từ `conversations.user_id` của kế hoạch (đọc DB, không lấy từ request), và `connections` từ kế hoạch đã kiểm toàn vẹn. Truyền vào `getAdapterForService` qua closure khi tạo `StepRunner`, ở mọi đường: chạy, thử lại, bỏ qua, chạy tiếp, khôi phục;
   - `gatherSearch` trong `server.ts` dùng `actor.userId` với `phase: 'planning'`;
   - `getToolCatalogFor(credentialRepo, encryptionKey, { userId, gmailEnabled })` trong `registered-services.ts` trả tool của dịch vụ chung như `getConfiguredToolCatalog`, cộng `GMAIL_TOOLS` khi `gmailEnabled` và người đó có kết nối `active`. `server.ts` của task này gọi với `gmailEnabled: false`; GMAIL-02 đổi.
10. **Gắn kế hoạch với kết nối** (`chat-service.ts`). Sau validator, trước `resourceLabels`, `plan_hash` và `createPlan`:
    - xoá mọi `connections` model tự viết;
    - nếu có bước `gmail.*`, ghi `connections.gmail = { credentialId, email }` của kết nối `active` hiện tại. Không còn kết nối thì không lưu kế hoạch, trả từ chối với `unavailableServices: [{ id: 'gmail', name: 'Gmail' }]`;
    - lấy kết nối qua một dependency truyền vào `ChatService`, không đọc DB trực tiếp trong service;
    - kế hoạch cũ đưa lại vào lịch sử cho model không kèm `connections`.

## Test tối thiểu

- **Migration** (PostgreSQL thật): CHECK của `oauth_states` theo ba mode; chèn bản ghi Gmail `user_id` NULL bị chặn; dữ liệu 0001–0008 giữ nguyên.
- **Routes:** HTTP thật + PostgreSQL + máy chủ Google giả:
  - kết nối thành công lưu đúng `config` mã hoá;
  - thiếu `refresh_token`, thiếu quyền → không có bản ghi;
  - state hết hạn, đã dùng, sai người, sai phiên, sai trình duyệt, phiên đã đăng xuất → `GMAIL_STATE_INVALID`;
  - state `login` ở callback Gmail và state `connect_gmail` ở callback đăng nhập/liên kết đều bị từ chối;
  - callback muộn sau `DELETE` không tạo lại kết nối;
  - `DELETE` gọi revoke rồi xoá, kể cả khi revoke lỗi hoặc treo (bị huỷ sau 10 s);
  - cờ tắt → 404; cờ bật ở sandbox thiếu biến → 503; live thiếu biến → `validateEnv` ném lỗi.
- **Token:**
  - hai yêu cầu đồng thời chỉ tạo một request làm mới (máy chủ giả đếm);
  - người gọi huỷ `signal` không huỷ lượt chung;
  - `invalid_grant` chuyển `reconnect_required`;
  - 5xx/treo là `SERVER_ERROR`/`NETWORK` và không đổi trạng thái.
- **Hai người A và B** (đặc tả mục 6.2), dùng adapter thử ghi lại lần gọi:
  - catalog của B không có Gmail;
  - adapter của A trong cache không được trả cho B;
  - `getPersonalCredentials` không trả bản ghi `user_id` NULL kể cả khi tạm bỏ CHECK trong transaction test;
  - kết nối lại giữa lúc xem trước và lúc duyệt, bằng tài khoản khác **và** bằng đúng địa chỉ cũ: bước Gmail lỗi `AUTH_ERROR`, adapter không được gọi;
  - khởi động lại server giữa hai bước Gmail: đường khôi phục vẫn kiểm `connections.gmail`.
- **Kế hoạch:** `connections` model tự viết bị xoá; `connections.gmail` nằm trong `plan_json` và trong chuỗi băm (`verifiedRecoverySteps` vẫn đạt); sửa `credentialId` trong DB làm hỏng kiểm toàn vẹn.
- **`GET /api/services`:** mỗi người chỉ thấy trạng thái Gmail của mình; quản trị viên không thấy của người khác; ba route quản trị từ chối Gmail.
- **Bí mật:** quét log, body lỗi, SSE bằng chuỗi mẫu.
- **Cờ tắt:** `npm run check` và browser hiện có đạt không sửa assertion; test `isWriteTool('gmail.reply') === true` khi cờ tắt.

## Đột biến (đặc tả mục 6.3, phần 1)

Bỏ kiểm người trong state; bỏ kiểm `mode` của state; cho Gmail rơi về khoá chung; cache adapter theo tên dịch vụ; bỏ so `credentialId` trước bước Gmail; để model tự ghi `connections`; bỏ kiểm quyền `gmail.modify`; bỏ `GMAIL_TOOLS` khỏi catalog `isWriteTool`; Gmail vẫn bật khi cờ `off`. Ghi kết quả từng đột biến vào log.

## Tiêu chí nghiệm thu

- [ ] RED trước GREEN cho từng nhóm test trên; đột biến phần 1 đều bị bắt.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` exit 0 không sửa assertion cũ.
- [ ] `ALL_TOOLS` 33 tool, `SERVICE_REGISTRY` 8 dịch vụ; routing offline 116 câu không đổi.
- [ ] Không gọi Google thật.

## Ngoài phạm vi

- Adapter Gmail thật và giả, grounding người nhận, nhãn xem trước, nối Gmail vào planner của `server.ts` (GMAIL-02).
- Giao diện (GMAIL-03).
- Google Cloud project thật (GMAIL-04).

## Kết quả (agent thi công điền)

- PR: chưa mở; nhánh `feat/gmail-01-personal-connection`, base `ebc192d`. Nhóm trưởng giao reviewer thi công ngày 14/10; cần review độc lập trước khi merge.
- RED/GREEN và đột biến: mọi nhóm test trong mục "Test tối thiểu" viết trước và chạy fail đúng lý do, rồi mới cài đặt. 13 đột biến (9 của đặc tả mục 6.3 phần 1, cộng việc gắn route khi cờ tắt, lịch sử giữ `connections`, bỏ lượt làm mới chung, lưu callback muộn) đều bị test bắt. `npm run check` exit 0: 1.796 v3 + 173 eval; `npm run test:browser:v3` exit 0, 101 pass/1 skip qua 11 nhóm, không sửa assertion cũ; `ALL_TOOLS` 33 tool, `SERVICE_REGISTRY` 8 dịch vụ, routing offline không đổi. Số liệu từng nhóm và kết quả browser ở [log](../log/2026-10-14-reviewer-GMAIL-01-personal-connection.md).
- Điều chưa làm hoặc khác với task card:
  - mô tả tool viết tiếng Việt như các tool hiện có;
  - `gmail.list_labels` giữ trường mặc định (`id`, `name`) trong bộ nhớ làm việc; hai tool đọc thư dùng `['id', 'participants']`;
  - `/api/health` chỉ có `gmailEnabled` khi cờ bật; hàng Gmail ở `GET /api/services` và chặn route quản trị chỉ có khi Gmail dùng được. Đã sửa GMAIL-common mục 4.2;
  - callback sau khi đăng xuất trả `401 INVALID_SESSION` (middleware xác thực), không phải `GMAIL_STATE_INVALID`;
  - phần "câu Gmail của B bị từ chối" ở router thuộc GMAIL-02; GMAIL-01 kiểm từ chối ở `ChatService`;
  - không gọi Google thật.
