# Slack message-content erasure Implementation Plan

> **For agentic workers:** Use `executing-plans` directly; no CLI implementers. One fresh read-only whole-branch reviewer after implementation.

**Goal:** Physically replace one registered message-content copy only when a durable invalidation intent matches its provenance and exact current artifact version.

**Architecture:** Private caller-transaction handler using durable intent metadata, common sorted source advisory locks and parent-first conversation/message/copy row locks. Erasure and registry terminal state occur together; queue completion is deliberately owned by a later fenced runner.

**Tech Stack:** TypeScript, pg/PostgreSQL16, Vitest. No new dependency/migration.

**Spec:** [personal Slack §9.1](../specs/2026-10-28-slack-personal-oauth-design.md); [accepted derived plan §§4–5](2026-10-30-slack-03b2-derived-lineage-and-purge.md); [03B2A registry](../../handoff/tasks/SLACK-03B2A-derived-registry.md).

## Global constraints

- One concrete selector `chat_history_message/content`; preserve all unregistered fields and unrelated owners/workspaces/generations.
- BIGINT versions are canonical strings; revisions compare exact decimal values, never floating point. Edit `beforeRevision` is exclusive; opaque revisions fail closed.
- Read actual intent target/cutoff from PostgreSQL; compare timestamps in PostgreSQL without millisecond truncation. Late matching copies are unresolved stale lineage, never proof of freshness.
- Purge must work after disconnect/consent expiry without tokens/model/network. Flags remain off; no main merge or fullF3 closure.
- Future runner must enumerate/claim/fence and keep stale/missing-handler intents unresolved. This handler never completes an intent.

## Review focus

1. Malformed or contradictory persisted channel provenance must not bypass membership erasure or falsely certify success.
2. Mixed-resource/epoch copies are erased if any matching dependency is invalid; unrelated fields remain intact.
3. Fingerprint/version mismatch and late legacy copies preserve replacement content but stay explicitly unresolved.
4. Writer/reader/eraser lock ordering must preserve fresh registration and serialize duplicate erasure with actual PostgreSQL waits.
5. SQL/abort/fault after an artifact write must rollback artifact and registry together; no queue closure or immediate SQL cancellation claim.

### Task 1: Concrete transactional handler

**Files:** Create `apps/chat-api/src/services/slack/slack-message-content-purger.ts`; create `apps/chat-api/tests/services/slack/slack-message-content-purger.test.ts`; card/plan/one handoff log only.

**Interfaces:** `SlackMessageContentPurger.purgeInTransaction(client, {intentId, derivedCopyId, expectedTargetVersion, signal?})` returns `{status: 'purged'|'already_purged'|'skipped'|'stale_lineage'|'missing_handler'}`. Inputs are internal server metadata; no target/version comes from model/HTTP. Caller must BEGIN, acquire no later-order locks first, and rollback on thrown errors. A result never authorizes content or completes a queue job.

- [x] Write real-PG tests: six scopes with negative binding/epoch/resource cases, BIGINT9007199254740993, edit below/equal/newer/opaque revisions, owned channel identity, exact timestamp cutoff, fingerprint mismatch retirement, wrong expected version, missing handler, duplicate erasure, transaction rollback and real writer contention/abort.
- [x] Run `npx vitest run apps/chat-api/tests/services/slack/slack-message-content-purger.test.ts --reporter=dot`; expected RED missing handler module.
- [x] Implement actual durable target loading, canonical segment matching, source locks before parent/artifact rows, re-read immutable metadata/version/fingerprint, exact content tombstone and terminal registry CAS. Return stale on malformed/mismatched/late provenance, missing_handler for unsupported selectors; no queue mutation.
- [x] Rerun targeted new suite plus existing registry suite; expected allPASS. Typecheck; commit exact files.

### Task 2: Review and publication

- [x] Run `npm run check` with isolated PostgreSQL55533; expected exit0.
- [x] Fresh independent read-only review of complete branch and review focus. One direct fix pass with RED→GREEN and fresh relevant/full checks after source changes.
- [x] Fill card/log with actual evidence and ruled limits, publish draft staging PR, require exact-head CI before staging merge. Keep fullF3 and broader derived runner/integration open.
