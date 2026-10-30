# Slack message and memory runtime implementation plan

Execution: direct native implementation by root, as authorized by the owner; one read-only independent whole-branch reviewer after verification.

Goal: finish a real writer→provenance/read guard→invalidation→erasure slice for message metadata and working-memory snapshots on accepted staging.

Spec: [personal Slack](../specs/2026-10-28-slack-personal-oauth-design.md), approved [03B2 design](2026-10-30-slack-03b2-derived-lineage-and-purge.md). PostgreSQL16, existing Slack registry and fenced consumer. No new public tool or write dispatch.

1. Add PostgreSQL integration tests using the real MessageRepo and lifecycle consumer. Demonstrate RED for missing transactional writer and selector support. Use a dedicated loopback test DB and isolated schemas.
2. Implement one selector module for messages and working memory: canonical JSON hashing, validated paths, duplicate-ID refusal and exact deletion. Extend the existing registry and purger without altering accepted source/barrier/lease semantics.
3. Add server-owned message manifest and transactional MessageRepo entrypoint. Sources are passed through a private server context, never HTTP/model data. Lock the full source union before conversation/artifact writes. Register and reauthorize every selected copy in the writer transaction.
4. Guard actual MessageRepo reads; preserve unchanged non-Slack memory. Carry permitted provenance through restored chat history to newly persisted answer/memory. Gate plan/schedule responses until the remaining core artifact writers exist. Slack-derived SSE notifications contain a reload pointer rather than cached plaintext.
5. Extend native consumer wiring for working memory and metadata. Keep future/other kinds pending. Exercise physical erasure, legacy masking, owner isolation, concurrency and cancellation.
6. Freeze product/base, run fullcheck, review whole branch, fix any finding and repeat only justified verification. Publish PR to staging and accept only exact-head check/browser success and matching merge tree. Update matrix/checkpoint at the proper acceptance phase.

Review focus: missing selectors or provenance, mutable output read after guard, superseded/purged copy resurrection, duplicate memory IDs, cross-owner or cross-workspace confusion, current authority vs absent barriers, SQL lock order and cancellation, derived output escaping through plan/schedule/SSE.
