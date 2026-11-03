# Slack M2 Read Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. User approved the M2 implementation sequence on 01/11/2026.

**Goal:** Deliver approved personal Slack reads through ATI, with server-owned workspace binding, current source authority and registered result lifecycle.
**Architecture:** Reuse the accepted private read wrapper and 03B2K lifecycle/origin guards. Bind a read snapshot before approval; executor dispatches immutable validated arguments through a backend authority hook. Public route/planner/UI follow as a separate 03B4 card.
**Tech Stack:** Existing Node.js ^22.12.0 || >=24.0.0, TypeScript, PostgreSQL16, React, Vitest/Playwright; no new dependencies.
**Spec:** ../specs/2026-10-28-slack-personal-oauth-design.md
**Baseline:** f5167983d39f45e53d1ff2081b43a73156ca5049, integration/slack-personal-20261029. Supersedes outdated implementation assumptions anchored at612ac427; original03B3 plan remains historical design evidence.

## Global Constraints
- One card/branch/PR at a time:03B3 read safety, then03B4 public integration.
- Defaults remain off. Personal Slack writes and unknown tools fail closed until04C; no native/model calls in implementation acceptance.
- Server derives all five binding fields; client only selects connection identifiers. No shared bot fallback.
- Exact approved snapshot, selectors, current policy references, source barriers and AbortSignal are checked on every attempt.
- Existing origin certificates and lineage guards remain authoritative; unknown legacy never becomes trusted by absence of a copy.
- Fresh Slack outputs are registered transactionally before persistence/display/model reuse. No source payload in SSE/replay caches.
- PostgreSQL/HTTP/AbortSignal tests, fullcheck, browser and independent review before acceptance. Publication/merge status is reported separately.

## Review Focus
1. Revoke/reconnect or provider/policy changes during adapter creation prevent transport.
2. Forged workspace/binding/dependency and persisted output provenance cannot authorize a fresh observation.
3. A source-free lookup plan cannot launder fresh Slack output into unregistered step/history/memory storage.
4. A source is edited/deleted/expired between reading and result publication: final authority gate blocks publication.
5. Multi-workspace selection, stale owner sessions, retry/resume and flags-off behavior remain isolated.

## Task1 · 03B3 schema and immutable read dispatch
Files: packages/tool-schemas/src/{types.ts,myslack-plan-bindings.ts,index.ts}; packages/executor/src/{runner.ts,types.ts,index.ts,slack/read-guard.ts}; associated tests.
Consumes: SlackBinding, SlackPolicyReference, MYSLACK_CORE_READ_TOOLS, canonical argument validator.
Produces: SlackPlanBindings; deriveSlackDependencySelectors(rawArgs,steps); validateSlackPlanBindings(value,steps); SlackExecutionSnapshot/SlackDispatchEnvelope and SlackDispatchGuard.authorize({envelope,signal}).
- [ ] RED schema tests for exact binding/policy/step/dependency validation.
- [ ] GREEN shared validators and strict ref/template grammar.
- [ ] RED runner tests for missing/forged snapshot, writes/unknown, mutation, abort and reauthorization.
- [ ] GREEN detached immutable execution envelope, digest projection and bounded authorize/factory/dispatch.
- [ ] Verify existing executor/schema suites and preserve non-Slack behavior.

## Task2 · 03B3 backend approval and read authority
Files: apps/chat-api/src/services/slack/{slack-plan-bindings.ts,slack-dispatch-guard.ts}; existing plan/execution services and tests.
Consumes: Task1 contracts, SlackConnectionRepo, SlackPolicyService, accepted source/lineage/origin APIs.
Produces: server binding resolver; backend dispatch hook; integrity-checked approval/recovery integration.
- [ ] RED real PostgreSQL tests for owner/workspace/identity/policy invalidation and concurrent approval.
- [ ] GREEN server-derived binding before hash, pre-approval validation and per-attempt source/connection verification.
- [ ] Keep metadata-only read-plan origin distinct from source-bearing result lineage; require a dedicated writer for any transition.
- [ ] RED OAuth-to-read scope coverage; GREEN users:read configuration/docs and missing-grant denial before provider.
- [ ] Verify focused suites, then fullcheck, independent review, scoped commit/PR and exact-head CI.

## Task3 · 03B4 public integration (next branch after03B3)
Files: exact runtime/UI files will be recorded in the03B4 card before code, after03B3 interfaces are frozen.
Consumes: accepted03B3 guard, private wrapper, source capture/derived registration APIs.
Produces: public authenticated read proposal/approval/result path, explicit workspace selection and planner integration.
- [ ] RED real HTTP/bootstrap tests for approved read and no transport before approval.
- [ ] RED transactional result registration/publication and revoke/edit/delete/policy/expiry tests.
- [ ] GREEN real route/planner/executor wiring and result source labels; do not expose a direct credential/read bypass.
- [ ] RED UI/browser tests for single/multiple workspace, approval, result/history reload and owner isolation.
- [ ] GREEN UI and native bootstrap fixture scenarios, scope expiry/regrant states.
- [ ] Fullcheck/browser, independent review, scoped03B4 commit/PR and exact-head CI.

## Completion
M2 requires an approved read through the real app and safety/erasure of existing core artifacts. Offline acceptance does not close native Slack07, fullF3/F4,04C writes,05/06 or main/live release.
