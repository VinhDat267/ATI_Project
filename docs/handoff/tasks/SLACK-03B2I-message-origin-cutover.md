# SLACK-03B2I - Message/memory/title origin cutover

Status: ACCEPTED on staging. PR #215 merge `7d00de3f`, published head `77c0c563`. Base `993d17ce`, after accepted PR214. Root implements directly in the same sole worktree/branch. [Parent03B2](SLACK-03B2-derived-lineage-and-purge.md), [M2](../SLACK-DELIVERY.md), [runtime plan](../../superpowers/plans/2026-10-31-slack-03b2i-message-origin-cutover.md).

Deliverable: actual message/memory and conversation-title writers atomically certify source-free remainder under an explicit cutover; actual HTTP/history/search/model hydration rejects unknown legacy and direct-SQL bypasses; deterministic bounded backfill classifies only evidence-backed artifacts and leaves ambiguous bytes quarantined. Existing source lineage/authority/TTL/CAS/physical purge remains mandatory for registered selectors. This is one end-to-end message lifecycle, not a detached certificate primitive.

Ownership: `apps/chat-api/`, next migration0025 `db/v3/`, this card/plan and one implementation log. No implementation delegation. Plan/step/audit/schedule origin certification follows as another complete lifecycle before public read. Do not claim full legacy or M2/F3/F4/native completion from this slice.

Acceptance:

- [x] Real message and first-user/scheduled-run/manual-title writers seal private owner/table/artifact/remainder proof in their actual transaction; missing cutover or registration failure rolls back publication.
- [x] Unknown unmarked legacy, new raw SQL bypass and payload/certificate substitution never reach actual HTTP/history/search/model; legitimate source-free chat still works.
- [x] Mixed-source registered memory preserves certified other-service remainder through invalidation and physical erasure; tampered unknown remainder is never resealed by purge.
- [x] Bounded deterministic backfill: dry-run default, explicit apply, evidence-only eligibility, idempotency, aggregate unresolved counts; ambiguous data unchanged and blocked. No native/production backfill run.
- [x] Real PostgreSQL locks/rollback/AbortSignal and native bootstrap fixture evidence; focused tests, frozen fullcheck and independent whole-branch review.
- [x] Exact published-head check/browser CI, identical merge tree and reviewer checkpoint.

## Kết quả

Frozen `62500f1b497db143c072c3cec615332fef362e27`: fullcheck3738PASS, exit0; typecheck/build/securityPASS. Origin27 and actual native bootstrap4 included; isolated HTTP/PG/AbortSignal/lease/physical purge and strict legacy-key backfill verified. Final independent whole29-file/call-path/fix reviewPASS; inherited106 backend tests and original P2 probePASS, plus fresh2/2 Chromium casesPASS,15.7s. [All REDs, fixture failures, fixes and scope](../log/2026-10-31-slack-03b2i-message-origin-cutover.md). Published head `77c0c563d65f51cbf0c487bb963a962ae5877340`: [CI 41195886792](https://github.com/VinhDat267/ATI_Project/actions/runs/41195886792) SUCCESS, `npm run check` and `npm run test:browser:v3` both SUCCESS, completed 2026-10-31T11:25:32Z. Merge `7d00de3f9994b6c9f8e524749ad141cc9502ca0a` at 2026-10-31T11:27:21Z; `git diff --exit-code` against that head exit 0. [Reviewer checkpoint](../log/2026-10-31-slack-03b2i-review-integration.md).

Maintenance command: `node --import tsx apps/chat-api/src/cli/slack-message-origin-backfill.ts` with explicitly selected DATABASE_URL; defaults to dry run, `--apply` writes only evidence-backed private manifest/origin proofs. Reports aggregate eligible/quarantined counts; ambiguous bytes remain blocked and unchanged. Executed only in isolated synthetic schemas; production/native data NOT_RUN.

Plan/step/audit/schedule origins and legacy approval/dispatch/run gates remain next before publicread03B3/03B4. H derived expiry remains accepted. No fullM2/F3/F4 or native Slack Free/Pro/two-user/model acceptance; live flags/main unchanged.


Browser fixture compatibility: raw-SQL saved-history RED reproduced in real Chromium;10 existing specs now use actual writers via one test helper, preserving assertions and technical timestamps/statuses. FE02 all4PASS. Product/backend unchanged. See implementation log for superseded CI and isolated fixture boundary.

Browser follow-up: local full-default 94PASS/2FAIL/1SKIP, both obsolete placeholder locators corrected then focused2PASS; schedule22PASS. Strict frontend unused-parameter diagnostic corrected without changing behavior/flags. That local full-default run is not claimed green.

Final browser evidence: FE02 all4PASS; local full-default 94PASS/2FAIL/1SKIP (not green), both corrected first-title locators focused2PASS; schedule22PASS; independent2browserPASS. Published-head CI then ran the complete browser suite and passed. No production compiler flag/guard changes.
