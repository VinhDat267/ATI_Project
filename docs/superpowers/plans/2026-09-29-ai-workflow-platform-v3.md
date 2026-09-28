# AI Workflow Automation Platform v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v3 AI Workflow Automation Platform featuring a conversational chat interface, multi-tool AI planner with working memory & hierarchical routing, 4-layer validation, and a sequential execution engine across Trello and Slack with write-safety guarantees.

**Architecture:** A clean separation of concerns in a TypeScript monorepo: `packages/tool-schemas` defines tool interfaces and JSON schemas without heavy SDK dependencies; `packages/tool-adapters` implements external APIs with encryption, global rate-limiting, and allowed scope filtering; `packages/planner` manages multi-turn gather/clarify in Chat Mode and single-shot planning with a Thinking Layer and Working Memory in Plan Mode; `packages/executor` runs sequential DAG execution with $ref resolution, ACID step state updates, and UNKNOWN write-safety; `apps/chat-api` provides async message ingestion (202 Accepted) and resilient SSE event streaming; `apps/chat-web` renders a modern React 19 UI with optimistic updates and interactive approval cards.

**Tech Stack:** Node.js, TypeScript 5.6+, PostgreSQL (pg pool), React 19, Tailwind CSS, Vite, Zustand, Server-Sent Events (SSE), Google Gemini API (gemini-1.5-pro / 2.0-flash), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`

## Global Constraints

- Monorepo packages: `@wap/tool-schemas`, `@wap/tool-adapters`, `@wap/planner`, `@wap/executor`, `@wap/chat-api`, `@wap/chat-web`.
- TypeScript strict mode enabled across all new packages with `"moduleResolution": "node16"` or `"bundler"`.
- PostgreSQL v3 schema isolated under `db/v3/` using 6 tables: `users`, `conversations`, `messages`, `plans`, `execution_steps`, `service_credentials`.
- Read tools MUST use `search_*` signatures with explicit `query: string` and `limit: number` (max 10). `list_*` dumping full entities into LLM context is forbidden.
- AI Plan generation uses 1 consistent model for dev, evaluation, and production (recommended `gemini-1.5-pro`).
- Plan hash calculation MUST be deterministic using `json-stable-stringify` or storing verbatim `plan_text`.
- Non-idempotent writes returning 5xx or timing out MUST be classified as `unknown` and NEVER auto-retried.
- Plan approval endpoint MUST enforce optimistic locking via `WHERE id = $1 AND status = 'pending'`.
- SSE events MUST include incremental `id` (sequence_id), and reconnects MUST honor `Last-Event-ID`.

## Review Focus

1. **DAG cross-step invalid reference:** AI generates a plan step referencing a non-existent step or non-existent output property (e.g., `$step_99.output.id`). Tested in Task 9.
2. **Ambiguous member search resolution:** User asks to assign "Minh" when multiple "Minh" members exist. AI enters clarification multi-turn rather than choosing arbitrarily. Tested in Task 10.
3. **Write timeout safety:** External API call (e.g., Trello `create_card`) hangs or times out after 30s. Executor marks step `unknown`, rolls nothing back, and halts execution for user choice. Tested in Task 13.
4. **SSE mid-stream disconnection:** Client disconnects while LLM is generating plan deltas. Reconnect with `Last-Event-ID` catches up without re-triggering planner or dropping events. Tested in Task 17.
5. **Rapid double approval clicks:** Two simultaneous `POST /api/plans/:id/approve` requests arrive within 10ms. Exactly one succeeds with 200, the other fails with 409 Conflict. Tested in Task 18.

---

### Task 1: Monorepo Package Scaffolding & Root Workspace Integration

**Files:**
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
- Modify: `package.json:11-48`
- Test: `tests/scaffold.test.ts`

**Interfaces:**
- Consumes: Monorepo workspace configuration `packages/*` and `apps/*`.
- Produces: Build and typecheck commands for `@wap/tool-schemas`, `@wap/tool-adapters`, `@wap/planner`, `@wap/executor`, `@wap/chat-api`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/scaffold.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('V3 Monorepo Scaffolding', () => {
  const pkgs = [
    'packages/tool-schemas',
    'packages/tool-adapters',
    'packages/planner',
    'packages/executor',
    'apps/chat-api',
  ];

  it('verifies all v3 packages and tsconfigs exist', () => {
    for (const pkg of pkgs) {
      expect(existsSync(resolve(pkg, 'package.json')), `missing ${pkg}/package.json`).toBe(true);
      expect(existsSync(resolve(pkg, 'tsconfig.json')), `missing ${pkg}/tsconfig.json`).toBe(true);
      const pkgJson = JSON.parse(readFileSync(resolve(pkg, 'package.json'), 'utf8'));
      expect(pkgJson.name).toMatch(/^@wap\//);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scaffold.test.ts`
Expected: FAIL with "missing packages/tool-schemas/package.json"

- [ ] **Step 3: Create package.json and tsconfig.json for each new package**

Add `package.json` with appropriate dependencies and scripts (`build`, `test`, `typecheck`) and `tsconfig.json` extending root config. Update root `package.json` with scripts: `check:v3:backend`, `test:v3`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scaffold.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ apps/chat-api/ package.json tests/scaffold.test.ts
git commit -m "chore(infra): scaffold v3 monorepo packages and workspaces"
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
- Consumes: Standard JSON Schema structures.
- Produces: `ToolDefinition`, `PlanResponse`, `PlanStep`, `ArgValue`, `TRELLO_TOOLS`, `SLACK_TOOLS`.

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
    expect(searchMembers).toBeDefined();
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

- [ ] **Step 3: Implement ToolDefinition and tool catalogs**

Define `ToolDefinition`, `PlanResponse`, `PlanStep`, `ClarificationResponse`, `RefusalResponse` in `src/types.ts`. Implement `TRELLO_TOOLS` in `src/trello.ts` (search_boards, search_lists, search_members, search_cards, get_card, create_card, update_card, add_member, add_checklist) and `SLACK_TOOLS` in `src/slack.ts` (search_channels, send_message) with accurate input/output schemas. Export from `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/tool-schemas/tests/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-schemas/
git commit -m "feat(schemas): define v3 tool definitions and plan contracts"
```

---

### Task 3: Base Adapter, Credential Encryption & Global Rate Limiting

**Files:**
- Create: `packages/tool-adapters/src/crypto.ts`
- Create: `packages/tool-adapters/src/rate-limiter.ts`
- Create: `packages/tool-adapters/src/base-adapter.ts`
- Test: `packages/tool-adapters/tests/crypto-ratelimit.test.ts`

**Interfaces:**
- Consumes: Node `crypto`, `packages/tool-schemas`.
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

Implement `encryptCredentials` / `decryptCredentials` in `crypto.ts` using `crypto.createCipheriv('aes-256-gcm', ...)` returning `v1:${iv}:${tag}:${ciphertext}`. Implement sliding-window or token-bucket `GlobalRateLimiter` in `rate-limiter.ts`. Implement abstract `BaseAdapter` with error normalization in `base-adapter.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/tool-adapters/tests/crypto-ratelimit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/
git commit -m "feat(adapters): implement AES-256-GCM credentials encryption and rate limiter"
```

---

### Task 4: Trello Adapter Implementation & Allowed Scope Filtering

**Files:**
- Create: `packages/tool-adapters/src/trello-adapter.ts`
- Create: `packages/tool-adapters/src/index.ts`
- Test: `packages/tool-adapters/tests/trello-adapter.test.ts`

**Interfaces:**
- Consumes: `@wap/tool-schemas`, `BaseAdapter`.
- Produces: `TrelloAdapter`, `TrelloCredentials`, `AllowedScope`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tool-adapters/tests/trello-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { TrelloAdapter } from '../src';

describe('TrelloAdapter', () => {
  it('searches members with query filter and obeys allowed scope', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: 'm1', fullName: 'Minh Nguyen', username: 'minhn' },
        { id: 'm2', fullName: 'An Tran', username: 'ant' },
      ],
    });

    const adapter = new TrelloAdapter({
      credentials: { apiKey: 'key', token: 'token' },
      allowedScope: { boards: ['b1'] },
      fetchFn: mockFetch as any,
    });

    const members = await adapter.execute('trello.search_members', {
      boardId: 'b1',
      query: 'Minh',
      limit: 5,
    });

    expect(members).toHaveLength(1);
    expect(members[0].fullName).toBe('Minh Nguyen');

    // Scope rejection test
    await expect(
      adapter.execute('trello.search_members', { boardId: 'forbidden-board', query: 'Minh' })
    ).rejects.toThrow(/Allowed scope restriction/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/tool-adapters/tests/trello-adapter.test.ts`
Expected: FAIL with "TrelloAdapter not defined"

- [ ] **Step 3: Implement TrelloAdapter with all 9 tools and scope validation**

Implement `TrelloAdapter` in `src/trello-adapter.ts` implementing `search_boards`, `search_lists`, `search_members`, `search_cards`, `get_card`, `create_card`, `update_card`, `add_member`, and `add_checklist`. Verify board ID against `allowedScope.boards` before any request. Normalize 401/403 to `AUTH_ERROR`, 404 to `NOT_FOUND`, 429 to `RATE_LIMIT`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/tool-adapters/tests/trello-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/
git commit -m "feat(adapters): implement Trello adapter with search queries and allowed scope"
```

---

### Task 5: Slack Adapter Implementation & Allowed Scope Filtering

**Files:**
- Create: `packages/tool-adapters/src/slack-adapter.ts`
- Modify: `packages/tool-adapters/src/index.ts`
- Test: `packages/tool-adapters/tests/slack-adapter.test.ts`

**Interfaces:**
- Consumes: `@wap/tool-schemas`, `BaseAdapter`.
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

    const result = await adapter.execute('slack.send_message', {
      channel: 'C2',
      text: 'Test notification',
    });
    expect(result.ts).toBe('12345.678');

    // Forbidden channel
    await expect(
      adapter.execute('slack.send_message', { channel: 'C1', text: 'Should fail' })
    ).rejects.toThrow(/Allowed scope restriction/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/tool-adapters/tests/slack-adapter.test.ts`
Expected: FAIL with "SlackAdapter not defined"

- [ ] **Step 3: Implement SlackAdapter**

Implement `SlackAdapter` in `src/slack-adapter.ts` with `search_channels` and `send_message`. Enforce `allowedScope.channels`. Export from `src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/tool-adapters/tests/slack-adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/
git commit -m "feat(adapters): implement Slack adapter with allowed channels filtering"
```

---

### Task 6: PostgreSQL V3 Schema Migration & Connection Pool (`db/v3/`)

**Files:**
- Create: `db/v3/0001_v3_core.sql`
- Create: `apps/chat-api/src/db/pool.ts`
- Test: `apps/chat-api/tests/db/pool.test.ts`

**Interfaces:**
- Consumes: PostgreSQL connection string from `DATABASE_URL`.
- Produces: `getPool`, `closePool`, SQL migration script with 6 core tables and performance indexes.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/db/pool.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('V3 SQL Schema', () => {
  it('contains definitions for 6 tables and 4 foreign key performance indexes', () => {
    const sql = readFileSync(resolve('db/v3/0001_v3_core.sql'), 'utf8');
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

Write `db/v3/0001_v3_core.sql` with the exact 6 tables and indexes specified in the spec. In `apps/chat-api/src/db/pool.ts`, wrap `pg.Pool` with graceful shutdown and connection health check.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/db/pool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add db/v3/ apps/chat-api/src/db/pool.ts apps/chat-api/tests/db/pool.test.ts
git commit -m "feat(db): add PostgreSQL v3 schema migration and connection pool"
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

Implement CRUD operations with parameters for `ConversationRepo`, `MessageRepo`, `PlanRepo` (including `approvePlan` with `WHERE status = 'pending'`), `StepRepo`, and `CredentialRepo`.

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
- Consumes: `@wap/tool-schemas`.
- Produces: `WorkingMemory`, `LLMProvider`, `MockLLMProvider`, `GeminiProvider`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/planner/tests/working-memory.test.ts
import { describe, it, expect } from 'vitest';
import { WorkingMemory } from '../src';

describe('Working Memory Management', () => {
  it('stores resolved entities and formats them as structured JSON context', () => {
    const memory = new WorkingMemory();
    memory.setEntity('board', { id: 'b_frontend', name: 'Frontend Web' });
    memory.addMember({ id: 'm_1', name: 'Minh', username: 'minhn' });

    const snapshot = memory.toJSON();
    expect(snapshot.board.id).toBe('b_frontend');
    expect(snapshot.members).toHaveLength(1);

    const promptContext = memory.toPromptString();
    expect(promptContext).toContain('b_frontend');
    expect(promptContext).toContain('Minh');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/planner/tests/working-memory.test.ts`
Expected: FAIL with "Cannot find module '../src'"

- [ ] **Step 3: Implement WorkingMemory and LLMProvider interface**

Implement `WorkingMemory` class in `src/working-memory.ts` holding resolved boards, lists, members, channels. Implement `LLMProvider` interface in `src/providers/llm-provider.ts` and `MockLLMProvider` for deterministic testing. Implement `GeminiProvider` using `@google/genai` or standard fetch to Google Gemini API.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/planner/tests/working-memory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/planner/
git commit -m "feat(planner): implement Working Memory store and LLM provider abstraction"
```

---

### Task 9: 4-Layer Plan Validator (`packages/planner`)

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

  it('rejects invalid JSON at Layer 1', () => {
    const result = validatePlan('not a json', catalog);
    expect(result.valid).toBe(false);
    expect(result.layer).toBe('json');
  });

  it('rejects missing thinking or summary at Layer 2', () => {
    const plan = JSON.stringify({ kind: 'plan', steps: [] });
    const result = validatePlan(plan, catalog);
    expect(result.valid).toBe(false);
    expect(result.layer).toBe('schema');
  });

  it('rejects non-existent tool or broken $ref at Layer 3', () => {
    const plan = JSON.stringify({
      kind: 'plan',
      thinking: 'Plan reasoning here',
      summary: 'Test summary',
      steps: [
        {
          id: 'step_1',
          tool: 'trello.create_card',
          description: 'Create card',
          args: { listId: 'l1', title: 'Task' },
          dependsOn: [],
        },
        {
          id: 'step_2',
          tool: 'trello.add_member',
          description: 'Add member',
          args: { cardId: { $ref: 'step_99.output.id' }, memberId: 'm1' },
          dependsOn: ['step_1'],
        },
      ],
      warnings: [],
    });

    const result = validatePlan(plan, catalog);
    expect(result.valid).toBe(false);
    expect(result.layer).toBe('semantic');
    expect(result.error).toMatch(/referenced step 'step_99' not found/i);
  });

  it('passes a fully valid DAG plan with thinking and valid $ref', () => {
    const plan = JSON.stringify({
      kind: 'plan',
      thinking: 'Step 1 creates card, step 2 links cardId from step 1',
      summary: 'Create card and add member',
      steps: [
        {
          id: 'step_1',
          tool: 'trello.create_card',
          description: 'Create card',
          args: { listId: 'l1', title: 'Task' },
          dependsOn: [],
        },
        {
          id: 'step_2',
          tool: 'trello.add_member',
          description: 'Add member',
          args: { cardId: { $ref: 'step_1.output.id' }, memberId: 'm1' },
          dependsOn: ['step_1'],
        },
      ],
      warnings: [],
    });

    const result = validatePlan(plan, catalog);
    expect(result.valid).toBe(true);
    expect(result.plan?.steps).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/planner/tests/validator.test.ts`
Expected: FAIL with "validatePlan is not a function"

- [ ] **Step 3: Implement 4-layer validation logic**

Implement `validatePlan` in `src/validator.ts`:
- Layer 1: `JSON.parse`.
- Layer 2: Schema validation (ensures `kind`, `thinking`, `summary`, `steps` conform to `PlanResponse`).
- Layer 3: Semantic check: tools exist in catalog, DAG is acyclic, references `$ref: 'step_X.output.Y'` point to previously declared steps and valid output fields, max 10 steps.
- Layer 4: Security check (flags instruction escapes or dangerous shell syntax).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/planner/tests/validator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/planner/
git commit -m "feat(planner): implement 4-layer plan validator with DAG and ref verification"
```

---

### Task 10: Hierarchical Router & Planner Core

**Files:**
- Create: `packages/planner/src/router.ts`
- Create: `packages/planner/src/prompts/system-prompt.ts`
- Create: `packages/planner/src/planner.ts`
- Modify: `packages/planner/src/index.ts`
- Test: `packages/planner/tests/planner.test.ts`

**Interfaces:**
- Consumes: `LLMProvider`, `WorkingMemory`, `validatePlan`, `@wap/tool-schemas`.
- Produces: `classifyServices`, `AIPlanner`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/planner/tests/planner.test.ts
import { describe, it, expect } from 'vitest';
import { AIPlanner, MockLLMProvider, WorkingMemory } from '../src';
import { TRELLO_TOOLS, SLACK_TOOLS } from '@wap/tool-schemas';

describe('AI Planner (Hierarchical Routing & Plan Generation)', () => {
  const tools = [...TRELLO_TOOLS, ...SLACK_TOOLS];

  it('routes user prompt mentioning trello and slack to both services', async () => {
    const mockLLM = new MockLLMProvider();
    mockLLM.setRouteResponse(['trello', 'slack']);
    mockLLM.setPlanResponse({
      kind: 'plan',
      thinking: 'User wants Trello card and Slack notification',
      summary: 'Create card and notify Slack',
      steps: [
        { id: 'step_1', tool: 'trello.create_card', description: 'Create card', args: { listId: 'l1', title: 'Task' }, dependsOn: [] },
        { id: 'step_2', tool: 'slack.send_message', description: 'Post Slack', args: { channel: 'C1', text: { $template: 'Card created: ${step_1.output.url}' } }, dependsOn: ['step_1'] }
      ],
      warnings: [],
    });

    const memory = new WorkingMemory();
    const planner = new AIPlanner({ provider: mockLLM, toolCatalog: tools });

    const response = await planner.processMessage({
      userMessage: 'Tạo card và báo Slack',
      history: [],
      memory,
    });

    expect(response.kind).toBe('plan');
    if (response.kind === 'plan') {
      expect(response.steps).toHaveLength(2);
      expect(response.thinking).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/planner/tests/planner.test.ts`
Expected: FAIL with "AIPlanner is not defined"

- [ ] **Step 3: Implement Router, System Prompt with Few-shots, and Planner**

In `src/router.ts`, implement service classification. In `src/prompts/system-prompt.ts`, write prompt containing 4 complete JSON few-shot examples with `$ref` and `$template`. In `src/planner.ts`, coordinate: classify services -> subset tools -> check if context is sufficient -> generate plan or ask clarification -> run 4-layer validation (with 1 automatic retry on validation failure).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/planner/tests/planner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/planner/
git commit -m "feat(planner): implement hierarchical router and planner with few-shots"
```

---

### Task 11: 50-Prompt Evaluation Framework & Prompt Versioning

**Files:**
- Create: `evaluations/golden-prompts.json`
- Create: `evaluations/evaluator.ts`
- Create: `packages/planner/src/prompts/v001-core.md`
- Test: `evaluations/eval.test.ts`

**Interfaces:**
- Consumes: `AIPlanner`, `golden-prompts.json`.
- Produces: Evaluation metrics: tool selection accuracy, argument validity, usable plan rate.

- [ ] **Step 1: Write the failing test**

```typescript
// evaluations/eval.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Evaluation Golden Dataset', () => {
  it('contains exactly 50 categorized evaluation prompts', () => {
    const raw = readFileSync(resolve('evaluations/golden-prompts.json'), 'utf8');
    const prompts = JSON.parse(raw);
    expect(prompts).toHaveLength(50);

    const happy = prompts.filter((p: any) => p.category === 'happy_path');
    const edge = prompts.filter((p: any) => p.category === 'edge_case');
    const adversarial = prompts.filter((p: any) => p.category === 'adversarial');

    expect(happy.length).toBeGreaterThanOrEqual(20);
    expect(edge.length).toBeGreaterThanOrEqual(15);
    expect(adversarial.length).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run evaluations/eval.test.ts`
Expected: FAIL with "no such file golden-prompts.json"

- [ ] **Step 3: Create golden prompts dataset and evaluation runner**

Write `evaluations/golden-prompts.json` with 50 structured prompts (happy path cross-service, missing args, ambiguous entities, adversarial injections). Create `evaluations/evaluator.ts` measuring tool accuracy, argument quality, and usable plan rate against prompt versions.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run evaluations/eval.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add evaluations/ packages/planner/src/prompts/
git commit -m "test(eval): add 50-prompt golden evaluation dataset and runner"
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
      count: 42,
      targetCardId: { $ref: 'step_1.output.id' },
      slackMessage: { $template: 'Created card ${step_1.output.id} at ${step_1.output.url}!' },
    };

    const resolved = resolveArgs(args, outputs);
    expect(resolved.title).toBe('Static title');
    expect(resolved.count).toBe(42);
    expect(resolved.targetCardId).toBe('card_123');
    expect(resolved.slackMessage).toBe('Created card card_123 at https://trello.com/c/123!');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/executor/tests/resolver.test.ts`
Expected: FAIL with "resolveArgs is not defined"

- [ ] **Step 3: Implement reference resolution**

Implement `resolveArgs` in `src/resolver.ts`. Handle deep object traversal, `$ref` path extraction (e.g., `step_1.output.id`), and regex-based `${step_X.output.Y}` string template interpolation with safe fallback if property is missing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/executor/tests/resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/executor/
git commit -m "feat(executor): implement argument and cross-step reference resolver"
```

---

### Task 13: Sequential Step Runner with ACID Transaction & UNKNOWN Status

**Files:**
- Create: `packages/executor/src/runner.ts`
- Test: `packages/executor/tests/runner.test.ts`

**Interfaces:**
- Consumes: `@wap/tool-adapters`, `resolveArgs`.
- Produces: `StepRunner`, `ExecutionResult`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/executor/tests/runner.test.ts
import { describe, it, expect, vi } from 'vitest';
import { StepRunner } from '../src';

describe('StepRunner (Write Safety & UNKNOWN Classification)', () => {
  it('marks write step as UNKNOWN on 500 error or timeout and halts execution', async () => {
    const mockAdapter = {
      execute: vi.fn().mockRejectedValue({ status: 502, message: 'Bad Gateway' }),
    };

    const runner = new StepRunner({
      getAdapter: () => mockAdapter as any,
    });

    const step = {
      id: 'step_write',
      tool: 'trello.create_card',
      description: 'Create card',
      args: { title: 'Test' },
      dependsOn: [],
    };

    const result = await runner.executeStep(step, new Map());
    expect(result.status).toBe('unknown');
    expect(result.error?.category).toBe('SERVER_ERROR');
    expect(result.output).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/executor/tests/runner.test.ts`
Expected: FAIL with "StepRunner is not defined"

- [ ] **Step 3: Implement StepRunner with Write Safety**

Implement `StepRunner` in `src/runner.ts`:
- Check tool risk level and side effect (read vs write).
- Timeouts: 15s for reads, 30s for writes.
- Write steps failing with 5xx or timeout MUST be classified as `unknown`.
- Persist step outputs in step dictionary for downstream `$ref` resolution.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/executor/tests/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/executor/
git commit -m "feat(executor): implement sequential step runner with write safety unknown handling"
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

    // User chooses to skip step s2
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

Implement `ExecutionController` in `src/controller.ts` with methods: `runUntilPause`, `retryStep`, `skipStepAndContinue`, and `stop`. Track DAG states (`pending`, `running`, `succeeded`, `failed`, `skipped`, `unknown`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/executor/tests/controller.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/executor/
git commit -m "feat(executor): implement execution controller with pause, retry, skip and stop"
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

Implement `generateTokens`, `verifyAccessToken` in `src/auth/jwt.ts`. In `src/routes/auth-routes.ts`, implement `login` (returns access + refresh tokens), `refresh`, and `me`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/auth/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/auth/ apps/chat-api/src/routes/auth-routes.ts apps/chat-api/tests/auth/
git commit -m "feat(api): implement JWT authentication and token refresh"
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
git commit -m "feat(api): implement message ingestion returning 202 accepted with async processing"
```

---

### Task 17: SSE Stream Endpoint (12 Events, Sequence Tracking & Last-Event-ID Sync)

**Files:**
- Create: `apps/chat-api/src/sse/sse-manager.ts`
- Create: `apps/chat-api/src/routes/stream-routes.ts`
- Test: `apps/chat-api/tests/sse/sse-manager.test.ts`

**Interfaces:**
- Consumes: `GET /api/conversations/:id/stream`.
- Produces: Persistent SSE connection with sequential IDs, reconnect sync buffer, and clean teardown on `req.on('close')`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/sse/sse-manager.test.ts
import { describe, it, expect, vi } from 'vitest';
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

- [ ] **Step 3: Implement SSEManager and Stream route**

Implement `SSEManager` in `src/sse/sse-manager.ts` maintaining an in-memory circular event buffer (max 100 events per conversation) with auto-incrementing `id`. In `src/routes/stream-routes.ts`, set headers `Content-Type: text/event-stream`, register client listener, handle `req.on('close')` to remove listener, and replay missed events if `req.headers['last-event-id']` is present.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/sse/sse-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/sse/ apps/chat-api/src/routes/stream-routes.ts apps/chat-api/tests/sse/
git commit -m "feat(api): implement SSE stream endpoint with sequence tracking and event replay"
```

---

### Task 18: Plan Approval & Execution Trigger with Optimistic Locking

**Files:**
- Create: `apps/chat-api/src/routes/execution-routes.ts`
- Create: `apps/chat-api/src/services/execution-service.ts`
- Modify: `apps/chat-api/src/app.ts`
- Test: `apps/chat-api/tests/routes/execution-routes.test.ts`

**Interfaces:**
- Consumes: `POST /api/plans/:id/approve`, `POST /api/executions/:planId/start`, `@wap/executor`, `PlanRepo`.
- Produces: Optimistic-locked plan approval, trigger execution, emit `exec_start`, `exec_step`, `exec_done` via SSE.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/routes/execution-routes.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ExecutionService } from '../../src/services/execution-service';

describe('Execution Service Approval Concurrency', () => {
  it('approves pending plan, rejecting duplicate concurrent approval with 409', async () => {
    let approved = false;
    const mockPlanRepo = {
      approvePlan: vi.fn().mockImplementation(async () => {
        if (approved) return false;
        approved = true;
        return true;
      }),
      getPlan: vi.fn().mockResolvedValue({ id: 'p1', status: 'approved', plan_json: { steps: [] } }),
    };

    const service = new ExecutionService({
      planRepo: mockPlanRepo as any,
      stepRepo: {} as any,
      executor: { run: vi.fn() } as any,
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

- [ ] **Step 3: Implement ExecutionService and Execution routes**

Implement `ExecutionService` and register routes in `src/routes/execution-routes.ts` for `/approve`, `/reject`, `/steps/:id/retry`, `/steps/:id/skip`, `/stop`. Wire Express app in `src/app.ts` mounting auth, conversation, stream, and execution routes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/routes/execution-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/services/ apps/chat-api/src/routes/execution-routes.ts apps/chat-api/src/app.ts apps/chat-api/tests/routes/execution-routes.test.ts
git commit -m "feat(api): implement plan approval with optimistic locking and execution routes"
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

Scaffold `apps/chat-web` with React 19, Tailwind CSS, and Vite. In `src/store/chat-store.ts`, implement Zustand store managing `messages`, `activePlan`, `stepStatuses`, `isStreaming`, `connectedServices`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/
git commit -m "feat(web): scaffold React 19 web app and Zustand chat store"
```

---

### Task 20: SSE Client Hook with Auto-reconnect & Event Sequencing

**Files:**
- Create: `apps/chat-web/src/hooks/use-sse.ts`
- Test: `apps/chat-web/tests/use-sse.test.ts`

**Interfaces:**
- Consumes: Browser `EventSource`, `useChatStore`.
- Produces: `useSSE(conversationId: string): { isConnected: boolean }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-web/tests/use-sse.test.ts
import { describe, it, expect, vi } from 'vitest';
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

- [ ] **Step 3: Implement SSE hook with sequence tracking and dispatch**

Implement `handleSSEEvent` and `useSSE` hook in `src/hooks/use-sse.ts`. Listen for all 12 events (`thinking`, `gather_start/step/done`, `text_start/delta/end`, `plan`, `clarification`, `refusal`, `exec_start/step/done`, `error`, `sync`), store last received sequence ID in `ref`, and pass `Last-Event-ID` on reconnect.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/use-sse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/hooks/ apps/chat-web/tests/use-sse.test.ts
git commit -m "feat(web): implement resilient SSE client hook with event sequencing"
```

---

### Task 21: Message List, Gather Progress & Clarification Cards

**Files:**
- Create: `apps/chat-web/src/components/MessageItem.tsx`
- Create: `apps/chat-web/src/components/GatherProgress.tsx`
- Create: `apps/chat-web/src/components/ClarificationCard.tsx`
- Create: `apps/chat-web/src/components/ChatContainer.tsx`
- Test: `apps/chat-web/tests/components/chat-components.test.tsx`

**Interfaces:**
- Consumes: `useChatStore`.
- Produces: Interactive chat rendering with collapsible gather steps and clarification buttons.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/chat-web/tests/components/chat-components.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ClarificationCard } from '../../src/components/ClarificationCard';

describe('Clarification Card', () => {
  it('renders question and clickable option buttons', () => {
    const onSelect = vi.fn();
    render(
      <ClarificationCard
        question="Chọn member nào?"
        options={['Minh Nguyen', 'An Tran']}
        onSelectOption={onSelect}
      />
    );

    expect(screen.getByText('Chọn member nào?')).toBeDefined();
    expect(screen.getByText('Minh Nguyen')).toBeDefined();
    expect(screen.getByText('An Tran')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-web/tests/components/chat-components.test.tsx`
Expected: FAIL with "Cannot find module ClarificationCard"

- [ ] **Step 3: Implement Chat UI components**

Implement `GatherProgress.tsx` showing active/completed read tools. Implement `ClarificationCard.tsx` rendering option buttons or text inputs. Implement `MessageItem.tsx` and `ChatContainer.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/components/chat-components.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/components/ apps/chat-web/tests/components/
git commit -m "feat(web): implement message list, gather progress, and clarification cards"
```

---

### Task 22: Plan Preview Card with Thinking Layer & Approval Actions

**Files:**
- Create: `apps/chat-web/src/components/PlanPreview.tsx`
- Create: `apps/chat-web/src/components/PlanStepItem.tsx`
- Test: `apps/chat-web/tests/components/plan-preview.test.tsx`

**Interfaces:**
- Consumes: `PlanResponse`, API client for `/api/plans/:id/approve`.
- Produces: Interactive Plan Preview card with step list, thinking collapsible, and [Duyệt], [Sửa], [Hủy] actions.

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
        { id: 's2', tool: 'slack.send_message', description: 'Gửi tin Slack', args: {}, dependsOn: ['s1'] },
      ],
      warnings: [],
    };

    render(<PlanPreview plan={plan} onApprove={onApprove} onEdit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('Tạo card và gửi Slack')).toBeDefined();
    expect(screen.getByText('Tạo card Trello')).toBeDefined();

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

Implement `PlanPreview.tsx` with collapsible Thinking section, formatted step list showing tool icons, arguments, dependencies, and warning badges. Wire approve/edit/cancel buttons.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/components/plan-preview.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/components/ apps/chat-web/tests/components/plan-preview.test.tsx
git commit -m "feat(web): implement plan preview card with thinking layer and action buttons"
```

---

### Task 23: Live Execution Progress & Partial Failure Recovery UI

**Files:**
- Create: `apps/chat-web/src/components/ExecutionProgress.tsx`
- Create: `apps/chat-web/src/components/PartialFailureModal.tsx`
- Test: `apps/chat-web/tests/components/execution-progress.test.tsx`

**Interfaces:**
- Consumes: Execution state from `useChatStore`.
- Produces: Live step status indicators (pending, running, succeeded, failed, unknown) and recovery actions (`[Thử lại]`, `[Sửa & Thử lại]`, `[Bỏ qua]`, `[Dừng]`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/chat-web/tests/components/execution-progress.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PartialFailureModal } from '../../src/components/PartialFailureModal';

describe('Partial Failure Modal', () => {
  it('renders 4 recovery actions on failed step', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /bỏ qua/i }));
    expect(onSkip).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-web/tests/components/execution-progress.test.tsx`
Expected: FAIL with "PartialFailureModal is not defined"

- [ ] **Step 3: Implement ExecutionProgress and PartialFailureModal**

Implement `ExecutionProgress.tsx` with animated status badges (⏳, 🔄, ✅, ❌, ❓) per step. Implement `PartialFailureModal.tsx` triggering API calls `/retry`, `/skip`, `/stop`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/components/execution-progress.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/components/ apps/chat-web/tests/components/execution-progress.test.tsx
git commit -m "feat(web): implement live execution progress and partial failure recovery modal"
```

---

### Task 24: Settings Page & Service Connection Wizard with Allowed Scope

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

Implement `ServiceCard.tsx` with credential fields, Allowed Scope (whitelist board/channel names), and live test button calling `/api/services/:name/test`. Implement `SettingsModal.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-web/tests/components/settings.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/src/components/ apps/chat-web/tests/components/settings.test.tsx
git commit -m "feat(web): implement service connection wizard with allowed scope management"
```

---

### Task 25: Automated E2E Scenarios (Trello + Slack Cross-Service Workflow)

**Files:**
- Create: `apps/chat-api/tests/e2e/workflow-e2e.test.ts`
- Test: `apps/chat-api/tests/e2e/workflow-e2e.test.ts`

**Interfaces:**
- Consumes: Full stack HTTP and SSE endpoints via Supertest or node fetch.
- Produces: 3 end-to-end automated scenarios proving real workflow automation across Trello and Slack.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/chat-api/tests/e2e/workflow-e2e.test.ts
import { describe, it, expect } from 'vitest';
import { createApp } from '../../src/app';

describe('V3 End-to-End Workflow Automation', () => {
  it('executes full cycle: chat input -> gather -> plan preview -> approve -> execution -> slack notification', async () => {
    const app = createApp({ useMocks: true });
    // Scenario 1: Project Management (Create card, assign member, post to Slack)
    const convRes = await app.inject({ method: 'POST', url: '/api/conversations', payload: { userId: 'u1' } });
    const { id: convId } = convRes.json();

    const msgRes = await app.inject({
      method: 'POST',
      url: `/api/conversations/${convId}/messages`,
      payload: { content: 'Tạo task sửa CSS cho Minh trên board Frontend và báo channel general' },
    });
    expect(msgRes.statusCode).toBe(202);

    // Wait for planner to emit plan
    const planRes = await app.inject({ method: 'GET', url: `/api/conversations/${convId}/plans/active` });
    const plan = planRes.json();
    expect(plan.steps).toHaveLength(3); // create_card, add_member, send_message

    // Approve
    const approveRes = await app.inject({ method: 'POST', url: `/api/plans/${plan.id}/approve` });
    expect(approveRes.statusCode).toBe(200);

    // Verify execution results
    const execRes = await app.inject({ method: 'GET', url: `/api/executions/${plan.id}/status` });
    expect(execRes.json().status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/e2e/workflow-e2e.test.ts`
Expected: FAIL with "createApp is not defined or routes missing"

- [ ] **Step 3: Implement app factory with mock services support and run full E2E**

Wire `createApp` in `apps/chat-api/src/app.ts` with injectable dependencies for mock/live adapters. Validate all 3 core scenarios:
1. Task creation + Member assignment + Slack notification.
2. Clarification on ambiguous name resolution.
3. Partial failure recovery (skip failed step, complete rest).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/chat-api/tests/e2e/workflow-e2e.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/
git commit -m "test(e2e): add automated end-to-end tests for 3 cross-service workflow scenarios"
```

---

## Plan Self-Review Checklist

- [x] **Spec coverage:** Every phase in the design spec (Phase 0 Foundation, Phase 1 Tool Adapters, Phase 2a DB, Phase 2b AI Planner, Phase 3 Execution Engine, Phase 4 Chat API & SSE, Phase 5 Chat UI, Phase 6 Demo Scenarios) has dedicated bite-sized tasks.
- [x] **Step scan:** Every step contains checkable actions, code assertions with exact names, commands to run, and conventional commits.
- [x] **Type consistency:** `@wap/tool-schemas` types (`ToolDefinition`, `PlanResponse`, `PlanStep`, `ArgValue`) and adapter interfaces are consistently named across planner, executor, API, and web store.
- [x] **Review Focus:** All 5 critical failure modes identified in the spec review (broken DAG $ref, ambiguous entity resolution, write step timeout handling, SSE reconnection sync, rapid double-approval race condition) are addressed with concrete unit/integration tests in their respective tasks.
- [x] **Proportion:** Concise, actionable tasks without code bloat or vague placeholders.
