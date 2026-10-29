# Slack Personal Assistant Delivery Plan (SLACK-03 through SLACK-07)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện toàn bộ kiến trúc trợ lý công việc và tích hợp Slack cá nhân đa workspace trong ATI — từ danh mục công cụ typed schema theo phương thức, kho lưu trữ nguồn có ACL và purge cascade (F3), gắn kết binding định danh bất biến (F2), ingress ký số và an toàn thực thi UNKNOWN (F4), ba chế độ phân loại theo ranh giới liên quan cá nhân có kiểm soát F1, đến Hộp đề xuất duyệt việc trong ATI và bộ đo đánh giá live.

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

1. **Workspace & Actor Isolation (F2):** Hai workspace có kênh hoặc người dùng trùng tên/ID tuyệt đối không bị trộn lẫn; binding được bảo toàn từ lúc đọc, qua memory/plan, đến bước thực thi cuối cùng.
2. **Organization Consent & Model Gate (F1):** Tổ chức chưa cấp phép hoặc đã thu hồi consent, hoặc provider chưa được xác minh không dùng dữ liệu huấn luyện: tuyệt đối không gửi dữ liệu nguồn/bản tóm tắt vào model trên MỌI luồng (Mode AI, Hybrid, Planner của Mode Luật, Daily Digest, Tra cứu thủ công).
3. **Data Lifecycle & Cascade Purge (F3):** Khi người dùng ngắt kết nối hoặc tin nhắn bị sửa/xóa trên Slack: lập tức tombstone chặn đọc, sau đó purge toàn bộ dữ liệu nguồn khỏi `slack_sources`, chat history messages, plan args và memory snapshots. Disconnect của User A không xóa nguồn hợp lệ của User B trong cùng workspace.
4. **Flag & Pause Independence (F4):** Khi cờ automation tắt hoặc workspace tạm dừng: ký số và timestamp vẫn bắt buộc; tin nhắn thường được xác thực rồi ACK và bỏ qua ngay trong bộ nhớ (không lưu body, không tạo job); nhưng sự kiện vòng đời (`tokens_revoked`, `app_uninstalled`, `message_deleted`, `message_changed`) VẪN ĐƯỢC XỬ LÝ ĐẦY ĐỦ để bảo vệ dữ liệu.
5. **Execution Safety & UNKNOWN State:** Thao tác ghi gặp timeout mạng hoặc client abort sau khi dispatch: bước chuyển trạng thái `UNKNOWN`, hệ thống tuyệt đối không tự ý retry write mù; phải đối soát qua outbox ledger và lịch sử kênh.

---

## 1. Cổng Phụ thuộc Hợp đồng SLACK-02 (Prerequisite Interface & Review Gate)

SLACK-02 hiện đang được lập kế hoạch tại một worktree riêng biệt. Để đảm bảo không bị phụ thuộc vòng hoặc giả định thiếu căn cứ, các task từ SLACK-03 trở đi tuân thủ hợp đồng phụ thuộc rõ ràng:

### Hợp đồng Giao diện Yêu cầu từ SLACK-02:
```ts
export interface SlackConnectionRecord {
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

export interface SlackConsentRecord {
  workspaceId: string;
  status: 'pending' | 'granted' | 'revoked';
  policyVersion: string;
  providerId: string;
  retentionDays: number;
}

export interface ISlackConnectionRepository {
  getConnection(connectionId: string, expectedIdentityVersion?: number): Promise<SlackConnectionRecord | null>;
  getActiveConnectionsForUser(atiUserId: string): Promise<SlackConnectionRecord[]>;
  getConsent(workspaceId: string): Promise<SlackConsentRecord | null>;
}
```

### Cổng Kiểm soát Độc lập (Explicit Review Gate):
Trước khi chạy tích hợp backend của SLACK-03B/04B, reviewer độc lập phải xác nhận:
1. Module kết nối đã cung cấp đúng các method trên.
2. Không truy vấn token trực tiếp từ bảng chung `service_credentials` mà phải qua `SlackConnectionRepository`.
3. Nếu SLACK-02 chưa merge, SLACK-03 thi công tầng schema (03A) và mock adapter contract trước mà không giả lập pass giả cho integration DB.

