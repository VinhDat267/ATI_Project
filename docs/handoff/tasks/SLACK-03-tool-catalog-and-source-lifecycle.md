# SLACK-03 · Tool Catalog, Source Store và Vòng đời Dữ liệu Nguồn

**Trạng thái:** DỰ THẢO KẾ HOẠCH (Chờ Reviewer & Nhóm trưởng duyệt; chưa thực thi code).
**Nhánh dự kiến:** `feat/slack-03-tool-catalog-and-source-lifecycle` (hoặc tách nhánh con theo từng PR).
**Nền đối chiếu:** `fc12e3fb` (sau merge SLACK-01 #183).
**Phụ thuộc:**
- **SLACK-01** (Nền tảng contract danh tính `SlackBinding`, `SlackSourceRef`, `SlackModelPolicy`, fixture HTTP, probe offline) — ĐÃ HOÀN TẤT (`fc12e3fb`).
- **SLACK-02** (OAuth cá nhân confidential client, repository nhiều workspace, CAS token rotation, trạng thái chấp thuận tổ chức `SlackConsentRecord`) — ĐANG LẬP KẾ HOẠCH Ở WORKTREE RIÊNG.
- **Cổng kiểm soát hợp đồng SLACK-02 (Explicit Review Gate):** Card này KHÔNG giả định code SLACK-02 đã merge. Yêu cầu interface chuẩn:
  - `getSlackConnection(connectionId: string, expectedIdentityVersion?: number): Promise<SlackConnectionRecord>`
  - `getSlackConsent(workspaceId: string): Promise<SlackConsentRecord>`
  - Phải có review gate độc lập xác nhận interface trên trước khi chạy integration test cho consumer.
**Đặc tả chuẩn tắc:** [Slack cá nhân và trợ lý công việc](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md) (Mục 2, 4.4, 4.5, 8, 9.1).
**Kế hoạch chi tiết:** [Slack Remaining Delivery Plan](../../superpowers/plans/2026-10-29-slack-remaining-delivery.md).

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ

Card này xây dựng danh mục công cụ `myslack.*`, kho lưu trữ dữ liệu nguồn có ACL và cơ chế thu hồi/tombstone/purge toàn diện (F3), gắn kết binding định danh bất biến từ lượt đọc đầu đến thực thi (F2), và hiện thực hóa năng lực API theo từng nhóm phương thức có nguồn từ bảng kiểm kê 343 method đã chốt.

### Ranh giới phạm vi (Scope Boundaries):
1. **Không có generic dispatcher:** Tuyệt đối không tạo công cụ gọi tùy ý `myslack.call(method, args)`. Mọi tool đưa vào catalog đều phải có typed schema cụ thể, validation, phân loại sideEffect (`read` | `write`), risk level (`low` | `medium` | `high`) và chính sách duyệt.
2. **Trách nhiệm kiểm kê toàn diện (343 frozen methods):**
   - 97 method loại trừ (`excluded`): 92 Enterprise-only admin, 3 retired/deprecated (`files.upload`, `rtm.start`, `users.setActive`), 2 app-level token (`apps.connections.open`, `apps.event.authorizations.list` phục vụ ingress SLACK-04).
   - 246 method cần probe (`probe_required`): Phải được ánh xạ phương thức cụ thể hoặc giữ nguyên trạng thái mở với lý do kỹ thuật/quyền hạn; không được âm thầm thu hẹp scope chỉ còn `send_message` và `conversations.history`.
   - 11 method phát sinh trong đợt quét 354 method (`slackbot.skills`, `admin.slackbot.skills`): Chủ dự án và đợt refresh riêng sẽ xử lý; card này cố định trên snapshot 343 method đã duyệt.
3. **Bảo tồn quyền chưa xác minh (Unknown Entitlements):** Quyền chưa chứng minh qua native probe được đánh dấu `probe_required`, không được tự ý công bố là "đã hỗ trợ" (planned ≠ supported).
4. **Mở khóa sớm cho SLACK-04:** Sau khi nhóm phương thức cốt lõi đầu tiên (03C: `conversations` + `chat` + `users`) hoàn tất, SLACK-04 (Ingress) có thể bắt đầu thi công ngay mà không cần đợi toàn bộ các nhóm 03D/03E.

---

## 2. Phân chia Module và Quyền sở hữu (Module Ownership)

Tuân thủ nghiêm ngặt ranh giới module tại [Team Workflow](../../team-workflow.md):
- **AI / Integration Engineer:** Sở hữu `packages/tool-schemas/src/myslack-tools.ts`, `packages/tool-schemas/src/myslack-source.ts`, catalog định nghĩa schemas và types.
- **Backend Engineer:** Sở hữu `packages/tool-adapters/src/myslack/`, `packages/executor/src/myslack/`, `apps/chat-api/src/services/slack/`, `db/v3/0014_slack_source_store.sql`.
- **Frontend Engineer:** Sở hữu hiển thị chi tiết nguồn/preview trong cockpit và audit log tại `apps/chat-web/`.

---

## 3. Lộ trình Phân rã 5 Giai đoạn Bounded PRs

### Giai đoạn 03A: Hợp đồng Danh mục Schema & Vòng đời Nguồn (PR 1)
- **Files:**
  - Create: `packages/tool-schemas/src/myslack-tools.ts`
  - Create: `packages/tool-schemas/src/myslack-source.ts`
  - Modify: `packages/tool-schemas/src/index.ts`
  - Tests: `packages/tool-schemas/tests/myslack-tools.test.ts`, `myslack-source.test.ts`
- **Nội dung:**
  - Định nghĩa metadata công cụ: `SlackToolDefinition` (tên, mô tả, parameters JSON schema, returns schema, sideEffect, risk, requiredScopes, planTier: 'free'|'pro'|'any').
  - Schema nguồn: `SlackSourceEntity { sourceRef: SlackSourceRef; contentText: string; metadata: Record<string, unknown>; expiresAt: Date; tombstoneAt: Date | null; purgedAt: Date | null }`.
  - Schema hợp đồng xóa nguồn (F3): `SlackSourcePurgeTarget { connectionId: string; workspaceId: string; resourceType: 'conversation'|'message'|'file'; resourceId: string; revision?: string }`.
  - Kiểm tra tính bất biến: Không đưa `myslack.*` vào `ALL_TOOLS` toàn cục khi chưa có cờ; schema từ chối mọi payload thiếu `binding`.

### Giai đoạn 03B: Kho Nguồn Bền vững, Purge Cascade & Binding Executor (PR 2)
- **Files:**
  - Create: `db/v3/0014_slack_source_store.sql`
  - Create: `apps/chat-api/src/services/slack/slack-source-store.ts`
  - Create: `apps/chat-api/src/services/slack/slack-purge-runner.ts`
  - Modify: `packages/executor/src/step-executor.ts`
  - Tests: `apps/chat-api/tests/slack/slack-source-store.test.ts`, `slack-purge-runner.test.ts`, `packages/executor/tests/myslack-executor.test.ts`
- **Nội dung (F2 & F3):**
  - Migration 0014: Bảng `slack_sources` có ràng buộc khóa ngoại/ACL `(ati_user_id, connection_id, identity_version)`, cột `tombstone_at`, `expires_at` (raw body trần 7 ngày, trích đoạn trần 30 ngày).
  - Triển khai `SlackSourceStore`: Lưu nguyên bản có ACL; truy vấn phải so khớp đúng `(atiUserId, connectionId, identityVersion)`. Nếu sai identityVersion hoặc đã tombstone -> từ chối truy cập.
  - Triển khai `SlackPurgeRunner`: Khi có sự kiện ngắt kết nối, xóa tin, hoặc hết hạn retention, ghi tombstone tức thì để chặn đọc; sau đó chạy job bền vững quét và purge sạch nội dung khỏi `slack_sources`, chat history messages, plan args, và bộ nhớ tạm (memory snapshots).
  - Invariant F4/F3: Purge runner hoạt động độc lập với cờ `MYSLACK_AUTOMATION_ENABLED` hoặc trạng thái pause.
  - Executor: Trước khi dispatch bất kỳ step `myslack.*`, kiểm tra `sameSlackBinding`, xác minh `identityVersion` hiện hành và đối chiếu hash đã duyệt.

### Giai đoạn 03C: Nhóm Phương thức Cốt lõi (Conversations & Chat & Users) (PR 3)
- **Files:**
  - Create: `packages/tool-adapters/src/myslack/personal-slack-adapter.ts`
  - Create: `packages/tool-adapters/src/myslack/conversations-family.ts`
  - Create: `packages/tool-adapters/src/myslack/chat-family.ts`
  - Create: `packages/tool-adapters/src/myslack/users-family.ts`
  - Tests: `packages/tool-adapters/tests/myslack/conversations-family.test.ts`, `chat-family.test.ts`, `users-family.test.ts`
- **Nội dung:**
  - 27 `conversations.*` methods: `list`, `history`, `replies`, `info`, `members`, `open`, `close`, `create`, `archive`, `unarchive`, `rename`, `setTopic`, `setPurpose`, `join`, `leave`, `invite`, `kick`... Phân trang chuẩn bằng cursor, phân định rõ giới hạn Free (lịch sử bị cắt) vs Pro.
  - 13 `chat.*` methods: `postMessage`, `update`, `delete`, `postEphemeral`, `scheduleMessage`, `deleteScheduledMessage`, `getPermalink`, `meMessage`...
  - 11 `users.*` methods: `info`, `list`, `profile.get`, `profile.set`, `lookupByEmail`, `getPresence`, `setPresence`, `identity`...
  - Xử lý trạng thái `UNKNOWN` và Outbox an toàn: Mọi thao tác ghi (`chat.postMessage`, `chat.update`, `chat.delete`) đều ghi nhận `outbox_attempt` trước khi gọi HTTP. Nếu timeout hoặc mất kết nối -> trả `UNKNOWN`, KHÔNG tự ý retry write mà phải đối chiếu qua lịch sử/client_msg_id.
  - Mở khóa: Hoàn thành PR 3 cho phép đội kỹ thuật bắt đầu triển khai SLACK-04.

### Giai đoạn 03D: Nhóm Phương thức Nội dung & Tương tác Bổ trợ (PR 4)
- **Files:**
  - Create: `packages/tool-adapters/src/myslack/content-interaction-families.ts` (Pins, Reactions, Stars, Bookmarks, Reminders, DND)
  - Create: `packages/tool-adapters/src/myslack/search-family.ts`
  - Create: `packages/tool-adapters/src/myslack/files-family.ts`
  - Tests: `packages/tool-adapters/tests/myslack/content-interaction.test.ts`, `search-files.test.ts`
- **Nội dung:**
  - `search.*` (3 methods: `all`, `messages`, `files`): Kiểm tra quyền tìm kiếm người dùng (đặc thù gói Pro).
  - `files.*` (14 methods: `list`, `info`, `delete`, `getUploadURLExternal`, `completeUploadExternal`, `sharedPublicURL`, `revokePublicURL`... Lưu ý phương thức cũ `files.upload` bị loại trừ theo inventory).
  - `pins.*` (3), `reactions.*` (4), `bookmarks.*` (4), `reminders.*` (5), `stars.*` (3), `dnd.*` (5).
  - Quản lý trạng thái đa bước cho upload file ngoài (External Upload URL -> upload binary -> complete upload) với error handling từng bước độc lập.

### Giai đoạn 03E: Nhóm Hợp tác Nâng cao & Quản trị Workspace (PR 5)
- **Files:**
  - Create: `packages/tool-adapters/src/myslack/advanced-collaboration-families.ts` (Canvases, Lists, Team, Usergroups)
  - Tests: `packages/tool-adapters/tests/myslack/advanced-collaboration.test.ts`
  - Modify: `docs/slack/method-inventory.json` (Cập nhật mapping trạng thái thực thi sau khi hoàn thành)
- **Nội dung:**
  - `canvases.*` (7 methods) & `slackLists.*` (12 methods): Yêu cầu kiểm tra năng lực gói dịch vụ thực tế (paid plan feature check).
  - `team.*` (7 methods), `usergroups.*` (7 methods).
  - Đóng bảng kiểm kê: Đối soát từng dòng trong 343 method; các dòng chưa có native live evidence giữ nguyên `probe_required` và `deliveryStatus: not_implemented` tại môi trường live.

---

## 4. Tiêu chí Nghiệm thu Cụ thể (Acceptance Criteria)

- [ ] **AC1 (F1 Model Policy Gate):** Trước khi bất kỳ nội dung nào từ `myslack` được đưa vào model/planner, hàm `decideSlackModelUse` từ SLACK-01 phải được gọi và trả về `{ allowed: true }`. Nếu consent bị thiếu/thu hồi hoặc provider chưa xác minh -> chặn đứng, không đưa vào prompt.
- [ ] **AC2 (F2 Workspace/Actor Isolation):** Hai workspace có kênh trùng tên hoặc trùng ID (ví dụ `C_GENERAL`) tuyệt đối không bị nhầm lẫn dữ liệu. Truy vấn của Workspace A chỉ nhận binding của A; không lấy token đầu tiên trong DB.
- [ ] **AC3 (F2 Ambiguous Clarification):** Khi người dùng có nhiều workspace kết nối nhưng câu hỏi không nêu rõ workspace, hệ thống trả về câu hỏi làm rõ thay vì tự ý chọn hoặc fanout bừa bãi.
- [ ] **AC4 (F3 Persisted ACL & Purge):** Khi người dùng ngắt kết nối hoặc tin nhắn nguồn bị xóa:
  - Bảng `slack_sources` lập tức ghi `tombstone_at`.
  - Mọi yêu cầu đọc sau đó trả về `SOURCE_TOMBSTONED`.
  - `SlackPurgeRunner` quét và xóa sạch trích đoạn khỏi chat history messages và memory snapshot.
  - Disconnect của User A không làm ảnh hưởng đến nguồn hợp lệ của User B trong cùng workspace.
- [ ] **AC5 (Execution Safety & UNKNOWN):** Thao tác ghi bị timeout (kích hoạt `AbortSignal` thật) không tự động retry ghi lại; trạng thái bước ghi nhận `UNKNOWN` và yêu cầu đối soát.
- [ ] **AC6 (Inventory Accountability):** Cả 343 phương thức trong frozen snapshot được phân định rõ: không có method nào bị rơi vào generic dispatcher; các dòng probe_required giữ nguyên trạng thái mở.

---

## 5. Lệnh Kiểm tra và Cổng Bằng chứng (Command & Evidence Gates)

> Toàn bộ script và test dưới đây sử dụng PostgreSQL 16 thật và HTTP Fixture thật, không dùng mock boolean.

1. **Kiểm tra Schema & Context Pure Functions:**
   ```powershell
   npm test -w @wap/tool-schemas -- tests/myslack-tools.test.ts tests/myslack-source.test.ts
   ```
2. **Kiểm tra Migration và Source Store DB với PG16 thật:**
   ```powershell
   # [Create] test integration cho Source Store và Purge Cascade
   node --test apps/chat-api/tests/slack/slack-source-store.test.mjs
   node --test apps/chat-api/tests/slack/slack-purge-runner.test.mjs
   ```
3. **Kiểm tra Nhóm Method với HTTP Fixture có State:**
   ```powershell
   # [Create] test suites tương ứng với FakeSlackPersonal mở rộng
   node --test packages/tool-adapters/tests/myslack/conversations-family.test.mjs
   node --test packages/tool-adapters/tests/myslack/chat-family.test.mjs
   ```
4. **Kiểm tra Toàn diện Không Hồi quy:**
   ```powershell
   npm run test:slack:foundation
   npm run typecheck:v3
   npm run check
   ```
5. **Kiểm tra Không có tool rò rỉ vào baseline khi cờ tắt:**
   ```powershell
   # Assert ALL_TOOLS và SERVICE_REGISTRY không đổi khi cờ tắt
   node -e "const { ALL_TOOLS, SERVICE_REGISTRY } = require('./packages/tool-schemas'); console.assert(!ALL_TOOLS.some(t => t.service === 'myslack')); console.assert(!SERVICE_REGISTRY.some(s => s.id === 'myslack'));"
   ```

---

## 6. Kết quả (Dành cho Agent Thi công)

*(Phần này để trống cho agent thi công ghi lại kết quả RED→GREEN, commit hashes, test logs và evidence sau khi hoàn thành từng PR).*
