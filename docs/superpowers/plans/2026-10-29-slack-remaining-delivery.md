# Slack Personal Assistant Delivery Plan (SLACK-03 through SLACK-07)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện toàn bộ kiến trúc trợ lý công việc và tích hợp Slack cá nhân đa workspace trong ATI — từ danh mục công cụ typed schema theo phương thức trên nền kiểm kê 354 methods (PR 185), kho lưu trữ nguồn có ACL và purge cascade (F3), gắn kết binding định danh bất biến (F2), ingress ký số và an toàn thực thi UNKNOWN (F4), ba chế độ phân loại theo ranh giới liên quan cá nhân có kiểm soát F1, đến Hộp đề xuất duyệt việc trong ATI và bộ đo đánh giá live.

**Architecture:** Áp dụng Domain-Driven Design (DDD) và Deep Modules để phân tầng hệ thống nghiêm ngặt. Tầng schema thuần (`packages/tool-schemas`) định hình hợp đồng công cụ và vòng đời nguồn; tầng adapter (`packages/tool-adapters`) giao tiếp với Slack Web API bằng user token; tầng executor & outbox (`packages/executor`) đảm bảo an toàn tuyệt đối chống echo lặp và chống retry mù khi UNKNOWN; tầng backend (`apps/chat-api`) quản lý ingress ký số, fanout quyền, hàng đợi bền vững và kho lưu trữ nguồn có tombstone/purge; tầng AI planner (`packages/planner`) vận hành 3 chế độ phân loại kèm F1 model gate; tầng frontend (`apps/chat-web`) cung cấp Hộp đề xuất kiểm soát duyệt việc; tầng đánh giá (`evaluations/`) đo lường benchmark trên bộ nhãn cam kết trước khi live.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.6+, Express 5, React 19, PostgreSQL 16 (pg pool), Vitest, `node:test`, native fetch/crypto.

**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md), bản duyệt `d479b098`.

---

## Global Constraints

- “OAuth bằng tài khoản Slack của người dùng; thao tác dưới danh nghĩa người đó.”
- “Hỗ trợ Free và Pro; hướng tới toàn bộ khả năng API phù hợp với hai gói và quyền thực tế của người kết nối.”
- “Bao phủ mọi kênh công khai, kênh riêng, DM và nhóm DM mà người kết nối được quyền truy cập; không yêu cầu chọn một danh sách kênh cho phép.”
- “Một tài khoản ATI kết nối đồng thời nhiều workspace Slack.”
- “Có đủ ba chế độ: luật, AI đánh giá tin mới, kết hợp luật và AI; chọn đúng một chế độ cho từng workspace.”
- “Cấu hình thuộc từng người dùng ATI trong từng workspace, không áp chung cho mọi thành viên.”
- “Nhận và duyệt đề xuất TRONG ATI; không thêm luồng duyệt trong Slack.”
- “Chỉ tạo đề xuất việc liên quan đến người kết nối hoặc thread họ chủ động theo dõi; không gom mọi việc chung trong kênh thành việc của họ.”
- “Mọi gather/search/lookup mang binding do server xác nhận gồm ATI user, connectionId, workspaceId, Slack user, identityVersion.”
- “Tuyệt đối không có công cụ gọi tùy ý method + args.”
- “Trước thu thập/lưu nội dung nguồn phải có quyền xử lý phù hợp (F1).”
- “Purge là công việc bền vững có retry và trạng thái, vẫn chạy khi feature/automation tắt (F3/F4).”
- “UNKNOWN: sau khi gửi nhưng không biết kết quả thì không tự retry write (Execution Safety).”
- “`MYSLACK_ENABLED=off` và `MYSLACK_AUTOMATION_ENABLED=off` mặc định; live-enable bằng PR riêng biệt.”

---

## Review Focus

