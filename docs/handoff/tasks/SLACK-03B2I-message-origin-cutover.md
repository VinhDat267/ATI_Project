# SLACK-03B2I - Message/memory/title origin cutover

Status: IN_PROGRESS. Base `993d17ce`, after accepted PR214. Root implements directly in the same sole worktree/branch. [Parent03B2](SLACK-03B2-derived-lineage-and-purge.md), [M2](../SLACK-DELIVERY.md), [runtime plan](../../superpowers/plans/2026-10-31-slack-03b2i-message-origin-cutover.md).

Deliverable: actual message/memory and conversation-title writers atomically certify source-free remainder under an explicit cutover; actual HTTP/history/search/model hydration rejects unknown legacy and direct-SQL bypasses; deterministic bounded backfill classifies only evidence-backed artifacts and leaves ambiguous bytes quarantined. Existing source lineage/authority/TTL/CAS/physical purge remains mandatory for registered selectors. This is one end-to-end message lifecycle, not a detached certificate primitive.

Ownership: `apps/chat-api/`, next migration0025 `db/v3/`, this card/plan and one implementation log. No implementation delegation. Plan/step/audit/schedule origin certification follows as another complete lifecycle before public read. Do not claim full legacy or M2/F3/F4/native completion from this slice.

Acceptance:

- [ ] Real message and first-user/scheduled-run/manual-title writers seal private owner/table/artifact/remainder proof in their actual transaction; missing cutover or registration failure rolls back publication.
- [ ] Unknown unmarked legacy, new raw SQL bypass and payload/certificate substitution never reach actual HTTP/history/search/model; legitimate source-free chat still works.
- [ ] Mixed-source registered memory preserves certified other-service remainder through invalidation and physical erasure; tampered unknown remainder is never resealed by purge.
- [ ] Bounded deterministic backfill: dry-run default, explicit apply, evidence-only eligibility, idempotency, aggregate unresolved counts; ambiguous data unchanged and blocked. No native/production backfill run.
- [ ] Real PostgreSQL locks/rollback/AbortSignal and native bootstrap fixture evidence; focused tests, frozen fullcheck and independent whole-branch review.
- [ ] Exact published-head check/browser CI, identical merge tree and reviewer checkpoint.

## Kết quả

Pending implementation and actual commands. H accepted independent derived TTL; this card does not reopen or replace it. No Slack native credentials/model acceptance; live flags/main remain unchanged.
