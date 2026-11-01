# SLACK-05A · Rules / AI / Hybrid runtime and Settings

Status: implementation in review preparation; M4 is not closed. Base `4d3dc4471138a69eb6106c6af44b99ee9bad74ea`, branch `feat/slack-05-modes`, managed worktree615f. Unrelated main/workspace/Trello work is preserved. No main/live flags, production backfill or native provider/model calls.

## Delivered scope

- Per-owner/connection disabled-hybrid defaults, literal bounded rules, exact bigint config CAS, independent algorithm revisions and processing-control watermarks. Follow/unfollow intervals use the new event's SQL time.
- Body-free durable ingress/fanout, global ordinary cap before503/ACK, per-owner capacity with retryable parent preservation/idempotent other-owner progress. Original receipt time anchors30s coalescing/24h attention, including legacy migration; one running SQL lease per connection and fair bounded selection.
- Fresh private Slack reads → deterministic Rules, unfiltered eligible-event AI, or rules-prefiltered Hybrid. Only new-trigger personal evidence can publish. Max20messages/20,000text chars; incomplete/missing/oversized context holds attention. No_action persists only fixed metadata enums. No background external write.
- Per-actual-model-attempt policy/config/lease/source checks and SQL call/token reservations, including retries. UTC day/month windows, no refund for uncertain dispatched requests. Provider-reported usage is separate, nullable and idempotent against captured reservation periods. Gemini bounded requests disable SDK-internal retries.
- Actual `proposal_excerpt` writer/guarded read/registry fingerprint and version, source delete/policy/TTL physical purge with flags absent. All source-derived fields live in one `body_json` selector. Missing/tampered proof and metadata binding swaps never become source-free. Lower retention monotonically reduces existing assistant/descendant expiry.
- Authenticated no-store Settings/follow/proposal-list routes; workspace-isolated Settings and finite limits with stale-session/config protection. A source-processing provider is built from the same frozen F1 environment; sandbox accepts explicit literal loopback only, never its canned chat planner.

## Verification and preserved attempts

Evidence directory: `.superpowers/sdd/2026-11-01-slack-m4-modes-inbox-digest/`. Own PostgreSQL16 container `ati-slack-m4-20261101`, ID `51e9291088f4ff44ce77f8af49b02494f2de6e18a400b067eb1a7a82e059fadc`, local port56569. Prior M3 container/evidence retained.

- Contracts32/32 and rules5/5 PASS; provider/parser/current-and-regression41/41 PASS; Settings+existingOAuth24/24 PASS; routes6/6 PASS.
- Actual SQL fanout/queue/worker64/64 PASS after original-receipt/legacy-deadline RED. Artifact11/11 PASS including purpose-separated Inbox, missing proof, payload/binding tamper, source/policy/TTL erasure and lower retention.
- Actual application bootstrap/HTTP/model fixture verifies signed metadata→fresh source→bounded request→registered guarded proposal, zero external writes, cap503 with no unstored ACK, and all-flags-off physical deletion. This is protocol acceptance with synthetic fixtures, not native Slack/model quality.
- Browser Settings4/4 PASS at375/1440 light/dark, two actual OAuth fixture connections, per-workspace persisted modes/budgets, invalid-positive-limit rejection and no width overflow. Screenshots preserved in browser-modes-r3; mobile visual inspection performed.
- RED evidence includes missing modules, eight actual transport attempt/cap failures, per-connection held-budget/fairness failures, full-owner/global cap/thread projection failures, coalescing/usage failures, shortened-retention and original/legacy-receipt-age failures, and triage-only Inbox-purpose failure.
- First full run exposed two existing5s parallel-load timeouts plus old M3 expectations that two assistant-kind handlers remain unavailable. Isolated auth/history passed; native compatibility now4/4 PASS with actual erasure/survivor assertions preserved and empty known domains completing. Empty-domain completion does not certify digest content.
- Full r3: all3565 workspace tests PASS, eval405PASS/1FAIL because UI service literals violated the existing generic-plumbing guard. Picker now imports shared schema data; eval406/406 PASS without an exception. Final full r4 at4workers: one existing AUTH-02 full-schema migration5s timeout;1355/1356 API tests and all other workspace tests passed. The unchanged auth suite reran15/15 PASS in isolation; build, build-security and launcher passed, node gates66/66 PASS. Overall full-command success remains pending at2workers; no test or production timeout was widened.
- Browser startup first hit Windows-reserved port51569; actual bind probe selected30569/5274. A minimal actual Chromium probe explained an exact-label/nested-select locator mismatch (label0/accessible-role1); corrected browser locator, product label unchanged. Source diffs retain HEAD LF style after Python's Windows newline inflation was detected and corrected.

## Rulings and costs

1. Execute the approved design and explicit M4 request inline, one fresh whole-branch reviewer per publishable card. Cost if wrong: revise interfaces/implementation before publication.
2. Include a real protected proposal store/read/erase in05A before exposing classifier output. Cost: a larger first vertical card; no partial artifact acceptance.
3. Separate algorithm configVersion from M3 processing epoch. Cost: pending/current-mode and permission-watermark behavior need distinct tests; old grants cannot replay.
4. Reserve conservative input/output units on every actual attempt and never refund uncertain requests. Cost: work can pause before provider-reported quota; native billing acceptance remains separate.
5. Default Hybrid requires work vocabulary plus personal evidence; AI sees every eligible input. Cost: keyword false negatives require explicit rule edits/native evaluation.
6. Budget reset periods are UTC, independent of digest timezone. Cost: Settings must explain UTC reset.
7. Each proposal owns a fixed source-free-title conversation; exact duplicate generations reuse only valid registered artifacts. Cost: more proposal chats; broader thread revision handling belongs to06A.
8. Receipt time starts queue clocks, including delayed fanout/migration; expired attention metadata can bypass active capacity. Cost: an old backlog requires explicit current-source handling rather than a renewed automatic processing window.

## Remaining gates and scope

Independent whole-branch review, any single Important fix pass, frozen final full check, exact-head CI/all-browser and staging merge-tree comparison remain pending. Implementer updates this card/log only; canonical CURRENT-STATE/ROADMAP are reviewer-owned after accepted integration.

Next cards:06A Inbox/refine/approved cross-service plans plus the minimal source-bound referenced thread reply, then06B durable09:00 IANA-timezone read-only digest and actual seventh-kind lifecycle chain. `daily_digest_entry` has a concrete table/selector/erase handler here, but no writer is accepted yet. General03D/03E methods and07 native/Free/Pro/Connect/model-quality×3 remain open; do not infer full F3/F4 or platform completion from this card. Existing M3 terminal-UNKNOWN recovery-button P3 remains deferred.
