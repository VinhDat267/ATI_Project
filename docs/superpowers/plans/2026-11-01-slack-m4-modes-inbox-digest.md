# Slack M4 Modes, Inbox and Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Native inline execution continues the user's accepted workflow; one fresh whole-branch reviewer for each independently publishable card. No implementer fanout.

**Goal:** Deliver per-user/workspace rules, AI and hybrid processing, protected ATI Inbox proposals, approved cross-service workflows and a read-only daily digest.

**Architecture:** Extend the accepted body-free fanout queue and existing private read/policy/provenance/expiry/purge services. All source-containing assistant artifacts have an owned conversation parent and one registered body_json selector. Model calls use a mandatory per-attempt policy/budget gate and bounded output; proposals prepare ordinary source-bound plans, while a separately validated source-bound Slack reply family retains durable outbox safety.

**Tech Stack:** Existing TypeScript/Express/React/Vitest/Playwright/PostgreSQL16. No new runtime dependency.

**Spec:** docs/superpowers/specs/2026-10-28-slack-personal-oauth-design.md sections4.4-9.2; existing SLACK05/06 parent cards; frozen source/ingress contract. Baseline accepted staging4d3dc4471138a69eb6106c6af44b99ee9bad74ea. Source cards' fc12e3fb/draft dependencies are historical, not implementation truth.

## Global Constraints

- One configuration for ATI user + connection; never choose a first token or another owner's workspace.
- Rules, AI, hybrid remain distinct. AI evaluates every eligible event; deterministic relevance evidence gates publication, not prefiltering of AI inputs.
- Only personal mention/direct request, self-commitment or a followed thread establishes personal relevance; @here/@channel alone does not.
- Coalesce a thread for30seconds, context≤20messages/20,000characters, at most one owned running job per connection. Record truncation.
- Pending work expires into needs_attention after24hours; budget/backlog holds never become no_action. Proposal review expires after7days.
- Every source/model boundary rechecks captured binding/policy epoch, barriers and current config/lease. No old grant may be rewrapped under a new grant.
- Every external write requires preview + explicit approval; changed parameters/target/account produce a new planHash. Background workers/digest never execute writes.
- Source edit/delete/revoke/expiry immediately blocks reads and publication, then physically purges registered payloads even with all content flags off.
- MYSLACK_ENABLED and MYSLACK_AUTOMATION_ENABLED remain default-off. No main/live flag enable, production backfill, native provider/model/FreePro/Connect acceptance is inferred from fixtures.
- Every card: TDD actual PostgreSQL/HTTP/AbortSignal, focused verification, frozen-source fullcheck/browser, independent whole-branch review, one Important fix pass if needed, exact-head CI and staging merge-tree comparison. Implementer edits only its card result/new log; reviewer owns canonical records after merge.

## Builder defaults and shared contracts

Root owns Backend, Frontend and shared Schema/Planner interfaces for each vertical card; interfaces below are agreed before implementation. Existing read-only/manual-post validators retain their boundaries.

- Default config: disabled, mode hybrid, timezone APP_TIME_ZONE or Asia/Ho_Chi_Minh, retentionDays1 (allowed1..7), maxQueueLength1000 (1..10000), finite daily/monthly call caps20/200 and reserved-token caps1,000,000/10,000,000; per-call output cap1024 (256..4096). UI states reserved accounting separately from provider-reported usage. No refund after an uncertain request.
- Rules use bounded literal keywords, author IDs, conversation kinds, direct-mention and intent templates; no arbitrary regular expressions. Default rule accepts personally relevant events. User target IDs remain candidates until connector scope checks and approval.
- Pure mode/rule/budget changes increment assistant configVersion, not processing-control version/start. Pending jobs use latest config; running work discards/requeues after a version change. Enable/resume/identity/policy changes retain M3 processing watermarks and conservative cancellation. No replay of decided events.
- Follow intervals are metadata keyed by connection/channel/root with SQL followed_at/unfollowed_at; membership is evaluated at the new event time, so follow does not scan old history.
- The shared artifact table stores kind proposal_excerpt or daily_digest_entry, owner/binding, conversation parent, revision/status/dedupe hash and body_json. All content-derived labels, excerpts, rationale, intents and links live in that single registered selector. Source-free metadata never doubles as a content cache. Reads require exact active-copy fingerprint/version and current authority; erase replaces body and makes pending proposals stale. Effective expiry is min(source/storage policy, configured retention, review expiry), not a promise to retain30days.
- Model adapters opt into maxOutputTokens and beforeModelAttempt(signal). Gate callback runs before EVERY actual transport attempt, including retries, after which the signal is checked again. Gemini bounded requests disable SDK-internal retries; unsupported bounded transports fail closed. Input serialization bytes + output cap + fixed framing reserve form conservative accounting; actual usage is separate. Source-bearing planning/digest calls use the same budget path.
- Durable parent receipts remain metadata-only while a per-owner queue is full and expose backlog_full; fanout retries do not omit an owner or replay an existing unique job. A global pending-receipt cap rejects new ordinary ingress with503 before ACK; lifecycle/echo handling retains its existing priority and durable guarantees.

