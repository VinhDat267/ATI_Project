# SLACK-04B3 · authorization fanout and six-watermark runtime

01/11/2026. Card:[04B3](../tasks/SLACK-04B3-authorization-fanout.md). Base`ec81ebb3`, branch`feat/slack-04b3-authorization-lifecycle`, native managed worktree615f. Only this Backend card is implemented; main Trello checkout and priorM2worktrees/audit are untouched. M3 as a whole remains open.

## Delivered path
Real signed ingress→body-free durable receipt→leased worker→every page of private app-level authorizations→exact app/workspace/actor/ATI owner/generation mapping→one metadata triage intent per eligible binding. A sender is never assumed to own the event. Missing context, bot/enterprise/foreign installations, malformed/partial pages and unsupported events cannot create guessed work. No message body/content/model/write processing is added.

Migration0028 adds fanout lease/retry fields, disabled server-owned processing controls, a runtime start/gap epoch and private unique metadata jobs. It also adds SQL-precision effective timestamps for actual identity/consent/provider writes, separate from backdatable evidence dates. Consumption compares immutable source time against all six watermark categories in PostgreSQL, takes owner/invalidation/authority locks and finishes jobs plus lease CAS in one transaction. Native startup/re-enable starts a fresh epoch rather than replaying backlog. SQL fences cancel old pending metadata jobs on captured-binding/owner/control/runtime changes. Future05 still must recheck current source/policy before content/model work.

The server starts/stops a supervised coalesced fanout worker using the existing tested runner. App token is private env/header only. Native destination is pinned; sandbox requires literal HTTP loopback. Flags-off ordinary work is discarded while the accepted independent lifecycle/purge supervisors remain active. No default/live flag was enabled.

## TDD and independent review
Baseline ingress/validation/token43PASS. Resolver, repo, runtime and native bootstrap tests were written before implementation and failed for missing modules/runtime wiring, then passed. Cancellation tests exposed five behaviors first: disabled runtime still claimed receipts; disconnect/reconnect/inactive owner/runtime-off left pending jobs. SQL fences and runtime claim gate fixed them. The pre-review focused suite77/77passed; reviewer independently ran HTTP11 and repo/runtime/native27, typecheck and actual private-PG adversarial probes.

Reviewer found threeP2:
1. Real consent writer created a millisecond Date before waiting for a provider lock; a receipt recorded while consent was revoked could be backfilled after regrant. Provider attestation had a similar transaction-start timestamp issue.
2. Connection app changed while waiting for FOR SHARE; final job eligibility omitted the app check.
3. Reassignment cancellation selected NEW owner, missing the old captured-owner job and owner-only mutations.

One fix pass added permanent real-writer/pg_blocking_pids regressions. Five initial behavior failures were observed; the consent-wait fixture initially omitted expectedRevision and failed at CAS instead. After correcting that fixture, temporarily removing only the new consent-effective predicate reproduced jobs1/expected0 (exit1); restoring it made the regression pass. No mutation remains. SQL post-lock authority-write stamps, final full mapping and captured-binding cancellation address all three findings. Final focused suite **83/83**, exit0, includes original lifecycle tests. Reviewer did not re-review the fixes; root verified reproduced failures and final commands.

## Verification
- Typecheck passed before fullcheck. Actual native bootstrap test passes shared2jobs via2HTTPpages, DM1job, no persisted message sentinel and flags-off no-fanout behavior. Windows child termination proves bootstrap behavior, not graceful OS-signal handling; runner stop/actualHTTPabort is tested separately.
- First fullcheck command was intentionally stopped before API tests because DATABASE_URL was omitted. It is not green evidence.
- Second fullcheck: all v3 groups passed; eval405/406 failed only because bare`slack.com` matched the generic-plumbing scanner. Native validation now compares exact URL href; no guard/exception was weakened. Static guard2/2passed after correction.

Final local verification: all npm run check stages completed: 3371 v3 + 406 evaluation + 1 launcher + 66 Node = 3844 passing; typecheck/build/build-security completed. The final process session was no longer available at the last poll, so the root exit code is not separately retained; stage logs are retained and exact-head CI remains a required gate. Browser slack_read 4/4, exit0 (54.1s), dedicated DB56559 and ports57623/57624.
- fullcheck-04b3-r3.log SHA256 e6ed3ededbfba6cbbe44f58892728c39e3a56e8bb0dadf19bbde67dc8d3bab34
- browser-04b3.log SHA256 2a1a2d9ed835df62e0836e9f1c1ed1c2da0a6e5eda48ae367f516e104b077738

Publication: exact published-head CI check/browser is required before staging acceptance.

## Decisions and limits
- Existing approved Slack spec and userM3 instruction authorize execution; no replacement product design or main release is inferred.
- Body-free receipts produce metadata intents; future05 retrieves content under fresh authority. Missing event_context is conservatively discarded. Cost: unsupported-context events do not trigger automation until a safe native route is proven.
- New startup/re-enable and SQL-effective fences reject pre-activation receipts. Cost: missed work requires explicit bounded retrieval. No production backfill ran.
- Provisional credential blocks or restart may cancel queued intents; recovery does not replay an old decision. No actual AI/write consumer is present yet.
- Independent review did not certify exact-headCI, exhaustive backend/infrastructure behavior, WindowsOS graceful shutdown or nativeSlack/SlackConnect/Free/Pro/model. Root owns final verification; deployment/native acceptance remains required.
- Rotation recovery04B4, outbox/echo/UNKNOWN04C, personal write dispatch03C2,05/06, fullF3/F4 and main/live release remain open. CURRENT-STATE/ROADMAP are unchanged by this implementation.