---

## 2. Bảng Phân bổ Module & Quyền sở hữu (Module Ownership)

| Thành phần | Đường dẫn Thư mục | Quyền Sở hữu (Role) | Quy tắc Phân quyền |
|---|---|---|---|
| Schemas & Contracts | `packages/tool-schemas/src/myslack-*` | AI / Integration Engineer | Sửa đổi cần review chung; Backend dùng |
| Adapters | `packages/tool-adapters/src/myslack/` | Backend / Integration Engineer | Sở hữu riêng |
| Executor & Outbox | `packages/executor/src/myslack/` | Backend Engineer | Sở hữu riêng |
| Backend Routes & Services | `apps/chat-api/src/services/slack/`, `routes/` | Backend Engineer | Sở hữu riêng |
| Database Migrations | `db/v3/0014_...sql` đến `0017_...sql` | Backend Engineer | Shared DB, chỉ migrate tiến |
| Prompts & Planner | `prompts/`, `packages/planner/src/slack/` | AI Engineer | Sở hữu riêng |
| Frontend Cockpit & Inbox | `apps/chat-web/src/components/slack/` | Frontend Engineer | Sở hữu riêng |
| Evaluations | `evaluations/slack/`, `scripts/eval-*.mjs` | AI Engineer | Sở hữu riêng |
| Docs & Inventory | `docs/slack/`, `docs/handoff/` | Shared / Planning Owner | Ghi nhật ký đầy đủ |

---

## 3. Danh mục Chi tiết Nhiệm vụ Triển khai (Detailed Task Breakdown)

```
SLACK-03: Tool Catalog & Source Lifecycle
  ├── Task 1 (03A): Tool Schemas, Definition Contracts & Source ACL Schemas (PR 1)
  ├── Task 2 (03B): Database Migration 0014, Source Store & Cascade Purge Runner (PR 2)
  ├── Task 3 (03C): First Valid Family (Conversations, Chat, Users) & UNKNOWN Safety (PR 3)
  ├── Task 4 (03D): Content & Collaboration Families (Search, Files, Pins, Reactions) (PR 4)
  └── Task 5 (03E): Advanced Families (Canvases, Lists, Teams) & 343 Method Reconciliation (PR 5)

SLACK-04: Ingress Lifecycle & Execution Safety (Bắt đầu sau Task 3 / PR 3 của SLACK-03)
  ├── Task 6 (04A): Signed Webhook Route, Timestamp Replay Check & Raw Buffer Verification (PR 6)
  ├── Task 7 (04B): Authorizations Fanout via App Token, Durable Queue & F4 Lifecycle (PR 7)
  └── Task 8 (04C): Outbox Ledger, Echo Guard vs User Typing & UNKNOWN State Guard (PR 8)

SLACK-05: Workspace Modes & Triage Engine
  ├── Task 9 (05A): Workspace Configuration Schema, Migration 0016 & Rules Engine (PR 9)
  ├── Task 10 (05B): AI Triage Prompt, F1 Model Policy Gate & Budget Tracker (PR 10)
  └── Task 11 (05C): Unified Triage Worker, CAS Configuration Versioning & Debounce (PR 11)

SLACK-06: Proposal Inbox & Approval Gates
  ├── Task 12 (06A): Proposals API, Migration 0017 & Proposal Service (PR 12)
  ├── Task 13 (06B): Proposal Inbox React UI, Workspace Partitioning & Cockpit Preview (PR 13)
  └── Task 14 (06C): Multi-Service Workflows (Trello/Sheets), Daily Digest & F3 UI Masking (PR 14)

SLACK-07: Evaluations & Live Acceptance
  ├── Task 15 (07A): Pre-labelled Dataset Commitment & Benchmark Harness (PR 15)
  ├── Task 16 (07B): 3-Mode Benchmark Execution (3 Runs / Mode) & Performance Report (PR 16)
  ├── Task 17 (07C): Live Acceptance on Free & Pro Workspaces, 2 Users & Readback (PR 17)
  └── Task 18 (07D): Release PR Toggling MYSLACK_ENABLED and MYSLACK_AUTOMATION_ENABLED (PR 18)
```

---

