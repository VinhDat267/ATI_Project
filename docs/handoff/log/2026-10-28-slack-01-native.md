# 28/10/2026 · SLACK-01 Native execution

**Card:** [SLACK-01](../tasks/SLACK-01-foundation.md) · **Plan:** [foundation](../../superpowers/plans/2026-10-28-slack-foundation.md).
**Branch:** `feat/slack-01-foundation` · **Base:** `2bf87b747672f207937397f2ba9186fcb97373af`.
**Authorization:** user chose `Native` after reviewing the concrete five-task plan. Execution remains limited to this card; no merge or live enable is inferred.

## Delivered

- `myslack-context.ts`: complete actor/connection/workspace/user/generation identity, clean validation projection and source reference contract.
- `myslack-policy.ts`: pure fail-closed model-use decision with ordered blockers for identity, consent, policy version, verified no-training provider and finite retention caps. Real consumer enforcement is future SLACK-02–06 work, not claimed here.
- Inventory collector/parser/verifier plus dated 343-row metadata snapshot and reading guide. Two concurrent public-doc requests, bounded retry/timeout, no Slack credentials; source hashes and decisions retained.
- Stateful HTTP fixture for five methods, synthetic credentials, scoped resources, cursor binding, Unicode and after-commit delays. It implements neither OAuth nor database locking.
- Loopback-only fixture probe: exact actors, paginated coverage, private-source isolation, read-only failure with no side effect, correlated thread readback and UNKNOWN without write retry. Reports only check metadata with `verifiedLive:false`.
- Root check keeps every original command and adds the three Node test files; foundation command runs Node and schema checks. Catalog/service registration and runtime routes are unchanged.

## Evidence before independent review

| Command/check | Actual outcome |
|---|---|
| Baseline `npm test -w @wap/tool-schemas` | 10 files / 67 tests, exit 0 |
| Task 1 RED → GREEN | Missing functions: 7 failed / 19 passed; implemented: 26 passed, exit 0 |
| Task 2 RED → GREEN | Missing decision function; implemented: 23 passed, exit 0 |
| Inventory Node tests | Missing module RED; inline malformed scopes reproduced and fixed; final 13 passed |
| Inventory CLI verify | 343 rows exactly match frozen index; candidate 0 / excluded 97 / probe_required 246; exit 0 |
| Inventory mutations | omitted, duplicate, unreviewed, source_changed: each rejected with exit 1; original snapshot retained |
| Checked-in snapshot CI guard | Physically omitted one row: RED exit 1; original bytes restored in finally; consumer GREEN |
| HTTP fixture | Missing module RED; split UTF-8 reproduced as replacement characters, fixed by decoding complete bytes; final 11 tests passed |
| Probe | Missing module RED; malformed missing_scope without ok:false incorrectly passed, reproduced then fixed; final 13 tests passed |
| `npm run test:slack:foundation` | 37 Node + 49 schema = 86 tests, exit 0 |
| `node scripts/slack/contract-probe.mjs --fixture` | 11/11 checks pass, mode fixture, verifiedLive false |
| `npm run typecheck:v3` | exit 0 |
| `npm run check` after final code change | 2,558 v3 + 406 evaluation fixture + 48 Node tests; typecheck, web build and build security check pass; exit 0 |

The first PowerShell check attempt stopped at Node's optional `.env` warning because Stop turned native stderr into NativeCommandError; that attempt is not counted as a passing suite. The native exit was captured using Git Bash without changing assertions. A later full run after the malformed-response regression fix also exited 0; final counts above refer to that tree.

The PostgreSQL container was created for this execution under Docker Compose project `ati-slack01-2bf87b7`, at the standard dedicated local test port 55533. It had no pre-existing container or data at creation; migrations 0001–0013 were applied. No existing user's DB container or checkout was reused or reset.

Inventory review is deliberately bounded: 92 explicit Enterprise-only exclusions, three deprecated/retired/non-functional methods and two app-level infrastructure methods. There are 254 explicit user-scope declarations and 89 undetermined declarations. Side effect/risk is annotated for 72 straightforward descriptions; 271 remain undetermined. Every native entitlement/role/behavior probe remains open where unverified; these are not 343 implemented tools.

## Rulings

1. Run `npm run check` through Git Bash because PowerShell Stop misclassifies optional-.env stderr. Commands/assertions are unchanged; possible cost is shell exit-handling differences, mitigated by capturing the native exit explicitly.
2. Add a real checked-in snapshot consumer test in the earlier inventory test file, so CI verifies the actual artifact, not only synthetic examples. Omitted-row mutation demonstrated the guard; intentional snapshot updates must keep index coverage coherent.

