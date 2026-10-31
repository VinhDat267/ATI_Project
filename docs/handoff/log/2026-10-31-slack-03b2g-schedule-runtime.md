# SLACK-03B2G schedule runtime

Base83c61de3, following acceptedPR212. Root implements directly in the same sole new Orca worktree/branch. Main and flags unchanged. [Card](../tasks/SLACK-03B2G-schedule-runtime.md), [plan](../../superpowers/plans/2026-10-31-slack-03b2g-schedule-runtime.md).

Ruling: wire complete schedule writer/read/run/erasure deliverable, including state messages and run titles, before lifting the existing source schedule gate. Reuse actual0022 helpers/registry/queue and actual next0023 migration, not proposed historical interfaces/numbers. Conservative source union for generated schedule fields; services are router identifiers. Source metadata stays server-private and nonserializable.

Ruling: bounded due candidates are processed with a complete source union before parent locks. Changed registry snapshots restart/fail closed; lower conflicting locks may retry, never relax lease/barrier/authority. Source-invalid in-flight results end as discarded with fixed safe metadata. Source-dependent schedules cannot resume/update/run after invalidation.

Ruling: authenticated manual title replacement retires active old title copies and records its new fingerprint. Historical purged copies remain immutable; a matching certificate distinguishes a legitimate human replacement from source resurrection. No certificate is supplied by HTTP/model input.

Environment: inherited DATABASE_URL absent; dedicated synthetic PostgreSQL16 container ati-slack-m2-pg-20261030 restarted, bound127.0.0.1:55439, databaseati_v3, random test schemas. No live env/provider credentials. Verification pending.


TDD evidence: initial new source schedule suite3/3RED at actual confirmation/chat gates, then3/3PASS after runtime wiring. First fixture run failed policy because it had not installed synthetic runtime provider environment; fixture now uses TEST_ENV via vi.stubEnv, no production bypass. Dedicated container had stopped externally (exit0); explicit restart restored loopback test DB. Expanded7-case suite exposed a real concurrent-confirm duplicate schedule; root observed RED, re-read new schedule under held parent and verified its complete source set is a subset of prelocked proposal sources, then73/73 schedule/chat/routes/new integrationPASS. A new pending-count regression observed1 instead of0 after revoke; count now guards actual schedule/run/plan snapshots. Later suites cover that fix.

Compatibility failures were investigated, not skipped: source-free row changes must be read under their parent lock rather than rejected by the Slack snapshot gate; source-bound changes still fail closed. A test pool observer only implements promise-form connect, while pg.Pool.query uses callback connect internally: runner metadata selection now checks out/releases its client explicitly. Prior8 failures plus2 hook deadlines are retained in schedule-compat1.log; corrected73PASS is a distinct run. One query-only conversation mock replaced with real PostgreSQL ownership/rename/read assertions. FE-02 runtime fixture now installs complete schema; its migration-only test retains a separate unmigrated schema so original once-only backfill assertions remain meaningful.


Focused combined9 files103PASS, exit0: source schedule/message/memory/plan/execution, schedule locks/runner/planning/routes and actual-server bootstrap. A distinct3-file run26PASS covers source schedule, FE-02 migration/runtime and real repository fixture. New coverage includes lease expiry/reclaim rollback, real HTTP AbortSignal timeout, source-copy snapshot mutation, expiry/uncovered manifest, two owners, idempotent concurrent confirm, update/cancel and physical erasure. Counts overlap and are not additive.

Native schedule-consumer omission: first filter invocation selected0 tests (409 skipped), NOT_RUN as mutation evidence. Corrected single-word filter selected the actual bootstrap test: omission failed at durable schedule-erasure deadline (exit1), exact server bytes restored in finally. Restored focused verification follows below. This proves the actual-server injection; no native Slack acceptance inferred.


Expanded retention regression exposed an expired segment throwing during lock preparation before the typed source conflict. Preparation now validates persisted identity/channel and acquires the exact advisory key union even for expired metadata; mandatory registry consumption guards still reject expired storage without refreshing retention. No guard, lease, barrier, or timeout was relaxed. Original failure28PASS/1FAIL is retained; source schedule/locks rerun follows. Changed source snapshots map to existing typed409 optimistic conflicts instead of500. Restored native bootstrap passed after omission; first latest29-case run had only that expiry failure.

Final focused source schedule suite10/10PASS, including actual HTTP list/owner/run409, exact TTL denial, real AbortSignal timeout and reclaimed-lease rollback. Separate schedule+lock13/13PASS. TypecheckPASS; diff-check0. No .env in worktree; synthetic DATABASE_URL explicitly targets127.0.0.1:55439/ati_v3. Freeze/fullcheck/review pending below.
