# SLACK-03B2A · Derived registry and first concrete read guard

Approved authority: [personal Slack spec](../specs/2026-10-28-slack-personal-oauth-design.md), [parent plan](2026-10-30-slack-03b2-derived-lineage-and-purge.md), [task card](../../handoff/tasks/SLACK-03B2A-derived-registry.md).

1. RED: real PostgreSQL tests for schema/registration, versions above2^53, atomic artifact/registry rollback, wrong owner, empty/mixed/stale epochs, target content changes, authority revocation before barriers and resource invalidation. Expected failure: module/migration absent.
2. Add parent-approved migration0018 without changing0017/0019. Keep seven target-kind names for schema compatibility, but expose only the concrete message-content handler in this slice.
3. Implement private `registerDerivedCopyInTransaction(client,input)`, `getActiveCopyInTransaction(client,target)` and `assertDerivedCopyAllowed(input)` over message content. Input segments come only from server acquisition context; this module is not a client/HTTP deserializer and is not registered as a tool. Reject caller-supplied versions/fingerprints. Read content and its owning conversation from actual tables.
4. All methods use canonical decimal version strings; registration computes a UTF-8 content fingerprint and server sequence version. Re-registration retires the previous active copy. Copy+segments use the caller's transaction; registration requires BEGIN.
5. Register/read acquire sorted source binding/channel/resource/epoch advisory locks, then conversation before authority/artifact/registry. Authority rows are held FOR SHARE while the real policy service verifies storage and consumption against the pinned epoch. Read validates all segments, expiry, exact version and current fingerprint before returning allowed. Missing proof/unsupported target is blocked.
6. GREEN: targeted real-PG tests; typecheck/full check; independent read-only review; direct RED→GREEN fixes. Add task results/log and draft PR to staging; exact-head CI before integration.

Segments retain sourceRef, acquisitionPolicyRef, storagePolicyRef, captureHash, optional channel/raw source identity, capturedAt and server-computed expiry. Source/reference binding and exact epochs must agree. Future raw expiry does not erase a derived reference: raw IDs have no FK. Per-segment derived TTL is at most30days and the currently approved storage limit. Target metadata stores no Slack content.

Remaining: seven-kind purge handlers and beforeRevision cutoff consumption, other concrete selectors, actual writer/HTTP/SSE/executor integration, durable queue runner, native/model acceptance. This slice cannot enable stored Slack output or claim F3 closure.
