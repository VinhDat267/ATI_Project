# GMAIL-02 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Work remains on one GMAIL-02 branch; an independent reviewer verifies the completed diff.

**Goal:** Enable the ten Gmail tools for connected members, prevent invented recipients, and keep mail content out of trusted working memory.

**Architecture:** Use the personal token and adapter contracts supplied by GMAIL-01. The live adapter calls Gmail with bounded reads and no retry of indeterminate writes. The existing planner search loop records only thread identities and header participants; display subjects stay in a separate memory projection that never reaches the provider.

**Tech Stack:** TypeScript, Node.js fetch, Vitest, PostgreSQL, local fake Google HTTP server, existing Playwright suite.

**Spec:** `docs/superpowers/specs/2026-10-13-gmail-personal-connections-design.md`, sections 3.10, 4.1–4.5 and 6.3 part 2. Implementation scope: `docs/handoff/tasks/GMAIL-02-gmail-tools.md`; interfaces: `GMAIL-common.md`, section 4.

## Global Constraints

- `GMAIL_ENABLED=off` and `PLANNER_READ_ANSWERS=off` remain the defaults.
- `ALL_TOOLS` and `SERVICE_REGISTRY` remain 33 tools and 8 services.
- One task, one isolated branch, one PR; update only the Result section of GMAIL-02 and add one handoff log.
- No real Gmail requests, real email sends, Gmail UI changes, or golden measurement changes.
- Show failing tests before production changes; use real HTTP, PostgreSQL, and AbortSignal for their respective behaviors.
- GMAIL-01 must merge before implementation/integration. The user explicitly chose to wait for PR #140 to merge and not write GMAIL-02 code (14/10/2026). PR #140 merged at `8973a9e`; implementation starts from current main `61d3be4`.
- Rebase onto current main before publishing a main-targeted PR. Preserve PRODUCT.md and skills-lock.json in the primary checkout.

## Review Focus

1. After a write reaches Gmail, a timeout, broken response body, or ambiguous server failure must not create a duplicate write. A write-tool error with `details.requestSent === false` is `failed`, not `unknown`: executor honors the marker and Gmail adapter adds it to errors before Gmail API dispatch, including token-refresh errors (user decision 14/10/2026).
2. Header parsing must separate display names from bare addresses, reject CR/LF, and never authorize an address mentioned only in message text.
3. Mail subjects from a prior turn must not enter any provider workingMemory input, including regex mode and retry calls.
4. Sandbox execution must verify the member's personal connection before returning a fake adapter; unconnected members cannot gain Gmail from fallback planning.
5. Late OAuth reconnect or recovery uses the exact connection stamped into the approved plan, inherited from GMAIL-01.

## Task 1: HTTP adapter and message formatting

**Create:** `packages/tool-adapters/src/gmail/gmail-adapter.ts`, `packages/tool-adapters/src/gmail/mail-format.ts`, `packages/tool-adapters/tests/gmail-adapter.test.ts`.
**Modify:** `packages/tool-adapters/src/index.ts`, `scripts/fake-google-gmail.mjs`.

**Consumes:** `GmailAccessTokenProvider.getAccessToken({ signal?, forceRefresh? })`, StepError, GlobalRateLimiter, Gmail schema constants.
**Produces:** `createGmailToolAdapter({ tokens, baseUrl?, fetchFn?, limiter? }): AdapterExecutor`. Each instance represents one member; the server passes a limiter shared only across that member's calls.

- [ ] Write HTTP tests against the fake Google server for all ten tools; assert received request paths, methods, bodies and write counts. Capture RED before implementing.
- [ ] Add deterministic fake threads/labels, scriptable response statuses and Retry-After, write hangs, disconnects and redirects to the existing fake Google server; preserve all OAuth behaviors.
- [ ] Implement bounded metadata search (10 threads, snippets 200 characters), last-five full message reads (4,000 each, 12,000 total), plain-text extraction from HTML and attachment metadata only. Test emoji boundaries and participant cap of 20.
- [ ] Implement plain UTF-8 MIME, base64url transport, RFC 2047 non-ASCII subjects, explicit recipient normalization and validation. Decode outgoing MIME in tests, including Vietnamese and emoji.
- [ ] For reply and reply-draft, use the latest non-DRAFT message's Message-ID, References, subject and threadId. Forward the original text without attachment content; reject draft-only threads.
- [ ] Reject unsupported input keys, empty/invalid IDs, recipient display names/CR/LF, 21 recipients, overlong bodies/subjects and invalid label operations before dispatch. Preserve UTF-16 pairs when truncating derived text.
- [ ] Implement exactly one forced refresh on 401; classify 403 permission/quota, 429, 404 and 400. Retry rate-limited reads twice at most, with abortable Retry-After capped at five seconds.
- [ ] Test indeterminate writes as UNKNOWN with one server-received write, including executor handling. Reject redirects and propagate cancellation to actual HTTP requests.
- [ ] Update `packages/executor/src/runner.ts` to classify errors carrying `details.requestSent === false` as `failed`. In the Gmail adapter, add that marker only to errors before Gmail API dispatch (including token refresh); never add it to ambiguous in-flight failures. Add RED/GREEN tests to `packages/executor/tests/runner.test.ts` and `packages/tool-adapters/tests/gmail-adapter.test.ts`: failed refresh/pre-dispatch failure yields failed and zero Gmail API requests; post-dispatch write hang/disconnect remains unknown and exactly one received write.
- [ ] Run adapter tests and existing adapter suite; record output and commit scoped changes.

