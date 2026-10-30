# Slack lifecycle validation consumer Implementation Plan

> **For agentic workers:** Use `executing-plans` for direct implementation. The user forbids Claude Code CLI/Antigravity implementation calls. One internal read-only whole-branch review is required before publication.

**Goal:** Resolve durable04A credential validation jobs without revoking a newer or still-valid grant based on an old event.

**Architecture:** Durable leased jobs and conservative metadata-only probes. Owner advisory locking spans the native probe; database transactions are short and acquire common invalidation advisory keys before authority row mutation. Lease, identity and fingerprint CAS fence every job outcome. Unknown results keep encrypted config and the provisional read barrier.

**Tech Stack:** TypeScript, PostgreSQL16, existing SlackOAuthClient, real loopback HTTP fixture and AbortSignal.

Authority: [personal Slack spec](../specs/2026-10-28-slack-personal-oauth-design.md), [frozen source/ingress contracts](../../handoff/decisions/2026-10-29-slack-source-ingress-contracts.md), [04A plan](2026-10-29-slack-04a-signed-ingress.md). Task: [04B1](../../handoff/tasks/SLACK-04B1-lifecycle-validation.md).

## Current owner interfaces and boundaries

-04A migration0019 stores body-free receipts and `slack_lifecycle_intents` with pending/applied/failed states. Credential jobs contain full binding, fingerprint, barrierId and sourceEventTime. No lease/attempt fields exist yet.
-`SlackConnectionRepo.withOwner(userId,callback)` holds a session advisory lock over the entire callback; TokenManager uses the same lock over refresh. Acquiring an existing owner lock must be bounded for worker cancellation/retry.
-TokenManager only handles active connections and may rotate a single-use refresh token. Ingress deliberately sets reconnect_required, so calling getAccessToken directly cannot safely validate these jobs.
-`SlackOAuthClient.verify(token,workspace,actor,signal)` calls only auth.test and validates identity. Existing boolean authenticationLost conflates expiry with revocation; consumer must not use that boolean alone to authorize destructive purge. Add only a fixed typed error category; never persist or echo raw provider payloads.
-`stageInTransaction` owns the common binding/channel/resource/epoch barriers and raw/derived purge intents. A provisional barrier carries no purge target. Confirmed invalidation uses a separate stable resolution sourceEventKey; it cannot reuse04A's immutable staging receipt with changed effects.

## Safety rulings

1. User IDs and event timestamps never identify a credential generation. Probe the captured local credential only while full binding/fingerprint/owner identity still matches.
2. Expired access tokens, refresh_in_flight, malformed/decryption failures and possible single-use refresh ambiguity are UNKNOWN for this consumer. Keep config and provisional block; do not retry refresh here. Recovery requiring refresh/reconnect is an explicit remaining gate, not proof that the provider revoked the grant.
3. Hard auth failure is destructive only when the current stored access credential is nonexpired, no refresh is in flight, there is no unresolved rotating refresh credential, and the typed probe outcome establishes invalid authentication for that exact captured credential. Otherwise fail closed as UNKNOWN. No provider revoke/write API is called.
4. A valid metadata response does not authorize content or restore another barrier. Deactivate only the owned provisional barrier; status may return active only if the same full binding/fingerprint still matches, there is no active binding/provisional barrier for it and no manual disconnect/regrant occurred. Channel/resource barriers remain enforced by read wrappers.
5. Stale jobs complete as superseded without touching a newer credential or its barriers. Never clear a barrier solely from its user ID; verify its full binding/source/ownership against the receipt and job.
6. Lease expiry is not job success. A worker whose lease/fingerprint/generation changed cannot commit an outcome. Retry/transient failures preserve metadata and barriers. Cleanup already retains failed/pending jobs until applied.
7. The private consumer runs independently of content flags. Native startup wiring is enabled only when actual metadata credentials/configuration are present; default content flags stay off. No wholeF4/rotation recovery/native claim is made by a private fixture run.

## Files

