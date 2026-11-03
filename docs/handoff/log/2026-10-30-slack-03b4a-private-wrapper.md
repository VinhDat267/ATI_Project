# SLACK-03B4A: private transient read wrapper

Base `715193c2b2f2e9451f0a7402597f84bf9ba698bd`, isolated branch `VinhDat267/feat-slack-03b4a-private`. The user transferred unfinished CLI work to direct Codex implementation. This slice owns the Backend wrapper, its real PostgreSQL/loopback fixture, two test suites, task card/plan and this log.

## Behavior

The internal wrapper exposes exactly the eight declared transient read methods. It validates caller/full binding, resolves the current provider/consent authority using the real policy service, maps legacy aliases to the canonical eight-field reference and pins that acquisition reference. Token acquisition uses the real TokenManager with a separate post-refresh owner gate. Binding/provisional/epoch/channel/resource barriers are checked before credentials/transport and against every returned entity/container. Caller cancellation and the overall deadline prevent late results. Errors expose fixed codes.

No public route/tool registration, planner/executor/UI integration, storage writer or model call is introduced. Content flags remain off; the injected wrapper config must explicitly enable its use.

## Direct takeover evidence

- Initial actual baseline: two files,47 PASS/1 FAIL. Missing acquisition/provenance evidence returned `SLACK_READ_INTERNAL`; after the direct error classification fix,48/48 PASS. Removed inherited unexpected-error console logging.
- Typecheck initially failed because inherited test helpers returned broad records and read unknown DTO fields without narrowing. Test helper annotations and assertions were corrected; the product result remains `unknown` at its public boundary.
- Full verification reached405/406 evaluation tests; static guard rejected only the native hostname literal in this dedicated provider wrapper. Added one exact-file/exact-literal exception with an explicit reason. The guard remains active for all other files/literals; its two tests now PASS. This additional evaluation file is required verification wiring for the slice.
- Final full suite and independent review are in progress; their actual results and fixes will be appended before publication.

Independent read-only review returned NEEDS WORK with threeP2 findings. New regression cases were observed **RED10 / existing48 PASS** before the direct fix pass: five empty page methods, four malformed barrier decisions, and a real deletion committed during final authorization. After the fixes the targeted suites passed **59/59**. The additional two-client ordering test observes the stager's actual PID waiting on an advisory lock; its invalidation commits after the read snapshot, and the next read is denied. The inverse interleaving (a stager awaited by final authorization) returns no stale DTO and safely reaches the deadline.

The final result gate now takes owner → globally sorted invalidation advisory → authority row share locks (user, connection, provider, consent). It checks current authority and **all observed resources** inside that transaction. Binding/reference snapshots are frozen. Empty pages retain mandatory container provenance; malformed barrier decisions fail with fixed INTERNAL. Final whole-suite validation after these changes remains pending below.

Review boundaries ruled explicitly: native Slack/ACL/model/public integration/full F3 remain NOT_RUN; trusted adapter constructs digests, while wrapper verifies format and identity/reference association (not an independent cryptographic attestation). Refresh/owner acquisition may complete after caller cancellation, but the wrapper cannot return their late result. No general deadlock certification is claimed; the demonstrated final-authorization race is covered by the real lock-order regression.

Final fix-pass `npm run check` **exit0**, **3,449 tests PASS**, finished `2026-10-30T03:06:36.9656696Z` using the isolated review PostgreSQL55533: schemas274, adapters519, planner381, executor42, API859, web901, evaluation406, launcher1, scripts66. Typecheck, production build and build-security also passed. The subsequent two-line timeout-budget/abort refinement was checked with fresh typecheck and both targeted suites before commit; no unrelated suite was changed. CI at the published head remains a separate gate before staging integration.

Cross-slice review found that nested policy/barrier pool checkout while an owner/snapshot client is held can stall a saturated pool. A new real single-connection-pool regression was RED with INTERNAL. The policy and barrier services now accept the existing query client, and both wrapper owner gates pass it to every policy/barrier query. The shared policy fix is cherry-picked from03B2A96ed9799. Targeted suites now **60/60 PASS**, including all earlier final-authorization and cancellation cases. Prior CI40995663340 succeeded atc1aa1c91; it does not certify this follow-up head. Fresh full check/CI are required below before integration.

Final pool-fix `npm run check` **exit0,3,450 tests PASS** (`2026-10-30T03:31:28.1831681Z`), PostgreSQL55533; typecheck/build/security also passed. API860, other workspace/eval/script counts unchanged. `git diff --check` exit0. This supersedes the earlier full-check evidence for publication; exact new-head CI remains required.

## Remaining gates

This is an internal transient boundary at retention0. Public integration, ingress credential probe consumer04B, derived persistence/erasure, executor binding, Inbox/modes and native/model acceptance remain open. No F3/whole-feature acceptance or main merge is implied.