1. **Workspace & Actor Isolation (F2):** Hai workspace có kênh hoặc người dùng trùng tên/ID tuyệt đối không bị trộn lẫn; binding được bảo toàn từ lúc đọc, qua memory/plan, đến bước thực thi cuối cùng. Tra cứu kết nối bắt buộc nhận `atiUserId` của caller: `getConnectionForUser(atiUserId, connectionId)`.
2. **Organization Consent & Model Gate (F1):** Tổ chức chưa cấp phép hoặc đã thu hồi consent, hoặc provider chưa được xác minh không dùng dữ liệu huấn luyện: tuyệt đối không gửi dữ liệu nguồn/bản tóm tắt vào model trên MỌI luồng (Mode AI, Hybrid, Planner của Mode Luật, Daily Digest, Tra cứu thủ công).
3. **Data Lifecycle & Cascade Purge (F3):** Khi người dùng ngắt kết nối hoặc tin nhắn bị sửa/xóa trên Slack: lập tức tombstone chặn đọc, sau đó purge toàn bộ dữ liệu nguồn khỏi `slack_sources`, chat history messages, plan args, memory snapshots và schedules. Disconnect của User A không xóa nguồn hợp lệ của User B trong cùng workspace.
4. **Flag & Pause Independence (F4) & Durable ACK Invariant:**
   - Ingress ký số HMAC-SHA256 trên raw buffer trong bộ nhớ.
   - TUYỆT ĐỐI KHÔNG gửi ACK 200 cho sự kiện cần xử lý trước khi receipt/job đã commit bền vững vào DB; nếu DB lỗi thì trả 500/503 để Slack retry.
   - Khi cờ automation tắt hoặc workspace tạm dừng: Ký số vẫn bắt buộc; tin nhắn thường được xác thực rồi ACK và bỏ qua ngay trong bộ nhớ (không lưu body, không tạo job); nhưng sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`) VẪN ĐƯỢC XỬ LÝ ĐẦY ĐỦ để bảo vệ dữ liệu.
5. **Execution Safety & UNKNOWN State:** Thao tác ghi gặp timeout mạng hoặc client abort sau khi dispatch: bước chuyển trạng thái `UNKNOWN`, hệ thống tuyệt đối không tự ý retry write mù; phải đối soát qua outbox ledger và lịch sử kênh. Giao thức write-dispatch phải được duyệt trước khi mở bất kỳ tool ghi nào.

---

## 1. Cổng Phụ thuộc Hợp đồng SLACK-02 & Đối chiếu PR 184

Draft PR 184 (`ac448dd39fd8b9188c4ebc967cb735454bbc803d`) hiện có migration `db/v3/0014_slack_oauth_connections.sql` định nghĩa bảng `slack_connections` và `slack_oauth_states`.
- **Tình trạng Thẩm định SLACK-02:** PR 184 CHƯA ĐƯỢC PHÊ DUYỆT do tồn tại lỗi tái hiện trên PostgreSQL thật: hai state hợp lệ cùng session ATI nhưng khác workspace bị DELETE toàn cục làm mất 1 state; đồng thời bảng chấp thuận tổ chức F1 / provider trust `SlackConsentRecord` vẫn còn thiếu.
- **Quy tắc Migration Database & Xếp chồng Nhánh (Stacked Branches):** Tuyệt đối không tạo file trùng tên `0014_...sql`. Mọi migration tiếp theo từ SLACK-03 trở đi được đánh số đề xuất `[proposed: NNNN_...sql]`. Các nhánh đã được chấp thuận trước đó có thể được xếp chồng (stacked branches) trước khi merge; việc cấp phát số thứ tự migration được thực hiện tuần tự sau reviewed backend head, không đòi hỏi user phải merge sớm vào main để tạo tiến độ.
- **Hợp đồng Giao diện Yêu cầu (Prerequisite Requirements Gate):** Card này KHÔNG giả định chữ ký code của PR 184 đã chuẩn hóa. Tầng tiêu thụ ở SLACK-03 yêu cầu interface giao ước tối thiểu:
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

  export interface SlackConsentRecord {
    workspaceId: string;
    status: 'pending' | 'granted' | 'revoked';
    policyVersion: string;
    providerId: string;
    retentionDays: number;
  }

  export interface ISlackConnectionRepository {
    // Phân giải kết nối cho người dùng: trả về metadata/binding hợp lệ
    getConnectionMetadataForUser(atiUserId: string, connectionId: string, expectedIdentityVersion?: number): Promise<SlackConnectionMetadata | null>;
    getActiveConnectionsForUser(atiUserId: string): Promise<SlackConnectionMetadata[]>;
    getConsentForWorkspace(workspaceId: string): Promise<SlackConsentRecord | null>;
    // Truy cập token nội bộ: chỉ adapter/token manager được phép gọi khi executeStep
    getInternalCredential(atiUserId: string, connectionId: string): Promise<SlackInternalCredentialRecord | null>;
  }
  ```
  *Quy tắc an ninh dữ liệu:* Tuyệt đối không chấp nhận hàm tra cứu không có chủ sở hữu `getConnection(id)`. Các dòng chứng chỉ mã hóa nội bộ (`tokenEncrypted`, secrets) TUYỆT ĐỐI KHÔNG BAO GIỜ được chia sẻ làm public DTO hoặc đầu vào của planner. Tầng phân giải kết nối (connection resolution) chỉ trả về validated binding và connection metadata. Việc giải mã và truy cập token được cô lập hoàn toàn bên trong adapter / token manager.

---

## 2. Bảng Đối soát Danh mục 354 Methods (PR 185 Inventory Reconciliation)

Kế hoạch đối soát toàn diện trên snapshot mới nhất PR 185 (head `811f5dc9`):
- **Tổng số:** 354 phương thức canonical.
- **101 phương thức loại trừ (`excluded`):** 96 Enterprise-only (bao gồm 4 `admin.slackbot.skills.*`), 3 deprecated/retired (`files.upload`, `rtm.start`, `users.setActive`), 2 app-level token (`apps.connections.open`, `apps.event.authorizations.list`).
- **253 phương thức cần probe (`probe_required`):** Bao gồm 7 phương thức người dùng `slackbot.skills.*` (cần probe Free/Pro và Canvas dependency).
- **265 phương thức có user scopes; 89 phương thức chưa xác định token eligibility.**
- **0 phương thức được công bố là đã hỗ trợ (`deliveryStatus: not_implemented` cho cả 354 row).**
- **Sổ cái phân bổ các nhóm phương thức:**
  - `conversations`: 28 phương thức trong sitemap (27 thao tác hội thoại thông thường + 1 thao tác canvas `conversations.canvases.create` thuộc Canvases).
  - `chat`: 13 phương thức.
  - `users`: 13 phương thức (11 probe_required, 1 `users.conversations`, 1 deprecated `users.setActive`).
  - `search`: 3 phương thức (`search.all`, `search.files`, `search.messages`) — Có scope tài liệu `search:read` CỘNG VỚI các điều kiện bổ sung chưa xác định (unknown additional conditions / plan constraints); siêu dữ liệu scope đơn lẻ không tự xác lập tính đủ điều kiện về token/role/plan trên môi trường native, giữ trạng thái `probe_required`.
  - `files`: 14 phương thức (13 hợp lệ + 1 deprecated `files.upload`).
  - `pins`: 3, `reactions`: 4, `bookmarks`: 4, `reminders`: 5, `stars`: 3, `dnd`: 5.
  - `canvases`: 7, `slackLists`: 12, `skills`: 7 (user-scoped).
  - `team`: 7, `usergroups`: 7.
  - `apps`: 21, `assistant`: 5, `agents`: 11, `admin`: 36, `calls`: 6, `functions`: 8, `workflows`: 8, `views`: 4, `blocks`: 1, `bots`: 1, `dialog`: 1, `emoji`: 1, `entity`: 3, `migration`: 1, `rtm`: 1, `tooling`: 1, `auth`: 2, `api`: 1.
  - Tuyệt đối không dùng generic dispatcher `method + args`.

