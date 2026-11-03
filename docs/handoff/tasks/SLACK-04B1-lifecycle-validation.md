# SLACK-04B1 · Durable credential validation consumer

Parent: [SLACK-04 ingress/lifecycle](SLACK-04-ingress-lifecycle-and-execution-safety.md), [frozen ingress contracts](../decisions/2026-10-29-slack-source-ingress-contracts.md). Base `c013933e`, branch `feat/slack-04b1-lifecycle-validation`. Private Backend consumer, direct implementation only.

Consume04A's durable per-binding validation jobs without inferring grant generation from event timestamps. A result is applied only under matching lease, owner lock, full binding, credential fingerprint and actual provisional barrier. A valid current credential may release only its own provisional barrier. Unknown results retain the read block and private encrypted config. Confirmed invalid credentials can stage a generation-scoped disconnect/purge. This card does not implement ordinary-event authorizations fanout, triage or complete F4/native acceptance.

Owner files: migration0020 lease/retry metadata; lifecycle job repository; validation worker; narrowly typed provider error classification if needed; real PostgreSQL/loopback tests; [implementation plan](../../superpowers/plans/2026-10-30-slack-04b1-lifecycle-validation.md); this card and one new log. No flag enable or generic dispatcher.

Acceptance: actual SKIP LOCKED claims and lease recovery; two workers without duplicate ownership; valid old-revoke/new-grant safety; stale fingerprint/generation/lease cannot mutate current authority; manual disconnect wins; all unrelated barriers retained; transient/expired/uncertain rotation stays blocked; hard invalid only for captured usable credential with no unresolved refresh ambiguity; transactional barrier/status/job result; failed-job retention; flags off still permit private lifecycle processing. Full native server wiring and rotation recovery must be explicitly bounded, not silently assumed.

## Kết quả

Private lease repository and metadata-only consumer implemented. **29 real-PG/loopback tests PASS**; final typecheck PASS. `npm run check` passed **3,552 tests**, typecheck/build/security (exit0); two additional race/fingerprint tests were then added and the full targeted suite rerun, with no further product changes. Exact published-head CI remains required before staging integration.

Independent review found a P1: malformed successful auth.test metadata could be treated as a contradictory principal and destructively invalidate a nonrotating credential. Five regressions were observed RED, then GREEN after identity shape validation precedes comparison. Unknown responses now retain config and the provisional barrier. Actual manual-disconnect/probe ordering, lease expiry after a real row-lock wait, stale fingerprint/generation, abort, rollback and unrelated barriers are covered. [Progress log](../log/2026-10-30-slack-04b1-validation-consumer.md).

Bounded acceptance only: no runtime wiring, safe rotating-token recovery, authorizations fanout, six-watermark processing, derived purge consumers, native Slack/Free/Pro/model acceptance or fullF4 closure. Flags remain off; no main merge.
