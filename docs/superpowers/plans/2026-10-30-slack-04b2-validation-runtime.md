# Slack native validation runtime Implementation Plan

> **For agentic workers:** Use `executing-plans` directly. No CLI implementers. One fresh internal read-only whole-branch review at the end.

**Goal:** Run durable metadata credential validation in the native server even while Slack content flags are off.

**Architecture:** Extract the unchanged bounded auth.test transport into a metadata-only base client. A private factory creates the accepted04B1 worker only with PostgreSQL, encryption and configured ingress plus a safe metadata endpoint. A nonoverlapping timer runner starts with the HTTP server, aborts on stop and bounds its own shutdown wait. No content processing is enabled.

**Tech Stack:** TypeScript, pg/PostgreSQL16, Node AbortSignal, real loopback HTTP fixtures, Vitest.

**Spec:** [personal Slack §9.2 F4](../specs/2026-10-28-slack-personal-oauth-design.md); [04B1](2026-10-30-slack-04b1-lifecycle-validation.md); [frozen ingress contracts](../../handoff/decisions/2026-10-29-slack-source-ingress-contracts.md).

## Global constraints

- Both content flags remain default-off. Ingress/metadata lifecycle is independent while app subscriptions remain configured.
- Metadata verification requires no OAuth client secret/redirect and performs auth.test only; no refresh/revoke/content/model calls.
- Live endpoint is existing pinned Slack API; sandbox endpoints must be literal HTTP loopback with no credentials/query/hash. Missing sandbox endpoint leaves the consumer absent, retaining jobs/barriers.
- Unknown/rotating/expired credentials retain config/block. No fullF4/F3/Slack/native-workspace acceptance.
- Stop aborts provider work and bounds this runner's wait, not all server/database shutdown. Late body-free lease metadata can settle after stop; lease recovery remains durable. No forced SQL-cancellation claim. An already dispatched COMMIT may finish; stop does not undo that transaction.

## Review focus

1. Flags-off startup must not accidentally enable OAuth/content APIs or require OAuth secrets to drain lifecycle jobs.
2. Malformed/missing sandbox endpoint must not fall back to native Slack or leak credentials through redirects/errors.
3. Concurrent timer/manual ticks and stop/restart must not overlap credential probes or swallow late rejection.
4. Blocked PostgreSQL claim can outlive shutdown grace; abort must prevent later authority changes or content calls.
5. Existing OAuth exchange/refresh/revoke and typed identity handling must remain behaviorally compatible after extraction.

### Task 1: Metadata client and native runner

Files: modify `apps/chat-api/src/services/slack/oauth-client.ts`, `apps/chat-api/src/config/slack-env.ts`, `apps/chat-api/src/server.ts`; create `apps/chat-api/src/services/slack/slack-lifecycle-runtime.ts`; create `apps/chat-api/tests/services/slack/slack-lifecycle-runtime.test.ts`; card/plan/one log.

Interfaces: `SlackIdentityClient(apiBaseUrl,fetchFn?)` exposes verify only (bounded transport protected); `SlackOAuthClient` extends it with unchanged constructor/config/public methods. `slackLifecycleApiBaseUrl(env,live):string|undefined` shares sandbox validation with OAuth. `createSlackLifecycleRuntime({pool?,encryptionKey,env,live,intervalMs?,stopGraceMs?,workerId?})` returns runner or undefined. Runner start/isRunning/tick/stop; tick returns same in-flight promise; stop aborts and waits at most configured grace (default3000ms, range1..10000); interval default5000ms (range10..60000), batch5.

- [x] Write tests first: flags off/no OAuth secrets actual job drained by timer; no config/DB/sandbox endpoint absent; unsafe endpoint rejected and native override ignored; actual HTTP abort/stop, concurrent ticks, restart; real PG ACCESS EXCLUSIVE claim wait with bounded stop and no late authority application.
- [x] Run new suite; expected RED missing runtime module/export, after fixing any harness errors.
- [x] Extract unchanged metadata methods and shared endpoint validation; implement runner/factory and server startup/shutdown hooks. Log fixed error codes only.
- [x] Run new suite plus existing04B1 and OAuth tests; expected PASS, typecheckPASS. Commit exact task files.

### Task 2: Review and publication

- [x] Run `npm run check` against isolated PostgreSQL55533; expected exit0.
- [x] One fresh independent whole-branch review; fix actionable findings directly with RED→GREEN, rerun checks. Rule explicitly on deferred limits.
- [ ] Fill card/log and publish draft staging PR; await exact-head CI before staging integration. No main/live enable/fullF4 claim.
