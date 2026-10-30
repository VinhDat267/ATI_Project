# SLACK-03 · Tool Catalog, Source Store và Vòng đời Dữ liệu Nguồn

**Trạng thái:** ĐANG TRIỂN KHAI MỘT PHẦN trên staging. Contracts,8 private read adapters, raw store, wrapper và registry/purge `messages.content` đã có mã; public integration và fullF3 còn mở. [Ma trận tiến độ và cổng nghiệm thu](../SLACK-DELIVERY.md) là trạng thái xuyên task hiện tại; các phần dưới giữ yêu cầu thiết kế.
**Nhánh dự kiến:** `feat/slack-03-tool-catalog-and-source-lifecycle` (tách nhánh con theo từng bounded PR).
**Nền đối chiếu:** `fc12e3fb` (sau merge SLACK-01 #183).
**Phụ thuộc:**
- **SLACK-01** (Foundation contracts `SlackBinding`, `SlackSourceRef`, `SlackModelPolicy`, fixture HTTP, probe offline) — ĐÃ HOÀN TẤT (`fc12e3fb`).
- **SLACK-02:** Backend/consent và UI đã vào staging; [review chung](../log/2026-10-29-slack-02-joint-review.md). Các lỗi của ứng viên PR184 cũ không phải trạng thái hiện tại. Native acceptance vẫn mở.
  - **Cổng hợp đồng:** Các interface minh họa dưới đây là bản thiết kế lịch sử, không phải chữ ký runtime mới. Khi thi công dùng binding5 trường/contracts đã đóng băng trong03A và các card con accepted; không sao chép DTO credential vào planner/public API.
    ```ts
    // Dòng chứng chỉ nội bộ - CHỈ lưu trữ DB và TokenManager/Adapter truy cập khi executeStep
    export interface SlackInternalCredentialRecord {
      id: string; // connectionId nội bộ
      atiUserId: string;
      slackAppId: string;
      workspaceId: string;
      workspaceName: string;
      slackUserId: string;
      slackUserLabel: string;
      scopes: string[];
      tokenEncrypted: string;
      status: 'active' | 'revoked' | 'reconnect_required';
      identityVersion: number;
    }

    // DTO công khai / Kết quả phân giải kết nối (Connection Resolution) - TUYỆT ĐỐI KHÔNG CHỨA TOKEN
    export interface SlackConnectionMetadata {
      id: string;
      atiUserId: string;
      slackAppId: string;
      workspaceId: string;
      workspaceName: string;
      slackUserId: string;
      slackUserLabel: string;
      scopes: string[];
      status: 'active' | 'revoked' | 'reconnect_required';
      identityVersion: number;
    }

    // Yêu cầu bắt buộc kiểm tra quyền sở hữu của caller (actor ownership)
    getConnectionMetadataForUser(atiUserId: string, connectionId: string, expectedIdentityVersion?: number): Promise<SlackConnectionMetadata | null>;
    getActiveConnectionsForUser(atiUserId: string): Promise<SlackConnectionMetadata[]>;
    getConsentForWorkspace(workspaceId: string): Promise<SlackConsentRecord | null>;
    // Token access: chỉ adapter/token manager nội bộ được phép gọi khi executeStep
    getInternalCredential(atiUserId: string, connectionId: string): Promise<SlackInternalCredentialRecord | null>;
    ```
    *Quy tắc bảo mật & phân tách an ninh:* Tuyệt đối không chấp nhận hàm tra cứu không có chủ sở hữu `getConnection(id)`. Các dòng chứng chỉ mã hóa nội bộ (`tokenEncrypted`, secrets) TUYỆT ĐỐI KHÔNG BAO GIỜ được chia sẻ làm public DTO hoặc đầu vào của planner. Tầng phân giải kết nối (connection resolution) chỉ trả về validated binding và connection metadata. Việc giải mã và truy cập token được cô lập hoàn toàn bên trong adapter / token manager.
**Đặc tả chuẩn tắc:** [Slack cá nhân và trợ lý công việc](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md) (Mục 2, 4.4, 4.5, 8, 9.1).
**Kế hoạch chi tiết:** [Slack Remaining Delivery Plan](../../superpowers/plans/2026-10-29-slack-remaining-delivery.md).

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ

Card này xây dựng danh mục công cụ `myslack.*`, kho lưu trữ dữ liệu nguồn có ACL và cơ chế thu hồi/tombstone/purge toàn diện (F3), gắn kết binding định danh bất biến từ lượt đọc đầu đến thực thi (F2), và hiện thực hóa năng lực API theo từng nhóm phương thức có nguồn từ bảng kiểm kê **354 method** (cập nhật theo snapshot mới nhất PR 185 head `811f5dc9`).

### Ranh giới phạm vi (Scope Boundaries):
1. **Không có generic dispatcher:** Tuyệt đối không tạo công cụ gọi tùy ý `myslack.call(method, args)`. Mọi tool đưa vào catalog đều phải có typed schema cụ thể, validation, phân loại sideEffect (`read` | `write`), risk level (`low` | `medium` | `high`) và chính sách duyệt.
2. **Trách nhiệm kiểm kê toàn diện (354 methods theo PR 185 snapshot):**
   - **101 method loại trừ (`excluded`):** 96 method có thông báo Enterprise-only (bao gồm 4 method `admin.slackbot.skills.*`), 3 method deprecated/retired (`files.upload`, `rtm.start`, `users.setActive`), 2 method yêu cầu app-level token (`apps.connections.open`, `apps.event.authorizations.list` phục vụ ingress SLACK-04).
   - **253 method cần probe (`probe_required`):** Bao gồm 7 method người dùng mới `slackbot.skills.*` (yêu cầu probe thực tế về gói Free/Pro và Canvas dependency); toàn bộ 253 method này phải được ánh xạ phương thức cụ thể hoặc giữ nguyên trạng thái mở với lý do kỹ thuật/quyền hạn; không được âm thầm thu hẹp scope chỉ còn `send_message` và `conversations.history`.
   - **265 method có khai báo user scopes; 89 method chưa xác định token eligibility.**
   - **Toàn bộ 354 method hiện có trạng thái `deliveryStatus: not_implemented`.** Không tuyên bố hoàn thành toàn bộ API khi các nhóm phương thức và điều kiện gói vẫn là `probe_required`.
3. **Điều kiện của `search.*`:** Theo tài liệu chính thức của Slack, `search.*` có scope tài liệu là `search:read` CỘNG VỚI các điều kiện bổ sung chưa xác định (unknown additional conditions / plan constraints). Siêu dữ liệu scope đơn lẻ KHÔNG tự động xác lập tính đủ điều kiện về token/role/plan trên môi trường native Slack; phải ghi nhận rõ scope đã có trong tài liệu cộng với các điều kiện bổ sung chưa xác định, không được tuyên bố scope là điều kiện duy nhất. Giữ đúng trạng thái `probe_required` cho đến khi có bằng chứng probe native.
4. **Không phát biểu số lượng phương thức ước lệ:** Từng nhóm phương thức được đối soát chính xác theo metadata:
   - `conversations.*`: 28 phương thức trong sitemap (27 thao tác hội thoại thông thường + 1 thao tác tạo canvas `conversations.canvases.create` thuộc nhóm Canvases).
   - `chat.*`: 13 phương thức.
   - `users.*`: 13 phương thức (11 phương thức probe_required, 1 `users.conversations`, 1 deprecated `users.setActive` thuộc nhóm loại trừ).
   - Metadata và HTTP fixture không phải bằng chứng chấp thuận Free/Pro; không hứa hẹn tính khả dụng phổ quát.
5. **Giao thức Ghi an toàn (Write-Dispatch Protocol) & Mở khóa sớm SLACK-04:**
   - Hoàn thành nhóm phương thức đọc cốt lõi (03C: `conversations` + `chat` đọc + `users`) cho phép SLACK-04 (Ingress) khởi động ngay mà không cần đợi toàn bộ các nhóm 03D/03E.
   - Thao tác ghi (write tools) bắt buộc phải có review giao thức dispatch ghi an toàn (outbox ledger, echo guard, UNKNOWN guard) trước khi kích hoạt ghi thật.

---

## 2. Phân chia Module và Quyền sở hữu (Module Ownership)

Tuân thủ nghiêm ngặt ranh giới module tại [Team Workflow](../../team-workflow.md), mỗi sub-task chỉ có đúng MỘT vai trò sở hữu mã nguồn:
- **AI / Schema Engineer:** Sở hữu `packages/tool-schemas/src/myslack-tools.ts`, `packages/tool-schemas/src/myslack-source.ts`, catalog định nghĩa schemas và types.
- **Backend Engineer:** Sở hữu `apps/chat-api/src/services/slack/`, `packages/executor/src/myslack/`, các file sửa đổi trong `packages/executor/src/runner.ts`, `packages/executor/src/controller.ts`, và migrations cơ sở dữ liệu `db/v3/`.
- **Integration / Adapter Engineer:** Sở hữu `packages/tool-adapters/src/slack/personal-slack-adapter.ts` và các file method families liên quan trong `packages/tool-adapters/`.
- **Frontend Engineer:** Sở hữu hiển thị chi tiết nguồn/preview trong cockpit và audit log tại `apps/chat-web/`.

---

## 3. Lộ trình Phân rã Bounded PRs

### Giai đoạn 03A: Hợp đồng Danh mục Schema & Vòng đời Nguồn (PR 1)
- **Code Owner:** AI / Schema Engineer (`packages/tool-schemas`)
- **Files:**
  - Create: `packages/tool-schemas/src/myslack-tools.ts`
  - Create: `packages/tool-schemas/src/myslack-source.ts`
  - Modify (verified): `packages/tool-schemas/src/index.ts`
  - Tests: `packages/tool-schemas/tests/myslack-tools.test.ts`, `packages/tool-schemas/tests/myslack-source.test.ts`
- **Nội dung:**
  - Định nghĩa metadata công cụ: `SlackToolDefinition` (tên, mô tả, parameters JSON schema, returns schema, sideEffect, risk, requiredScopes, planTier: 'free'|'pro'|'any').
  - Schema nguồn: `SlackSourceEntity { sourceRef: SlackSourceRef; contentText: string; metadata: Record<string, unknown>; expiresAt: Date; tombstoneAt: Date | null; purgedAt: Date | null }`.
  - Schema hợp đồng xóa nguồn (F3): `SlackSourcePurgeTarget { connectionId: string; workspaceId: string; resourceType: 'conversation'|'message'|'file'; resourceId: string; revision?: string }`.
  - Không đưa `myslack.*` vào `ALL_TOOLS` toàn cục khi chưa có cờ; schema từ chối mọi payload thiếu `binding`.

### Giai đoạn 03B: Kho Nguồn Bền vững, Purge Cascade & Binding Executor (PR 2)
- **Code Owner:** Backend Engineer (`apps/chat-api`, `packages/executor`, `db/v3`)
- **Files:**
  - Create: `db/v3/[proposed: NNNN_slack_source_store.sql]` (Số thứ tự migration được cấp sau reviewed backend head; cho phép stacked branches trước merge, không xung đột với `0014` của PR 184)
  - Create: `apps/chat-api/src/services/slack/slack-source-store.ts`
  - Create: `apps/chat-api/src/services/slack/slack-purge-runner.ts`
  - Modify (verified existing in repo): `packages/executor/src/runner.ts` (Kiểm tra binding trước khi gọi executeStep)
  - Modify (verified existing in repo): `packages/executor/src/controller.ts` (Pre-dispatch binding verification)
  - Tests (proposed): `apps/chat-api/tests/slack/slack-source-store.test.mjs`, `apps/chat-api/tests/slack/slack-purge-runner.test.mjs`, `packages/executor/tests/myslack-executor.test.ts`
- **Nội dung (F2 & F3):**
  - Migration tạo bảng `slack_sources` có ràng buộc khóa ngoại/ACL `(user_id, connection_id, identity_version)`, cột `tombstone_at`, `expires_at` (raw body trần 7 ngày, trích đoạn trần 30 ngày).
  - Triển khai `SlackSourceStore`: Lưu nguyên bản có ACL; truy vấn phải so khớp đúng `(atiUserId, connectionId, identityVersion)`. Nếu sai identityVersion hoặc đã tombstone -> từ chối truy cập.
  - Triển khai `SlackPurgeRunner`: Khi có sự kiện ngắt kết nối, xóa tin, hoặc hết hạn retention, ghi tombstone tức thì để chặn đọc; sau đó chạy job bền vững quét và purge sạch nội dung khỏi `slack_sources`, chat history messages, plan args, và bộ nhớ tạm (memory snapshots).
  - Invariant F4/F3: Purge runner hoạt động độc lập với cờ `MYSLACK_AUTOMATION_ENABLED` hoặc trạng thái pause.
  - Executor: Trước khi dispatch bất kỳ step `myslack.*`, kiểm tra `sameSlackBinding`, xác minh `identityVersion` hiện hành và đối chiếu hash đã duyệt.

### Giai đoạn 03C: Nhóm Phương thức Cốt lõi (Conversations & Chat & Users) (PR 3)
- **Code Owner:** Integration / Adapter Engineer (`packages/tool-adapters`)
- **Files:**
  - Create: `packages/tool-adapters/src/slack/personal-slack-adapter.ts`
  - Create: `packages/tool-adapters/src/slack/conversations-family.ts`
  - Create: `packages/tool-adapters/src/slack/chat-family.ts`
  - Create: `packages/tool-adapters/src/slack/users-family.ts`
  - Tests (proposed): `packages/tool-adapters/tests/slack/conversations-family.test.mjs`, `packages/tool-adapters/tests/slack/chat-family.test.mjs`, `packages/tool-adapters/tests/slack/users-family.test.mjs`
- **Nội dung:**
  - 27 `conversations.*` methods (phân trang cursor, lọc giới hạn Free vs Pro theo kết quả probe).
  - 13 `chat.*` methods (gửi tin, cập nhật, xóa, hẹn giờ).
  - 12 `users.*` methods hợp lệ (profile, info, lookupByEmail, presence, identity; loại trừ deprecated `users.setActive`).
  - Giao thức ghi an toàn & UNKNOWN: Mọi thao tác ghi (`chat.postMessage`, `chat.update`, `chat.delete`) đều ghi nhận `outbox_attempt` trước khi gọi HTTP. Nếu timeout (`AbortSignal`) hoặc mất kết nối -> trả `UNKNOWN`, KHÔNG tự ý retry write mà phải đối soát qua lịch sử/client_msg_id.
  - Mở khóa: Hoàn thành nhóm đọc và adapter cốt lõi của PR 3 cho phép đội kỹ thuật bắt đầu triển khai SLACK-04.

### Giai đoạn 03D: Nhóm Phương thức Nội dung & Tương tác Bổ trợ (PR 4)
- **Code Owner:** Integration / Adapter Engineer (`packages/tool-adapters`)
- **Files:**
  - Create: `packages/tool-adapters/src/slack/content-interaction-families.ts` (Pins, Reactions, Stars, Bookmarks, Reminders, DND)
  - Create: `packages/tool-adapters/src/slack/search-family.ts`
  - Create: `packages/tool-adapters/src/slack/files-family.ts`
  - Tests (proposed): `packages/tool-adapters/tests/slack/content-interaction.test.mjs`, `packages/tool-adapters/tests/slack/search-files.test.mjs`
- **Nội dung:**
  - `search.*` (3 methods: `all`, `messages`, `files`): Ghi nhận scope tài liệu `search:read` CỘNG VỚI các điều kiện bổ sung chưa xác định (unknown additional conditions / plan constraints); siêu dữ liệu scope đơn lẻ không tự xác lập tính đủ điều kiện về token/role/plan trên môi trường native, giữ trạng thái `probe_required`.
  - `files.*` (14 methods: 13 method hợp lệ bao gồm luồng upload ngoài 3 bước: `getUploadURLExternal` -> upload binary -> `completeUploadExternal`; loại trừ `files.upload` cũ).
  - `pins.*` (3), `reactions.*` (4), `bookmarks.*` (4), `reminders.*` (5), `stars.*` (3), `dnd.*` (5).

### Giai đoạn 03E: Nhóm Hợp tác Nâng cao & Bảng Đối soát 354 Methods (PR 5)
- **Code Owner:** Integration / Adapter Engineer (`packages/tool-adapters`) + AI / Schema Engineer (`docs/slack/`)
- **Files:**
  - Create: `packages/tool-adapters/src/slack/advanced-collaboration-families.ts` (Canvases 7 methods, SlackLists 12 methods, Skills 7 methods, Team 7 methods, Usergroups 7 methods)
  - Create: `packages/tool-adapters/src/slack/governance-automation-families.ts` (Apps 21, Assistant 5, Agents 11, Admin 36, Calls 6, Functions 8, Workflows 8, Views 4, Blocks 1, Bots 1, Dialog 1, Emoji 1, Entity 3, Migration 1, Rtm 1, Tooling 1, Auth 2, Api 1)
  - Modify (verified existing in repo): `docs/slack/method-inventory.json` (Cập nhật ánh xạ sau khi rà soát toàn bộ 354 method)
  - Tests (proposed): `packages/tool-adapters/tests/slack/advanced-collaboration.test.mjs`
- **Nội dung:**
  - Bảng kiểm kê đối soát toàn diện 354 phương thức theo PR 185:
    - 101 phương thức excluded (ghi rõ lý do: Enterprise admin, deprecated, app token).
    - 253 phương thức probe_required (giữ nguyên disposition, không tự phong là supported).
    - Từng nhóm chức năng (calls, workflows, apps, assistant, skills) được định danh rõ trong ledger; tuyệt đối không để phương thức nào biến mất hoặc gộp vào generic dispatcher.

---

## 4. Tiêu chí Nghiệm thu Cụ thể (Acceptance Criteria)

- [ ] **AC1 (F1 Model Policy Gate):** Trước khi bất kỳ nội dung nào từ `myslack` được đưa vào model/planner, hàm `decideSlackModelUse` từ SLACK-01 phải được gọi và trả về `{ allowed: true }`. Nếu consent bị thiếu/thu hồi hoặc provider chưa xác minh -> chặn đứng, không đưa vào prompt.
- [ ] **AC2 (F2 Workspace/Actor Isolation & Actor Ownership):**
  - Hàm truy vấn kết nối bắt buộc nhận `atiUserId` của caller: `getConnectionMetadataForUser(atiUserId, connectionId, expectedIdentityVersion)` trả về validated binding và metadata.
  - Hai workspace có kênh trùng tên hoặc trùng ID (ví dụ `C_GENERAL`) tuyệt đối không bị nhầm lẫn dữ liệu. Truy vấn của Workspace A chỉ nhận binding của A; không lấy token đầu tiên trong DB.
  - Các dòng chứng chỉ mã hóa nội bộ (internal encrypted credential rows chứa `tokenEncrypted`) tuyệt đối không chia sẻ làm public DTO hoặc đầu vào của planner. Việc giải mã và truy cập token do adapter / token manager quản lý riêng biệt tại thời điểm thực thi.
- [ ] **AC3 (F2 Ambiguous Clarification):** Khi người dùng có nhiều workspace kết nối nhưng câu hỏi không nêu rõ workspace, hệ thống trả về câu hỏi làm rõ thay vì tự ý chọn hoặc fanout bừa bãi.
- [ ] **AC4 (F3 Persisted ACL & Purge):** Khi người dùng ngắt kết nối hoặc tin nhắn nguồn bị xóa:
  - Bảng `slack_sources` lập tức ghi `tombstone_at`.
  - Mọi yêu cầu đọc sau đó trả về `SOURCE_TOMBSTONED`.
  - `SlackPurgeRunner` quét và xóa sạch trích đoạn khỏi chat history messages, plan args, memory snapshots và schedules.
  - Disconnect của User A không làm ảnh hưởng đến nguồn hợp lệ của User B trong cùng workspace.
- [ ] **AC5 (Execution Safety & UNKNOWN):** Thao tác ghi bị timeout (kích hoạt `AbortSignal` thật) không tự động retry ghi lại; trạng thái bước ghi nhận `UNKNOWN` và yêu cầu đối soát.
- [ ] **AC6 (Kiểm soát Bao phủ & Đối soát Kiểm kê 354 Methods):** Cả 354 phương thức trong snapshot PR 185 được theo dõi minh bạch trong ledger theo đúng trạng thái phân loại (`disposition`), phân phối (`deliveryStatus`) và bằng chứng native thực tế; chủ động giải quyết qua bằng chứng hoặc giữ lại tường minh unknowns/exclusions; không giữ nguyên 253 `probe_required` vĩnh viễn trong khi tuyên bố live accepted; unknown eligibility không được coi là live accepted; `search.*` ghi nhận scope `search:read` + unknown additional conditions; không có method nào bị rơi vào generic dispatcher.

---

## 5. Lệnh Kiểm tra và Cổng Bằng chứng (Command & Evidence Gates)

> Toàn bộ script và test dưới đây sử dụng PostgreSQL 16 thật và HTTP Fixture thật, không dùng mock boolean. Các lệnh chưa chạy được đánh dấu `[Proposed: not run]`.

1. **Kiểm tra Schema & Context Pure Functions:**
   ```powershell
   npm test -w @wap/tool-schemas -- tests/myslack-context.test.ts tests/myslack-policy.test.ts
   # [Proposed: not run] Chạy khi Task 1 hoàn tất:
   # npm test -w @wap/tool-schemas -- tests/myslack-tools.test.ts tests/myslack-source.test.ts
   ```
2. **Kiểm tra Migration và Source Store DB với PG16 thật:**
   ```powershell
   # [Proposed: not run] Test integration cho Source Store và Purge Cascade:
   # node --test apps/chat-api/tests/slack/slack-source-store.test.mjs
   # node --test apps/chat-api/tests/slack/slack-purge-runner.test.mjs
   ```
3. **Kiểm tra Nhóm Method với HTTP Fixture có State:**
   ```powershell
   # [Proposed: not run] Test suites tương ứng với FakeSlackPersonal mở rộng:
   # node --test packages/tool-adapters/tests/slack/conversations-family.test.mjs
   # node --test packages/tool-adapters/tests/slack/chat-family.test.mjs
   ```
4. **Kiểm tra Toàn diện Không Hồi quy:**
   ```powershell
   npm run test:slack:foundation
   npm run typecheck:v3
   npm run check
   ```
5. **Kiểm tra Không có tool rò rỉ vào baseline khi cờ tắt:**
   ```powershell
   node -e "const { ALL_TOOLS, SERVICE_REGISTRY } = require('./packages/tool-schemas'); console.assert(!ALL_TOOLS.some(t => t.service === 'myslack')); console.assert(!SERVICE_REGISTRY.some(s => s.id === 'myslack'));"
   ```

---

## 6. Kết quả (Dành cho Agent Thi công)

*(Phần này để trống cho agent thi công ghi lại kết quả RED→GREEN, commit hashes, test logs và evidence sau khi hoàn thành từng PR).*