### Task 1: (03A) Tool Schemas, Definition Contracts & Source ACL Schemas

**Files:**
- Create: `packages/tool-schemas/src/myslack-tools.ts`
- Create: `packages/tool-schemas/src/myslack-source.ts`
- Modify: `packages/tool-schemas/src/index.ts`
- Tests: `packages/tool-schemas/tests/myslack-tools.test.ts`, `packages/tool-schemas/tests/myslack-source.test.ts`

- [ ] **Step 1:** Viết tests kiểm tra cấu trúc `SlackToolDefinition`: bắt buộc có tên hợp lệ, sideEffect (`read` | `write`), risk level (`low` | `medium` | `high`), requiredScopes, và JSON schema cho parameters/returns. Kiểm tra `SlackSourceEntity` và `SlackSourcePurgeTarget` từ chối các đối tượng thiếu binding hoặc version không hợp lệ.
- [ ] **Step 2:** Chạy `npm test -w @wap/tool-schemas -- tests/myslack-tools.test.ts tests/myslack-source.test.ts`; mong đợi FAIL do chưa có file/export.
- [ ] **Step 3:** Triển khai `myslack-tools.ts` và `myslack-source.ts`, export qua `packages/tool-schemas/src/index.ts`. Không đăng ký vào `ALL_TOOLS` toàn cục khi chưa có cờ.
- [ ] **Step 4:** Chạy lại lệnh test; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): define personal tool schemas and source entity contracts`.

---

### Task 2: (03B) Migration 0014, Source Store Bền vững & Cascade Purge Runner

**Files:**
- Create: `db/v3/0014_slack_source_store.sql`
- Create: `apps/chat-api/src/services/slack/slack-source-store.ts`
- Create: `apps/chat-api/src/services/slack/slack-purge-runner.ts`
- Modify: `packages/executor/src/step-executor.ts`
- Tests: `apps/chat-api/tests/slack/slack-source-store.test.mjs`, `apps/chat-api/tests/slack/slack-purge-runner.test.mjs`

- [ ] **Step 1:** Viết integration test với PG16 thật: kiểm tra insert source có ACL; get source với đúng `(atiUserId, connectionId, identityVersion)` -> trả kết quả; get với sai identityVersion hoặc đã tombstone -> trả null/tombstoned error; chạy purge runner -> toàn bộ bản ghi tombstoned và trích đoạn liên quan trong chat history bị che/xóa.
- [ ] **Step 2:** Chạy test integration; mong đợi FAIL do chưa có bảng và module.
- [ ] **Step 3:** Viết migration `0014_slack_source_store.sql` tạo bảng `slack_sources` có các cột `(id, ati_user_id, connection_id, identity_version, workspace_id, resource_type, resource_id, revision, content_text, expires_at, tombstone_at, purged_at)`.
- [ ] **Step 4:** Triển khai `SlackSourceStore` và `SlackPurgeRunner`. Trong `step-executor.ts`, bổ sung bước kiểm tra binding và identityVersion trước khi thực thi.
- [ ] **Step 5:** Chạy lại test integration trên PG16; mong đợi PASS.
- [ ] **Step 6:** Commit: `feat(slack): implement persistent source store and cascade purge runner`.

---

### Task 3: (03C) First Valid Family (Conversations, Chat, Users) & UNKNOWN Safety

**Files:**
- Create: `packages/tool-adapters/src/myslack/personal-slack-adapter.ts`
- Create: `packages/tool-adapters/src/myslack/conversations-family.ts`
- Create: `packages/tool-adapters/src/myslack/chat-family.ts`
- Create: `packages/tool-adapters/src/myslack/users-family.ts`
- Tests: `packages/tool-adapters/tests/myslack/conversations-family.test.mjs`, `chat-family.test.mjs`, `users-family.test.mjs`

- [ ] **Step 1:** Viết tests với `fake-slack-personal.mjs` mở rộng: kiểm tra 27 phương thức `conversations.*` (phân trang cursor, lọc Free vs Pro); 13 phương thức `chat.*` (gửi tin, cập nhật, xóa); 11 phương thức `users.*`. Viết test UNKNOWN: khi `chat.postMessage` gặp timeout `AbortSignal` sau commit, kết quả trả về `UNKNOWN`, cấm retry write tự động.
- [ ] **Step 2:** Chạy test; mong đợi FAIL do chưa có adapter.
- [ ] **Step 3:** Triển khai `PersonalSlackAdapter` và ba family cốt lõi. Triển khai cơ chế kiểm tra abort signal và gán trạng thái `UNKNOWN`.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): implement core conversations, chat and users tool families`.
*(Cột mốc quan trọng: Mở khóa triển khai SLACK-04 ngay sau Task này).*

