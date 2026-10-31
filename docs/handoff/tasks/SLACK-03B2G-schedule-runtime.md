# SLACK-03B2G - Schedule source lifecycle runtime

Status: CODE_COMPLETE / REVIEW_PASS; staging publication pending. Base `83c61de3196663718cdc172a939911052b6a5c03`, after acceptedPR212. Same one Orca worktree/branch; root implements directly. [Parent03B2](SLACK-03B2-derived-lineage-and-purge.md), [deliveryM2](../SLACK-DELIVERY.md), [runtime plan](../../superpowers/plans/2026-10-31-slack-03b2g-schedule-runtime.md).

Deliverable: actual source-history proposal -> confirmation and schedule/state registration -> guarded schedule/manual or due run -> transactional title/run message/plan provenance -> invalidation/read masking/physical erasure. No detached primitive or public Slack dispatch. Preserve approved per-run approval, limits, missed-run and version semantics.

Owner: backend `apps/chat-api/`, actual next migration0023 in `db/v3/`, card/plan and one implementation log. No implementation delegation. Sources come from private server context only; all source keys precede parent locks. Changed copy snapshots fail closed without acquiring late source keys. Selected schedule fields erased; service IDs and other owners survive. Manual title replacement retires old lineage with a fingerprint certificate; stale intents cannot erase authenticated replacement or certify an unregistered resurrection.

Acceptance:

- [x] Real chat proposal/confirm/update/state writers register all source-bearing fields atomically, with rollback/version/owner tests.
- [x] Actual schedule/run/title HTTP/history/planner readers guard current source versions, fingerprints, policy, barriers and retention; legacy uncovered source data fails closed.
- [x] Scheduled and manual runs check source before model and result persistence; revoke during real async work cannot publish stale plans/titles/messages or run again from a purged schedule.
- [x] Fenced native consumer physically erases schedule name/request/recurrence, registered run error/title; pauses active schedule and bumps version, preserves terminal status/services and independent owners.
- [x] Real PostgreSQL/HTTP/AbortSignal RED->GREEN; fullcheck3696PASS; independent whole-branch audit/final exact-head verification PASS,28/28 focused.
- [ ] Exact published-head check/browser CI, staging merge/tree comparison and reviewer checkpoint.

Full legacy backfill/derived TTL cascade and public read03B3/03B4 remain separate gates. No fullM2/F3/F4 or native Slack acceptance; future06 kinds unsupported. Main/live flags unchanged.

## Kết quả

Code and fixture flow verified at frozen `3485e8cc019097818f30369646cb4328ffa4d678`: fullcheck3696PASS, exit0, typecheck/build/securityPASS. Real source schedule suite15 plus native bootstrap and lock-order evidence, independent review findings/fixes and original failed runs are recorded in the [implementation log](../log/2026-10-31-slack-03b2g-schedule-runtime.md). Independent whole-branch review/final exact-head verification PASS,28/28 tests, no remaining P1/P2/P3; all findings reproduced and fixed. Staging publication gate remains pending. No native Slack or fullM2/F3/F4 acceptance.
