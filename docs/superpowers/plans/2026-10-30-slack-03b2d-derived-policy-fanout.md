# Derived-only Slack policy fanout Implementation Plan

> **For agentic workers:** Use `executing-plans` directly, no CLI implementers. One fresh read-only whole-branch review after implementation.

**Goal:** Stage durable derived erasure obligations for old policy epochs that outlive raw source retention.

**Architecture:** Query distinct affected policy-event/derived-epoch pairs with an anti-join against their own receipt keys before limiting work. Validate exact epoch/hash in TypeScript. Stage one epoch barrier and seven derived intents per pair in a short transaction. Existing raw stage/hash behavior remains unchanged; derived-only stage hashes use a separate domain so mixed-mode replay conflicts.

**Tech Stack:** TypeScript, PostgreSQL16 pg, Vitest; no dependency/migration.

**Spec:** [personal Slack §9.1](../specs/2026-10-28-slack-personal-oauth-design.md), [derived plan §5](2026-10-30-slack-03b2-derived-lineage-and-purge.md), [frozen source contracts](../../handoff/decisions/2026-10-29-slack-source-ingress-contracts.md).

## Constraints / review focus

- Receipt identity exactly `derived-policy:<eventId>:<epochHash>`; effect `derived_policy_epoch_invalidated:<epochHash>`; exact full binding/epoch, seven derived kinds, no raw job. Never mutate/re-stage `policy:<eventId>`.
- Handle consent_granted/revoked via older consentRevision per workspace/provider, and provider_attested/updated via older providerRevision globally. Equal/newer revisions and other providers/users/workspaces stay untouched.
- Include active and fingerprint-mismatch retired lineage even with no raw row; actual artifact erasure is a separate consumer. Missing/corrupt epoch metadata fails closed, never invents an authorization.
- SQL epoch hash is only a lookup key; recompute `hashPolicyEpoch(validateSlackPolicyEpoch(...))` before stage. Revision strings stay exact, including9007199254740993. Policy/provider values with Unicode/spaces must hash identically.
- Anti-join event/epoch receipts before limit prevents already-processed early events/epochs from starving later pairs. Concurrent workers replay idempotently; crash leaves either all receipt/barrier/intents or none.
- Registration after a policy change must already revalidate authority; no cutoff-based freshness assumption or content-read authority from this metadata fanout. Flags remain off, native/model acceptance/fullF3/F4 open.

### Task 1: Stage API, fanout and native hook

Files: modify `apps/chat-api/src/services/slack/slack-invalidation-service.ts` (new `stageDerivedInTransaction`, preserve existing stage), `slack-invalidation-runner.ts` and `apps/chat-api/src/server.ts` (optional native consumer hook/stat); create `apps/chat-api/src/services/slack/slack-derived-policy-fanout.ts`, `apps/chat-api/tests/services/slack/slack-derived-policy-fanout.test.ts`; card/plan/one log.

Interfaces: `stageDerivedInTransaction(client,StageInTransactionInput):Promise<StageInTransactionResult>` stages cascade kinds only with its own hash domain; existing `stageInTransaction` unchanged. `SlackDerivedPolicyFanout(pool,invalidation).runOnce(limit=50):Promise<{staged:number}>` returns committed pairs only; idempotent duplicate stage may count handled but never inserts duplicate rows. Runner options `derivedPolicyFanout?:Pick<..., 'runOnce'>`, stat `derivedPolicyEpochsStaged` default0.

- [x] Write real-PG tests before product: raw source absent + existing immutable raw receipt, all four event types, exact old/equal/new provider/consent revisions, Unicode epoch hash and >2^53 revisions, concurrent workers/idempotency, rollback crash, >limit processed early pairs then later pending work, native no-content-config hook stages7 only. Missing/malformed epoch leaves no forged receipt.
- [x] Run new suite, expect RED missing fanout module/API.
- [x] Implement shared private stage core with derived-only hash domain/raw suppression; candidate SQL computes exact canonical-array hash, validates it against TypeScript, and stages per-pair atomic transactions. Native hook before message erasure, independent of flags.
- [x] Run new suite plus existing policy/invalidator/registry suites, expected PASS; typecheck/check and commit exact task files.

### Task 2: Review/publication

- [x] Fresh independent whole-branch review; one direct RED→GREEN fix pass if needed, full checks after source fixes.
- [ ] Fill task/log, draft staging PR, require exact-head CI before staging integration. No main/live enable or fullF3/F4 claim.
