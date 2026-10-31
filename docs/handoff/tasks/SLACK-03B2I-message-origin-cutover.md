# SLACK-03B2I - Message/memory/title origin cutover

Status: CODE_COMPLETE; independent final review/publication pending. Base `993d17ce`, after accepted PR214. Root implements directly in the same sole worktree/branch. [Parent03B2](SLACK-03B2-derived-lineage-and-purge.md), [M2](../SLACK-DELIVERY.md), [runtime plan](../../superpowers/plans/2026-10-31-slack-03b2i-message-origin-cutover.md).

Deliverable: actual message/memory and conversation-title writers atomically certify source-free remainder under an explicit cutover; actual HTTP/history/search/model hydration rejects unknown legacy and direct-SQL bypasses; deterministic bounded backfill classifies only evidence-backed artifacts and leaves ambiguous bytes quarantined. Existing source lineage/authority/TTL/CAS/physical purge remains mandatory for registered selectors. This is one end-to-end message lifecycle, not a detached certificate primitive.

Ownership: `apps/chat-api/`, next migration0025 `db/v3/`, this card/plan and one implementation log. No implementation delegation. Plan/step/audit/schedule origin certification follows as another complete lifecycle before public read. Do not claim full legacy or M2/F3/F4/native completion from this slice.

Acceptance:

- [x] Real message and first-user/scheduled-run/manual-title writers seal private owner/table/artifact/remainder proof in their actual transaction; missing cutover or registration failure rolls back publication.
- [x] Unknown unmarked legacy, new raw SQL bypass and payload/certificate substitution never reach actual HTTP/history/search/model; legitimate source-free chat still works.
- [x] Mixed-source registered memory preserves certified other-service remainder through invalidation and physical erasure; tampered unknown remainder is never resealed by purge.
- [x] Bounded deterministic backfill: dry-run default, explicit apply, evidence-only eligibility, idempotency, aggregate unresolved counts; ambiguous data unchanged and blocked. No native/production backfill run.
- [ ] Real PostgreSQL locks/rollback/AbortSignal and native bootstrap fixture evidence; focused tests, frozen fullcheck and independent whole-branch review.
- [ ] Exact published-head check/browser CI, identical merge tree and reviewer checkpoint.

## Kết quả

Prior freeze `eb18241fdc3fe19a4fc59cffa7c79a36ed5541d1`: fullcheck3735PASS, exit0; typecheck/build/securityPASS. That run included24 origin regressions covering real SQL/HTTP/model/CLI/lock/AbortSignal/lease/remainder; actual native bootstrap4 tests run in fullcheck with flags/config absent. [Original REDs, fixture failures and fixes](../log/2026-10-31-slack-03b2i-message-origin-cutover.md). Independent review found one P2 in legacy dictionary-key eligibility after103/103 focusedPASS; root reproduced3RED and tightened remaining-state eligibility. Revised origin27/27PASS, exit0,14.69s. Revised frozen fullcheck/final review and exact-head publication remain pending.

Maintenance command: `node --import tsx apps/chat-api/src/cli/slack-message-origin-backfill.ts` with explicitly selected DATABASE_URL; defaults to dry run, `--apply` writes only evidence-backed private manifest/origin proofs. Reports aggregate eligible/quarantined counts; ambiguous bytes remain blocked and unchanged. Executed only in isolated synthetic schemas; production/native data NOT_RUN.

Plan/step/audit/schedule origins and legacy approval/dispatch/run gates remain next before publicread03B3/03B4. H derived expiry remains accepted. No fullM2/F3/F4 or native Slack Free/Pro/two-user/model acceptance; live flags/main unchanged.
