# JIRA-08 Binding and Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute personal Jira plans with server-owned, versioned bindings and fail-closed authorization from planning through outbound calls and source publication.

**Architecture:** `ChatService` binds Jira from PostgreSQL before hashing a plan. `ExecutionService` rechecks that immutable binding at approval/start/recovery and delegates each Jira step to a guarded adapter path. A short committed JIRA-05 lease is not by itself a lock across the HTTP dispatch: implement and test an explicit dispatch/revocation linearization protocol before enabling writes. Source refs travel with outputs and are checked before model input, persistence and SSE publication.

**Tech Stack:** TypeScript, Express, PostgreSQL 16 (`pg`), `@wap/executor`, `@wap/tool-adapters`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-jira-personal-workspaces-design.md` §§7–9, 11–12; `docs/superpowers/specs/2026-11-02-jira-shared-workspace-amendment.md`.

## Global Constraints

- `MYJIRA_ENABLED=off` by default; do not enable the feature in this PR.
- `JiraPlanConnection` and `JiraSourceRef` in `packages/tool-schemas/src/myjira-context.ts` are frozen JIRA-02 contracts; request an owner-reviewed contract PR if a required field is absent.
- `JiraLeaseManager.acquireLease` currently commits before outbound HTTP. Do not assume it blocks a later revoke; prove the final dispatch protocol with two PostgreSQL clients.
- No live Atlassian writes in tests; use loopback HTTP fixture and synthetic PostgreSQL. Keep all secrets out of plan JSON, logs, responses, prompts and receipts.
- One task card and one new handoff log in the implementation PR. Do not edit `CURRENT-STATE.md` or `ROADMAP.md` as implementer.

## Review Focus

- Revoke commits between lease acquisition and HTTP dispatch: new request must not start on stale authority (Task 3).
- Token refresh or identity switch between preview and approve: retain immutable preview binding and refuse stale approval (Tasks 1–2).
- First write succeeds, second site loses access: keep first receipt and stop later steps without retry (Tasks 3–4).
- Provider result or model response arrives after revocation: mask before store/SSE and before next model prompt (Task 5).
- Legacy `jira.*` plan or scheduled run enters personal context: refuse rather than borrowing another adapter (Tasks 4, 6).

## File map and integration boundaries

| Responsibility | Candidate files | Owner |
|---|---|---|
| Server binding before hash and source propagation | `apps/chat-api/src/services/chat-service.ts`, new `apps/chat-api/src/services/jira/jira-plan-binding.ts`, tests under `apps/chat-api/tests/services/` | Backend |
| Durable snapshot / approval CAS | `apps/chat-api/src/db/repositories/plan-repo.ts`, `apps/chat-api/src/services/execution-service.ts`, tests under `apps/chat-api/tests/db/` and `tests/services/` | Backend |
| Dispatch/revocation linearization | `apps/chat-api/src/services/jira/jira-lease-manager.ts`, new `jira-dispatch-guard.ts`, additive `db/v3/0023_*.sql` only if required; tests with two real PG clients | Backend |
| Personal adapter wiring and no fallback | `apps/chat-api/src/services/adapter-factory.ts`, `apps/chat-api/src/server.ts`, `apps/chat-api/src/services/execution-service.ts`, `packages/executor/src/runner.ts` only if hook is unavoidable | Backend |
| Source persist/publish and SSE | `apps/chat-api/src/services/chat-service.ts`, `apps/chat-api/src/routes/stream-routes.ts`, `apps/chat-api/src/sse/jira-stream-guard.ts`, `apps/chat-api/src/services/jira/jira-policy-service.ts` | Backend |
| Schedules and production gate | schedule proposal/runner entrypoints, `apps/chat-api/src/routes/conversation-routes.ts`, `apps/chat-api/src/server.ts` | Backend |

Confirm exact scheduler path and any migration need from current code before editing; avoid gratuitous changes to `packages/executor` or schemas.

### Task 1: Bind personal Jira before plan hash

**Interfaces:** Consume `JiraPlanConnection`/`JiraPlanStepScope` and JIRA-03–05 repositories. Produce a server-only binder taking `(ownerId, conversation, steps, signal)` and returning a validated `JiraPlanConnection`; never accept model/browser binding as authority.

- [ ] Write failing real-PG tests: spoofed `connections.myjira` is discarded; valid multi-site steps receive distinct `siteSteps`; rotated token leaves hash unchanged; removed member, grant, site/project, moved issue fail before plan persistence.
- [ ] Run focused tests and record RED output.
- [ ] Implement binder and call it in `ChatService` after plan validation and before labels, `plan_text`/`plan_hash`/`createPlan`. Preserve atomic plan replacement under existing conversation row lock.
- [ ] Run focused tests GREEN; commit only binder, integration and tests.

### Task 2: Recheck binding during approval and start

**Interfaces:** Consume stored `connections.myjira` from integrity-checked plan, owner conversation and current DB authority. Produce a shared Jira approval/start validation result with explicit denied/stale/unavailable categories; no token in result.

- [ ] Write failing PG tests for membership, account identity, grant, workspace/site/project version changing after preview; `approvePlan` must remain `pending` or reject via CAS, with no `exec_start` on denial.
- [ ] Run RED, then implement check in `ExecutionService.approveAndStart` immediately before approval CAS and again at queued start; make race-safe SQL guard part of the CAS or recheck after acquiring locks. Never rely only on a pre-CAS read.
- [ ] Run GREEN and commit scoped files.

### Task 3: Prove per-step dispatch linearization

**Interfaces:** Consume bound `stepId → site/cloud/project/version`, owner and `AbortSignal`. Produce one guarded execution of a specific `myjira.*` call with a short-lived authorization decision and explicit release/revocation outcome.

- [ ] First choose lock/dispatch protocol from the spec's revocation rule. Document lock order and maximum hold time. Short committed lease + later `revalidateLease` alone is insufficient; a revoke must wait for an already authorized dispatch or a final atomic dispatch claim must occur after the revoke boundary.
- [ ] Write failing tests using two PostgreSQL clients and loopback HTTP: revoke wins before dispatch ⇒ zero HTTP calls; dispatch wins ⇒ revoke waits/commits after dispatch boundary; stalled HTTP respects deadline/abort; grant rotation does not deadlock. Test read and write separately.
- [ ] Run RED; implement guard in `jira-lease-manager.ts`/`jira-dispatch-guard.ts`, with additive migration only if proven necessary. Token retrieval stays outside DB lock. Never start request after lease expiry or policy change.
- [ ] Run GREEN and commit guard, migration (if any) and tests.

### Task 4: Execute bound steps and preserve receipts

**Interfaces:** Consume guarded context from Task 3; call JIRA-06 personal adapter only after current scope checks. Produce step status/receipt with owner, workspace, site/project and connection label, never token.

- [ ] Write failing API → executor integration tests for `list_sites`, project/issue read, create and comment; moved issue recheck; multi-site plan; revoked later step preserving prior receipt; UNKNOWN write not retried by recovery; rejection of legacy fallback in personal context.
- [ ] Run RED; wire `AdapterFactory`, `ExecutionService`/`StepRunner` and recovery to recheck each Jira step. Do not weaken existing services or generic recovery semantics.
- [ ] Run GREEN and commit integration/tests.

### Task 5: Guard source, persistence and SSE publication

**Interfaces:** Consume `JiraSourceRef` and JIRA-05 `JiraPolicyService`/`JiraStreamBuffer`. Output model input, message/plan/receipt and SSE events only after current policy revalidation.

- [ ] Write failing tests for revoked gather source, late model response, mixed-source message, history/raw plan route, delayed SSE delta and provider outage. A mutation removing each guard must make its test fail.
- [ ] Run RED; attach source refs in the producer, sanitize before model/persist/publish, and connect `JiraStreamBuffer` to the producer. Progress events must contain no Jira content; discard buffered deltas on revoke/expiry.
- [ ] Run GREEN and commit source/SSE tests and code.

### Task 6: Schedule refusal, production opt-in and final gate

- [ ] Write failing tests that reject new schedule proposals containing `myjira`, reject scheduler execution without actor/workspace, and refuse legacy `jira.*` fallback. Record a read-only inventory command and result for existing Jira schedules; do not rewrite them.
- [ ] Run RED; implement schedule guard. Enable production `jiraContext: true` only behind `MYJIRA_ENABLED` and only after Tasks 1–5 pass; off/misconfigured remains 503.
- [ ] Run GREEN. Run `npm run typecheck:v3`, focused API/executor suites, `npm run check`, `npm run test:browser:v3` on synthetic DB. Record commands, counts, exit codes and feature flag in task card and one new handoff log.
- [ ] Request independent review per `docs/handoff/REVIEW-CHECKLIST.md`; fix findings, rerun affected gates, then open PR via `.github/pull_request_template.md` under GitHub account `longnguyen005`. Do not merge.

## Self-review checklist before implementation

- [ ] Binding fields match JIRA-02 exactly; no token or model-provided connection survives.
- [ ] Tests prove authority at plan save, approve CAS, queued start, each HTTP dispatch, recovery, model input, persistence and SSE.
- [ ] Two-client race test demonstrates the actual revocation boundary, not a boolean mock.
- [ ] Existing non-Jira flows and flag-off behavior remain green.
- [ ] JIRA-09 cockpit integration and live/model acceptance remain in JIRA-09/JIRA-10/JIRA-11, not claimed here.