---

## 3. Bảng Phân bổ Module & Quyền sở hữu (Module Ownership)

| Thành phần | Đường dẫn Thư mục | Quyền Sở hữu (Role) | Quy tắc Phân quyền |
|---|---|---|---|
| Schemas & Contracts | `packages/tool-schemas/src/myslack-*` | AI / Schema Engineer | Sửa đổi cần review chung; Backend dùng |
| Adapters | `packages/tool-adapters/src/slack/` | Integration / Adapter Engineer | Sở hữu riêng |
| Executor & Outbox | `packages/executor/src/myslack/`, `runner.ts`, `controller.ts` | Backend Engineer | Sở hữu riêng |
| Backend Routes & Services | `apps/chat-api/src/services/slack/`, `routes/` | Backend Engineer | Sở hữu riêng |
| Database Migrations | `db/v3/[proposed: NNNN_...sql]` | Backend Engineer | Shared DB, số thứ tự cấp sau reviewed backend head (cho phép stacked branches) |
| Prompts & Planner | `prompts/`, `packages/planner/src/slack/`, `planner.ts` | AI Engineer | Sở hữu riêng |
| Frontend Cockpit & Inbox | `apps/chat-web/src/components/slack/` | Frontend Engineer | Sở hữu riêng |
| Evaluations | `evaluations/slack/`, `scripts/eval-*.mjs` | AI Engineer | Sở hữu riêng |
| Docs & Inventory | `docs/slack/`, `docs/handoff/` | Shared / Planning Owner | Ghi nhật ký đầy đủ |

---

## 4. Danh mục Chi tiết Nhiệm vụ Triển khai (Detailed Task Breakdown)

```
SLACK-03: Tool Catalog & Source Lifecycle
  ├── Task 1 (03A): Tool Schemas, Definition Contracts & Source ACL Schemas (PR 1 - AI/Schema)
  ├── Task 2 (03B): Database Migration, Source Store & Cascade Purge Runner (PR 2 - Backend)
  ├── Task 3 (03C): First Valid Family (Conversations, Chat, Users) & UNKNOWN Safety (PR 3 - Integration)
  ├── Task 4 (03D): Content & Collaboration Families (Search, Files, Pins, Reactions) (PR 4 - Integration)
  └── Task 5 (03E): Advanced Families & 354 Method Reconciliation Ledger (PR 5 - Integration/AI)

SLACK-04: Ingress Lifecycle & Execution Safety (Bắt đầu sau Task 3 / PR 3 của SLACK-03)
  ├── Task 6 (04A): Signed Webhook Route, Timestamp Freshness & Durable Commit ACK (PR 6 - Backend)
  ├── Task 7 (04B): Authorizations Fanout via App Token, Durable Queue & F4 Lifecycle (PR 7 - Backend)
  └── Task 8 (04C): Outbox Ledger, Echo Guard vs User Typing & UNKNOWN State Guard (PR 8 - Backend)

SLACK-05: Workspace Modes & Triage Engine
  ├── Task 9 (05A): Workspace Configuration Schema, Migration & Rules Engine (PR 9 - Backend/AI)
  ├── Task 10 (05B): AI Triage Prompt, F1 Model Policy Gate & Budget Tracker (PR 10 - AI/Backend)
  └── Task 11 (05C): Unified Triage Worker, CAS Configuration Versioning & Debounce (PR 11 - Backend)

SLACK-06: Proposal Inbox & Approval Gates
  ├── Task 12 (06A): Proposals API, Migration & Proposal Service (PR 12 - Backend)
  ├── Task 13 (06B): Proposal Inbox React UI, Workspace Partitioning & Cockpit Preview (PR 13 - Frontend)
  └── Task 14 (06C): Multi-Service Workflows, Daily Digest & F3 UI Masking (PR 14 - Backend/Frontend/AI)

SLACK-07: Evaluations & Live Acceptance
  ├── Task 15 (07A): Pre-labelled Dataset Commitment & Benchmark Harness (PR 15 - AI)
  ├── Task 16 (07B): 3-Mode Benchmark Execution (3 Runs / Mode) & Performance Report (PR 16 - AI)
  ├── Task 17 (07C): Live Acceptance on Free & Pro Workspaces, 2 Users & Readback (PR 17 - Reviewer/Leader)
  └── Task 18 (07D): Release PR Toggling MYSLACK_ENABLED and MYSLACK_AUTOMATION_ENABLED (PR 18 - Reviewer/Leader)
```

---

### Task 1: (03A) Tool Schemas, Definition Contracts & Source ACL Schemas

**Code Owner:** AI / Schema Engineer (`packages/tool-schemas`)
**Files:**
- Create: `packages/tool-schemas/src/myslack-tools.ts`
- Create: `packages/tool-schemas/src/myslack-source.ts`
- Modify (verified): `packages/tool-schemas/src/index.ts`
- Tests: `packages/tool-schemas/tests/myslack-tools.test.ts`, `packages/tool-schemas/tests/myslack-source.test.ts`