## Review Focus

1. An owner/config/policy change during HTTP, model retry, row-lock wait or final publication must discard source bytes and never create an approvable old-version plan.
2. AI must see every eligible event, but cannot assign work from @channel/general chatter or use another workspace/account; followed-thread timing and self-authored personal commitments need distinct coverage.
3. Budget reservation and one-running-connection ownership must be actual SQL under concurrent workers; unknown usage, retries and expired leases cannot overspend or silently discard work.
4. Every new source copy must have both immediate read exclusion and flag-independent physical erasure across proposal, digest, chat, plan, audit and memory; raw SQL mutation cannot be resealed by a trusted erase.
5. Referenced source-bound thread replies must materialize only certified approved dependency outputs; provider commit→lost response→restart must never resend, and digest must make zero external writes.

## Dependency pre-flight

| Producer → consumer | Interface | Gate |
|---|---|---|
| M3 fanout →05A | existing slack_triage_jobs body-free receipt/binding/epoch/processing/runtime versions | Extend lease/status fields; no alternate content queue or lost-owner fallback. |
|05A →06A | protected proposal_excerpt row + exact source segments/config version, guarded public DTO | Shared schema frozen; no source text in metadata-only decisions or logs. |
|05A →06A/06B | beforeModelAttempt policy/budget callback + bounded output | Classifier/planner/retry share counters and current rights. |
|06A →06B | proposal lifecycle/current revisions + source segments + owned conversation | Digest uses guarded proposals, not guessed external task completion. |

### Task 1: SLACK-05A complete three-mode runtime and Settings

**Card:** docs/handoff/tasks/SLACK-05A-three-modes-runtime.md, branch feat/slack-05-modes.

**Files:**
- Create packages/tool-schemas/src/myslack-assistant.ts and tests/myslack-assistant.test.ts; export index.
- Modify packages/planner/src/types.ts, providers/transport.ts, gemini-provider.ts, openai-compatible-provider.ts; add bounded-attempt provider tests.
- Create packages/planner/src/slack-triage.ts and prompts/slack-triage.prompt.txt with strict output parsing; tests/slack-triage.test.ts.
- Create db/v3/0030_slack_assistant_modes.sql; extend existing triage intents, config/follow/budget/decision/artifact tables and payload-mirror erasure function for new kinds.
- Create API repositories slack-assistant-repo.ts, slack-assistant-artifact-repo.ts; services slack-rules-engine.ts, slack-triage-worker.ts, slack-assistant-runtime.ts; config/slack-assistant-runtime.ts; routes/slack-assistant.ts.
- Modify existing artifact-targets/derived-lineage/purge consumer+handler only to support two new concrete kinds, fanout repo/receipt repo for bounded capacity and thread metadata, server/app wiring, schema test migration helper if needed.
- Create web services/slack-assistant.ts, components/slack/SlackAutomationSettings.tsx; compose in Settings/PersonalSlack.tsx. Reuse existing classes, owner guards and accessible labels.
- Tests: schema contracts, planner/provider HTTP attempts, API actual-PG config/queue/artifact/worker/races, actual bootstrap integration, UI component and browser slack_assistant scenario. Extend existing HTTP Slack fixture with thread/context and local model fixture.

