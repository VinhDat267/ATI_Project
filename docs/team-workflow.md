# Team Workflow & Git Strategy — AI Workflow Platform v3

**Áp dụng cho:** ATI_Project monorepo
**Ngày lập:** 29/09/2026

---

## 1. Phân chia vai trò theo Module Ownership

Kiến trúc v3 đã tách rõ module boundaries → mỗi người **sở hữu riêng** files
của mình, gần như không đụng vào code người khác.

### Đội 3 người:

| Vai trò | Người | Sở hữu files | Không được sửa |
|---|---|---|---|
| **🤖 AI Engineer** | A | `packages/planner/`, `packages/tool-schemas/`, `prompts/`, `evaluations/` | `apps/`, `packages/executor/`, `packages/tool-adapters/` |
| **⚙️ Backend Engineer** | B | `apps/chat-api/`, `packages/executor/`, `packages/tool-adapters/`, `db/v3/` | `apps/chat-web/`, `packages/planner/` |
| **🎨 Frontend Engineer** | C | `apps/chat-web/` | `apps/chat-api/`, `packages/` |

### Đội 4 người:

| Vai trò | Người | Sở hữu files |
|---|---|---|
| **🤖 AI Engineer** | A | `packages/planner/`, `prompts/`, `evaluations/` |
| **⚙️ Backend Engineer** | B | `apps/chat-api/`, `packages/executor/`, `db/v3/` |
| **🔌 Integration Engineer** | C | `packages/tool-schemas/`, `packages/tool-adapters/` |
| **🎨 Frontend Engineer** | D | `apps/chat-web/` |

### Shared files (CẦN THỎA THUẬN trước khi sửa):

```
Shared — phải PR + review trước khi merge:
├── packages/tool-schemas/   ← AI Engineer sở hữu, Backend dùng
├── db/v3/migration.sql      ← Backend sở hữu, cả team dùng
├── docker-compose.yml       ← Backend sở hữu
├── package.json (root)      ← thỏa thuận
└── docs/                    ← ai cũng sửa được
```

**Quy tắc vàng:** Nếu file nằm ngoài folder bạn sở hữu → **tạo PR, tag owner
review**. Không bao giờ push thẳng vào file người khác.

---

## 2. Git Branching Strategy

### 2.1. Branch chính

```
main                    ← production-ready, luôn chạy được
  └── develop           ← integration branch, merge features vào đây
        ├── feat/...    ← feature branches
        ├── fix/...     ← bug fix branches
        └── chore/...   ← config, docs, refactor
```

### 2.2. Branch naming

```
Format: <type>/<tên-ngắn>

Ví dụ:
  feat/trello-adapter
  feat/ai-planner-gather
  feat/chat-ui-messages
  feat/execution-engine
  fix/sse-reconnect
  chore/docker-setup
  docs/api-spec
```

**Quy tắc tên:**
- Viết thường, dùng dấu `-` (không dùng `_` hay CamelCase)
- Tối đa 3-4 từ
- Phải rõ ràng thuộc module nào

### 2.3. Flow làm việc hàng ngày

```
1. Pull develop mới nhất:
   git checkout develop
   git pull origin develop

2. Tạo branch từ develop:
   git checkout -b feat/trello-adapter

3. Code + commit (xem mục 3)

4. Khi xong, push branch:
   git push origin feat/trello-adapter

5. Tạo Pull Request → develop
   - Tag reviewer (owner của module bị ảnh hưởng)
   - Mô tả thay đổi
   - Checklist: tests pass, lint pass, không đụng file người khác

6. Reviewer approve → Merge (squash merge hoặc merge commit)

7. Xóa branch đã merge:
   git branch -d feat/trello-adapter
```

### 2.4. Khi nào merge vào main

```
develop → main chỉ khi:
  ✅ Tất cả tests pass
  ✅ Demo chạy được end-to-end
  ✅ Cả team đồng ý
  → Thường cuối mỗi Phase hoàn thành
```

---

## 3. Commit Conventions (Conventional Commits)

### 3.1. Format

```
<type>(<scope>): <mô tả ngắn>

[body — giải thích chi tiết nếu cần]
```

### 3.2. Types

| Type | Khi nào dùng | Ví dụ |
|---|---|---|
| `feat` | Thêm tính năng mới | `feat(planner): add gather phase with search tools` |
| `fix` | Sửa bug | `fix(executor): handle timeout for write steps` |
| `refactor` | Đổi code không đổi behavior | `refactor(adapters): extract base adapter class` |
| `test` | Thêm/sửa test | `test(planner): add 10 evaluation prompts` |
| `docs` | Documentation | `docs(api): update SSE event types` |
| `chore` | Config, build, deps | `chore: add eslint config for chat-api` |
| `style` | Format, whitespace | `style(chat-web): fix tailwind class order` |

### 3.3. Scopes (theo module)

