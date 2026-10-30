# Registered Slack message purge consumer Implementation Plan

> **For agentic workers:** Use `executing-plans` directly, no CLI implementers. One fresh read-only whole-branch review after implementation.

**Goal:** Drain the existing durable message-content purge intents safely, preserving leases and unresolved lineage.

**Architecture:** Atomic SKIP LOCKED claims use a fresh worker nonce and exact server lease timestamp. Per-job transactions select a bounded matching-copy batch, acquire all common source/barrier locks together, re-read the batch and proof, call03B2B, then lock the job row and check expiry in a new statement before committing effects and final/partial status. Native invalidation sweeps invoke this consumer.

**Tech Stack:** TypeScript, pg/PostgreSQL16, existing0017 queue/0018 registry, Vitest; no migration/dependency.

**Spec:** [personal Slack §9.1](../specs/2026-10-28-slack-personal-oauth-design.md), [derived plan §§4–5](2026-10-30-slack-03b2-derived-lineage-and-purge.md), [frozen contracts](../../handoff/decisions/2026-10-29-slack-source-ingress-contracts.md).

## Global constraints

- Claim `chat_history_message` only. Other six derived kinds remain pending; no whole receipt/F3 closure.
- Order claims by attempts then creation/id so permanently failed old jobs cannot monopolize the native batch. Preserve them as unresolved durable retries.
- Exact five-field binding, six target matching predicates, canonical BIGINT strings, exclusive decimal edit cutoff, actual intent timestamp cutoff. Do not silently miss matching late/mismatched/resurrected registered copies.
- Queue consumer requires actual staging receipt and matching active barrier. Current stage contract cannot prove workspace_consent_revocation: keep unprovable jobs failed, do not invent a global proof/lock.
- All batch source/barrier advisory keys acquired sorted before conversation/message/copy/job rows. Prelock every conversation parent in deterministic order before per-copy erasure: disjoint workspace source keys can still share conversations. Re-read candidate versions/keys/proof after waits. Lock job row last; expiry checked in a fresh statement after real wait.
- Erasure + registry + fenced complete/partial status share the transaction. Lost lease rolls all effects back. Failures persist fixed codes only, never payload/error messages.
- Bounded copy batch default20 (1..100), lease60s (1..600 for tests/config). Partial work remains retryable. Live tokens/consent not needed to erase. Flags remain off; no model/network calls.
- Existing invalidation supervisor shutdown limitations remain; this task does not promise immediate SQL cancellation or whole-process grace. Already dispatched COMMIT may finish.

## Review focus

1. Candidate SQL must agree with the concrete handler for binding/epoch/channel and exact revision semantics, including absent/contradictory channel metadata.
2. Lost/reclaimed lease or row-lock expiry must rollback actual erasure, not only deny queue status.
3. Duplicate workers and overlapping intents must follow common lock order across the entire batch, including disjoint workspace jobs with opposite conversation orders, preserving fresh registrations.
4. Late/stale/unsupported/resurrected copies and unlinked barrier proof must remain unresolved, including retries after fingerprint retirement.
5. Native flags-off sweeps may complete raw/message intents only; remaining kinds and unregistered artifacts are not certified clean.

Review fix rulings: verified fresh registered successor text outside an old target is not a resurrected old payload. Match owner/selector/new server version and actual fingerprint, recheck candidates after parent locks, and rescan unresolved work under the target barrier so verified history larger than the batch limit can finish. This metadata proof grants no content-read authority; ungated/backfilled artifacts remain a separate deployment gate.

### Task 1: Consumer and native sweep integration

Files: create `apps/chat-api/src/services/slack/slack-message-purge-consumer.ts`; modify `slack-message-content-purger.ts` (metadata-only batch source-key preparation), `slack-invalidation-runner.ts` (optional consumer hook/stats), `apps/chat-api/src/server.ts` (native injection); create `apps/chat-api/tests/services/slack/slack-message-purge-consumer.test.ts`; card/plan/one log.

Interfaces: `SlackMessagePurgeConsumer(pool,{batchSize?,leaseSeconds?,purger?})`, `claim(limit=5)` returns private lease descriptors with unique nonce/exact expiry, `process(job,signal?)` returns completed/retried/lost, `runOnce(limit=5,signal?)` returns metadata counts. `SlackMessageContentPurger.sourceLockKeysInTransaction(client,copyIds)` validates persisted source identity and returns union keys without authorization/content. Existing purge interface preserved. Invalidation options `messagePurgeConsumer?: Pick<..., 'runOnce'>`; new stats messageIntentsCompleted/messageIntentsRetried default0.

- [x] Write real-PG tests first: real staged proof and all supported target scopes; negative identity/epoch; exact edit cutoff; empty matching set; multiple batches; two-worker SKIP LOCKED/no duplicate claims; stale/reclaimed lease rollback; actual row-lock expiry; malformed/late/fingerprint mismatch/unsupported selectors; missing proof; fixed error codes; flags-off native sweep with other six kinds pending.
- [x] Run new suite, expected RED missing consumer module.
- [x] Implement parameterized candidate selection (including unresolved late/mismatch/resurrection), batch key/proof recheck, actual handler effects and fenced outcome. Native hook follows raw sweep, independent of content config. No unfenced completeIntent use for derived jobs.
- [x] Run new suite + existing handler/registry/invalidation runner; expected PASS, typecheckPASS. Commit exact task files.

### Task 2: Review/publication

- [x] Run `npm run check`, expected exit0 on isolated PostgreSQL55533.
- [x] Fresh independent read-only whole-branch review, one direct RED→GREEN fix pass if needed, fresh checks after source changes.
- [ ] Fill card/log, publish draft staging PR, require exact-head CI before integration. No main/flag enable/fullF3 closure.
