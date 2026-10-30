# SLACK-03B2C · Fenced registered-message purge consumer

Parent: [03B2](SLACK-03B2-derived-lineage-and-purge.md), accepted [03B2B](SLACK-03B2B-message-content-purge.md). Backend direct implementation, branch `feat/slack-03b2c-message-purge-consumer`, base `98a678c4`. [Plan](../../superpowers/plans/2026-10-30-slack-03b2c-message-purge-consumer.md).

Consume actual staged `chat_history_message` intents, enumerate matching registered copies, pre-acquire the complete batch's sorted source/barrier locks, invoke the concrete handler and fence final job status in the same transaction. Unique per-claim nonce and exact server lease expiry prevent expired/stale workers from committing erasure or queue completion. Partial batches retain durable progress; stale lineage/missing selector remains failed, never complete. Other derived kinds remain pending. Native invalidation sweeps process this consumer independently of content flags.

Only effects with a matching active authoritative barrier/receipt may complete. `workspace_consent_revocation` currently has no corresponding barrier contract in accepted03B1 `stageInTransaction`; unlinked/unprovable jobs fail closed, even though the private handler supports its matching predicate. No guessed global lock/proof protocol is added.

Scope: registered `messages.content` only, no unregistered artifact/backfill certification, other selectors, generic TTL sweep, fullF3 or native Slack/model acceptance. Raw completion plus message completion does not close the other six derived intents.

## Kết quả

Consumer/native sweep implemented. Targeted consumer/handler/registry/invalidation69PASS (29new), plus actual-server sandbox probe1PASS, total70PASS; typecheckPASS. Real lease-reclaim/row-lock-expiry/abort/SQL-failure paths inspected persisted erasure/registry/job rows. Four regressions observed RED→GREEN: orphan scan, mutable target CAS, unrelated orphan owner partition, and disjoint-workspace jobs taking opposite conversation orders. All batch parents are now prelocked in deterministic order. Earlier fullcheck3601PASS precedes final refinements; final combined verification/review/CI remain open. No fullF3 acceptance. [Log](../log/2026-10-30-slack-03b2c-message-purge-consumer.md).