| Scope | Module | Ai dùng |
|---|---|---|
| `planner` | packages/planner | AI Engineer |
| `schemas` | packages/tool-schemas | AI Engineer |
| `adapters` | packages/tool-adapters | Backend Engineer |
| `executor` | packages/executor | Backend Engineer |
| `api` | apps/chat-api | Backend Engineer |
| `web` | apps/chat-web | Frontend Engineer |
| `db` | db/v3 | Backend Engineer |
| `prompts` | prompts/ | AI Engineer |
| `eval` | evaluations/ | AI Engineer |
| `docker` | docker, infra | Backend Engineer |

### 3.4. Ví dụ commits tốt

```
feat(schemas): define ToolDefinition interface and Trello tool schemas
feat(adapters): implement Trello adapter with rate limiting
feat(planner): add LLM Router for service subset selection
feat(executor): implement sequential executor with $ref resolution
feat(api): add SSE stream endpoint with sequence_id
feat(web): add PlanPreview component with approve/edit/cancel
fix(api): fix plan hash using json-stable-stringify
test(planner): add 20 evaluation prompts for Trello workflows
docs(api): document SSE-first protocol and reconnect flow
chore(db): add indexes on foreign keys
```

### 3.5. Commits xấu (TRÁNH)

```
❌ "update code"
❌ "fix bug"
❌ "WIP"
❌ "asdf"
❌ "Minh's changes"
❌ commit 50 files cùng lúc — chia nhỏ ra!
```

### 3.6. Commit size

- **1 commit = 1 thay đổi logic** — không trộn 3 features vào 1 commit
- Nếu đang code dở cuối ngày → dùng `git stash` hoặc commit WIP trên branch riêng
  (sẽ squash trước khi PR)
- PR nên có 1-5 commits, không quá 10

---

## 4. Tránh Conflict — Chiến lược cốt lõi

### 4.1. Module Ownership = Không conflict

```
Người A sửa: packages/planner/src/gather.ts
Người B sửa: packages/executor/src/runner.ts
Người C sửa: apps/chat-web/src/components/PlanPreview.tsx

→ 3 người code song song, KHÔNG BAO GIỜ conflict
  vì sửa files hoàn toàn khác nhau
```

**Đây là lý do kiến trúc tách packages quan trọng.**

### 4.2. Shared interfaces — Contract-first

Khi 2 modules cần giao tiếp, THỎA THUẬN interface TRƯỚC khi code:

```typescript
// packages/tool-schemas/src/types.ts
// ← AI Engineer và Backend Engineer CÙNG review file này
// ← Merge vào develop TRƯỚC khi ai bắt đầu code

export interface ToolDefinition {
  name: string;
  service: string;
  description: string;
  sideEffect: "read" | "write";
  riskLevel: "low" | "medium" | "high";
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
}

export interface PlanStep {
  id: string;
  tool: string;
  args: Record<string, ArgValue>;
  dependsOn: string[];
}
```

**Quy tắc:** Interface files merge vào develop **TRƯỚC** khi implement. Ai cũng
code theo cùng 1 contract → plug vào là chạy.

### 4.3. API Contract giữa Frontend và Backend

Frontend và Backend thỏa thuận API contract TRƯỚC:

```typescript
// docs/api-contract.ts (hoặc OpenAPI spec)
// ← Backend và Frontend CÙNG review

// POST /api/conversations/:id/messages → 202
interface SendMessageRequest {
  content: string;
}
interface SendMessageResponse {
  messageId: string;
}

// SSE events
interface SSEEvent {
  event: "plan" | "exec_step" | "text_delta" | ...;
  data: string; // JSON
  id: string;   // sequence_id
}
```

Frontend mock API responses theo contract → code song song với Backend.

### 4.4. Khi conflict xảy ra (hiếm)

```
1. git pull origin develop
2. Nếu conflict:
   git status                    ← xem files bị conflict
   Mở file → tìm <<<< ==== >>>> ← resolve thủ công
   git add <file>
   git commit
3. Nếu conflict ở shared file (types.ts, migration.sql):
   → Chat nhóm, thỏa thuận, 1 người resolve
   → KHÔNG tự ý resolve file người khác
```

---

## 5. Parallel Work Plan theo Phase

### Phase 0: Foundation (làm CÙNG NHAU)

```
Ngày 1-2: Cả team ngồi cùng setup
  ├── Backend: docker-compose, DB schema, auth module
  ├── AI: tool-schemas package, TypeScript interfaces
  ├── Frontend: Vite project setup, Tailwind config, folder structure
  └── Cùng review: shared interfaces, API contract
```

### Phase 1: Tool Catalog & Adapters

```
Song song:
  AI Engineer:     tool-schemas (Trello + Slack definitions)
  Backend:         tool-adapters (Trello adapter → Slack adapter)
  Frontend:        Login page + Layout skeleton + Settings page (mock data)

Merge point: Backend test adapters hoạt động với schemas từ AI Engineer
```

### Phase 2a: DB Foundation

```
Backend (chính):   DB migration, repositories
AI Engineer:       Bắt đầu system prompt, evaluation framework setup
Frontend:          Chat components (MessageList, InputBar) với mock data
```

### Phase 2b: AI Planner ⭐

```
AI Engineer (chính): Planner core — gather, plan, validation
Backend:             Executor skeleton, reference resolver
Frontend:            PlanPreview component, GatherProgress component (mock data)

Merge point: Planner sinh plan → Executor chạy plan (CLI demo)
```