## Independent review and one fix pass (29/10)

Fresh `gpt-6-astra` review covered `2bf87b74..99bd3866`. It independently passed 37 Node +49 schema tests, verified all 343 cached source hashes against the snapshot, and found no runtime registration/routes/flags. Verdict at that head: not ready, one Important; no Critical.

Important: a real HTTP relay cleared history `next_cursor` while retaining `has_more:true`; all 11 probe checks still passed. Two new HTTP regressions also cover a relay that falsely marks completion. Both failed before the fix (`pass !== fail`, exit 1). The probe now rejects contradictory continuation metadata and requires every known Free seed exactly once. Probe tests then passed 15/15, exit 0. No second independent review was dispatched; the Native fix pass uses RED→GREEN and full-suite verification.

Minor (deferred): the review read the final pre-fix Node batch as 47 versus the aggregate 48 in this log. Inspection of that same full log confirms launcher 1 at lines 134–136 plus final batch 47 at lines 189–191. Historical aggregate wording is retained; post-fix results are recorded separately below.

The review explicitly set aside the following behaviors. Each is a scope ruling, not acceptance of future runtime behavior:

3. Real consent/provider enforcement in API/planner/manual/rule/scheduler is deferred to SLACK-02–06: this branch exports a pure contract and registers no personal Slack runtime. Cost if wrong: a future consumer could bypass authorization unless its own integration gate is tested.
4. OAuth, token rotation, callback CAS, refresh and disconnect PostgreSQL are deferred to SLACK-02: users cannot connect personal Slack with this foundation alone. Cost if wrong: future stale-token or concurrency defects would remain undiscovered by fixture tests.
5. Source ACL, tombstone/purge/history/memory and revocation races are deferred to SLACK-03–04: this branch stores no native Slack source data. Cost if wrong: future ingestion could retain or expose revoked sources without separate real-store acceptance.
6. Signed ingress, authorization fanout, echo/outbox and lifecycle while automation is paused are deferred to SLACK-04: no ingress is installed or enabled here. Cost if wrong: later events could be misattributed, duplicated or missed unless ingress acceptance is completed.
7. Three modes, budgets/backlog, Inbox and UI/browser acceptance are deferred to SLACK-05–06: no user-facing personal Slack workflow is advertised by this card. Cost if wrong: users would lack the promised assistant workflow until those cards are delivered.
8. Native eligibility, Free/Pro roles/quotas and 246 probe_required methods remain unverified backlog; inventory metadata is not supported capability. Cost if wrong: promoting a row without native evidence could promise an unavailable operation.
9. Live Slack readback, actual model evaluation and feature enable remain NOT_RUN under SLACK-07: fixture reports verifiedLive:false and no live flag changes occur. Cost if wrong: enabling early would expose untested provider/model behavior.
10. Fixture fidelity is intentionally limited to five methods and fixed seeds, not all provider details; fixed seed coverage belongs in its probe and the missing-page Important is fixed in this pass. Cost if wrong: later consumers could assume native parity that synthetic HTTP evidence cannot establish.


## Remaining gates

- Post-fix foundation: 39 Node +49 schema =88, exit 0. Probe CLI: 11/11 checks, verifiedLive false.
- Post-fix full `npm run check`: 116+443+381+42+693+883 =2,558 workspace tests; 406 evaluation fixture tests; launcher 1/1 plus final Node batch 49/49. Typecheck, production build and build-security check pass; native exit 0.
- The final full-check raw log SHA256 before temporary scratch cleanup: `F6BE6C9D1DF6F3F4259B41D21FC0CBFF064B2272956D85C4F3DD4F1771C59ED6`. Summary lines were inspected directly (workspace lines23–88; eval101; launcher134–136; Node191–193).
- Whole-branch fresh-context review: completed at `99bd3866`; Important fixed with two HTTP regressions RED→GREEN and the passing whole suite. Owner review remains required before integration.
- Exact-head remote CI/integration: pending; no merge requested or performed.
- UI browser checks, actual model evaluation, OAuth/native Slack actions and live enable: **NOT_RUN** and not claimed by fixture evidence.
- SLACK-02–07 remain open; specifically there is no connect button, actual user token acquisition, event ingress, three-mode worker or Inbox yet.

Only this card's files are committed. Main checkout's seven unrelated changes and four existing untracked PR #180 review logs are preserved. CURRENT-STATE and ROADMAP are not edited. Full execution scratch/RED logs are temporary; these verified results and Git history are the durable handoff.
