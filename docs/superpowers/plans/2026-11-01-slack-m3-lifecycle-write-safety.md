# Slack M3 · lifecycle, permissions and safe personal writes

User authorized continued M3 implementation01/11/2026. Apply executing-plans inline with TDD and one fresh whole-branch reviewer per completed card. Existing approved Slack spec and frozen source/ingress contracts remain authoritative; defaults/main/live stay off. Start at accepted M2 staging `ec81ebb3`.

## Sequence and boundaries
1.04B3 authorization fanout + six watermarks: one branch/card/PR, complete signed-ingress→durable authorization pages→owned metadata jobs→actual native supervision, no content/model processing.
2.04B4 rotating credential lifecycle recovery: next branch after04B3 freezes/acceptance; preserve owner lock/checkpoint/lease/CAS, never reuse an uncertain single-use refresh token. Actual fresh auth.test after a confirmed refresh can release only its captured provisional barrier. Unknown refresh requires reconnect. No timestamp inference of grant generation.
3.04C execution safety: next card for durable outbox/attempt, verified echo correlation before/after provider receipt and UNKNOWN reconciliation; no automatic write replay. Actual commit-then-AbortSignal HTTP fixture and restart races.
4.03C2 approved write dispatch: only after04C, minimal reviewed write family with full binding/current resource permission, public preview/approval/readback and result lifecycle. No full API/native acceptance inferred. Exact files/interfaces for later cards are written before those cards start, using accepted preceding interfaces.

##04B3 files/interfaces
- Create `db/v3/0028_slack_authorization_fanout.sql`: body-free receipt lease/retry fields, per-binding disabled processing controls, app runtime start/gap epoch, unique private metadata jobs; SQL authority-write effective timestamps and captured-binding cancellation fences.
- Create `apps/chat-api/src/services/slack/slack-authorizations-resolver.ts`: `SlackAuthorizationsResolver({appToken,apiBaseUrl,timeoutMs?,fetchFn?}).resolve(eventContext,workspaceId,signal?):Promise<string[]>`; returns validated deduplicated non-bot local-installation user IDs only after complete bounded pagination. Native https://slack.com/api; sandbox HTTP literal loopback. Safe fixed errors.
- Create `apps/chat-api/src/db/repositories/slack-fanout-repo.ts`: `SlackFanoutRepo(pool,policy)` reuses transaction-bound invalidation helpers; `setRuntime(appId,enabled):Promise<void>`, `setProcessing(binding,enabled):Promise<void>`, `claim(limit,workerId,leaseSeconds,appId):Promise<FanoutLease[]>`, `retry(lease,code):Promise<boolean>`, `complete(lease,authorizedUsers,signal?):Promise<{jobs:number;discarded?:string}>`. Complete verifies lease/receipt/context and locks actual authorities before atomic job insertion and completion CAS. Clock comparisons are SQL timestamptz, no JS Number/millisecond truncation of source time.
- Create `slack-fanout-runtime.ts`: `SlackFanoutWorker.runOnce(limit?,signal?):Promise<{claimed:number;applied:number;retried:number}>`; async `createSlackFanoutRuntime({pool?,env,live,workerId?,intervalMs?,stopGraceMs?,onError?}):Promise<SlackLifecycleValidationRunner|undefined>` reuses the bounded coalesced supervisor; retained ingress configuration, app token used only by resolver; bootstrap hooks in server.ts. Metadata controls remain internal/disabled until explicitly set; test uses actual service calls, no fake approval booleans.

## TDD tasks
1. RED HTTP resolver tests: multiple pages/duplicates/bot/foreign team; partial error/malformed cursor/loop, absent context, redirect and actual abort leave no usable list. GREEN bounded transport. Verify resolver suite and existing OAuth client tests.
2. RED PostgreSQL fanout tests: unique claims/reclaim/stale lease;2authorized owners versusDM1; wrong actor/workspace; each watermark one microsecond after source denies; no controls/consent/current policy denies; retry/context errors; reconnect/revoke/source edit before commit; lease expiry after real row-lock wait rolls back jobs. GREEN migration and transactional repo. Verify real PG suites.
3. RED actual native bootstrap signed ingress→HTTP auth pages→per-owner metadata jobs; stop/restart/flags-off lifecycle regressions. GREEN runtime factory/server hooks with no overlapping ticks, bounded cancellation and sanitized logs. Verify focused suites, typecheck and existing native lifecycle integration.
4. Freeze product; fullcheck and relevant browser, independent review once; reproduce Important findings RED→GREEN in one fix pass; final fullcheck if changed. Scoped commit/PR, exact-head CI check/browser and merge-tree comparison before acceptance. Reviewer records canonical status after merge, implementer only card result/new log.

## Review Focus
1. Partial/forged authorization pages, Slack Connect/foreign team, enterprise/bot and missing-context paths cannot produce another owner's job.
2. Exact six watermarks, restart/re-enable, regrant/identity/provider/config changes cannot backfill or rebind old receipts; SQL microseconds preserved.
3. Lease loss or owner/connection/source/policy mutation during HTTP/lock waits cannot partially publish jobs.
4. App token never enters body, public DTO/model, receipt, exception cause or log; transport endpoint remains pinned/bounded.
5. Flags-off lifecycle stays active; fanout remains metadata-only and future05 cannot treat a queued intent as permanent content/model authorization.
