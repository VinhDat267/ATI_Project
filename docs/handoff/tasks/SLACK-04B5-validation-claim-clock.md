# SLACK-04B5 · Validation claims use the database clock

Base accepted M3 staging `ef63950b8c45b494ca5c2369b65b1bfaafe05490`; branch `fix/slack-lifecycle-claim-clock`. One Backend corrective card discovered while verifying documentation PR #234. Main/user work remains isolated. No flag/native/live change.

## Evidence and contract

Documentation CI41313243051 attempt1 failed the existing contradictory-principal assertion after40ms. Initial500ms timeout hypothesis was ruled out by that duration. Original isolated23/23 passed; an ignored observer rerun reproduced the identical assertion plus other failures with actual SQL jobs still pending, validation_attempts0. Claim currently compares PostgreSQL microsecond due/lease timestamps only with the JavaScript caller Date. Existing repo fixture explicitly backdates due rows to avoid this edge, but the real worker does not. A due job can be skipped when the caller clock is behind PostgreSQL.

Use one statement-time SQL cutoff equal to the later of the validated caller Date and PostgreSQL clock_timestamp. Use that same cutoff for due and expired-lease eligibility. Keep SKIP LOCKED, status/intent filters, bounds, distinct lease ownership, lease duration and completion/retry fencing. Explicit future clocks used by existing tests retain their semantics. No sleep/retry or timeout/assertion relaxation in original tests.

## Files and verification

Own apps/chat-api/src/db/repositories/slack-lifecycle-validation-repo.ts, apps/chat-api/tests/db/slack-lifecycle-validation-repo.test.ts, apps/chat-api/tests/services/slack/slack-lifecycle-runtime.test.ts, this card and a new implementation log. The runtime test observes actual holder→worker blocking through pg_blocking_pids, independent of the SQL query prefix. Add deterministic actual-PG cases: due timestamp one microsecond after a stale caller cutoff but before DB now; expired lease in that same gap with stale-owner retry denied; genuinely future due remains unclaimed. Watch first two fail before implementation. Run repo+unchanged worker suites, final fullcheck/typecheck/build/security and relevant existing browser. One fresh whole-branch review, one TDD fix pass if Important; exact-head check/all-browser CI and merge-tree equality before staging acceptance. Reviewer then resumes canonical M3 record.

Review focus: single SQL cutoff does not pull truly future jobs or steal a live lease; old owner stays fenced; caller Date validation/future-clock tests retain behavior; no test helper workaround hides the defect.

## Kết quả

Deterministic actual-PG RED2FAIL/7PASS exit1 → GREEN repo+unchanged worker32/32PASS exit0. One SQL cutoff fixes due/expired-lease eligibility, with genuine future due and stale-owner fencing retained. Fullcheck/browser/review/exact-head CI pending; see [implementation log](../log/2026-11-01-slack-04b5-validation-claim-clock.md). Original docs CI failure and canceled obsolete rerun remain evidence, not acceptance.
