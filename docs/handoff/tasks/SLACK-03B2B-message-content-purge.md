# SLACK-03B2B · Concrete message-content erasure

Parent: [derived lineage and purge](SLACK-03B2-derived-lineage-and-purge.md). Backend owner, direct execution on `feat/slack-03b2b-message-purge`, base `c68fb3ae`. [Plan](../../superpowers/plans/2026-10-30-slack-03b2b-message-content-purge.md).

Implement one private transactional handler for the actual03B2A selector `chat_history_message/content`. Read the purge target/cutoff from a durable intent, match all six canonical target scopes against persisted provenance, preserve exact edit watermarks, and CAS actual artifact fingerprint + server BIGINT version before erasure. No live credentials or current consent are needed to erase invalidated/expired content. Lock common source keys before conversation/message/copy rows. A mismatch retires lineage without overwriting newer text and is never reported as purged.

Scope: one handler and real PostgreSQL tests. No queue claiming/completion, startup wiring, other selectors, general derived TTL sweep, public writer/reader integration or fullF3 acceptance. A future runner must fence its own lease, enumerate all copies (including unresolved late/mismatched copies), and atomically apply handler results; skipped/stale/missing-handler results do not certify receipt closure.

## Kết quả

Private handler implemented:36/36 targeted real-PG tests PASS; fullcheck3,547PASS including typecheck/build/security, exit0. Exact scope and test provenance are in [implementation log](../log/2026-10-30-slack-03b2b-message-content-purge.md). Fresh independent review PASS with no P1/P2/P3; reviewer reran36 targeted +3 additional PostgreSQL probes. After accepted04B1 merge, combined fullcheck3,576PASS, exit0. Exact-head CI remains required before staging integration. No queue/fullF3 acceptance.
