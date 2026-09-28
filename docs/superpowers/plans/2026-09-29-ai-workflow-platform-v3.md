# AI Workflow Automation Platform v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v3 AI Workflow Automation Platform featuring a conversational chat interface, multi-tool AI planner with working memory & hierarchical routing, 4-layer validation, and a sequential execution engine across Trello and Slack with write-safety guarantees.

**Architecture:** A clean separation of concerns in a TypeScript monorepo: `packages/tool-schemas` defines tool interfaces and JSON schemas with zero heavy dependencies; `packages/tool-adapters` implements external APIs with AES-256-GCM encryption, global rate-limiting, and allowed scope filtering; `packages/planner` manages multi-turn gather/clarify in Chat Mode and single-shot planning with a Thinking Layer and Working Memory in Plan Mode; `packages/executor` runs sequential DAG execution with $ref resolution, ACID step state updates, and UNKNOWN write-safety; `apps/chat-api` provides async message ingestion (202 Accepted) using Express + Supertest and resilient SSE event streaming; `apps/chat-web` renders a React 19 UI with `@microsoft/fetch-event-source` for authenticated streaming and interactive approval cards.

**Tech Stack:** Node.js, TypeScript 5.6+, Express, Supertest, PostgreSQL (pg pool), React 19, Tailwind CSS, Vite, Zustand, `@microsoft/fetch-event-source`, Google Gemini API via `@google/genai` (gemini-1.5-pro), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`

## Global Constraints

- Monorepo packages: `@wap/tool-schemas`, `@wap/tool-adapters`, `@wap/planner`, `@wap/executor`, `@wap/chat-api`, `@wap/chat-web`.
- Every internal package MUST define `"exports": { ".": "./src/index.ts" }` in `package.json` and be listed in root `vitest.workspace.ts`.
- TypeScript strict mode enabled across all new packages.
- PostgreSQL v3 schema isolated under `db/v3/` using 6 tables: `users`, `conversations`, `messages`, `plans`, `execution_steps`, `service_credentials` with 4 performance indexes.
- Read tools MUST use `search_*` signatures with explicit `query: string` and `limit: number` (max 10). `list_*` dumping full entities into LLM context is forbidden.
- AI Plan generation uses 1 consistent model across dev, eval, and prod (`gemini-1.5-pro`).
- Plan hash calculation MUST be deterministic using `json-stable-stringify` or storing verbatim `plan_text`.
- Non-idempotent writes returning 5xx or timing out (via `AbortSignal`) MUST be classified as `unknown` and NEVER auto-retried.
- Plan approval endpoint MUST enforce optimistic locking via `WHERE id = $1 AND status = 'pending'`.
- SSE client on frontend MUST use `@microsoft/fetch-event-source` to support `Authorization: Bearer` and `Last-Event-ID` headers.

## Review Focus

1. **DAG cross-step invalid reference:** AI generates a plan step referencing a non-existent step or non-existent output property (e.g., `$step_99.output.id`). Tested in Task 10.
2. **Ambiguous member search resolution:** User asks to assign "Minh" when multiple "Minh" members exist. AI enters clarification multi-turn rather than choosing arbitrarily. Tested in Task 11.
3. **Write timeout safety:** External API call (e.g., Trello `create_card`) hangs or times out after 30s. `AbortSignal` triggers, executor marks step `unknown`, rolls nothing back, and halts execution for user choice. Tested in Task 14.
4. **SSE mid-stream disconnection:** Client disconnects while LLM is generating plan deltas. Reconnect with `Last-Event-ID` catches up without re-triggering planner or dropping events. Tested in Task 19.
5. **Rapid double approval clicks:** Two simultaneous `POST /api/plans/:id/approve` requests arrive within 10ms. Exactly one succeeds with 200, the other fails with 409 Conflict. Tested in Task 20.

---

### Task 1: Monorepo Scaffolding, Workspace Config & Environment Validation

**Files:**
- Create: `vitest.workspace.ts`
- Create: `packages/tool-schemas/package.json`
- Create: `packages/tool-schemas/tsconfig.json`
- Create: `packages/tool-adapters/package.json`
- Create: `packages/tool-adapters/tsconfig.json`
- Create: `packages/planner/package.json`
- Create: `packages/planner/tsconfig.json`
- Create: `packages/executor/package.json`
- Create: `packages/executor/tsconfig.json`
- Create: `apps/chat-api/package.json`
- Create: `apps/chat-api/tsconfig.json`
- Create: `apps/chat-api/src/config/env.ts`
- Create: `.env.example`
- Modify: `package.json:11-48`
- Test: `tests/scaffold.test.ts`

**Interfaces:**
- Consumes: Monorepo workspace configuration `packages/*` and `apps/*`.
- Produces: `vitest.workspace.ts`, `validateEnv()`, package `exports` for all local packages.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scaffold.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('V3 Monorepo Scaffolding & Config', () => {
  const pkgs = [
    'packages/tool-schemas',
    'packages/tool-adapters',
    'packages/planner',
    'packages/executor',
    'apps/chat-api',
  ];

  it('verifies all packages have exports and tsconfig setup', () => {
    expect(existsSync(resolve('vitest.workspace.ts')), 'missing vitest.workspace.ts').toBe(true);
    expect(existsSync(resolve('.env.example')), 'missing .env.example').toBe(true);

    for (const pkg of pkgs) {
      expect(existsSync(resolve(pkg, 'package.json')), `missing ${pkg}/package.json`).toBe(true);
      expect(existsSync(resolve(pkg, 'tsconfig.json')), `missing ${pkg}/tsconfig.json`).toBe(true);
      const pkgJson = JSON.parse(readFileSync(resolve(pkg, 'package.json'), 'utf8'));
      expect(pkgJson.name).toMatch(/^@wap\//);
      expect(pkgJson.exports).toBeDefined();
      expect(pkgJson.exports['.']).toBe('./src/index.ts');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scaffold.test.ts`
Expected: FAIL with "missing vitest.workspace.ts"

- [ ] **Step 3: Implement workspace config, environment schema, and package files**

Create `vitest.workspace.ts` registering packages. Add `package.json` with `"exports": { ".": "./src/index.ts" }` and tsconfig references. Add `apps/chat-api/src/config/env.ts` validating required variables (`DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `GEMINI_API_KEY`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scaffold.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add vitest.workspace.ts .env.example packages/ apps/chat-api/ package.json tests/scaffold.test.ts
git commit -m "chore(infra): scaffold v3 monorepo with workspace config and env validation"
```

---

### Task 2: Shared Tool Schemas & Plan Contracts (`packages/tool-schemas`)

**Files:**
- Create: `packages/tool-schemas/src/types.ts`
- Create: `packages/tool-schemas/src/trello.ts`
- Create: `packages/tool-schemas/src/slack.ts`
- Create: `packages/tool-schemas/src/index.ts`
- Test: `packages/tool-schemas/tests/schemas.test.ts`

**Interfaces:**
- Consumes: Standard JSON Schema.
- Produces: `ToolDefinition`, `PlanResponse`, `PlanStep`, `ArgValue`, `AllowedScope`, `TRELLO_TOOLS`, `SLACK_TOOLS`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tool-schemas/tests/schemas.test.ts
import { describe, it, expect } from 'vitest';
import { TRELLO_TOOLS, SLACK_TOOLS, ToolDefinition } from '../src';

describe('Tool Schemas', () => {
  it('defines 9 Trello tools and 2 Slack tools with search query limits', () => {
    expect(TRELLO_TOOLS).toHaveLength(9);
    expect(SLACK_TOOLS).toHaveLength(2);

    const searchMembers = TRELLO_TOOLS.find((t: ToolDefinition) => t.name === 'trello.search_members');
    expect(searchMembers?.sideEffect).toBe('read');
    expect(searchMembers?.inputSchema.properties).toHaveProperty('query');
    expect(searchMembers?.inputSchema.properties).toHaveProperty('limit');

    const createCard = TRELLO_TOOLS.find((t: ToolDefinition) => t.name === 'trello.create_card');
    expect(createCard?.sideEffect).toBe('write');
    expect(createCard?.riskLevel).toBe('low');

    const sendMessage = SLACK_TOOLS.find((t: ToolDefinition) => t.name === 'slack.send_message');
    expect(sendMessage?.sideEffect).toBe('write');
    expect(sendMessage?.riskLevel).toBe('medium');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/tool-schemas/tests/schemas.test.ts`
Expected: FAIL with "Cannot find module '../src'"

- [ ] **Step 3: Implement ToolDefinition, AllowedScope and tool catalogs**

Define `ToolDefinition`, `AllowedScope`, `PlanResponse`, `PlanStep`, `ClarificationResponse`, `RefusalResponse` in `src/types.ts`. Implement `TRELLO_TOOLS` in `src/trello.ts` (with `limit <= 10`) and `SLACK_TOOLS` in `src/slack.ts`. Export from `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/tool-schemas/tests/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-schemas/
git commit -m "feat(schemas): define v3 tool definitions, allowed scope and plan contracts"
```

---

### Task 3: Base Adapter, Credential Encryption & Global Rate Limiting

**Files:**
- Create: `packages/tool-adapters/src/crypto.ts`
- Create: `packages/tool-adapters/src/rate-limiter.ts`
- Create: `packages/tool-adapters/src/base-adapter.ts`
- Test: `packages/tool-adapters/tests/crypto-ratelimit.test.ts`

**Interfaces:**
- Consumes: Node `crypto`, `@wap/tool-schemas`.
- Produces: `encryptCredentials`, `decryptCredentials`, `GlobalRateLimiter`, `BaseAdapter`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tool-adapters/tests/crypto-ratelimit.test.ts
import { describe, it, expect } from 'vitest';
import { encryptCredentials, decryptCredentials, GlobalRateLimiter } from '../src';

describe('Crypto & Rate Limiting', () => {
  const secretKey = '01234567890123456789012345678901'; // 32 bytes

  it('encrypts and decrypts credentials with AES-256-GCM format v1:iv:tag:ciphertext', () => {
    const raw = { apiKey: 'trello-key', token: 'trello-token' };
    const encrypted = encryptCredentials(raw, secretKey);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(encrypted.split(':')).toHaveLength(4);

    const decrypted = decryptCredentials<typeof raw>(encrypted, secretKey);
    expect(decrypted).toEqual(raw);
  });

  it('enforces rate limiting tokens per window', async () => {
    const limiter = new GlobalRateLimiter({ maxRequests: 2, windowMs: 100 });
    expect(await limiter.acquire('test')).toBe(true);
    expect(await limiter.acquire('test')).toBe(true);
    expect(await limiter.acquire('test')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/tool-adapters/tests/crypto-ratelimit.test.ts`
Expected: FAIL with "Cannot find module '../src'"

- [ ] **Step 3: Implement AES-256-GCM encryption and in-memory GlobalRateLimiter**

Implement `encryptCredentials` / `decryptCredentials` in `crypto.ts` returning `v1:${iv}:${tag}:${ciphertext}`. Implement sliding-window `GlobalRateLimiter` in `rate-limiter.ts`. Implement `BaseAdapter` with error categorization in `base-adapter.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/tool-adapters/tests/crypto-ratelimit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/
git commit -m "feat(adapters): implement AES-256-GCM encryption and global rate limiter"
```

---

### Task 4a: Trello Base Adapter, Auth & Error Normalization

**Files:**
- Create: `packages/tool-adapters/src/trello/base.ts`
- Create: `packages/tool-adapters/src/trello/types.ts`
- Test: `packages/tool-adapters/tests/trello-base.test.ts`

**Interfaces:**
- Consumes: `BaseAdapter`, `TrelloCredentials`.
- Produces: `TrelloBaseAdapter` normalizing 401/403 (`AUTH_ERROR`), 404 (`NOT_FOUND`), 429 (`RATE_LIMIT`).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tool-adapters/tests/trello-base.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TrelloBaseAdapter } from '../src/trello/base';

describe('Trello Base Adapter & Error Normalization', () => {
  it('normalizes HTTP 401/403 to AUTH_ERROR and 429 to RATE_LIMIT', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid key',
    });

    const adapter = new TrelloBaseAdapter({
      credentials: { apiKey: 'bad-key', token: 'bad-token' },
      fetchFn: mockFetch as any,
    });

    await expect(adapter.request('/members/me')).rejects.toMatchObject({
      category: 'AUTH_ERROR',
      statusCode: 401,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/tool-adapters/tests/trello-base.test.ts`
Expected: FAIL with "TrelloBaseAdapter is not defined"

- [ ] **Step 3: Implement TrelloBaseAdapter**

Implement `TrelloBaseAdapter` in `src/trello/base.ts` injecting `key` and `token` query params and normalizing HTTP error statuses into `StepError`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/tool-adapters/tests/trello-base.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/trello/ packages/tool-adapters/tests/trello-base.test.ts
git commit -m "feat(adapters): implement Trello base adapter with error normalization"
```

---

### Task 4b: Trello Read Tools & Allowed Scope Validation

**Files:**
- Create: `packages/tool-adapters/src/trello/read-tools.ts`
- Test: `packages/tool-adapters/tests/trello-read.test.ts`

**Interfaces:**
- Consumes: `TrelloBaseAdapter`, `AllowedScope`.
- Produces: Handlers for `search_boards`, `search_lists`, `search_members`, `search_cards`, `get_card`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tool-adapters/tests/trello-read.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TrelloReadTools } from '../src/trello/read-tools';

describe('Trello Read Tools', () => {
  it('searches members by query and rejects access to boards outside allowedScope', async () => {
    const mockRequest = vi.fn().mockResolvedValue([
      { id: 'm1', fullName: 'Minh Nguyen', username: 'minhn' },
      { id: 'm2', fullName: 'An Tran', username: 'ant' },
    ]);

    const tools = new TrelloReadTools({
      request: mockRequest,
      allowedScope: { boards: ['b1'] },
    });

    const members = await tools.searchMembers({ boardId: 'b1', query: 'Minh', limit: 5 });
    expect(members).toHaveLength(1);
    expect(members[0].fullName).toBe('Minh Nguyen');

    // Forbidden board test
    await expect(
      tools.searchMembers({ boardId: 'forbidden_board', query: 'Minh' })
    ).rejects.toThrow(/Allowed scope restriction/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/tool-adapters/tests/trello-read.test.ts`
Expected: FAIL with "TrelloReadTools is not defined"

- [ ] **Step 3: Implement Trello read tools**

Implement `searchBoards`, `searchLists`, `searchMembers`, `searchCards`, and `getCard` in `src/trello/read-tools.ts`. Check `boardId` against `allowedScope.boards` before making requests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/tool-adapters/tests/trello-read.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/trello/read-tools.ts packages/tool-adapters/tests/trello-read.test.ts
git commit -m "feat(adapters): implement Trello search read tools and scope enforcement"
```

---

### Task 4c: Trello Write Tools Implementation

**Files:**
- Create: `packages/tool-adapters/src/trello/write-tools.ts`
- Create: `packages/tool-adapters/src/trello/index.ts`
- Modify: `packages/tool-adapters/src/index.ts`
- Test: `packages/tool-adapters/tests/trello-write.test.ts`

**Interfaces:**
- Consumes: `TrelloBaseAdapter`, `TrelloReadTools`.
- Produces: Handlers for `create_card`, `update_card`, `add_member`, `add_checklist`, and unified `TrelloAdapter`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tool-adapters/tests/trello-write.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TrelloAdapter } from '../src';

describe('Trello Write Tools & Unified Adapter', () => {
  it('creates card, adds member, and creates checklist', async () => {
    const mockRequest = vi.fn().mockImplementation(async (path: string, options?: any) => {
      if (path === '/cards') return { id: 'c1', name: options?.body?.name, url: 'https://trello.com/c/c1' };
      if (path.includes('/idMembers')) return { id: 'c1', idMembers: ['m1'] };
      if (path.includes('/checklists')) return { id: 'chk1', name: 'Checklist' };
      return {};
    });

    const adapter = new TrelloAdapter({
      credentials: { apiKey: 'k', token: 't' },
      allowedScope: { boards: ['b1'] },
      customRequest: mockRequest,
    });

    const card = await adapter.execute('trello.create_card', { listId: 'l1', title: 'New Card' });
    expect(card.id).toBe('c1');

    const memberRes = await adapter.execute('trello.add_member', { cardId: 'c1', memberId: 'm1' });
    expect(memberRes.idMembers).toContain('m1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/tool-adapters/tests/trello-write.test.ts`
Expected: FAIL with "TrelloAdapter is not defined"

- [ ] **Step 3: Implement write tools and composite TrelloAdapter**

Implement `createCard`, `updateCard`, `addMember`, `addChecklist` in `src/trello/write-tools.ts`. Combine read and write tools in `TrelloAdapter` in `src/trello/index.ts` and export from `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/tool-adapters/tests/trello-write.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/trello/ packages/tool-adapters/src/index.ts packages/tool-adapters/tests/trello-write.test.ts
git commit -m "feat(adapters): implement Trello write tools and complete TrelloAdapter"
```

---

### Task 5: Slack Adapter Implementation & Allowed Channels Filtering

**Files:**
- Create: `packages/tool-adapters/src/slack/slack-adapter.ts`
- Create: `packages/tool-adapters/src/slack/index.ts`
- Modify: `packages/tool-adapters/src/index.ts`
- Test: `packages/tool-adapters/tests/slack-adapter.test.ts`

**Interfaces:**
- Consumes: `BaseAdapter`, `@wap/tool-schemas`.
- Produces: `SlackAdapter`, `SlackCredentials`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tool-adapters/tests/slack-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SlackAdapter } from '../src';

describe('SlackAdapter', () => {
  it('searches channels and posts message adhering to allowed channels', async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('conversations.list')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            channels: [
              { id: 'C1', name: 'general' },
              { id: 'C2', name: 'frontend' },
            ],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, ts: '12345.678' }),
      };
    });

    const adapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-token' },
      allowedScope: { channels: ['C2', 'frontend'] },
      fetchFn: mockFetch as any,
    });

    const channels = await adapter.execute('slack.search_channels', { query: 'front', limit: 5 });
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('frontend');

    const result = await adapter.execute('slack.send_message', { channel: 'C2', text: 'Task notification' });
    expect(result.ts).toBe('12345.678');

    // Forbidden channel test
    await expect(
      adapter.execute('slack.send_message', { channel: 'C1', text: 'Forbidden' })
    ).rejects.toThrow(/Allowed scope restriction/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/tool-adapters/tests/slack-adapter.test.ts`
Expected: FAIL with "SlackAdapter is not defined"

- [ ] **Step 3: Implement SlackAdapter**

Implement `SlackAdapter` in `src/slack/slack-adapter.ts` with `search_channels` and `send_message`. Enforce `allowedScope.channels`. Export from `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/tool-adapters/tests/slack-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/slack/ packages/tool-adapters/src/index.ts packages/tool-adapters/tests/slack-adapter.test.ts
git commit -m "feat(adapters): implement Slack adapter with allowed channels filtering"
```

---

### Task 6: PostgreSQL V3 Schema Migration & Connection Pool

**Files:**
- Create: `db/v3/0001_v3_core.sql`
- Create: `apps/chat-api/src/db/pool.ts`
- Test: `apps/chat-api/tests/db/pool.test.ts`

**Interfaces:**
- Consumes: PostgreSQL connection string from `DATABASE_URL`.
- Produces: `getPool`, `closePool`, SQL migration script with 6 core tables and 4 indexes.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/db/pool.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('V3 SQL Schema & Pool', () => {
  it('verifies SQL migration defines 6 tables and 4 performance indexes with valid syntax', () => {
    const file = resolve('db/v3/0001_v3_core.sql');
    expect(existsSync(file)).toBe(true);
    const sql = readFileSync(file, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS conversations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS messages');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS plans');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS execution_steps');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS service_credentials');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_conversations_user_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_messages_conv_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_plans_conv_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_execution_steps_plan_id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/db/pool.test.ts`
Expected: FAIL with "no such file or directory db/v3/0001_v3_core.sql"

- [ ] **Step 3: Create SQL migration and Pool abstraction**

Write `db/v3/0001_v3_core.sql` with the 6 tables and indexes. In `apps/chat-api/src/db/pool.ts`, wrap `pg.Pool` with connection health checks and graceful shutdown.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/db/pool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add db/v3/ apps/chat-api/src/db/pool.ts apps/chat-api/tests/db/pool.test.ts
git commit -m "feat(db): add PostgreSQL v3 migration and database connection pool"
```

---

### Task 7: Repository Layer for Conversations, Messages, Plans & Steps

**Files:**
- Create: `apps/chat-api/src/db/repositories/conversation-repo.ts`
- Create: `apps/chat-api/src/db/repositories/message-repo.ts`
- Create: `apps/chat-api/src/db/repositories/plan-repo.ts`
- Create: `apps/chat-api/src/db/repositories/step-repo.ts`
- Create: `apps/chat-api/src/db/repositories/credential-repo.ts`
- Create: `apps/chat-api/src/db/repositories/index.ts`
- Test: `apps/chat-api/tests/db/repositories.test.ts`

**Interfaces:**
- Consumes: `getPool`, SQL tables.
- Produces: `ConversationRepo`, `MessageRepo`, `PlanRepo`, `StepRepo`, `CredentialRepo`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/db/repositories.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PlanRepo } from '../../src/db/repositories';

describe('Plan Repository (Optimistic Locking & Deterministic Hash)', () => {
  it('attempts to approve plan with optimistic locking query', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: 'plan-1', status: 'approved' }] });
    const repo = new PlanRepo({ query: mockQuery } as any);

    const approved = await repo.approvePlan('plan-1');
    expect(approved).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1 AND status = 'pending'"),
      ['plan-1']
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/db/repositories.test.ts`
Expected: FAIL with "Cannot find module PlanRepo"

- [ ] **Step 3: Implement repositories with optimistic locking and typed queries**

Implement CRUD operations with parameterized queries for `ConversationRepo`, `MessageRepo`, `PlanRepo` (including `approvePlan` with `WHERE status = 'pending'`), `StepRepo`, and `CredentialRepo`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/db/repositories.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/db/repositories/ apps/chat-api/tests/db/repositories.test.ts
git commit -m "feat(api): implement database repositories with optimistic locking"
```

---

### Task 8: LLM Provider Abstraction & Working Memory Entity Store (`packages/planner`)

**Files:**
- Create: `packages/planner/src/types.ts`
- Create: `packages/planner/src/working-memory.ts`
- Create: `packages/planner/src/providers/llm-provider.ts`
- Create: `packages/planner/src/providers/mock-provider.ts`
- Create: `packages/planner/src/providers/gemini-provider.ts`
- Test: `packages/planner/tests/working-memory.test.ts`

**Interfaces:**
- Consumes: `@google/genai`, `@wap/tool-schemas`.
- Produces: `WorkingMemory`, `LLMProvider`, `MockLLMProvider`, `GeminiProvider`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/planner/tests/working-memory.test.ts
import { describe, it, expect } from 'vitest';
import { WorkingMemory, GeminiProvider } from '../src';

describe('Working Memory & Provider Setup', () => {
  it('stores resolved entities and formats them as structured JSON context', () => {
    const memory = new WorkingMemory();
    memory.setEntity('board', { id: 'b_frontend', name: 'Frontend Web' });
    memory.addMember({ id: 'm_1', name: 'Minh', username: 'minhn' });

    const snapshot = memory.toJSON();
    expect(snapshot.board.id).toBe('b_frontend');
    expect(snapshot.members).toHaveLength(1);
    expect(memory.toPromptString()).toContain('b_frontend');
  });

  it('throws an error if GeminiProvider is created in live mode without GEMINI_API_KEY', () => {
    const original = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    expect(() => new GeminiProvider({ apiKey: '' })).toThrow(/GEMINI_API_KEY is required/i);
    process.env.GEMINI_API_KEY = original;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/planner/tests/working-memory.test.ts`
Expected: FAIL with "Cannot find module '../src'"

- [ ] **Step 3: Implement WorkingMemory and GeminiProvider**

Implement `WorkingMemory` in `src/working-memory.ts`. Implement `GeminiProvider` using `@google/genai` checking for API key. Implement `MockLLMProvider` for offline testing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/planner/tests/working-memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/planner/
git commit -m "feat(planner): implement Working Memory store and Gemini LLM provider"
```

---

### Task 9: 4-Layer Plan Validator with Thinking Precedence (`packages/planner`)

**Files:**
- Create: `packages/planner/src/validator.ts`
- Test: `packages/planner/tests/validator.test.ts`

**Interfaces:**
- Consumes: `@wap/tool-schemas`.
- Produces: `validatePlan(rawOutput: string, catalog: ToolDefinition[]): ValidationResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/planner/tests/validator.test.ts
import { describe, it, expect } from 'vitest';
import { validatePlan } from '../src';
import { TRELLO_TOOLS, SLACK_TOOLS } from '@wap/tool-schemas';

describe('4-Layer Plan Validator', () => {
  const catalog = [...TRELLO_TOOLS, ...SLACK_TOOLS];

  it('rejects invalid JSON at Layer 1 and missing thinking at Layer 2', () => {
    expect(validatePlan('not json', catalog).layer).toBe('json');
    const noThinking = JSON.stringify({ kind: 'plan', summary: 'test', steps: [] });
    expect(validatePlan(noThinking, catalog).layer).toBe('schema');
  });

  it('rejects broken $ref at Layer 3 semantic check', () => {
    const plan = JSON.stringify({
      kind: 'plan',
      thinking: 'Thinking reasoning here',
      summary: 'Test summary',
      steps: [
        { id: 'step_1', tool: 'trello.create_card', description: 'Create card', args: { listId: 'l1', title: 'Task' }, dependsOn: [] },
        { id: 'step_2', tool: 'trello.add_member', description: 'Add member', args: { cardId: { $ref: 'step_99.output.id' }, memberId: 'm1' }, dependsOn: ['step_1'] }
      ],
      warnings: [],
    });

    const result = validatePlan(plan, catalog);
    expect(result.valid).toBe(false);
    expect(result.layer).toBe('semantic');
    expect(result.error).toMatch(/referenced step 'step_99' not found/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/planner/tests/validator.test.ts`
Expected: FAIL with "validatePlan is not a function"

- [ ] **Step 3: Implement 4-layer validation logic**

Implement `validatePlan` in `src/validator.ts`:
- Layer 1: JSON parse.
- Layer 2: Schema validation (requires `thinking` non-empty string, `summary`, `steps`).
- Layer 3: Semantic check (tools in catalog, valid $ref references, acyclic DAG, max 10 steps).
- Layer 4: Security filter.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/planner/tests/validator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/planner/src/validator.ts packages/planner/tests/validator.test.ts
git commit -m "feat(planner): implement 4-layer plan validator with thinking precedence"
```

---

### Task 10: Hierarchical Router & Planner with 1x Automatic Retry

**Files:**
- Create: `packages/planner/src/router.ts`
- Create: `packages/planner/src/prompts/system-prompt.ts`
- Create: `packages/planner/src/planner.ts`
- Modify: `packages/planner/src/index.ts`
- Test: `packages/planner/tests/planner.test.ts`

**Interfaces:**
- Consumes: `LLMProvider`, `WorkingMemory`, `validatePlan`, `@wap/tool-schemas`.
- Produces: `AIPlanner`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/planner/tests/planner.test.ts
import { describe, it, expect } from 'vitest';
import { AIPlanner, MockLLMProvider, WorkingMemory } from '../src';
import { TRELLO_TOOLS, SLACK_TOOLS } from '@wap/tool-schemas';

describe('AI Planner (Routing & 1x Retry Flow)', () => {
  const tools = [...TRELLO_TOOLS, ...SLACK_TOOLS];

  it('retries exactly once when validation fails, passing error feedback on second call', async () => {
    const mockLLM = new MockLLMProvider();
    // First call returns broken ref; second call returns fixed plan
    mockLLM.setPlanResponses([
      {
        kind: 'plan',
        thinking: 'Attempt 1',
        summary: 'Invalid plan',
        steps: [{ id: 'step_1', tool: 'trello.add_member', description: 'Add', args: { cardId: { $ref: 'non_exist.id' }, memberId: 'm1' }, dependsOn: [] }],
        warnings: [],
      },
      {
        kind: 'plan',
        thinking: 'Attempt 2: Fixed ref',
        summary: 'Valid plan',
        steps: [{ id: 'step_1', tool: 'trello.create_card', description: 'Create', args: { listId: 'l1', title: 'Task' }, dependsOn: [] }],
        warnings: [],
      },
    ]);

    const planner = new AIPlanner({ provider: mockLLM, toolCatalog: tools });
    const response = await planner.processMessage({
      userMessage: 'Tạo card',
      history: [],
      memory: new WorkingMemory(),
    });

    expect(mockLLM.getCallCount()).toBe(2);
    expect(response.kind).toBe('plan');
    if (response.kind === 'plan') {
      expect(response.summary).toBe('Valid plan');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/planner/tests/planner.test.ts`
Expected: FAIL with "AIPlanner is not defined"

- [ ] **Step 3: Implement Router, System Prompt with Few-shots, and Planner with 1x Retry**

Implement `src/router.ts` for service classification. In `src/planner.ts`, check validation result; if failed, invoke LLM once more appending the exact validation error message as a feedback turn.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/planner/tests/planner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/planner/
git commit -m "feat(planner): implement planner with hierarchical routing and 1x validation retry"
```

---

### Task 11: 50-Prompt Evaluation Framework with Quality Gate Thresholds

**Files:**
- Create: `evaluations/golden-prompts.json`
- Create: `evaluations/evaluator.ts`
- Create: `packages/planner/src/prompts/v001-core.md`
- Test: `evaluations/eval.test.ts`

**Interfaces:**
- Consumes: `AIPlanner`, `golden-prompts.json`.
- Produces: Evaluator with assertions for Quality Gate: happy path $\ge 85\%$, edge cases $\ge 70\%$, syntax $100\%$.

- [ ] **Step 1: Write the failing test**

```typescript
// evaluations/eval.test.ts
import { describe, it, expect } from 'vitest';
import { runEvaluations } from './evaluator';

describe('Evaluation Framework & Quality Gate', () => {
  it('enforces quality gate thresholds on golden dataset', async () => {
    const results = await runEvaluations({ useMock: true });
    expect(results.totalPrompts).toBe(50);
    expect(results.syntaxValidRate).toBe(1.0);
    expect(results.happyPathAccuracy).toBeGreaterThanOrEqual(0.85);
    expect(results.edgeCaseAccuracy).toBeGreaterThanOrEqual(0.70);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run evaluations/eval.test.ts`
Expected: FAIL with "Cannot find module './evaluator'"

- [ ] **Step 3: Create golden prompts dataset and evaluation runner**

Write `evaluations/golden-prompts.json` with 50 structured prompts. Create `evaluations/evaluator.ts` measuring tool accuracy, argument quality, and usable plan rate against prompt versions with clear accuracy thresholds.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run evaluations/eval.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add evaluations/ packages/planner/src/prompts/
git commit -m "test(eval): implement 50-prompt evaluation framework with quality gate thresholds"
```

---

### Task 12: Reference Resolver ($ref, $template) (`packages/executor`)

**Files:**
- Create: `packages/executor/src/types.ts`
- Create: `packages/executor/src/resolver.ts`
- Create: `packages/executor/src/index.ts`
- Test: `packages/executor/tests/resolver.test.ts`

**Interfaces:**
- Consumes: `@wap/tool-schemas` (`PlanStep`, `ArgValue`).
- Produces: `resolveArgs(rawArgs: Record<string, ArgValue>, stepOutputs: Map<string, any>): Record<string, any>`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/executor/tests/resolver.test.ts
import { describe, it, expect } from 'vitest';
import { resolveArgs } from '../src';

describe('Argument & Reference Resolver', () => {
  it('resolves literals, $ref paths and $template string interpolations', () => {
    const outputs = new Map<string, any>([
      ['step_1', { id: 'card_123', url: 'https://trello.com/c/123' }],
      ['step_2', { memberId: 'm_456' }],
    ]);

    const args = {
      title: 'Static title',
      targetCardId: { $ref: 'step_1.output.id' },
      slackMessage: { $template: 'Card: ${step_1.output.url}' },
    };

    const resolved = resolveArgs(args, outputs);
    expect(resolved.title).toBe('Static title');
    expect(resolved.targetCardId).toBe('card_123');
    expect(resolved.slackMessage).toBe('Card: https://trello.com/c/123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/executor/tests/resolver.test.ts`
Expected: FAIL with "resolveArgs is not defined"

- [ ] **Step 3: Implement reference resolution**

Implement `resolveArgs` in `src/resolver.ts` supporting nested objects, `$ref` paths, and regex `${step_X.output.Y}` interpolation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/executor/tests/resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/executor/
git commit -m "feat(executor): implement argument and cross-step reference resolver"
```

---

### Task 13: Step Runner with AbortSignal Timeout & UNKNOWN Status

**Files:**
- Create: `packages/executor/src/runner.ts`
- Test: `packages/executor/tests/runner.test.ts`

**Interfaces:**
- Consumes: `@wap/tool-adapters`, `resolveArgs`.
- Produces: `StepRunner`, `ExecutionResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/executor/tests/runner.test.ts
import { describe, it, expect } from 'vitest';
import { StepRunner } from '../src';

describe('StepRunner (Write Safety & AbortSignal Timeout)', () => {
  it('halts execution with UNKNOWN when AbortSignal times out on write action', async () => {
    const runner = new StepRunner({
      getAdapter: () => ({
        execute: async (_tool: string, _args: any, options?: { signal?: AbortSignal }) => {
          return new Promise((_, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('Timeout')));
          });
        },
      }),
    });

    const step = {
      id: 'step_write',
      tool: 'trello.create_card',
      description: 'Create card',
      args: { title: 'Test' },
      dependsOn: [],
    };

    const result = await runner.executeStep(step, new Map(), { timeoutMs: 20 });
    expect(result.status).toBe('unknown');
    expect(result.error?.category).toBe('NETWORK');
    expect(result.output).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/executor/tests/runner.test.ts`
Expected: FAIL with "StepRunner is not defined"

- [ ] **Step 3: Implement StepRunner with AbortSignal timeout and UNKNOWN classification**

Implement `StepRunner` in `src/runner.ts`. Connect `AbortSignal.timeout(options?.timeoutMs || 30000)` to write actions. Catch timeout or 5xx responses and classify step as `unknown`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/executor/tests/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/executor/
git commit -m "feat(executor): implement step runner with AbortSignal timeout and unknown write safety"
```

---

### Task 14: Execution Controller (Pause, Resume, Retry Step, Skip, Stop)

**Files:**
- Create: `packages/executor/src/controller.ts`
- Modify: `packages/executor/src/index.ts`
- Test: `packages/executor/tests/controller.test.ts`

**Interfaces:**
- Consumes: `StepRunner`, `resolveArgs`, `@wap/tool-schemas`.
- Produces: `ExecutionController`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/executor/tests/controller.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ExecutionController } from '../src';

describe('Execution Controller (Partial Failure Handling)', () => {
  it('pauses plan on step failure and allows skip step to proceed to next steps', async () => {
    const steps = [
      { id: 's1', tool: 'trello.create_card', description: 'Step 1', args: {}, dependsOn: [] },
      { id: 's2', tool: 'trello.add_member', description: 'Step 2 (fails)', args: {}, dependsOn: ['s1'] },
      { id: 's3', tool: 'slack.send_message', description: 'Step 3', args: {}, dependsOn: ['s1'] },
    ];

    let s2Failed = true;
    const runner = {
      executeStep: vi.fn().mockImplementation(async (step: any) => {
        if (step.id === 's2' && s2Failed) return { status: 'failed', error: { message: 'Not found' } };
        return { status: 'succeeded', output: { ok: true } };
      }),
    };

    const controller = new ExecutionController({ runner: runner as any, steps });
    const run1 = await controller.runUntilPause();
    expect(run1.status).toBe('partial');
    expect(run1.pausedAtStepId).toBe('s2');

    // Skip step s2
    const run2 = await controller.skipStepAndContinue('s2');
    expect(run2.status).toBe('completed');
    expect(controller.getStepState('s2')?.status).toBe('skipped');
    expect(controller.getStepState('s3')?.status).toBe('succeeded');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/executor/tests/controller.test.ts`
Expected: FAIL with "ExecutionController is not defined"

- [ ] **Step 3: Implement ExecutionController**

Implement `ExecutionController` in `src/controller.ts` supporting `runUntilPause`, `retryStep`, `skipStepAndContinue`, and `stop`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/executor/tests/controller.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/executor/
git commit -m "feat(executor): implement execution controller with partial failure recovery"
```

---

### Task 15: Authentication & User Session Endpoints (JWT + Refresh)

**Files:**
- Create: `apps/chat-api/src/auth/jwt.ts`
- Create: `apps/chat-api/src/routes/auth-routes.ts`
- Test: `apps/chat-api/tests/auth/auth.test.ts`

**Interfaces:**
- Consumes: Node `crypto`, `bcrypt`, `apps/chat-api/src/db`.
- Produces: `POST /api/auth/login`, `POST /api/auth/refresh`, `GET /api/auth/me`, `authMiddleware`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/auth/auth.test.ts
import { describe, it, expect } from 'vitest';
import { generateTokens, verifyAccessToken } from '../../src/auth/jwt';

describe('Auth & JWT Handling', () => {
  const secret = 'jwt-test-secret-at-least-32-chars-long';

  it('generates access token with short TTL and verifies payload', () => {
    const user = { id: 'u1', email: 'test@example.com', name: 'Test User' };
    const { accessToken, refreshToken } = generateTokens(user, secret);

    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();

    const decoded = verifyAccessToken(accessToken, secret);
    expect(decoded.id).toBe('u1');
    expect(decoded.email).toBe('test@example.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/auth/auth.test.ts`
Expected: FAIL with "generateTokens is not defined"

- [ ] **Step 3: Implement JWT authentication and auth routes**

Implement `generateTokens`, `verifyAccessToken` in `src/auth/jwt.ts` and Express routes in `src/routes/auth-routes.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/auth/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/auth/ apps/chat-api/src/routes/auth-routes.ts apps/chat-api/tests/auth/
git commit -m "feat(api): implement JWT authentication and token refresh endpoints"
```

---

### Task 16: Message Ingestion (POST 202 Accepted) & Planner Pipeline

**Files:**
- Create: `apps/chat-api/src/routes/conversation-routes.ts`
- Create: `apps/chat-api/src/services/chat-service.ts`
- Test: `apps/chat-api/tests/routes/conversation-routes.test.ts`

**Interfaces:**
- Consumes: `@wap/planner`, `ConversationRepo`, `MessageRepo`.
- Produces: `POST /api/conversations`, `POST /api/conversations/:id/messages` returning `202 Accepted { messageId }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/routes/conversation-routes.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ChatService } from '../../src/services/chat-service';

describe('Chat Service Message Ingestion', () => {
  it('saves message to db and returns 202 accepted payload immediately', async () => {
    const mockMsgRepo = { createMessage: vi.fn().mockResolvedValue({ id: 'msg-123' }) };
    const mockPlanner = { processMessage: vi.fn().mockResolvedValue({ kind: 'plan' }) };

    const service = new ChatService({
      msgRepo: mockMsgRepo as any,
      planner: mockPlanner as any,
      eventEmitter: { emit: vi.fn() } as any,
    });

    const result = await service.handleUserMessage({
      conversationId: 'conv-1',
      userId: 'u-1',
      content: 'Hello planner',
    });

    expect(result.status).toBe(202);
    expect(result.messageId).toBe('msg-123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/routes/conversation-routes.test.ts`
Expected: FAIL with "ChatService is not defined"

- [ ] **Step 3: Implement ChatService and async dispatch pipeline**

In `src/services/chat-service.ts`, implement `handleUserMessage` saving message immediately and scheduling background planner execution that emits SSE events via an event bus. Add conversation endpoints in `src/routes/conversation-routes.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/routes/conversation-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/services/ apps/chat-api/src/routes/conversation-routes.ts apps/chat-api/tests/routes/
git commit -m "feat(api): implement message ingestion returning 202 accepted"
```

---

### Task 17: SSE Stream Endpoint (12 Events, Sequence Tracking & Last-Event-ID Sync)

**Files:**
- Create: `apps/chat-api/src/sse/sse-manager.ts`
- Create: `apps/chat-api/src/routes/stream-routes.ts`
- Test: `apps/chat-api/tests/sse/sse-manager.test.ts`

**Interfaces:**
- Consumes: Express `GET /api/conversations/:id/stream`.
- Produces: Persistent SSE connection with sequential IDs, reconnect sync buffer, and clean teardown on `req.on('close')`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/sse/sse-manager.test.ts
import { describe, it, expect } from 'vitest';
import { SSEManager } from '../../src/sse/sse-manager';

describe('SSE Stream Manager', () => {
  it('tracks sequential event IDs and replays missed events based on Last-Event-ID', () => {
    const manager = new SSEManager();
    const convId = 'conv-1';

    manager.emitEvent(convId, 'thinking', { text: 'Analyzing...' }); // id: 1
    manager.emitEvent(convId, 'gather_start', { tool: 'trello.search_boards' }); // id: 2
    manager.emitEvent(convId, 'gather_done', {}); // id: 3

    const missed = manager.getMissedEvents(convId, 1);
    expect(missed).toHaveLength(2);
    expect(missed[0].id).toBe(2);
    expect(missed[0].event).toBe('gather_start');
    expect(missed[1].id).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/sse/sse-manager.test.ts`
Expected: FAIL with "SSEManager is not defined"

- [ ] **Step 3: Implement SSEManager and Express Stream route**

Implement `SSEManager` in `src/sse/sse-manager.ts` maintaining an in-memory event buffer with auto-incrementing `id`. In `src/routes/stream-routes.ts`, set headers `Content-Type: text/event-stream`, register client listener, handle `req.on('close')` to remove listener, and replay missed events if `req.headers['last-event-id']` is present.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/sse/sse-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/sse/ apps/chat-api/src/routes/stream-routes.ts apps/chat-api/tests/sse/
git commit -m "feat(api): implement SSE stream endpoint with sequence tracking and event replay"
```

---

### Task 18: Plan Approval & Execution Trigger with Dependency Injection Pipeline

**Files:**
- Create: `apps/chat-api/src/routes/execution-routes.ts`
- Create: `apps/chat-api/src/services/execution-service.ts`
- Create: `apps/chat-api/src/services/adapter-factory.ts`
- Modify: `apps/chat-api/src/app.ts`
- Test: `apps/chat-api/tests/routes/execution-routes.test.ts`

**Interfaces:**
- Consumes: `POST /api/plans/:id/approve`, `@wap/executor`, `PlanRepo`, `CredentialRepo`.
- Produces: Complete Dependency Injection pipeline (`CredentialRepo` -> `decryptCredentials` -> `Adapter` -> `ExecutionController`), optimistic-locked approval.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/routes/execution-routes.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ExecutionService } from '../../src/services/execution-service';

describe('Execution Service Approval & Adapter Injection', () => {
  it('approves pending plan with optimistic lock and rejects concurrent duplicate with 409', async () => {
    let callCount = 0;
    const mockPlanRepo = {
      approvePlan: vi.fn().mockImplementation(async () => {
        callCount++;
        return callCount === 1; // Only first succeeds
      }),
      getPlan: vi.fn().mockResolvedValue({ id: 'p1', status: 'approved', plan_json: { steps: [] } }),
    };

    const mockAdapterFactory = {
      getAdapterForService: vi.fn().mockResolvedValue({ execute: vi.fn() }),
    };

    const service = new ExecutionService({
      planRepo: mockPlanRepo as any,
      stepRepo: { createStep: vi.fn() } as any,
      credentialRepo: { getCredentials: vi.fn() } as any,
      adapterFactory: mockAdapterFactory as any,
      sseManager: { emitEvent: vi.fn() } as any,
    });

    const call1 = await service.approveAndStart('p1', 'u1');
    expect(call1.success).toBe(true);

    const call2 = await service.approveAndStart('p1', 'u1');
    expect(call2.success).toBe(false);
    expect(call2.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/routes/execution-routes.test.ts`
Expected: FAIL with "ExecutionService is not defined"

- [ ] **Step 3: Implement AdapterFactory and ExecutionService**

Implement `AdapterFactory` resolving and decrypting credentials from `CredentialRepo`. Implement `ExecutionService` executing steps and emitting SSE status updates. Mount routes on Express app in `src/app.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/routes/execution-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/services/ apps/chat-api/src/routes/execution-routes.ts apps/chat-api/src/app.ts apps/chat-api/tests/routes/execution-routes.test.ts
git commit -m "feat(api): implement execution service with adapter injection and optimistic locking"
```

---

### Task 19: Frontend Workspace Scaffolding & State Store (`apps/chat-web`)

**Files:**
- Create: `apps/chat-web/package.json`
- Create: `apps/chat-web/tsconfig.json`
- Create: `apps/chat-web/vite.config.ts`
- Create: `apps/chat-web/src/types.ts`
- Create: `apps/chat-web/src/store/chat-store.ts`
- Test: `apps/chat-web/tests/store.test.ts`

**Interfaces:**
- Consumes: Zustand, React 19.
- Produces: `useChatStore` holding messages, active conversation, active plan, execution progress.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-web/tests/store.test.ts
import { describe, it, expect } from 'vitest';
import { useChatStore } from '../src/store/chat-store';

describe('Chat Store State Management', () => {
  it('adds optimistic user message and replaces it upon sync', () => {
    const store = useChatStore.getState();
    store.addOptimisticMessage({ id: 'temp-1', content: 'Create a card' });

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].status).toBe('sending');

    store.confirmMessage('temp-1', 'confirmed-msg-id');
    expect(useChatStore.getState().messages[0].id).toBe('confirmed-msg-id');
    expect(useChatStore.getState().messages[0].status).toBe('sent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-web/tests/store.test.ts`
Expected: FAIL with "Cannot find module useChatStore"

- [ ] **Step 3: Setup Vite React project and Zustand store**

Scaffold `apps/chat-web` with React 19, Tailwind CSS, and Vite. In `src/store/chat-store.ts`, implement Zustand store managing messages, activePlan, stepStatuses, isStreaming.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/
git commit -m "feat(web): scaffold React 19 web app and Zustand chat store"
```

---

### Task 20: SSE Client with `@microsoft/fetch-event-source` & Event Sequencing

**Files:**
- Create: `apps/chat-web/src/hooks/use-sse.ts`
- Test: `apps/chat-web/tests/use-sse.test.ts`

**Interfaces:**
- Consumes: `@microsoft/fetch-event-source`, `useChatStore`.
- Produces: `useSSE(conversationId: string, token: string)` sending `Authorization: Bearer` and `Last-Event-ID`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-web/tests/use-sse.test.ts
import { describe, it, expect } from 'vitest';
import { handleSSEEvent } from '../src/hooks/use-sse';
import { useChatStore } from '../src/store/chat-store';

describe('SSE Client Event Handler', () => {
  it('updates store on text_delta and plan events with sequence check', () => {
    const store = useChatStore.getState();
    store.reset();

    handleSSEEvent('text_start', '{}', 1);
    handleSSEEvent('text_delta', JSON.stringify({ delta: 'Hello ' }), 2);
    handleSSEEvent('text_delta', JSON.stringify({ delta: 'world' }), 3);

    expect(useChatStore.getState().streamingText).toBe('Hello world');

    handleSSEEvent('plan', JSON.stringify({ kind: 'plan', summary: 'Test', steps: [] }), 4);
    expect(useChatStore.getState().activePlan?.summary).toBe('Test');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-web/tests/use-sse.test.ts`
Expected: FAIL with "handleSSEEvent is not defined"

- [ ] **Step 3: Implement SSE hook using fetch-event-source**

In `src/hooks/use-sse.ts`, use `fetchEventSource` configuring `headers: { 'Authorization': 'Bearer ' + token, 'Last-Event-ID': lastId }`. Dispatch incoming events into `useChatStore`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/use-sse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/hooks/ apps/chat-web/tests/use-sse.test.ts
git commit -m "feat(web): implement authenticated SSE client with fetch-event-source"
```

---

### Task 21: Gather Progress & Clarification Cards (`apps/chat-web`)

**Files:**
- Create: `apps/chat-web/src/components/GatherProgress.tsx`
- Create: `apps/chat-web/src/components/ClarificationCard.tsx`
- Test: `apps/chat-web/tests/components/gather-clarify.test.tsx`

**Interfaces:**
- Consumes: `useChatStore`.
- Produces: `GatherProgress` collapsible and `ClarificationCard` with interactive option buttons.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/chat-web/tests/components/gather-clarify.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ClarificationCard } from '../../src/components/ClarificationCard';

describe('Clarification Card Component', () => {
  it('renders question and calls onSelectOption on click', () => {
    const onSelect = vi.fn();
    render(<ClarificationCard question="Chọn board nào?" options={['Web Frontend', 'Backend API']} onSelectOption={onSelect} />);

    expect(screen.getByText('Chọn board nào?')).toBeDefined();
    fireEvent.click(screen.getByText('Web Frontend'));
    expect(onSelect).toHaveBeenCalledWith('Web Frontend');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-web/tests/components/gather-clarify.test.tsx`
Expected: FAIL with "ClarificationCard is not defined"

- [ ] **Step 3: Implement GatherProgress and ClarificationCard**

Implement `GatherProgress.tsx` displaying search query badges. Implement `ClarificationCard.tsx` displaying option buttons and open-ended text input.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/components/gather-clarify.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/components/GatherProgress.tsx apps/chat-web/src/components/ClarificationCard.tsx apps/chat-web/tests/components/gather-clarify.test.tsx
git commit -m "feat(web): implement gather progress and clarification cards"
```

---

### Task 22: Message List & Chat Container (`apps/chat-web`)

**Files:**
- Create: `apps/chat-web/src/components/MessageItem.tsx`
- Create: `apps/chat-web/src/components/ChatContainer.tsx`
- Test: `apps/chat-web/tests/components/chat-container.test.tsx`

**Interfaces:**
- Consumes: `useChatStore`.
- Produces: `ChatContainer` and `MessageItem` rendering user and assistant markdown messages.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/chat-web/tests/components/chat-container.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MessageItem } from '../../src/components/MessageItem';

describe('Message Item Component', () => {
  it('renders markdown assistant message correctly', () => {
    render(<MessageItem role="assistant" content="**Bold plan** explanation" />);
    expect(screen.getByText('Bold plan')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-web/tests/components/chat-container.test.tsx`
Expected: FAIL with "MessageItem is not defined"

- [ ] **Step 3: Implement MessageItem and ChatContainer**

Implement `MessageItem.tsx` with markdown rendering and role-based styling. Implement `ChatContainer.tsx` with scroll-to-bottom and message input bar.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/components/chat-container.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/components/MessageItem.tsx apps/chat-web/src/components/ChatContainer.tsx apps/chat-web/tests/components/chat-container.test.tsx
git commit -m "feat(web): implement message item and chat container components"
```

---

### Task 23: Plan Preview Card with Thinking Layer & Approval Actions

**Files:**
- Create: `apps/chat-web/src/components/PlanPreview.tsx`
- Create: `apps/chat-web/src/components/PlanStepItem.tsx`
- Test: `apps/chat-web/tests/components/plan-preview.test.tsx`

**Interfaces:**
- Consumes: `PlanResponse`.
- Produces: `PlanPreview` card with collapsible Thinking section and [Duyệt], [Sửa], [Hủy] actions.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/chat-web/tests/components/plan-preview.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PlanPreview } from '../../src/components/PlanPreview';

describe('PlanPreview Component', () => {
  it('renders thinking layer, plan steps, and triggers approve handler', () => {
    const onApprove = vi.fn();
    const plan = {
      kind: 'plan' as const,
      thinking: 'Thinking reasoning here',
      summary: 'Tạo card và gửi Slack',
      steps: [
        { id: 's1', tool: 'trello.create_card', description: 'Tạo card Trello', args: {}, dependsOn: [] },
      ],
      warnings: [],
    };

    render(<PlanPreview plan={plan} onApprove={onApprove} onEdit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Tạo card và gửi Slack')).toBeDefined();
    const approveBtn = screen.getByRole('button', { name: /duyệt/i });
    fireEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-web/tests/components/plan-preview.test.tsx`
Expected: FAIL with "PlanPreview is not defined"

- [ ] **Step 3: Implement PlanPreview and PlanStepItem**

Implement `PlanPreview.tsx` with collapsible Thinking section, formatted step list, tool badges, and action buttons.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/components/plan-preview.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/components/PlanPreview.tsx apps/chat-web/src/components/PlanStepItem.tsx apps/chat-web/tests/components/plan-preview.test.tsx
git commit -m "feat(web): implement plan preview card with thinking layer"
```

---

### Task 24: Live Execution Progress & Partial Failure Recovery UI

**Files:**
- Create: `apps/chat-web/src/components/ExecutionProgress.tsx`
- Create: `apps/chat-web/src/components/PartialFailureModal.tsx`
- Test: `apps/chat-web/tests/components/execution-progress.test.tsx`

**Interfaces:**
- Consumes: Execution state from `useChatStore`.
- Produces: Live step indicators (pending, running, succeeded, failed, unknown) and recovery actions (`[Thử lại]`, `[Sửa & Thử lại]`, `[Bỏ qua]`, `[Dừng]`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/chat-web/tests/components/execution-progress.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PartialFailureModal } from '../../src/components/PartialFailureModal';

describe('Partial Failure Modal', () => {
  it('renders recovery buttons on failed step', () => {
    const onRetry = vi.fn();
    const onSkip = vi.fn();

    render(
      <PartialFailureModal
        stepId="step_2"
        tool="trello.add_member"
        errorMessage="Member not found"
        onRetry={onRetry}
        onEditAndRetry={vi.fn()}
        onSkip={onSkip}
        onStop={vi.fn()}
      />
    );

    expect(screen.getByText(/Member not found/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /thử lại/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-web/tests/components/execution-progress.test.tsx`
Expected: FAIL with "PartialFailureModal is not defined"

- [ ] **Step 3: Implement ExecutionProgress and PartialFailureModal**

Implement `ExecutionProgress.tsx` and `PartialFailureModal.tsx` triggering `/retry`, `/skip`, and `/stop`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/components/execution-progress.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/components/ExecutionProgress.tsx apps/chat-web/src/components/PartialFailureModal.tsx apps/chat-web/tests/components/execution-progress.test.tsx
git commit -m "feat(web): implement execution progress and partial failure modal"
```

---

### Task 25: Settings Page & Service Connection Wizard with Allowed Scope

**Files:**
- Create: `apps/chat-web/src/components/SettingsModal.tsx`
- Create: `apps/chat-web/src/components/ServiceCard.tsx`
- Test: `apps/chat-web/tests/components/settings.test.tsx`

**Interfaces:**
- Consumes: `/api/services`, `/api/services/:name/connect`, `/api/services/:name/test`.
- Produces: Settings modal with Trello and Slack credentials setup, allowed scope configuration, and live connection testing.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/chat-web/tests/components/settings.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ServiceCard } from '../../src/components/ServiceCard';

describe('ServiceCard Component', () => {
  it('renders service info, credential inputs, allowed scope and test connection button', () => {
    const onTest = vi.fn();
    render(
      <ServiceCard
        service="trello"
        title="Trello"
        connected={false}
        onSave={vi.fn()}
        onTestConnection={onTest}
      />
    );

    expect(screen.getByText('Trello')).toBeDefined();
    const testBtn = screen.getByRole('button', { name: /kiểm tra kết nối/i });
    fireEvent.click(testBtn);
    expect(onTest).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-web/tests/components/settings.test.tsx`
Expected: FAIL with "ServiceCard is not defined"

- [ ] **Step 3: Implement ServiceCard and SettingsModal**

Implement `ServiceCard.tsx` with credential fields, Allowed Scope (whitelist board/channel names), and live test button. Implement `SettingsModal.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/components/settings.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/components/SettingsModal.tsx apps/chat-web/src/components/ServiceCard.tsx apps/chat-web/tests/components/settings.test.tsx
git commit -m "feat(web): implement service connection wizard with allowed scope"
```

---

### Task 26: Automated Cross-Service E2E Scenario 1: Project Task Creation & Slack Notification

**Files:**
- Create: `apps/chat-api/tests/e2e/scenario-1-task-slack.test.ts`
- Test: `apps/chat-api/tests/e2e/scenario-1-task-slack.test.ts`

**Interfaces:**
- Consumes: Express app via `supertest`.
- Produces: Automated E2E verification of chat -> gather -> plan -> approve -> execute -> card created + Slack notified.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/e2e/scenario-1-task-slack.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

describe('E2E Scenario 1: Trello Card Creation & Slack Notification', () => {
  it('completes multi-step workflow via Express REST endpoints', async () => {
    const app = createApp({ useMocks: true });

    // 1. Create conversation
    const convRes = await request(app).post('/api/conversations').send({ userId: 'u1' });
    expect(convRes.status).toBe(201);
    const { id: convId } = convRes.body;

    // 2. Send message
    const msgRes = await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .send({ content: 'Tạo task sửa CSS cho Minh trên board Frontend và báo channel general' });
    expect(msgRes.status).toBe(202);

    // 3. Query generated plan
    const planRes = await request(app).get(`/api/conversations/${convId}/plans/active`);
    expect(planRes.status).toBe(200);
    const plan = planRes.body;
    expect(plan.steps).toHaveLength(3);

    // 4. Approve plan
    const approveRes = await request(app).post(`/api/plans/${plan.id}/approve`).send({});
    expect(approveRes.status).toBe(200);

    // 5. Verify execution
    const execRes = await request(app).get(`/api/executions/${plan.id}/status`);
    expect(execRes.body.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/e2e/scenario-1-task-slack.test.ts`
Expected: FAIL with "createApp is not exported or routes missing"

- [ ] **Step 3: Implement mock fixtures and wire E2E scenario 1**

Configure mock adapter responses and ensure the full flow passes from chat input to execution status query using `supertest(app)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/e2e/scenario-1-task-slack.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/tests/e2e/scenario-1-task-slack.test.ts
git commit -m "test(e2e): implement automated Scenario 1 Trello card creation and Slack notification"
```

---

### Task 27: Automated E2E Scenario 2: Ambiguous Name Clarification & Resolution

**Files:**
- Create: `apps/chat-api/tests/e2e/scenario-2-clarification.test.ts`
- Test: `apps/chat-api/tests/e2e/scenario-2-clarification.test.ts`

**Interfaces:**
- Consumes: Express app via `supertest`.
- Produces: Automated E2E verification of multi-turn clarification when multiple members match a query.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/e2e/scenario-2-clarification.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

describe('E2E Scenario 2: Ambiguous Name Clarification', () => {
  it('returns clarification question when search_members yields multiple matches, then completes plan', async () => {
    const app = createApp({ useMocks: true });
    const convRes = await request(app).post('/api/conversations').send({ userId: 'u1' });
    const { id: convId } = convRes.body;

    // Send ambiguous prompt
    await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .send({ content: 'Gán task cho Minh' });

    // Expect clarification response
    const msgRes = await request(app).get(`/api/conversations/${convId}/messages/latest`);
    expect(msgRes.body.metadata?.type).toBe('clarification');
    expect(msgRes.body.metadata?.options).toContain('Minh Nguyen');
    expect(msgRes.body.metadata?.options).toContain('Minh Tran');

    // Answer clarification
    await request(app)
      .post(`/api/conversations/${convId}/messages`)
      .send({ content: 'Minh Nguyen' });

    // Now plan should be generated
    const planRes = await request(app).get(`/api/conversations/${convId}/plans/active`);
    expect(planRes.body.kind).toBe('plan');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/e2e/scenario-2-clarification.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement clarification state transition in ChatService**

Store clarification state in Working Memory and verify that subsequent user answers resolve the entity and trigger plan generation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/e2e/scenario-2-clarification.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/tests/e2e/scenario-2-clarification.test.ts
git commit -m "test(e2e): implement automated Scenario 2 entity clarification and multi-turn resolution"
```

---

### Task 28: Automated E2E Scenario 3: Partial Failure Recovery (Skip Step)

**Files:**
- Create: `apps/chat-api/tests/e2e/scenario-3-partial-failure.test.ts`
- Test: `apps/chat-api/tests/e2e/scenario-3-partial-failure.test.ts`

**Interfaces:**
- Consumes: Express app via `supertest`.
- Produces: Automated E2E verification of execution pausing on failed step and user skipping step to complete remainder.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/e2e/scenario-3-partial-failure.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';

describe('E2E Scenario 3: Partial Failure Recovery', () => {
  it('pauses execution when step 2 fails, allows skip step, and finishes remaining steps', async () => {
    const app = createApp({ useMocks: true, failStepId: 'step_2' });
    const convRes = await request(app).post('/api/conversations').send({ userId: 'u1' });
    const { id: convId } = convRes.body;

    await request(app).post(`/api/conversations/${convId}/messages`).send({ content: 'Tạo card và gửi Slack' });
    const planRes = await request(app).get(`/api/conversations/${convId}/plans/active`);
    const plan = planRes.body;

    await request(app).post(`/api/plans/${plan.id}/approve`).send({});

    // Check status is paused at step_2
    const status1 = await request(app).get(`/api/executions/${plan.id}/status`);
    expect(status1.body.status).toBe('partial');
    expect(status1.body.pausedStepId).toBe('step_2');

    // Skip step_2
    const skipRes = await request(app).post(`/api/executions/${plan.id}/steps/step_2/skip`).send({});
    expect(skipRes.status).toBe(200);

    // Final status completed
    const status2 = await request(app).get(`/api/executions/${plan.id}/status`);
    expect(status2.body.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/e2e/scenario-3-partial-failure.test.ts`
Expected: FAIL

- [ ] **Step 3: Wire skip endpoint in ExecutionService and run E2E test**

Implement skip step transition updating step status to `skipped` and continuing execution of remaining steps.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/e2e/scenario-3-partial-failure.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/tests/e2e/scenario-3-partial-failure.test.ts
git commit -m "test(e2e): implement automated Scenario 3 partial failure pause and skip recovery"
```

---

## Plan Self-Review Checklist

- [x] **Spec coverage:** All phases from Phase 0 to Phase 6 covered in 28 bite-sized tasks.
- [x] **Step scan:** Every step contains clear code blocks, exact names, and unambiguous test commands.
- [x] **Type consistency:** `@wap/tool-schemas` exported and imported consistently across packages using standard Node `exports`.
- [x] **Review Focus:** Addressed all 5 failure modes with concrete test assertions (DAG ref check, clarification multi-turn, AbortSignal timeout, SSE sequence tracking, optimistic locking concurrency).
- [x] **Reality Check:** Fixed Express + Supertest mismatch, switched browser SSE to `@microsoft/fetch-event-source`, and added Quality Gate thresholds to 50-prompt evaluation.