---

### Task 4: (03D) Content & Collaboration Families (Search, Files, Pins, Reactions)

**Files:**
- Create: `packages/tool-adapters/src/myslack/content-interaction-families.ts`
- Create: `packages/tool-adapters/src/myslack/search-family.ts`
- Create: `packages/tool-adapters/src/myslack/files-family.ts`
- Tests: `packages/tool-adapters/tests/myslack/content-interaction.test.mjs`, `search-files.test.mjs`

- [ ] **Step 1:** Viết tests cho `search.*` (kiểm tra scope và gói Pro); `files.*` (quy trình upload file ngoài 3 bước: `getUploadURLExternal` -> upload binary -> `completeUploadExternal`, xử lý lỗi từng bước); `pins`, `reactions`, `bookmarks`, `reminders`, `stars`, `dnd`.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Triển khai các family theo chuẩn typed interface và error handling.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): implement content, search and interaction tool families`.

---

### Task 5: (03E) Advanced Families (Canvases, Lists, Team) & Đối soát 343 Methods

**Files:**
- Create: `packages/tool-adapters/src/myslack/advanced-collaboration-families.ts`
- Modify: `docs/slack/method-inventory.json`
- Tests: `packages/tool-adapters/tests/myslack/advanced-collaboration.test.mjs`

- [ ] **Step 1:** Viết tests cho `canvases.*`, `slackLists.*`, `team.*`, `usergroups.*`, kiểm tra xử lý lỗi khi gọi trên gói Free (thiếu capability).
- [ ] **Step 2:** Triển khai code các family tương ứng.
- [ ] **Step 3:** Chạy `node scripts/slack/inventory.mjs verify --input docs/slack/method-inventory.json`; đối soát đầy đủ 343 method, giữ nguyên 97 excluded và 246 probe_required.
- [ ] **Step 4:** Chạy lại test; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): complete advanced tool families and reconcile 343 inventory rows`.

---

### Task 6: (04A) Signed Webhook Route, Timestamp Freshness & Raw Buffer Verification

**Files:**
- Create: `apps/chat-api/src/routes/slack-events.ts`
- Create: `apps/chat-api/src/services/slack/slack-ingress-service.ts`
- Tests: `apps/chat-api/tests/slack/slack-events-signature.test.mjs`

- [ ] **Step 1:** Viết unit tests kiểm tra: chữ ký HMAC-SHA256 sai -> 401; timestamp lệch > 300s -> 400; `url_verification` challenge -> trả đúng `challenge` string với Content-Type `text/plain` hoặc json; chữ ký đúng -> 200 `{ ok: true }` trong < 3s.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Cấu hình Express route với middleware thu thập raw body buffer, xác thực chữ ký và timestamp.
- [ ] **Step 4:** Chạy lại test; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): add signed webhook ingress route with replay protection`.

---

### Task 7: (04B) Authorizations Fanout, Durable Queue & F4 Lifecycle

**Files:**
- Create: `db/v3/0015_slack_events_and_outbox.sql`
- Create: `apps/chat-api/src/services/slack/slack-authorizations-resolver.ts`
- Create: `apps/chat-api/src/services/slack/slack-event-queue.ts`
- Tests: `apps/chat-api/tests/slack/slack-authorizations-fanout.test.mjs`, `slack-ingress-lifecycle-f4.test.mjs`

- [ ] **Step 1:** Viết tests: fanout gọi `apps.event.authorizations.list` khi event_context có mặt; map Slack user ID sang active connections; cô lập DM giữa User A và Colleague không tạo job cho User B. Viết test F4: khi cờ automation tắt -> ACK và bỏ qua tin thường, nhưng sự kiện `tokens_revoked` hoặc `message_deleted` vẫn được ghi nhận và kích hoạt purge.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Tạo migration 0015 (`slack_event_receipts`, `slack_triage_jobs`). Triển khai resolver và queue worker với giao dịch `SKIP LOCKED`.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): implement authorizations fanout and flag-independent lifecycle`.