- [ ] **Step 1:** Viết tests kiểm tra cấu trúc `SlackToolDefinition`: bắt buộc có tên hợp lệ, sideEffect (`read` | `write`), risk level (`low` | `medium` | `high`), requiredScopes, và JSON schema cho parameters/returns. Kiểm tra `SlackSourceEntity` và `SlackSourcePurgeTarget` từ chối các đối tượng thiếu binding hoặc version không hợp lệ.
- [ ] **Step 2:** Chạy `npm test -w @wap/tool-schemas -- tests/myslack-tools.test.ts tests/myslack-source.test.ts`; mong đợi FAIL do chưa có file/export.
- [ ] **Step 3:** Triển khai `myslack-tools.ts` và `myslack-source.ts`, export qua `packages/tool-schemas/src/index.ts`. Không đăng ký vào `ALL_TOOLS` toàn cục khi chưa có cờ.
- [ ] **Step 4:** Chạy lại lệnh test; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): define personal tool schemas and source entity contracts`.

---

### Task 2: (03B) Migration Source Store Bền vững & Cascade Purge Runner

**Code Owner:** Backend Engineer (`apps/chat-api`, `packages/executor`, `db/v3`)
**Files:**
- Create: `db/v3/[proposed: NNNN_slack_source_store.sql]` (Số thứ tự migration được cấp sau khi chốt backend head)
- Create: `apps/chat-api/src/services/slack/slack-source-store.ts`
- Create: `apps/chat-api/src/services/slack/slack-purge-runner.ts`
- Modify (verified): `packages/executor/src/runner.ts` (Kiểm tra binding trước khi gọi executeStep)
- Modify (verified): `packages/executor/src/controller.ts` (Pre-dispatch binding verification)
- Tests (proposed): `apps/chat-api/tests/slack/slack-source-store.test.mjs`, `apps/chat-api/tests/slack/slack-purge-runner.test.mjs`, `packages/executor/tests/myslack-executor.test.ts`

- [ ] **Step 1:** Viết integration test với PG16 thật: kiểm tra insert source có ACL; get source với đúng `(atiUserId, connectionId, identityVersion)` -> trả kết quả; get với sai identityVersion hoặc đã tombstone -> trả null/tombstoned error; chạy purge runner -> toàn bộ bản ghi tombstoned và trích đoạn liên quan trong chat history bị che/xóa.
- [ ] **Step 2:** Chạy test integration; mong đợi FAIL do chưa có bảng và module.
- [ ] **Step 3:** Viết migration tạo bảng `slack_sources` có các cột `(id, user_id, connection_id, identity_version, workspace_id, resource_type, resource_id, revision, content_text, expires_at, tombstone_at, purged_at)`.
- [ ] **Step 4:** Triển khai `SlackSourceStore` và `SlackPurgeRunner`. Trong `runner.ts` và `controller.ts`, bổ sung bước kiểm tra binding và identityVersion trước khi thực thi.
- [ ] **Step 5:** Chạy lại test integration trên PG16; mong đợi PASS.
- [ ] **Step 6:** Commit: `feat(slack): implement persistent source store and cascade purge runner`.

---

### Task 3: (03C) First Valid Family (Conversations, Chat, Users) & UNKNOWN Safety

**Code Owner:** Integration / Adapter Engineer (`packages/tool-adapters`)
**Files:**
- Create: `packages/tool-adapters/src/slack/personal-slack-adapter.ts`
- Create: `packages/tool-adapters/src/slack/conversations-family.ts`
- Create: `packages/tool-adapters/src/slack/chat-family.ts`
- Create: `packages/tool-adapters/src/slack/users-family.ts`
- Tests (proposed): `packages/tool-adapters/tests/slack/conversations-family.test.mjs`, `packages/tool-adapters/tests/slack/chat-family.test.mjs`, `packages/tool-adapters/tests/slack/users-family.test.mjs`

- [ ] **Step 1:** Viết tests với `fake-slack-personal.mjs` mở rộng: kiểm tra 27 phương thức `conversations.*` (phân trang cursor, lọc Free vs Pro); 13 phương thức `chat.*` (gửi tin, cập nhật, xóa); 12 phương thức `users.*` hợp lệ. Viết test UNKNOWN: khi `chat.postMessage` gặp timeout `AbortSignal` sau commit, kết quả trả về `UNKNOWN`, cấm retry write tự động.
- [ ] **Step 2:** Chạy test; mong đợi FAIL do chưa có adapter.
- [ ] **Step 3:** Triển khai `PersonalSlackAdapter` và ba family cốt lõi. Triển khai cơ chế kiểm tra abort signal và gán trạng thái `UNKNOWN`.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): implement core conversations, chat and users tool families`.
*(Cột mốc quan trọng: Mở khóa triển khai SLACK-04 ngay sau Task này).*

---

### Task 4: (03D) Content & Collaboration Families (Search, Files, Pins, Reactions)

**Code Owner:** Integration / Adapter Engineer (`packages/tool-adapters`)
**Files:**
- Create: `packages/tool-adapters/src/slack/content-interaction-families.ts` (Pins, Reactions, Stars, Bookmarks, Reminders, DND)
- Create: `packages/tool-adapters/src/slack/search-family.ts`
- Create: `packages/tool-adapters/src/slack/files-family.ts`
- Tests (proposed): `packages/tool-adapters/tests/slack/content-interaction.test.mjs`, `packages/tool-adapters/tests/slack/search-files.test.mjs`

