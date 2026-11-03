# Message/memory/title origin cutover implementation plan

Execution: root directly with executing-plans and test-driven-development; one independent read-only whole-branch reviewer after freeze. User already authorized routine integration gates. Base993d17ce. [Card](../../handoff/tasks/SLACK-03B2I-message-origin-cutover.md), [approved Slack design](../specs/2026-10-28-slack-personal-oauth-design.md), [parent03B2 sections5/7](../../handoff/tasks/SLACK-03B2-derived-lineage-and-purge.md).

Goal: certify actual new writer origin and source-free remainder, deny unknown legacy at actual message/title consumption, and backfill only deterministically proven rows without changing their bytes.

Architecture: private explicit cutover marker plus DB origin record bound to owner, table, artifact, conversation, role, selector manifest and canonical remainder fingerprint. Registered source selectors are normalized by the actual eraser before hashing; their existing source-copy/policy/barrier/TTL guards remain separate and mandatory. No default/trigger, client/model attestation, public provenance JSON or inference from missing copies/role/timestamp.

Ruling: scope I to the complete message/memory/title lifecycle; plan/step/audit/schedule origin gates follow next. These are separately testable actual consumers, not primitive-only PRs. Public read remains gated until all core origin surfaces are covered. Cost of a missed downstream origin gate: M2 cannot be accepted; the matrix must retain that open requirement.

1. [x] Real-PG regressions first in `tests/integration/slack-message-origin-runtime.test.ts`: plain unmarked legacy leaks through HTTP/model, copied/mutated certificate, actual new source-free writer and missing cutover rollback. Observe intended RED before production changes.
2. [x] Add repeatable0025 marker/origin schema and focused private `services/slack/slack-message-origin.ts`. Seal from actual locked DB payload in actual writer transaction, bind exact manifest and remainder. Require explicit marker at seal/read. No SQL bypass auto-certification.
3. [x] Wire MessageRepo (own transaction for pool; SAVEPOINT verifies held caller transaction), all source writer paths and first-user-title fallback. Wire ConversationRepo create/rename and ScheduleRunner title registration. Source-run user-role seed registers title if it actually fills a NULL title. Audit all message/title SQL writers.
4. [x] Route every actual message read through locked origin guard, including no Slack marker/copy. Conversation title/history/search use origin plus existing schedule source guard. Unknown remainder masks whole artifact; blocked registered source selectors still redact individually while retaining certified other-service fields. Physical purge changes no certified remainder and never launders unknown data.
5. [x] Add bounded cursor backfill with default dry run and explicit apply CLI, aggregate counts only. Eligible legacy requires exact registered selectors/fingerprints covering all nonconstant payload, or existing authenticated manual-title fingerprint. Unknown plain user/assistant/memory text is quarantined, not guessed. No production/native application.
6. [x] Prove actual HTTP/model/native bootstrap, source invalidation->physical erasure, mixed remainder, cutover loss, transaction rollback and concurrent writer ordering. Focused tests per change. Adapt historical raw-SQL compatibility fixtures to use their real trusted writer, retaining explicit unknown-legacy assertions.
7. [x] Freeze base/product/tests; fullcheck then independent whole-branch review, necessary RED->GREEN fixes. Card/log results, exact published-head CI check/browser, merge/tree comparison and reviewer checkpoint. No repeated fullcheck without change/failure/concern.

Review focus: absent manifest/copy is never source-free proof; certificates cannot move across owner/table/id/conversation or survive remainder mutation; source-copy-only changes cannot skip origin; first title/internal user seed has real provenance; purge preserves certified mixed remainder but cannot certify unknown remainder; unknown legacy is never model history/memory; marker removal fails closed; backfill is bounded, idempotent and preserves ambiguous bytes.


Frozen e8349895: fullcheck3738PASS, exit0; typecheck/build/securityPASS. [Failures and evidence](../../handoff/log/2026-10-31-slack-03b2i-message-origin-cutover.md). Earlier independent review's one dictionary-key P2 reproduced3RED and fixed; revised origin27PASS. Incidental fields separately bound; physical reseal requires a fully valid prior origin. Final independent whole-branch/fix reviewPASS,106/106 fresh tests and original P2 probePASS. Exact published-head check/browser CI/merge-tree pending.


Browser fixture follow-up: actual FE02 RED from raw SQL seeds, then4/4PASS after actual-writer conversion across10 existing specs/shared helper. Source/backend unchanged; branch audit now29files. Freeze browser fixtures, run broader browser and exact-headCI; retain existing local/database guards and assertions.

Browser validation: FE02 4PASS; default94PASS/2FAIL/1SKIP, two first-title locator fixes focused2PASS; schedule22PASS. Minimal unused parameter rename resolves strict frontend compiler after actual writer imports. Final re-freeze/fullcheck/review binding before exact-headCI.

Final combined freeze62500f1b: rootfullcheck3738PASS, typecheck/build/securityPASS; independentwhole29filereviewPASS,2freshChromiumPASS15.7s, inheriting106backend/P2probe on runtime-identical product. Full-default localfailed thenfocused2PASS remains separately scoped, not a green combinedrun.

Accepted PR215 at published 77c0c563, CI41195886792 check and browser SUCCESS; merge 7d00de3f at 2026-10-31T11:27:21Z, identical tree diff 0. [Reviewer checkpoint](../../handoff/log/2026-10-31-slack-03b2i-review-integration.md). Plan/step/audit/schedule origin gates remain next; public read stays pending.