**Interfaces:**
- SlackAssistantConfig: enabled/mode/configVersion/rules/budget/maxQueueLength/retentionDays/timezone/digest; validation rejects unknown/actor/secret fields, decimal version strings preserve SQL bigint.
- SlackAssistantRepo.getConfig(owner,connectionId), updateConfig(owner,connectionId,expectedVersion,config), followThread(owner,connectionId,channelId,threadTs,follow), claim(limit,workerId,signal), reserveAttempt(lease,reservedTokens,signal), publish(lease,decision,segments,signal), hold(lease,reason). All mutation ownership/CAS is SQL, no boolean-only approval simulation.
- SlackTriagePlanner(provider).classify({binding,context,truncated,signal,beforeModelAttempt,maxOutputTokens}) → validated no_action/needs_clarification/proposal intents; source IDs are server-selected indices, never model-supplied bindings.
- SlackAssistantArtifactRepo.publishProposal(lease,payload,segments), list(owner,connectionId), get(owner,id,purpose), reject(owner,id,revision). Publishes exact registered JSON in the same transaction; no source-free fallback for missing proof.
- SlackTriageWorker.runOnce(limit,signal) and createPersonalSlackAssistantRuntime({pool,oauth,provider,env,encryptionKey}) → service/routes + coalesced runner. Metadata Settings route remains independent of background enablement, with explicit availability.
- GET/PUT /api/connections/myslack/:connectionId/assistant, PUT /.../assistant/followed-threads, GET /api/slack/proposals. API owner check precedes provider/model work.

- [x] Step1 RED contract cases: disabled hybrid defaults; malformed rules/versions/timezones/budgets/foreign actor fields denied; concrete rule engine personal mention/self/DM/follow and generic @channel no_action.
- [x] Step2 GREEN strict contracts/rules; run schema and rules suites, expected all named cases PASS.
- [ ] Step3 RED actual-PG config CAS/owner isolation, one SQL running lease, due SQL microseconds, queue/budget preservation, global receipt cap503 with lifecycle priority, mode change during a real HTTP request, source/consent revoke before commit, and proposal payload tamper/read/physical purge. Model attempt HTTP503→retry must reauthorize/re-reserve; invalid model JSON cannot publish.
- [ ] Step4 GREEN migration/repos, bounded model hooks and real worker/provider/runtime. Verify exact output caps and cancellation via actual HTTP/AbortSignal. Source store/segments use accepted private wrapper evidence; no raw body from ingress.
- [ ] Step5 RED API/Settings integration: one owner/two workspaces different modes, disabled/background flags, finite budget validation, withheld result visibly pending; native bootstrap signed event→private HTTP source→real local model protocol→guarded registered proposal.
- [ ] Step6 GREEN routes/server/UI, component tests and browser375/1440 light/dark. Final focused suites, npm run check, relevant browser and review/CI/merge gate. Record result/new log before publication.

### Task 2: SLACK-06A protected Inbox, refine/approval and cross-service workflow

**Card:** docs/handoff/tasks/SLACK-06A-inbox-approved-workflows.md, separate branch from accepted05A.

**Files:** extend artifact/proposal repository and routes; create services/slack/slack-proposal-service.ts and packages/planner/src/slack-proposal-plan.ts; modify ChatService/PlanRepo/ExecutionService/source guards only through dedicated source-bound family. Extend SafeWriter/outbox exact thread/referenced-text family rather than widening the manual source-free validator. Create web SlackProposalInbox/Card, /inbox route/navigation and API methods. Migration0031 if durable plan/proposal revision or reply correlation fields require it, assigned after05A freeze.

**Interfaces:** POST /api/slack/proposals/:id/refine with expected revision creates/opens owned chat under current lineage; POST /:id/prepare prepares a new preview/hash, never dispatch; POST /:id/reject CAS; explicit approval uses existing /plans approval flow. Source-bound reply validates approved plan plus certified dependency outputs before outbox dispatch. Proposal plan identity is owner+proposalRevision+configVersion+source refs, with stale supersession; UI editing cannot patch an executing plan.