---

### Task 8: (04C) Outbox Ledger, Echo Guard vs User Typing & UNKNOWN State Guard

**Files:**
- Create: `packages/executor/src/myslack/myslack-outbox.ts`
- Create: `apps/chat-api/src/services/slack/slack-echo-guard.ts`
- Modify: `packages/executor/src/step-executor.ts`
- Tests: `apps/chat-api/tests/slack/slack-echo-guard.test.mjs`, `packages/executor/tests/myslack-unknown-safety.test.mjs`

- [ ] **Step 1:** Viết tests: tin do ATI gửi đi có `client_msg_id` trong ledger -> Echo Guard chặn, không tạo proposal; tin do user tự gõ trong Slack -> Echo Guard cho phép đi tiếp; write bị ngắt kết nối sau commit -> Executor ghi nhận `UNKNOWN`, không phát lại write.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Triển khai `MyslackOutbox` và `SlackEchoGuard`. Cập nhật `step-executor.ts` với cơ chế kiểm soát trạng thái `UNKNOWN`.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): enforce echo guard and non-retryable UNKNOWN execution safety`.

---

### Task 9: (05A) Workspace Config Schema, Migration 0016 & Rules Engine

**Files:**
- Create: `packages/tool-schemas/src/myslack-config.ts`
- Create: `db/v3/0016_slack_workspace_configs.sql`
- Create: `apps/chat-api/src/services/slack/slack-rules-engine.ts`
- Tests: `packages/tool-schemas/tests/myslack-config.test.ts`, `apps/chat-api/tests/slack/slack-rules-engine.test.mjs`

- [ ] **Step 1:** Viết tests: cấu hình theo `(atiUserId, connectionId)`; RulesEngine so khớp mentions cá nhân -> trigger intent; tin `@here`/`@channel` không có mention -> `no_action`; thread được theo dõi trong `followed_threads` -> trigger intent.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Tạo migration 0016 (`slack_workspace_configs`, `slack_followed_threads`). Triển khai `SlackRulesEngine`.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): add workspace config schema and deterministic rules engine`.

---

### Task 10: (05B) AI Triage Prompt, F1 Model Policy Gate & Budget Tracker

**Files:**
- Create: `prompts/slack-triage.prompt.txt`
- Create: `packages/planner/src/slack/slack-triage-planner.ts`
- Create: `apps/chat-api/src/services/slack/slack-budget-tracker.ts`
- Tests: `packages/planner/tests/slack/slack-triage-planner.test.ts`, `apps/chat-api/tests/slack/slack-budget-tracker.test.mjs`

- [ ] **Step 1:** Viết tests: prompt phân biệt việc cá nhân vs việc chung; kiểm tra F1 `decideSlackModelUse` trước khi gọi provider (consent revoked -> chặn gọi); budget tracker trừ token/lượt gọi và chuyển trạng thái `paused_budget_exceeded` khi vượt trần.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Xây dựng prompt triage, triage planner và budget tracker.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): implement AI triage planner with F1 policy gate and budget tracker`.

---

### Task 11: (05C) Unified Triage Worker, CAS Configuration Versioning & Debounce

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-triage-worker.ts`
- Tests: `apps/chat-api/tests/slack/slack-triage-worker.test.mjs`