-`db/v3/0020_slack_lifecycle_validation_leases.sql`: additive lease token/owner/until, attempts, next_attempt_at, safe last-error code. Keep04A status names for cleanup compatibility; no content columns.
-`apps/chat-api/src/db/repositories/slack-lifecycle-validation-repo.ts`: bounded claim/retry/outcome CAS, metadata validation and transaction boundaries.
-`apps/chat-api/src/services/slack/slack-lifecycle-validation-worker.ts`: bounded runOnce/stop with signal, owner/probe orchestration, typed conservative outcomes.
-`apps/chat-api/src/services/slack/oauth-client.ts`: fixed safe auth error classification preserving existing callers.
-Two real-PG/HTTP test suites and fixture; card/log. Server wiring and ordinary authorization fanout are separate follow-ups unless all prerequisites are proven in this slice.

## Task1: leased durable jobs

- [ ] Write real PostgreSQL tests before implementation: concurrent SKIP LOCKED claims, no overlap, due-time filtering, expired-lease reclaim with a new token, stale worker CAS denied, pending/failed recovery retained, no body/token columns.
- [ ] Run and observe RED.
- [ ] Add0020 and claim API `claim(limit,workerId,leaseSeconds,now)` returning validated payload plus lease token. Support only credential-validation intents; source edit/delete jobs already have their separate durable barrier/purge chain and are not falsely certified here.
- [ ] Implement `retry(jobId,leaseToken,nextAttempt,safeCode)` and fenced finalization. All finalization writes require current lease ownership and expiry bounds. Use exact checked UUID/decimal/time metadata.
- [ ] Run GREEN; commit exact task files with evidence.

## Task2: conservative credential consumer

- [ ] Write fixture auth.test tests plus real PG state tests: valid captured token; expired/in-flight/rotating uncertainty; hard invalid nonrotating token; transient429/5xx/timeout; wrong actor/workspace; delayed old revoke after regrant; stale fingerprint; disconnect vs probe; two pending barriers; wrong barrier/receipt ownership; caller abort and stale lease during probe.
- [ ] Observe RED. Tests must inspect real persisted barrier/config/status/job rows and actual AbortSignal behavior.
- [ ] Implement bounded owner-gated metadata verification. Do not keep a DB transaction/row lock open over HTTP. Before/after the probe, recheck lease/binding/fingerprint. Final transaction order: owner → common sorted invalidation advisory keys → connection/barrier/job rows, with lease and config CAS.
- [ ] Valid: clear only that owned provisional barrier; restore active only when all full-binding authority conditions permit it. Invalid: atomically stage permanent old-generation binding barrier/purge, clear captured config and invalidate its generation. Unknown: preserve config and barrier and schedule a bounded retry/manual-reconnect outcome with fixed safe code.
- [ ] Ensure a race cannot lose an uncommitted outcome yet report applied. Fenced stale workers release all locks without touching current authority.
- [ ] Run GREEN, typecheck/check and commit evidence.

## Task3: review and publication

- [ ] Independent read-only review of full branch, including grant/lease ownership, unknown refresh semantics, common lock order, cancellation and no-secret paths.
- [ ] One direct fix pass with actual RED→GREEN reproductions; full checks after source changes.
- [ ] Fill task result and one log, publish draft PR to staging, await exact-head CI before integration. Never close fullSLACK04/F4/F3 from this slice.

## Official metadata sources checked30Oct2026

-[auth.test](https://docs.slack.dev/reference/methods/auth.test/) checks authentication/identity; successful metadata does not demonstrate content scopes or message ACL.
-[Token rotation](https://docs.slack.dev/authentication/using-token-rotation/) describes expiring access tokens and single-use refresh tokens. Expiry or uncertain refresh is not sufficient evidence for destructive revocation of a still-valid newer grant.

## Remaining gates

Safe rotating-token recovery for provisional connections; apps.event.authorizations.list pagination and full6-watermark fanout; ordinary queue/triage; echo/outbox/write dispatch; full derived purge/atomic consumption; native Free/Pro/two-user acceptance and deployment enable. These stay open even when this consumer's fixture suite passes.
