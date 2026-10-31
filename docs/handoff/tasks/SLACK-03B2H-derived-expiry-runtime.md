# SLACK-03B2H - Independent derived expiry cascade

Status: CODE_COMPLETE / REVIEW_PASS; staging publication pending. Base `9dd97e7efe25d840e3e70d9b84caf882f39f4fd7`, after acceptedPR213. Root directly implements in the same sole Orca worktree/branch. [Parent03B2](SLACK-03B2-derived-lineage-and-purge.md), [deliveryM2](../SLACK-DELIVERY.md), [runtime plan](../../superpowers/plans/2026-10-31-slack-03b2h-derived-expiry-runtime.md).

Deliverable: expired persisted derived segment -> durable exact expiry proof/intent -> existing fenced core consumers -> physical erasure through actual native server, even when raw source is already gone and Slack configuration/flags are absent. Cover all five actual core kinds and their actual message/memory/plan/step/audit/schedule/title surfaces. No isolated expiry primitive.

Owner: backend `apps/chat-api/`, actual next migration0024 in `db/v3/`, card/plan and one implementation log. No implementation agents. Preserve source-event barrier proof, lease/cutoff/CAS, current consent guards and approved retention semantics. Expiring an old capture must not globally delete/revoke a healthy source, new acquisition or another owner.

Acceptance:

- [x] Actual native bootstrap stages/erases expired registered core artifacts without raw source, Slack network/config or business flags.
- [x] Bounded idempotent expiry staging validates exact persisted copy/version/segment/time metadata; immutable proof and queue intents commit together.
- [x] Time-only intents require their durable expiry proof and DB clock. Existing source-event intents still require exact active source barriers; a prefix/payload cannot bypass proof.
- [x] Consumer selection/physical CAS erases only expired segments at immutable cutoff; fresh same-reference/revision/policy acquisition and other owner survive. Mixed-source output expires when any segment expires.
- [x] Real PostgreSQL/AbortSignal cancellation, rollback, expired lease reclaim, malformed/stale proof and fingerprint mismatch fail closed; no untruthful completion or current-authorization dependency for erasure.
- [x] Focused/frozen fullcheck3710PASS; independent whole-branch/final fix reviewPASS,82/82 fresh focused tests.
- [ ] Exact published-head check/browser CI, merge-tree and reviewer checkpoint.

Explicit cutover/source-free writer certification and full legacy backfill/fail-closed gates remain next, before publicread03B3/03B4. Future06 proposal/digest kinds remain unsupported; no fullM2/F3/F4/native Slack acceptance. Main/live flags unchanged.

## Kết quả

Code and fixture flow verified at frozen `9074bce1cb592dbd562b73a438ae58332067b9a3`: fullcheck3710PASS, exit0, typecheck/build/securityPASS. Actual source expiry13/native3 focused tests cover real raw-store removal, healthy equal-reference acquisition, unknown lineage, proof/cutoff tamper, mixed capture, AbortSignal and lease rollback. [Original failures, review P2 and fixes](../log/2026-10-31-slack-03b2h-derived-expiry-runtime.md). Independent whole-branch/final exact-head fix verification PASS,82/82 tests, no remaining P1/P2/P3. Staging publication gate pending; no fullM2/F3/F4/native Slack acceptance.
