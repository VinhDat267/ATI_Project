# V3 Audit Remediation Implementation Plan

> **For agentic workers:** Work task by task with failing tests first, review source contracts, and verify the final integrated result.

**Goal:** Close the reproduced findings in `docs/audits/2026-09-29-v3-review/RECHECK-7368e2a.md` without overstating production readiness.

**Architecture:** Enforce identity and plan state in the API and PostgreSQL repositories, fail closed at runtime boundaries, use real credential verification and adapter transport controls, and scope client event state to each conversation. Preserve the v3 module boundaries and leave v2 source unchanged.

**Tech Stack:** TypeScript, Express, PostgreSQL 16, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`; audit evidence: `docs/audits/2026-09-29-v3-review/REVIEW.md` and `RECHECK-7368e2a.md` in the original checkout.

## Global constraints

- No real external service writes or paid AI calls in the test campaign.
- Concurrency tests must use real PostgreSQL or semantically equivalent database behavior.
- Timeout tests must observe a real `AbortSignal`.
- Keep each change within its v3 package owner; do not edit legacy v2.
- Distinguish fixed behavior from unverified live operation in the final report.

## Review focus

- A stored password hash with a misleading prefix must never authenticate an arbitrary password.
- A user must not reject or inspect another user's plan.
- Concurrent plan creation must leave at most one pending plan per conversation.
- A persisted failure must stop later tool writes and be reflected in execution status.
- Sandbox must never make real provider calls; live must never fall back to mocks or memory storage.

---

### Task 1: Identity and ownership

**Files:** `apps/chat-api/src/db/repositories/user-repo.ts`, `apps/chat-api/src/server.ts`, `apps/chat-api/src/routes/execution-routes.ts`, related API tests.

- [ ] Add failing tests for fake bcrypt prefix/password123, default account behavior, reject and status cross-user access.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Fix password verification and remove production default login path; enforce ownership on all plan and execution routes.
- [ ] Run focused API tests and typecheck.

### Task 2: Plan and execution durability

**Files:** `apps/chat-api/src/db/repositories/plan-repo.ts`, `apps/chat-api/src/services/execution-service.ts`, `db/v3/*`, related PostgreSQL and service tests.

- [ ] Add failing real PostgreSQL concurrency test and plan hash mismatch test.
- [ ] Add failing test showing persistence error cannot lead to a later write or completed status.
- [ ] Make plan creation atomic; bind approval to a valid plan hash and expiry; align execution state with durable writes.
- [ ] Run focused tests against the isolated `ati_v3` test database and typecheck.

### Task 3: Runtime and credentials

**Files:** `apps/chat-api/src/server.ts`, `apps/chat-api/src/routes/services-routes.ts`, `apps/chat-api/src/db/repositories/credential-repo.ts`, `apps/chat-api/src/execution/adapter-factory.ts`, related tests.

- [ ] Add failing tests for live database/planner failure, sandbox isolation, raw credential storage, false connection health, and allowed scope persistence.
- [ ] Enforce explicit runtime mode behavior and encrypted credential storage; verify connection health through read-only provider calls.
- [ ] Run focused tests and typecheck without external writes.

### Task 4: Adapter transport and scope

**Files:** `packages/tool-adapters/src/**`, related adapter tests.

- [ ] Add failing tests for limiter use, 429 Retry-After behavior, and missing board scope rejection.
- [ ] Implement transport throttling and bounded retry according to the v3 design; fail closed on unknown scope.
- [ ] Run adapter tests and typecheck.

### Task 5: Planner and evidence

**Files:** `packages/planner/src/**`, `apps/chat-api/src/services/chat-service.ts`, `prompts/**`, `evaluations/**`, related tests.

- [ ] Add failing tests for invalid argument types, multi-turn clarification/memory, and prompt contract mismatch.
- [ ] Implement the minimum v3 Gather/Clarify and validation behavior with persistent conversation context.
- [ ] Separate offline mock evaluation from live provider evaluation and report the unrun live gate accurately.
- [ ] Run planner/API/evaluation tests and typecheck.

### Task 6: Frontend event and settings behavior

**Files:** `apps/chat-web/src/hooks/use-sse.ts`, `apps/chat-web/src/components/ServiceCard.tsx`, `apps/chat-web/src/components/SettingsModal.tsx`, related web tests.

- [ ] Add failing tests for conversation switch with reused sequence numbers and real connection-test result display.
- [ ] Scope SSE cursors per conversation and wire settings to actual API outcomes.
- [ ] Run web tests, typecheck and build.

### Task 7: Integrated review

- [ ] Inspect combined diff for security bypasses and regressions.
- [ ] Run full `npm run test:v3`, `npm run typecheck:v3`, `npm run build:v3`, acceptance probes, and real PostgreSQL race tests.
- [ ] Update audit evidence with exact commands, outputs, passed gates, and remaining unverified production criteria.