- [ ] **Step 1:** Viết tests cho `search.*` (kiểm tra scope tài liệu `search:read` cộng với các điều kiện bổ sung chưa xác định, giữ disposition `probe_required`, không tự suy diễn tính đủ điều kiện native); `files.*` (quy trình upload file ngoài 3 bước: `getUploadURLExternal` -> upload binary -> `completeUploadExternal`, xử lý lỗi từng bước); `pins`, `reactions`, `bookmarks`, `reminders`, `stars`, `dnd`.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Triển khai các family theo chuẩn typed interface và error handling.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): implement content, search and interaction tool families`.

---

### Task 5: (03E) Advanced Families & Bảng Đối soát 354 Methods

**Code Owner:** Integration / Adapter Engineer (`packages/tool-adapters`) + AI / Schema Engineer (`docs/slack/`)
**Files:**
- Create: `packages/tool-adapters/src/slack/advanced-collaboration-families.ts` (Canvases 7, SlackLists 12, Skills 7, Team 7, Usergroups 7)
- Create: `packages/tool-adapters/src/slack/governance-automation-families.ts` (Apps 21, Assistant 5, Agents 11, Admin 36, Calls 6, Functions 8, Workflows 8, Views 4, Blocks 1, Bots 1, Dialog 1, Emoji 1, Entity 3, Migration 1, Rtm 1, Tooling 1, Auth 2, Api 1)
- Modify (verified existing in repo): `docs/slack/method-inventory.json`
- Tests (proposed): `packages/tool-adapters/tests/slack/advanced-collaboration.test.mjs`

- [ ] **Step 1:** Viết tests cho `canvases.*`, `slackLists.*`, `slackbot.skills.*`, `team.*`, `usergroups.*`, kiểm tra xử lý lỗi khi gọi trên gói Free (thiếu capability).
- [ ] **Step 2:** Triển khai code các family tương ứng.
- [ ] **Step 3:** Chạy `node scripts/slack/inventory.mjs verify --input docs/slack/method-inventory.json`; đối soát theo dõi trạng thái phân loại (`disposition`), phân phối (`deliveryStatus`), và bằng chứng native của từng phương thức trên tập snapshot 354 method đã duyệt; chủ động giải quyết hoặc giữ lại tường minh các yếu tố chưa biết / loại trừ.
- [ ] **Step 4:** Chạy lại test; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): complete advanced tool families and reconcile 354 inventory rows`.

---

### Task 6: (04A) Signed Webhook Route, Timestamp Freshness & Durable Commit ACK

**Code Owner:** Backend Engineer (`apps/chat-api`)
**Files:**
- Create: `apps/chat-api/src/routes/slack-events.ts`
- Create: `apps/chat-api/src/services/slack/slack-ingress-service.ts`
- Tests (proposed): `apps/chat-api/tests/slack/slack-events-signature.test.mjs`

- [ ] **Step 1:** Viết unit tests kiểm tra: chữ ký HMAC-SHA256 sai -> 401; timestamp lệch > 300s -> 400; `url_verification` challenge -> trả đúng `challenge` string; cờ automation tắt -> ACK 200 và discard body trong memory; tin cần xử lý gặp lỗi DB -> trả 500/503 (không ACK trước khi commit DB); commit DB thành công -> trả 200 `{ ok: true }` trong < 3s.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Cấu hình Express route với middleware thu thập raw body buffer, xác thực chữ ký và timestamp.
- [ ] **Step 4:** Chạy lại test; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): add signed webhook ingress route with replay protection and durable ACK`.

---

### Task 7: (04B) Authorizations Fanout, Durable Queue & F4 Lifecycle

**Code Owner:** Backend Engineer (`apps/chat-api`, `db/v3`)
**Files:**
- Create: `db/v3/[proposed: NNNN_slack_events_and_outbox.sql]` (Số thứ tự migration được cấp sau khi chốt backend head)
- Create: `apps/chat-api/src/services/slack/slack-authorizations-resolver.ts`
- Create: `apps/chat-api/src/services/slack/slack-event-queue.ts`
- Tests (proposed): `apps/chat-api/tests/slack/slack-authorizations-fanout.test.mjs`, `apps/chat-api/tests/slack/slack-ingress-lifecycle-f4.test.mjs`

- [ ] **Step 1:** Viết tests: fanout gọi `apps.event.authorizations.list` khi event_context có mặt; map Slack user ID sang active connections; cô lập DM giữa User A và Colleague không tạo job cho User B. Viết test F4: khi cờ automation tắt -> ACK và bỏ qua tin thường, nhưng sự kiện `tokens_revoked` hoặc `message_deleted` vẫn được ghi nhận và kích hoạt purge.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Tạo migration (`slack_event_receipts`, `slack_triage_jobs`). Triển khai resolver và queue worker với giao dịch `SKIP LOCKED`.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): implement authorizations fanout and flag-independent lifecycle`.

---

### Task 8: (04C) Outbox Ledger, Echo Guard vs User Typing & UNKNOWN State Guard

**Code Owner:** Backend Engineer (`apps/chat-api`, `packages/executor`)
**Files:**
- Create: `packages/executor/src/myslack/myslack-outbox.ts`
- Create: `apps/chat-api/src/services/slack/slack-echo-guard.ts`
- Modify (verified): `packages/executor/src/runner.ts`
- Modify (verified): `packages/executor/src/controller.ts`
- Tests (proposed): `apps/chat-api/tests/slack/slack-echo-guard.test.mjs`, `packages/executor/tests/myslack-unknown-safety.test.mjs`

