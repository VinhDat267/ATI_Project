# SLACK-03B2H - Independent derived expiry cascade

Status: IN_PROGRESS. Base `9dd97e7efe25d840e3e70d9b84caf882f39f4fd7`, after acceptedPR213. Root directly implements in the same sole Orca worktree/branch. [Parent03B2](SLACK-03B2-derived-lineage-and-purge.md), [deliveryM2](../SLACK-DELIVERY.md), [runtime plan](../../superpowers/plans/2026-10-31-slack-03b2h-derived-expiry-runtime.md).

Deliverable: expired persisted derived segment -> durable exact expiry proof/intent -> existing fenced core consumers -> physical erasure through actual native server, even when raw source is already gone and Slack configuration/flags are absent. Cover all five actual core kinds and their actual message/memory/plan/step/audit/schedule/title surfaces. No isolated expiry primitive.

Owner: backend `apps/chat-api/`, actual next migration0024 in `db/v3/`, card/plan and one implementation log. No implementation agents. Preserve source-event barrier proof, lease/cutoff/CAS, current consent guards and approved retention semantics. Expiring an old capture must not globally delete/revoke a healthy source, new acquisition or another owner.

Acceptance:

- [ ] Actual native bootstrap stages/erases expired registered core artifacts without raw source, Slack network/config or business flags.
- [ ] Bounded idempotent expiry staging validates exact persisted copy/version/segment/time metadata; immutable proof and queue intents commit together.
- [ ] Time-only intents require their durable expiry proof and DB clock. Existing source-event intents still require exact active source barriers; a prefix/payload cannot bypass proof.
- [ ] Consumer selection/physical CAS erases only expired segments at immutable cutoff; fresh same-reference/revision/policy acquisition and other owner survive. Mixed-source output expires when any segment expires.
- [ ] Real PostgreSQL/AbortSignal cancellation, rollback, expired lease reclaim, malformed/stale proof and fingerprint mismatch fail closed; no untruthful completion or current-authorization dependency for erasure.
- [ ] Focused tests, freeze/fullcheck, independent read-only whole-branch review, exact published-head check/browser CI, merge-tree and reviewer checkpoint.

Explicit cutover/source-free writer certification and full legacy backfill/fail-closed gates remain next, before publicread03B3/03B4. Future06 proposal/digest kinds remain unsupported; no fullM2/F3/F4/native Slack acceptance. Main/live flags unchanged.

## Kết quả

Implementation in progress; no acceptance claim.