- [ ] **Step 1:** Viết tests: worker xử lý 3 mode (Luật, AI, Kết hợp); gom tin cùng thread trong 30s; kiểm tra CAS: đổi config lúc job đang chạy -> hủy kết quả cũ, chạy lại theo config mới; cắt ngữ cảnh tối đa 20 tin / 20k ký tự và đánh dấu `context_truncated`.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Triển khai `SlackTriageWorker` tích hợp RulesEngine, TriagePlanner và BudgetTracker.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): add unified triage worker with CAS versioning and thread debouncing`.

---

### Task 12: (06A) Proposals API, Migration 0017 & Proposal Service

**Files:**
- Create: `db/v3/0017_slack_proposals.sql`
- Create: `apps/chat-api/src/routes/slack-proposals.ts`
- Create: `apps/chat-api/src/services/slack/slack-proposal-service.ts`
- Tests: `apps/chat-api/tests/slack/slack-proposals-api.test.mjs`

- [ ] **Step 1:** Viết tests API: `GET /api/slack/proposals` lọc theo connection/workspace/status; `POST .../approve` duyệt đề xuất; `POST .../reject` từ chối; tự động đánh dấu `expired` sau 7 ngày.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Tạo migration 0017 (`slack_proposals`). Triển khai service và API routes.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): implement proposals API and lifecycle management`.

---

### Task 13: (06B) Proposal Inbox React UI, Workspace Partitioning & Cockpit Preview

**Files:**
- Create: `apps/chat-web/src/components/slack/SlackProposalInbox.tsx`
- Create: `apps/chat-web/src/components/slack/SlackProposalCard.tsx`
- Modify: `apps/chat-web/src/components/Sidebar.tsx`
- Tests: `apps/chat-web/tests/slack/SlackProposalInbox.test.tsx`