- [ ] **Step 1:** Viết tests: tin do ATI gửi đi có `client_msg_id` trong ledger -> Echo Guard chặn, không tạo proposal; tin do user tự gõ trong Slack -> Echo Guard cho phép đi tiếp; write bị ngắt kết nối sau commit -> Executor ghi nhận `UNKNOWN`, không phát lại write.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Triển khai `MyslackOutbox` và `SlackEchoGuard`. Cập nhật `runner.ts` và `controller.ts` với cơ chế kiểm soát trạng thái `UNKNOWN`.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): enforce echo guard and non-retryable UNKNOWN execution safety`.

---

### Task 9: (05A) Workspace Config Schema, Migration & Rules Engine

**Code Owner:** Nhóm phối hợp (Coordination Group) phân rã thành các task con đơn sở hữu (single-owner child cards/PRs, schema/interface trước):
- 05A.1 (AI / Schema Engineer): Schema & Contract định nghĩa chế độ (`packages/tool-schemas`)
- 05A.2 (Backend Engineer): Migration `slack_workspace_configs` và Deterministic Rules Engine (`db/v3`, `apps/chat-api`)
**Files:**
- Create: `packages/tool-schemas/src/myslack-config.ts`
- Create: `db/v3/[proposed: NNNN_slack_workspace_configs.sql]` (Số thứ tự migration được cấp sau khi chốt backend head)
- Create: `apps/chat-api/src/services/slack/slack-rules-engine.ts`
- Tests (proposed): `packages/tool-schemas/tests/myslack-config.test.ts`, `apps/chat-api/tests/slack/slack-rules-engine.test.mjs`

- [ ] **Step 1:** Viết tests: cấu hình theo `(atiUserId, connectionId)`; RulesEngine so khớp mentions cá nhân -> trigger intent; tin `@here`/`@channel` không có mention -> `no_action`; thread được theo dõi trong `followed_threads` -> trigger intent.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Tạo migration (`slack_workspace_configs`, `slack_followed_threads`). Triển khai `SlackRulesEngine`.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): add workspace config schema and deterministic rules engine`.

---

### Task 10: (05B) AI Triage Prompt, F1 Model Policy Gate & Budget Tracker

**Code Owner:** Nhóm phối hợp (Coordination Group) phân rã thành các task con đơn sở hữu (single-owner child cards/PRs, schema/interface trước):
- 05B.1 (AI Engineer): Prompt AI triage & Triage planner integration (`prompts`, `packages/planner`)
- 05B.2 (Backend Engineer): Budget Tracker & usage storage (`apps/chat-api`)
**Files:**
- Create: `prompts/slack-triage.prompt.txt`
- Create: `packages/planner/src/slack/slack-triage-planner.ts`
- Create: `apps/chat-api/src/services/slack/slack-budget-tracker.ts`
- Modify (verified existing in repo): `packages/planner/src/planner.ts` (Tích hợp F1 policy check trước khi xử lý tin nhắn)
- Tests (proposed): `packages/planner/tests/slack/slack-triage-planner.test.ts`, `apps/chat-api/tests/slack/slack-budget-tracker.test.mjs`

- [ ] **Step 1:** Viết tests: prompt phân biệt việc cá nhân vs việc chung; kiểm tra F1 `decideSlackModelUse` trước khi gọi provider (consent revoked -> chặn gọi); budget tracker trừ token/lượt gọi và chuyển trạng thái `paused_budget_exceeded` khi vượt trần. Đảm bảo dữ liệu đầu vào chỉ chứa validated binding/metadata, không chứa internal encrypted credential rows.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Xây dựng prompt triage, triage planner và budget tracker.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): implement AI triage planner with F1 policy gate and budget tracker`.

---

### Task 11: (05C) Unified Triage Worker, CAS Configuration Versioning & Debounce

**Code Owner:** Backend Engineer (`apps/chat-api`)
**Files:**
- Create: `apps/chat-api/src/services/slack/slack-triage-worker.ts`
- Tests (proposed): `apps/chat-api/tests/slack/slack-triage-worker.test.mjs`

- [ ] **Step 1:** Viết tests: worker xử lý 3 mode (Luật, AI, Kết hợp); gom tin cùng thread trong 30s; kiểm tra CAS: đổi config lúc job đang chạy -> hủy kết quả cũ, chạy lại theo config mới; cắt ngữ cảnh tối đa 20 tin / 20k ký tự và đánh dấu `context_truncated`.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Triển khai `SlackTriageWorker` tích hợp RulesEngine, TriagePlanner và BudgetTracker.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): add unified triage worker with CAS versioning and thread debouncing`.

---

### Task 12: (06A) Proposals API, Migration & Proposal Service

**Code Owner:** Backend Engineer (`apps/chat-api`, `db/v3`)
**Files:**
- Create: `db/v3/[proposed: NNNN_slack_proposals.sql]` (Số thứ tự migration được cấp sau khi chốt backend head)
- Create: `apps/chat-api/src/routes/slack-proposals.ts`
- Create: `apps/chat-api/src/services/slack/slack-proposal-service.ts`
- Tests (proposed): `apps/chat-api/tests/slack/slack-proposals-api.test.mjs`

