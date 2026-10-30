# SLACK-04A: signed ingress implementation and direct takeover

Base: `612ac427152fcfcf8a0f1bff3158088d8f393a5d`, isolated branch `VinhDat267/feat-slack-04a-signed`. The user transferred implementation from CLI workers to direct Codex work. All three active Claude Code CLI sessions exited to their shells; pending wrapper/registry changes remain in their own worktrees. No further Claude Code CLI or Antigravity implementation is authorized.

## Implemented ingress boundary

- Migration `0019_slack_signed_event_ingress.sql`: body-free receipts, unique app/event identity and durable per-binding lifecycle validation intents. Migration0018 remains reserved for derived lineage.
- Exact-byte HMAC/signature/timestamp checks; URL challenge; raw stream1MiB cap/timeout; public signed route mounted before JSON middleware.
- Receipt, lifecycle intent and03B1 read barrier commit together before200. Duplicate payload conflicts fail closed; owner lock contention/DB failures return503. One absolute staging budget includes pool acquisition and every real PostgreSQL statement.
- Revocation/uninstall captures full binding/credential fingerprint, retains encrypted config, changes to reconnect_required and stages provisional barriers. No destructive generation decision or native probe is made in ingress. Message keys use `JSON.stringify([channelId,messageTs])`, workspace separate; edit watermarks and permanent delete barriers use03B1.
- Configured lifecycle works with both content flags off; ordinary events are dropped in memory when automation is off. Receipt cleanup retains pending/failed lifecycle validation jobs; completed routing metadata expires after seven days. The minimal recovery metadata may therefore outlive seven days until its job finishes.

## Direct fixes and real evidence

Initial inherited targeted baseline:47 passed/1 failed (48 tests). Direct regression evidence in worktree `.superpowers/review-ingress/`:

| Finding | RED | GREEN |
|---|---|---|
| Ingress row/advisory lock inversion against raw source writer | Real client PID observed waiting on advisory lock; source writer failed55P03 on connection row | Same root harness passed; committed two-client tests cover token revocation and uninstall |
| Chunked413 and HTTP keepalive reuse of incomplete rejected request | Existing route test returned status0 | Connection:close; route suite9/9 passed |
| Content flags disabled lifecycle configuration | New env suite3 failed/1 passed | Env suite4/4 passed; HTTP off-path uses actual env factory |
| Receipt cleanup erased unfinished validation jobs | Real-PG pending-job retention test failed | Pending/failed retained; applied receipt expires |
| Pool acquisition and cumulative transaction exceeded ACK budget | Occupied real pool and pg_sleep trigger tests both failed | Bounded acquisition, remaining server/driver timeouts, rollback/discard; DB suites16/16 passed |
| Independent review P2: late edit purge erased newer captures | Real PostgreSQL test consumed the actual queued purge target:3 captures erased instead of1 | Explicit exclusive `beforeRevision`; equal/newer revisions survive; all8 raw/derived intents retain the cutoff |
| Independent review P2: a NULL-config generation rolled back other bindings | Both uninstall and token-revocation PG cases failed `SLACK_CONNECTION_CONFIG_MISSING` | Credentialless generation gets a durable binding barrier and8 purge intents; healthy generation gets its own provisional barrier/probe job |

Before independent review, the7 ingress suites passed58 tests and `npm run check` passed3,448 tests. The fresh read-only Codex review returned NEEDS WORK with the twoP2 findings above. Direct fixes were verified RED→GREEN; the schema/receipt/source suites passed58 tests after the fixes. The final full check is pending below; prior implementation or planning checks do not certify the final tree.

Final direct fix pass: `DATABASE_URL=<isolated review PostgreSQL55533> npm run check` **exit0**, finished `2026-10-30T02:41:12.8687716Z`. **3,451 tests PASS**: schemas274, adapters519, planner381, executor42, API861, web901, evaluation406, launcher1 and scripts66. Typecheck, production web build and build-security check also passed. No skipped DB tests in this final run. `git diff --check` exit0. Artifacts: `.superpowers/review-ingress/direct-reviewfix-db-fullcheck.log` and its result JSON (ignored). The first resumed full check used provider-test fallback port56533 and failed connection setup; the corrected explicit55533 run above is the final evidence. CI for the published head remains a separate pending integration gate.

## Contract rulings from review

- A `resource_lifecycle/source_edited` purge requires `beforeRevision`, an exact decimal exclusive upper bound, and cannot also carry an exact `revision`. Stage validation requires the cutoff to equal the associated read barrier's watermark. Raw PostgreSQL erasure compares exact numerics, preserves equal/newer captures, and erases opaque revisions that cannot prove freshness. Every future derived eraser must apply this same predicate to each dependency before field-scoped erasure; the seven-kind consumer remains unimplemented. This small shared-schema/raw-consumer correction is required to make ingress's durable purge contract safe.
- A credentialless generation has already lost usable authority inside ATI. Under the owner/advisory/row locks, ingress stages a permanent barrier and generation-scoped authorization-loss purge for that binding, retains its reconnect UI state, and creates no impossible credential probe. Other credentialed bindings retain the conservative provisional/probe flow. This does not infer provider revocation or invalidate a later grant: OAuth increments `identity_version`, and the PG regression proves generation2 remains outside generation1's barrier.
- The worktree had copied `node_modules/@wap` sources. They were replaced with normal npm workspace links before final validation, so imports execute the current tracked package sources. The incidental npm lockfile metadata change was restored; no dependency manifest/lockfile change is part of this task.

## Remaining gates

This is bounded ingress implementation. Metadata-only validation consumer/auth.test with CAS and complete six-watermark authorization fanout belong to04B and remain NOT_RUN. AC6/AC7 of the parent card are therefore only partially implemented; the whole task/feature is not closed. Seven-kind derived purge, executor/routing integration, modes/Inbox and native/model acceptance remain open. Content flags stay off. No main merge, CURRENT-STATE or ROADMAP change.