### Phase 3: Execution Engine

```
Backend (chính):   Executor hoàn chỉnh, error handling, crash recovery
AI Engineer:       Cải thiện prompts, chạy evaluation, fix edge cases
Frontend:          ExecutionProgress component, PartialFailure component

Merge point: CLI chạy full flow plan→execute
```

### Phase 4: Chat API + SSE

```
Backend (chính):   API endpoints, SSE stream, plan approval
AI Engineer:       Context management, Working Memory integration
Frontend:          SSE hook, real API integration thay mock

Merge point: Postman/browser chạy full flow
```

### Phase 5: Chat UI

```
Frontend (chính):  Tất cả UI components, responsive, onboarding
Backend:           API fixes theo Frontend feedback
AI Engineer:       Final prompt tuning

Merge point: FULL END-TO-END trong browser
```

### Phase 6: Polish

```
Cả team:
  ├── Backend: performance, security fixes
  ├── AI: final evaluation report
  ├── Frontend: polish, animations, error states
  └── Docs: README, API docs, architecture docs
```

---

## 6. Daily Workflow

### 6.1. Standup (5 phút, mỗi ngày hoặc mỗi 2 ngày)

Mỗi người trả lời 3 câu:
1. **Hôm qua làm gì?** (commit nào, branch nào)
2. **Hôm nay làm gì?** (task nào, file nào)
3. **Bị block gì không?** (cần interface, cần API, cần review)

### 6.2. Code review

```
Quy tắc:
  - PR < 200 lines → review trong ngày
  - PR > 200 lines → tách nhỏ
  - Shared files (schemas, contract) → 2 người review
  - Module riêng → 1 người review đủ
  - Approve = ✅, Request changes = ❌ kèm lý do cụ thể
```

### 6.3. Communication channel

```
Nên dùng 1 channel (Slack/Discord/Zalo group):
  #general     — thông báo, standup
  #pr-review   — tag khi cần review PR
  #help        — khi bị stuck, cần hỗ trợ

Gửi PR link + mô tả ngắn khi cần review.
Không gửi code qua chat — mọi thứ qua Git.
```

---

## 7. Git Commands Cheat Sheet

```bash
# === HÀNG NGÀY ===

# Bắt đầu ngày: pull develop mới nhất
git checkout develop
git pull origin develop

# Tạo branch mới
git checkout -b feat/ten-feature

# Xem thay đổi
git status
git diff

# Stage + commit
git add packages/planner/src/gather.ts
git commit -m "feat(planner): implement gather phase with search tools"

# Push branch
git push origin feat/ten-feature

# === KHI MERGE ===

# Cập nhật branch với develop mới nhất (TRƯỚC khi tạo PR)
git checkout feat/ten-feature
git pull origin develop --rebase
# Resolve conflicts nếu có
git push origin feat/ten-feature --force-with-lease

# === TIỆN ÍCH ===

# Lưu tạm code chưa xong
git stash
git stash pop

# Xem log gọn
git log --oneline -10

# Xem ai sửa file nào
git log --oneline -- packages/planner/

# Xem branch nào đang active
git branch -a

# Xóa branch đã merge
git branch -d feat/ten-feature
git push origin --delete feat/ten-feature
```

---

## 8. Checklist trước khi tạo PR

```
□ Code chạy được (npm run build không lỗi)
□ Tests pass (npm run test -- --filter=<module>)
□ Lint pass (npm run lint)
□ Chỉ sửa files trong module mình sở hữu
□ Nếu sửa shared file → tag owner review
□ Commit messages đúng format
□ PR description mô tả thay đổi + lý do
□ Branch up-to-date với develop (đã rebase)
□ Không commit secrets/API keys (check .gitignore)
```

---

## 9. .gitignore quan trọng

```gitignore
# Dependencies
node_modules/

# Build
dist/
.turbo/

# Environment & Secrets
.env
.env.local
.env.*.local

# IDE
.vscode/settings.json
.idea/

# OS
.DS_Store
Thumbs.db

# Test
coverage/

# QUAN TRỌNG: Không commit API keys
# Dùng .env.example làm template
```

Kèm `.env.example` (KHÔNG chứa giá trị thật):

```
# .env.example — copy thành .env và điền giá trị thật
TRELLO_API_KEY=
TRELLO_TOKEN=
SLACK_BOT_TOKEN=
GEMINI_API_KEY=
DATABASE_URL=postgresql://user:pass@localhost:5432/ati_v3
JWT_SECRET=
ENCRYPTION_KEY=
```

---

## 10. Tóm tắt — 5 quy tắc vàng

```
1. CHỈ SỬA FILE CỦA MÌNH     → Không conflict
2. INTERFACE TRƯỚC, CODE SAU   → Plug & play khi merge
3. BRANCH RIÊNG, PR ĐỂ MERGE  → Không push thẳng develop/main
4. COMMIT NHỎ, MESSAGE RÕ     → Dễ review, dễ rollback
5. PULL DEVELOP MỖI NGÀY       → Không bị lệch xa
```