- [ ] **Step 1:** Viết tests API: `GET /api/slack/proposals` lọc theo connection/workspace/status; `POST .../approve` duyệt đề xuất; `POST .../reject` từ chối; tự động đánh dấu `expired` sau 7 ngày.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Tạo migration (`slack_proposals`). Triển khai service và API routes.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): implement proposals API and lifecycle management`.

---

### Task 13: (06B) Proposal Inbox React UI, Workspace Partitioning & Cockpit Preview

**Code Owner:** Frontend Engineer (`apps/chat-web`)
**Files:**
- Create: `apps/chat-web/src/components/slack/SlackProposalInbox.tsx`
- Create: `apps/chat-web/src/components/slack/SlackProposalCard.tsx`
- Modify (verified existing in repo): `apps/chat-web/src/routes.ts`
- Tests (proposed): `apps/chat-web/tests/slack/SlackProposalInbox.test.tsx`

- [ ] **Step 1:** Viết frontend component tests: hiển thị chia theo workspace; hiện tên workspace và danh tính đại diện; thẻ đề xuất có deep link, trích đoạn bảo vệ ACL, và các bước hành động; nút Duyệt mở preview xác nhận.
- [ ] **Step 2:** Chạy test frontend; mong đợi FAIL.
- [ ] **Step 3:** Xây dựng component React đáp ứng responsive 1440px / 375px và dark mode.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): create proposal inbox UI with workspace partitioning`.

---

### Task 14: (06C) Multi-Service Workflows, Daily Digest & F3 UI Masking

**Code Owner:** Nhóm phối hợp (Coordination Group) phân rã thành các task con đơn sở hữu (single-owner child cards/PRs, schema/interface trước):
- 06C.1 (AI Engineer): Cross-service plan templates trong `packages/planner` (Slack intent -> Trello card + Slack reply)
- 06C.2 (Backend Engineer): Daily Digest service & API trong `apps/chat-api`
- 06C.3 (Frontend Engineer): F3 UI Masking & Redaction trong `apps/chat-web`
**Files:**
- Create: `apps/chat-api/src/services/slack/slack-digest-service.ts`
- Modify (verified existing in repo): `packages/planner/src/planner.ts` (Thêm mẫu lập plan từ Slack intent sang Trello/Jira/Sheets)
- Modify (future file created by Task 13): `apps/chat-web/src/components/slack/SlackProposalCard.tsx`
- Tests (proposed): `apps/chat-api/tests/slack/slack-digest-service.test.mjs`, `apps/chat-web/tests/slack/slack-f3-redaction.test.tsx`

