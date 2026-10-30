# SLACK-03B2D · Derived-only policy invalidation fanout

Parent: [03B2](SLACK-03B2-derived-lineage-and-purge.md), §5 derived-policy receipt contract. Backend direct execution, branch `feat/slack-03b2d-derived-policy-fanout`, base `ef304040`. [Plan](../../superpowers/plans/2026-10-30-slack-03b2d-derived-policy-fanout.md).

Reconstruct invalidated epochs from persisted derived provenance even when raw source payloads/rows are absent or raw policy receipts already exist. Each affected event/epoch stages a separate `derived-policy:<eventId>:<epochHash>` receipt with exact epoch barrier and seven derived intents, without raw intent or replaying/mutating the immutable `policy:<eventId>` receipt. Native sweeps run this fanout independently of content flags. Do not claim physical erasure from staging alone; unsupported derived kinds remain pending.

Scope: one derived-only stage API, metadata fanout, native hook and real-PG tests; no migration/dependency or content/model calls, general TTL/other selectors/writer-read integration/fullF3/native Slack acceptance.

## Kết quả

Implementation complete; independent whole-branch review PASS with no actionable P1/P2/P3. Real-PG targeted47/47 and fullcheck3604PASS, exit0 (2026-10-30T10:39:52Z); reviewer reran33 focused PG tests and35 additional SQL/JavaScript hash parity cases. No product changes after review. Publication/base integration and exact-head CI remain pending; this is staging of derived obligations, not physical erasure or fullF3/F4. See the [evidence log](../log/2026-10-30-slack-03b2d-derived-policy-fanout.md).
