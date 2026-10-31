# Plan and execution source lifecycle runtime

Execution: root directly; one independent read-only reviewer at final freeze. Approved [Slack spec](../specs/2026-10-28-slack-personal-oauth-design.md) and [03B2 plan](2026-10-30-slack-03b2-derived-lineage-and-purge.md); current base afterPR211.

1. Add real-PG/HTTP regressions for actual PlanRepo/StepRepo, preview, approval and execution. Observe RED for missing source writer/guard/erasure. Use no live env.
2. Introduce concrete plan/step target selectors and parent-first lock/read/erasure helpers, extend existing registry/consumer (not a second queue protocol); add repeatable0022 manifest/view migration.
3. Wire actual PlanRepo/StepRepo writes and reads atomically with private server source context. Plan preview and result snapshots mask invalidation immediately; fingerprint/version/owner/authority rechecks use the held client.
4. Remove chat's plan gate only once that writer is wired; retain schedule gate. Execution wraps real adapters with immutable source-plan snapshot and fresh pre-dispatch guard, propagates dependencies through step args/output/error and guards recovery/read surfaces. Provider result after revoke is recorded without private content, with truthful outcome safety; source SSE only requests guarded reload.
5. Native invalidation consumer physically scrubs plan/step/audit fields using the same lease/barrier/cutoff/CAS as accepted message erasure, invalidates executable states and discards linked run references; future/schedule kinds stay open.
6. Freeze, fullcheck, independent review, exact-head check/browser CI, staging merge/tree verification then checkpoint. Do not repeat fullcheck without source/base changes or a specific unresolved concern.

Review focus: source-bound plans with only non-Slack write steps; output-derived next-step refs; provider success racing revoke; late persistence and retry/recovery; two owners with same resource IDs; JSON selector/hash integrity; global parent/source lock order; orphan/superseded/resurrected copies and partial queue batches; no source payload in SSE.