- [ ] **Step 1:** Viết tests: workflow Slack mention -> tạo card Trello + trả lời Slack; Daily Digest quét lúc 09:00 tạo đề xuất tổng hợp (không tự ý ghi); khi source bị xóa -> UI thẻ đề xuất lập tức che nội dung trích dẫn. Dữ liệu chỉ sử dụng validated binding/metadata, không truyền credential rows.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Triển khai `SlackDigestService` kết nối với `schedules` và hoàn thiện logic workflow liên dịch vụ.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): integrate cross-service workflows, daily digest and F3 UI masking`.

---

### Task 15: (07A) Đóng băng Bộ Dữ liệu Đo & Benchmark Harness

**Code Owner:** AI Engineer (`evaluations/slack`)
**Files:**
- Create: `evaluations/slack/fixtures/slack-eval-cases.json`
- Create: `evaluations/slack/fixtures/slack-eval-labels.json`
- Create: `scripts/eval-slack-triage.mjs`
- Tests (proposed): `evaluations/tests/slack-eval-harness.test.mjs`

- [ ] **Step 1:** Tạo bộ 50+ test cases đa dạng (Tiếng Việt, deadline mơ hồ, chitchat, prompt injection, kênh riêng). Đóng băng file nhãn `slack-eval-labels.json` và ghi lại mã băm SHA256.
- [ ] **Step 2:** Xây dựng script benchmark tự động hóa 3 lượt chạy độc lập cho mỗi mode.
- [ ] **Step 3:** Viết test kiểm tra tính toàn vẹn của harness runner; mong đợi PASS.
- [ ] **Step 4:** Commit: `eval(slack): commit frozen evaluation dataset and benchmark runner`.

---

### Task 16: (07B) Báo cáo Đánh giá Mô hình 3 Chế độ (3 Runs / Mode)

**Code Owner:** AI Engineer (`evaluations/reports`)
**Files:**
- Create: `evaluations/reports/slack-triage-report.md`
- Modify (verified existing in repo): `docs/PROJECT-REPORT.md`

- [ ] **Step 1:** Lựa chọn tường minh evaluation provider/config và xác minh vượt qua cổng bằng chứng no-training + retention của tổ chức/nhà cung cấp trước khi đánh giá trên nội dung nguồn. (Loại bỏ runtime model hardcode; không suy diễn từ model builder như `gemini-3.8-flash-high`).
- [ ] **Step 2:** Phân tách rõ: Bộ harness ngoại tuyến trên dữ liệu tổng hợp (synthetic offline harness) được phép chạy độc lập; việc đánh giá trên dữ liệu live/nguồn thật bắt buộc phải có văn bản ủy quyền cụ thể (concrete authorization). Chạy script benchmark:
  `node scripts/eval-slack-triage.mjs --runs 3 --output evaluations/reports/slack-triage-report.md`
- [ ] **Step 3:** Kiểm tra kết quả đáp ứng ngưỡng: Precision ≥ 90%, Recall ≥ 85%, Unapproved Writes = 0, Cross-User Leaks = 0. Ghi nhận chính xác provider/model/version vào báo cáo SAU KHI lựa chọn hợp lệ hoàn tất, không suy diễn từ cấu hình builder.
- [ ] **Step 4:** Cập nhật bảng kết quả benchmark vào `docs/PROJECT-REPORT.md`.
- [ ] **Step 5:** Commit: `docs(eval): publish three-mode slack triage evaluation report`.

---

### Task 17: (07C) Nghiệm thu Live trên 2 Workspace và Readback Từng Nhóm

**Code Owner:** Reviewer / Nhóm trưởng (`docs/handoff/evidence`)
**Files:**
- Create: `docs/handoff/evidence/slack-live-acceptance.md`
- Modify (verified existing in repo): `docs/slack/method-inventory.json`

- [ ] **Step 1:** Nhóm trưởng/Reviewer cấu hình Slack App thật, kết nối 1 Workspace Free và 1 Workspace Pro với 2 tài khoản người dùng ATI.
- [ ] **Step 2:** Gửi tin nhắn webhook thật, kiểm tra đề xuất xuất hiện trong ATI Inbox, duyệt ghi Trello + Slack reply và đối chiếu readback thật trên Slack.
- [ ] **Step 3:** Thử nghiệm ngắt kết nối và kiểm tra purge dữ liệu nguồn thật.
- [ ] **Step 4:** Ghi nhận toàn bộ bằng chứng vào `docs/handoff/evidence/slack-live-acceptance.md`.
- [ ] **Step 5:** Commit: `docs(slack): record live multi-workspace acceptance and readback evidence`.

---

### Task 18: (07D) Thay đổi Phát hành & Cấu hình Triển khai (Release Configuration PR)

**Code Owner:** Reviewer / Nhóm trưởng
**Files:**
- Bảo toàn (verified existing in repo): `.env.example` (BẮT BUỘC GIỮ DEFAULT-OFF: `MYSLACK_ENABLED=off`, `MYSLACK_AUTOMATION_ENABLED=off`).
- Modify: Tài liệu hướng dẫn triển khai sản xuất và cấu hình môi trường có tên (named deployment configuration).

- [ ] **Step 1:** Bảo toàn `.env.example` ở trạng thái default-off; tuyệt đối không bật cờ trên `.env.example` rồi gọi đó là triển khai.
- [ ] **Step 2:** Áp dụng thay đổi cờ vào cấu hình triển khai có tên (named deployment configuration, ví dụ staging/production secret store) sau khi đã hoàn tất nghiệm thu P-LIVE.
- [ ] **Step 3:** Chuẩn bị kịch bản rollback chi tiết, kiểm tra trỏ đúng commit head đã qua review và nhận sự ủy quyền tường minh từ người dùng (user authorization).
- [ ] **Step 4:** Xếp chồng các nhánh đã được chấp thuận trước đó (stacked branches) trước khi merge; việc cấp phát số thứ tự migration được thực hiện tuần tự sau reviewed backend head, không đòi hỏi user phải merge sớm vào main để tạo tiến độ.
- [ ] **Step 5:** Kiểm tra toàn bộ CI xanh đúng commit head và ghi nhận biên bản phát hành.

---

## 5. Bảng Tổng hợp Tiêu chuẩn Nghiệm thu Toàn diện (Release Gates)

| Hạng mục | Tiêu chuẩn Bắt buộc | Môi trường Kiểm tra |
|---|---|---|
| **Inventory** | Bao phủ 354 phương thức snapshot đã duyệt (PR 185), không generic dispatcher; theo dõi disposition/delivery/native evidence thực tế; chủ động giải quyết hoặc giữ lại tường minh unknowns/exclusions; không giữ nguyên 253 probe_required vĩnh viễn mà tuyên bố live accepted; unknown eligibility không được coi là live accepted; search.* ghi nhận scope search:read + unknown additional conditions | Script `inventory.mjs verify` |
| **F1 Policy** | Không consent / unverified provider -> chặn mọi lời gọi model; evaluation provider qua no-training evidence gate trước khi đánh giá dữ liệu nguồn | Vitest + PG16 thật |
| **F2 Identity** | Workspace/User binding bất biến từ read -> plan -> execute; caller-scoped lookup; internal encrypted credential rows cách ly tuyệt đối, không chia sẻ làm public DTO / planner input | Vitest + Integration DB |
| **F3 Purge** | Disconnect/Delete -> tombstone tức thì, purge sạch trích đoạn chat/memory | Integration DB + UI test |
| **F4 Ingress** | Ký số bắt buộc; không ACK trước khi lưu bền vững; cờ tắt vẫn xử lý lifecycle và purge | Ingress HTTP tests |
| **Safety** | Echo Guard chặn tự lặp; UNKNOWN không tự retry write; write-dispatch reviewed | Executor tests + AbortSignal |
| **3 Modes** | Cấu hình độc lập per workspace; ranh giới cá nhân chuẩn xác; CAS versioning | Triage Worker tests |
| **Proposal Inbox** | Duyệt trong ATI; cấm tự ý ghi; sửa tham số sinh plan mới; phân biệt component hiện hữu vs tương lai (SlackProposalCard) | Web component tests |
| **Evaluations** | Precision ≥ 90%, Recall ≥ 85%, 0 unapproved writes, 0 cross leaks; provider no-training gate passed | 9 runs trên dataset cam kết |
| **P-LIVE** | Readback trên Free & Pro, 2 users chung workspace, revoke thật | Môi trường Slack thật |
| **Release & Deployment** | .env.example giữ nguyên default-off; kích hoạt chỉ áp dụng trên named deployment configuration sau nghiệm thu có rollback, đúng reviewed head và user authorization; stacked branches được phép trước merge | Runbook thẩm định phát hành |
