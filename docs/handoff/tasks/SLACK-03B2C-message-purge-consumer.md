# SLACK-03B2C · Fenced registered-message purge consumer

Parent: [03B2](SLACK-03B2-derived-lineage-and-purge.md), accepted [03B2B](SLACK-03B2B-message-content-purge.md). Backend direct implementation, branch `feat/slack-03b2c-message-purge-consumer`, base `98a678c4`. [Plan](../../superpowers/plans/2026-10-30-slack-03b2c-message-purge-consumer.md).

Consume actual staged `chat_history_message` intents, enumerate matching registered copies, pre-acquire the complete batch's sorted source/barrier locks, invoke the concrete handler and fence final job status in the same transaction. Unique per-claim nonce and exact server lease expiry prevent expired/stale workers from committing erasure or queue completion. Partial batches retain durable progress; stale lineage/missing selector remains failed, never complete. Other derived kinds remain pending. Native invalidation sweeps process this consumer independently of content flags.

Only effects with a matching active authoritative barrier/receipt may complete. `workspace_consent_revocation` currently has no corresponding barrier contract in accepted03B1 `stageInTransaction`; unlinked/unprovable jobs fail closed, even though the private handler supports its matching predicate. No guessed global lock/proof protocol is added.

Scope: registered `messages.content` only, no unregistered artifact/backfill certification, other selectors, generic TTL sweep, fullF3 or native Slack/model acceptance. Raw completion plus message completion does not close the other six derived intents.

## Kết quả

Consumer/native sweep implemented. Independent review found P1 failed jobs starving later valid purges and P2 valid fresh registered content treated as resurrection. Both plus batch-limit supersession were reproduced RED→GREEN in one direct fix pass. Post-fix consumer/handler/registry/invalidation73PASS (33new), plus actual-server sandbox bootstrap1PASS, total74PASS. Final post-fix fullcheck3,625PASS, typecheck/build/securityPASS, exit0. Accepted staging via PR208, head `145a6016`, CI41042072139 SUCCESS including browser, merge `2821d426` tree identical. [Publication evidence](../log/2026-10-30-slack-03b2c-review-integration.md). Real lease/row-lock/abort/SQL failures roll actual effects back. Six other kinds/backfill/fullF3 remain open. [Log](../log/2026-10-30-slack-03b2c-message-purge-consumer.md).
