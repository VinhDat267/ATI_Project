# SLACK-03B2I message/memory/title origin cutover

Base993d17ce, after accepted PR214. Root directly implements in the same sole Orca worktree/branch. [Card](../tasks/SLACK-03B2I-message-origin-cutover.md), [plan](../../superpowers/plans/2026-10-31-slack-03b2i-message-origin-cutover.md).

Ruling: complete message/memory/title writer -> origin/read guard -> deterministic backfill/quarantine -> compatible physical purge in I, then the plan/step/audit/schedule lifecycle. No public read until every core gate is safe. No source-free inference from absent copies, role=user, Git history or timestamps. Private source-free remainder proof does not replace source policy/barrier/TTL checks.

Ruling: preserve ambiguous legacy bytes and block consumption; backfill only authenticated/manual or fully registered exact coverage. Database defaults/triggers cannot certify arbitrary direct SQL. No native/production migration/backfill or Slack/model acceptance claim.

Dedicated synthetic PostgreSQL16 at127.0.0.1:55439/ati_v3, random test schemas, explicit fixture DATABASE_URL; no live .env. Main/user changes and business flags untouched. TDD outputs follow.


TDD: two real SQL/HTTP regressions RED at the actual response: unmarked legacy answer/memory/title and direct SQL written after a trusted writer were returned. Source-free chat baseline PASS. Actual private cutover/origin schema0025 and writer/read wiring brought origin+message/memory23/23PASS. Extended origin guards8/8PASS, source/memory/schedule integration48/48PASS, typecheckPASS.

Origin proof binds owner/table/id/conversation/role, exact selector manifest and canonical source-free remainder. No default/trigger or client/model attestation. Every message read checks it, even without marker/copy. Actual first-title, authenticated rename and scheduled-title writers seal in their own transaction; held clients require a SAVEPOINT before any write. Registered source selectors retain original policy/barrier/version/TTL guards. Purge never reseals a tampered remainder; certified other-service memory survives physical source removal.

Maintenance: default dry-run bounded cursor pages, explicit apply CLI, aggregate counts only. Backfill accepts exact fully source-covered artifact selectors/fingerprints or prior authenticated manual-title fingerprint. It can reconstruct a missing private manifest from exact active copy evidence. Partial mixed legacy, unknown plain human/machine text, stale fingerprints and invalid existing certificates stay quarantined; their bytes remain. No native/production application. Actual CLI child dry-run/apply verified against the synthetic private schema.

Fixture failures recorded: PostgreSQL had stopped exit0 during the session interruption (ECONNREFUSED before tests); restarted the same dedicated container, no live fallback. Initial native HTTP test used legacy generateTokens without a session and correctly received401; fixture now uses actual generateAccessToken/session. History compatibility test wrote titles via SQL and became correctly unsearchable; fixture now uses actual authenticated rename and only SQL-writes technical timestamps. Policy fixture explicitly uses synthetic provider TEST_ENV. No production guard/timeout/lease/barrier relaxed.

Native/history/origin28/28PASS, exit0,46.90s, before the last three regressions. Independent guard-omission mutation makes the actual bootstrap HTTP regression fail with the old private payload (exit1); exact source restored in finally and SHA256 verified. Real SQL trigger pg_sleep tests abort only after the certificate INSERT is visibly waiting: message/artifact/copies and backfill certificate roll back. Internal user-role run seed with NULL title registers title lineage and survives actual guard before native consumer erasure.

Final input-lock regression observedRED: metadata mutated after initial validation while actual writer waited on a parent row lock. Source-free writer now clones input before its first await; restored origin suite19/19PASS, exit0,10.90s. Source-free race, competing first-title writers, changed/copied certificates, actual CLI, cancellation and physical mixed-memory purge covered. Typecheck previouslyPASS; frozen fullcheck/review/publication follow.

Scope limit: plan/step/audit/schedule origin certification and their legacy execution gates remain the next complete lifecycle; no global source-free/M2/F3/F4 claim. Existing scheduler origin classification still needs that follow-up before public reads or enabling product flags. This slice's proof attests the reviewed message/title producer transaction and remainder, and never grants policy access to a registered Slack selector.