- [ ] **Step 1:** Viết frontend component tests: hiển thị chia theo workspace; hiện tên workspace và danh tính đại diện; thẻ đề xuất có deep link, trích đoạn bảo vệ ACL, và các bước hành động; nút Duyệt mở preview xác nhận.
- [ ] **Step 2:** Chạy test frontend; mong đợi FAIL.
- [ ] **Step 3:** Xây dựng component React đáp ứng responsive 1440px / 375px và dark mode.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): create proposal inbox UI with workspace partitioning`.

---

### Task 14: (06C) Multi-Service Workflows, Daily Digest & F3 UI Masking

**Files:**
- Create: `apps/chat-api/src/services/slack/slack-digest-service.ts`
- Modify: `packages/planner/src/workflow-planner.ts`
- Modify: `apps/chat-web/src/components/slack/SlackProposalCard.tsx`
- Tests: `apps/chat-api/tests/slack/slack-digest-service.test.mjs`, `apps/chat-web/tests/slack/slack-f3-redaction.test.tsx`

- [ ] **Step 1:** Viết tests: workflow Slack mention -> tạo card Trello + trả lời Slack; Daily Digest quét lúc 09:00 tạo đề xuất tổng hợp (không tự ý ghi); khi source bị xóa -> UI thẻ đề xuất lập tức che nội dung trích dẫn.
- [ ] **Step 2:** Chạy test; mong đợi FAIL.
- [ ] **Step 3:** Triển khai `SlackDigestService` kết nối với `schedules` và hoàn thiện logic workflow liên dịch vụ.
- [ ] **Step 4:** Chạy lại tests; mong đợi PASS.
- [ ] **Step 5:** Commit: `feat(slack): integrate cross-service workflows, daily digest and F3 UI masking`.

---

### Task 15: (07A) Đóng băng Bộ Dữ liệu Đo & Benchmark Harness

**Files:**
- Create: `evaluations/slack/fixtures/slack-eval-cases.json`
- Create: `evaluations/slack/fixtures/slack-eval-labels.json`
- Create: `scripts/eval-slack-triage.mjs`
- Tests: `evaluations/tests/slack-eval-harness.test.mjs`

- [ ] **Step 1:** Tạo bộ 50+ test cases đa dạng (Tiếng Việt, deadline mơ hồ, chitchat, prompt injection, kênh riêng). Đóng băng file nhãn `slack-eval-labels.json` và ghi lại mã băm SHA256.
- [ ] **Step 2:** Xây dựng script benchmark tự động hóa 3 lượt chạy độc lập cho mỗi mode.
- [ ] **Step 3:** Viết test kiểm tra tính toàn vẹn của harness runner; mong đợi PASS.
- [ ] **Step 4:** Commit: `eval(slack): commit frozen evaluation dataset and benchmark runner`.

---

### Task 16: (07B) Báo cáo Đánh giá Mô hình 3 Chế độ (3 Runs / Mode)

**Files:**
- Create: `evaluations/reports/slack-triage-report.md`
- Modify: `docs/PROJECT-REPORT.md`

- [ ] **Step 1:** Chạy script benchmark trên LLM `gemini-3.8-flash`:
  `node scripts/eval-slack-triage.mjs --runs 3 --output evaluations/reports/slack-triage-report.md`
- [ ] **Step 2:** Kiểm tra kết quả đáp ứng ngưỡng: Precision ≥ 90%, Recall ≥ 85%, Unapproved Writes = 0, Cross-User Leaks = 0.
- [ ] **Step 3:** Cập nhật bảng kết quả benchmark vào `docs/PROJECT-REPORT.md`.
- [ ] **Step 4:** Commit: `docs(eval): publish three-mode slack triage evaluation report`.

---

### Task 17: (07C) Nghiệm thu Live trên 2 Workspace và Readback Từng Nhóm

**Files:**
- Create: `docs/handoff/evidence/slack-live-acceptance.md`
- Modify: `docs/slack/method-inventory.json`

- [ ] **Step 1:** Nhóm trưởng/Reviewer cấu hình Slack App thật, kết nối 1 Workspace Free và 1 Workspace Pro với 2 tài khoản người dùng ATI.
- [ ] **Step 2:** Gửi tin nhắn webhook thật, kiểm tra đề xuất xuất hiện trong ATI Inbox, duyệt ghi Trello + Slack reply và đối chiếu readback thật trên Slack.
- [ ] **Step 3:** Thử nghiệm ngắt kết nối và kiểm tra purge dữ liệu nguồn thật.
- [ ] **Step 4:** Ghi nhận toàn bộ bằng chứng vào `docs/handoff/evidence/slack-live-acceptance.md`.
- [ ] **Step 5:** Commit: `docs(slack): record live multi-workspace acceptance and readback evidence`.

---

### Task 18: (07D) PR Bật Cờ Tính năng (Release PR)

**Files:**
- Modify: `.env.example`, tài liệu triển khai.

- [ ] **Step 1:** Tạo PR riêng biệt kích hoạt `MYSLACK_ENABLED=on` và `MYSLACK_AUTOMATION_ENABLED=on`.
- [ ] **Step 2:** Kiểm tra toàn bộ CI xanh đúng commit head.
- [ ] **Step 3:** Nhóm trưởng phê duyệt và merge PR kích hoạt tính năng.

---

## 4. Bảng Tổng hợp Tiêu chuẩn Nghiệm thu Toàn diện (Release Gates)

| Hạng mục | Tiêu chuẩn Bắt buộc | Môi trường Kiểm tra |
|---|---|---|
| **Inventory** | Đủ 343 phương thức, không generic dispatcher, 246 probe_required giữ nguyên | Script `inventory.mjs verify` |
| **F1 Policy** | Không consent / unverified provider -> chặn mọi lời gọi model | Vitest + PG16 thật |
| **F2 Identity** | Workspace/User binding bất biến từ read -> plan -> execute | Vitest + Integration DB |
| **F3 Purge** | Disconnect/Delete -> tombstone tức thì, purge sạch trích đoạn chat/memory | Integration DB + UI test |
| **F4 Ingress** | Ký số bắt buộc; cờ tắt vẫn xử lý lifecycle và purge | Ingress HTTP tests |
| **Safety** | Echo Guard chặn tự lặp; UNKNOWN không tự retry write | Executor tests + AbortSignal |
| **3 Modes** | Cấu hình độc lập per workspace; ranh giới cá nhân chuẩn xác; CAS versioning | Triage Worker tests |
| **Proposal Inbox** | Duyệt trong ATI; cấm tự ý ghi; sửa tham số sinh plan mới | Web component tests |
| **Evaluations** | Precision ≥ 90%, Recall ≥ 85%, 0 unapproved writes, 0 cross leaks | 9 runs trên dataset cam kết |
| **P-LIVE** | Readback trên Free & Pro, 2 users chung workspace, revoke thật | Môi trường Slack thật |
| **Release PR** | PR bật cờ riêng biệt, chỉ merge khi tất cả các cổng trên đều ĐẠT | GitHub Actions CI xanh |