## Task 2: Recipient validation and safe observed memory

**Modify:** `packages/planner/src/validator.ts`, `packages/planner/src/search.ts`, `packages/planner/src/planner.ts`.
**Create:** `packages/planner/tests/gmail-grounding.test.ts`, `packages/planner/tests/gmail-search.test.ts`.

**Consumes:** `ToolDefinition.observedFields`, `x-recipient`, Gmail participants from validated headers, existing `grounding.userTexts`.
**Produces:** Recipient schema/grounding failures using the existing retry/clarification contract; `__observed.thread` holds only id and participants, `__labels.thread[id]` holds subjects for display.

- [ ] Write RED tests rejecting recipient arrays containing refs, templates or `${...}` even with grounding disabled. Verify case-insensitive exact-address grounding from user text and participants, with no suffix/substr authorization.
- [ ] Implement recipient grounding, listing unknown addresses in errors. Test one corrective provider retry and clarification after two failures; validator feedback must not count as user-supplied evidence.
- [ ] Add an optional kept-fields argument to recordObserved; lookup passes observedFields when supplied and retains the legacy default otherwise. Keep at most 20 thread display labels.
- [ ] Strip __labels from every provider workingMemory input, in llm and regex modes, including retry. Test persisted old subjects and read results containing title/body injection.
- [ ] Verify Gmail prefetch calls only list_labels, and explicit Gmail searches remain inside the existing `<search_results>` data wrapper.
- [ ] Test the 116 existing routing sentences with Gmail absent and present: only rf03 changes; exclude thư viện/thư ký/thư giãn/thư mục.
- [ ] Run focused Gmail and existing planner tests; record output and commit scoped changes.

## Task 3: Preview labels, sandbox and server integration

**Modify:** `apps/chat-api/src/services/resource-labels.ts`, `apps/chat-api/src/services/chat-service.ts` (pass real userTexts only), `apps/chat-api/src/server.ts`, `apps/chat-api/src/sandbox/index.ts`, `apps/chat-api/src/sandbox/scenarios.ts`.
**Create:** `apps/chat-api/src/sandbox/fake-results/gmail.ts`, `apps/chat-api/tests/config/gmail-sandbox.test.ts`, `apps/chat-api/tests/integration/gmail-tools.test.ts`.

**Consumes:** GMAIL-01 AdapterFactory, GmailTokenManager, personal catalog lookup, actor forwarding and plan connections.
**Produces:** Opt-in per-member Gmail catalog/registry, real live adapter, connection-checked fake sandbox adapter, and server-authored preview labels.

- [ ] Write RED tests for subject labels and recipient sources from userTexts or observed participants. Model-written labels must not authorize addresses. Preserve existing resource-label behavior.
- [ ] Compute recipient labels as `user` or `thread:<subject>` and thread labels from __labels; use bare normalized addresses as label keys.
- [ ] Add eight fixed Vietnamese fake threads, including body and subject injection fixtures. Fake write outputs have deterministic IDs and never use a network transport.
- [ ] Add a gmail scenario provider with an explicit search round followed by a reply plan. Keep all existing scenario assertions unchanged.
- [ ] Wire live Gmail through createGmailToolAdapter and sandbox Gmail through the same personal AdapterFactory validation followed by the fake adapter. Shared sandbox adapters retain current behavior.
- [ ] When Gmail is available, extend the service registry with GMAIL_SERVICE; extend catalog only for connected users. Do not turn unavailable/validation failures into a shared-service backup plan.
- [ ] Run native HTTP integration with real PostgreSQL and fake OAuth: connect A, plan, inspect stamped connection/recipient labels, approve, execute A's fake adapter; unconnected B receives Gmail in unavailableServices. Assert no Gmail API write requests in sandbox.
- [ ] Run focused chat-api tests and record output.

## Task 4: Mutation checks, compatibility and delivery

- [ ] Mutate each required rule independently, run the relevant test, confirm failure, and restore exact source bytes: accept body-only recipients; accept a ref in to; drop CR/LF validation; resend UNKNOWN writes; remove search_results wrapper; mark search_threads listable; retain subject in observed working memory. Also mutate each side of the user-approved pre-dispatch rule: omit the adapter's `details.requestSent === false` marker, and ignore that marker in the executor; both mutations must fail their respective tests.
- [ ] Run `npm run check` with both flags off and existing browser suite without editing assertions. If failures reproduce on base, preserve evidence and report them separately.
- [ ] Run the gmail sandbox scenario manually against fake OAuth through the app; keep Gmail UI/browser-group changes for GMAIL-03.
- [ ] Independent review per REVIEW-CHECKLIST.md, including rerun tests and unresolved findings. Do not claim review PASS without evidence.
- [ ] Fill GMAIL-02 Result, add one dated handoff log with RED/GREEN, mutation outcomes, actual outputs and limits; leave CURRENT-STATE.md and ROADMAP.md unchanged.
- [ ] Commit only task files, push branch and prepare PR using repository template. Verify CI against the exact final head. No merge without user instruction.
