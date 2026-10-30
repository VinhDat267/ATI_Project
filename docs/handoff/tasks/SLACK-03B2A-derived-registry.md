# SLACK-03B2A · Derived registry and message-content guard

Parent: [SLACK-03B2](SLACK-03B2-derived-lineage-and-purge.md). Approved design: [derived lifecycle plan](../../superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md). Base `c013933e`; isolated branch `feat/slack-03b2a-derived-registry`. Direct Codex implementation; no CLI delegation.

This first runtime slice adds migration0018 and private registry primitives for `chat_history_message/content`. Other target kinds/selectors fail closed until their concrete artifact handlers exist. No existing HTTP/SSE/planner writer is enabled by this slice. Full F3 remains open.

Ownership: `db/v3/0018_slack_derived_lineage_and_purge.sql`, `apps/chat-api/src/db/repositories/slack-derived-lineage-repo.ts`, its real-PG test/helper, this card, [implementation plan](../../superpowers/plans/2026-10-30-slack-03b2a-derived-registry.md) and one handoff log. No CURRENT-STATE/ROADMAP edits.

Acceptance: canonical BIGINT strings including9007199254740993; nonempty same-owner segments; immutable acquisition/storage epoch; real target ownership/fingerprint; server-derived version/TTL; caller-managed transaction and rollback; current authority+durable barrier checks under common sorted locks; supersession; read denial for wrong owner/version/fingerprint/expiry/revoke/deletion; real concurrency. Native/model/other artifact handlers/purge consumer/public writer integration are NOT_RUN here.

## Kết quả

Targeted real PostgreSQL **14/14 PASS**. Typecheck passed before review; final full check after review fixes is pending. Independent review found channel metadata could bypass membership barriers and policy resolution could exhaust a small pool. Both observed RED→GREEN: derive message/conversation channels from canonical resource identity, reject conflicts even in persisted segments; authorize through the held query client. The shared policy resolver gained a backward-compatible query-client argument (commit96ed9799), also consumed by the wrapper follow-up. See [implementation log](../log/2026-10-30-slack-03b2a-registry.md). FullF3/public integration remain open.

Final `npm run check`: **exit0,3.465 tests PASS** (`2026-10-30T03:28:11Z`), gồm typecheck/build/security; PG riêng55533. CI đúng head là cổng riêng trước tích hợp. Module public policy service là file bổ sung bắt buộc để giải quyết nested pool checkout; API cũ giữ mặc định pool, caller giao dịch truyền query client hiện hữu.