- [ ] Step1 RED owner/workspace-filtered Inbox, delayed stale polls, source redaction and reopen chat; each source body/plan writer requires exact registered lineage.
- [ ] Step2 GREEN API/UI with source/epoch/expiry checks before HTTP DTO and clear-on-invalidation; metadata receipt has no source text.
- [ ] Step3 RED actual HTTP cross-service workflows: Trello task+thread reply with certified returned URL; Jira lookup-before-create; Sheets scope/missing destination; vague timezone/deadline yields needs_info. Preview without approval makes0writes, double approval writes once, edit makes new hash and invalidates old approval, config/source change before dispatch denies.
- [ ] Step4 GREEN bounded planner integration and source-bound write family, retaining manual read/post defaults and all pre/post provider authority checks. Real commit→AbortSignal→restart UNKNOWN reconciliation makes0resends; no skip/retry bypass.
- [ ] Step5 Verify actualPG/HTTP/UI/browser, frozen fullcheck, independent whole-branch review, Important RED→GREEN once, final local/CI/merge tree. Update card/new log, not canonical status.

### Task 3: SLACK-06B daily digest and seventh-kind lifecycle integration

**Card:** docs/handoff/tasks/SLACK-06B-digest-lifecycle.md, separate branch from accepted06A.

**Files:** create services/slack/slack-digest-service.ts, digest job repository; integrate a read/create-artifact auxiliary job with existing scheduler heartbeat, default09:00 configured IANA timezone. New migration0032 assigned after06A freeze for durable due/lease/day uniqueness; extend Inbox digest component/API and Settings digest controls. Use existing daily_digest_entry concrete artifact kind/handlers from05A, with real writer/readers here.

**Interfaces:** SlackDigestService.tick(signal) claims due connection/day, publishes only current guarded proposal snapshots and dependencies, never calls execution. GET /api/slack/digests?connectionId, POST /digests/:id/refresh-status only authorized reads. Source truth is ATI proposal states; external task completion requires explicit connector read or user confirmation with time/source. SCHEDULES_ENABLED off reports unavailable without stopping Inbox/ingress/privacy cleanup.

- [ ] Step1 RED actualSQL duplicate ticks/restart, IANA timezone/DST, paused/scheduler flags, missing digest consent, source change while generating; unique digest per connection/local day and current authority. No external writes during digest.
- [ ] Step2 GREEN durable digest scheduler/read API/UI, deterministic summary of guarded proposals (a model summary, if used, must use the same attempt budget/F1 gate).
- [ ] Step3 RED actual signed edit/delete/disconnect/policy/TTL after full lookup→proposal→chat/plan/memory→digest chain. All seven concrete kinds physically erased with flags/config absent; owner B survives, stale responses cannot restore content, no reapproval of an old plan. Raw SQL mutation stays quarantined.
- [ ] Step4 GREEN final lifecycle integration and browser375/1440 light/dark, frozen fullcheck/review/CI gates. Native/model-quality×3 remain07 NOT_RUN; do not infer full F3/F4 until every requirement has separate evidence.

### Task 4: Reviewer M4 integration record

After accepted product merges, independent reviewer updates CURRENT-STATE/ROADMAP/SLACK-DELIVERY, parent/child result statuses and a new integration log. Keep failed attempts, all rulings/costs, actual head/CI/merge-tree hashes, native NOT_RUN and remaining03D/03E/07/release boundaries. Documentation-only exact-head CI before staging merge; preserve own worktree/evidence and unrelated dirty checkout.

## Plan self-review

Spec coverage: sections6-7 map to tasks1-3; F1/2 reused and rechecked at every read/model boundary; F3 seven actual kinds task1/3; F4 runtime/queue/pause/re-enable tasks1/3; referenced source writes and approval task2. General method-by-method03D/03E and native/model-quality07 remain separate; required minimal thread-reply workflow is included rather than silently omitted. No external deployment or flag enablement is part of this execution.
