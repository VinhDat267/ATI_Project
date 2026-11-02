# Telegram audit fixes implementation plan

> **For agentic workers:** Use executing-plans to implement inline, then request one independent whole-branch review.

**Goal:** Close Telegram audit findings F1/F7/F8 without changing other services.

**Architecture:** Serialize digest dispatch with the existing schedule row, preserving confirmed delivery across later cancellation. Bind GitHub digest sources to the selected repo scope. Persist projected Telegram updates and cursor transactionally before acknowledging provider updates; share the inbox between callback polls and instances.

**Tech Stack:** TypeScript, PostgreSQL 16, Vitest, existing fetch adapters.

**Spec:** `../specs/2026-11-02-telegram-oauth-and-digest-design.md`; task `docs/handoff/tasks/TELEGRAM-01-audit-fixes.md`.

## Constraints and review focus

- Preserve 33 ALL_TOOLS and prompt hash; no feature flag enablement or live external writes.
- Existing pending Telegram schedules using invalid github.list_issues must require reconfirmation rather than silently alter their hash.
- Cancellation before send, cancellation after send, paused/version-changed runs and real AbortSignal must have regression coverage.
- GitHub tests must reach the real adapter with literal repo/query expectations.
- Pairing cursor must not acknowledge a batch before durable storage; test concurrent users, process restart and failed persistence.
- Keep ordinary Telegram message text out of the durable pairing inbox; bound retention.

## 1. Dispatch cancellation and receipt preservation

Files: `telegram-digest-runner.ts`, `schedule-runner.ts`, server composition, new PostgreSQL cancellation test.

- [x] Write and run failing tests for cancellation/pause/version change during a source-read barrier, and cancellation between successful send and result persistence.
- [x] Require the runner's PostgreSQL pool; row-lock the schedule and run before dispatch, checking owner/version/status/config hash/AbortSignal.
- [x] Return discarded only before dispatch. Persist successful delivery even when schedule version changes afterward.
- [x] Run the focused cancellation and existing digest tests.

## 2. Real GitHub digest source

Files: `telegram-digest-candidate.ts`, `chat-service.ts`, candidate/adapter integration tests.

- [x] RED: derive a candidate with two allowed repos and execute each source through the real GitHubAdapter; reject unavailable scope.
- [x] Use github.search_issues with an explicit approved repo and open-issue query per source; include args in the existing config hash.
- [x] Pass the current GitHub lookup from ChatService; retain adapter scope checks at run time.
- [x] GREEN: selected proposal/runner/ChatService regression tests.

## 3. Durable pairing inbox

Files: new migration `0020_telegram_update_inbox.sql`, new `telegram-update-repo.ts`, `bot-client.ts`, Telegram route/server composition, DB/client tests.

- [x] RED: 101+ updates with pending pairings on both pages; repeat from a second client after restart; failed storage/abort must not advance the cursor.
- [x] Use a per-bot PostgreSQL cursor row lock. Store minimized update projections and cursor in one transaction before a later getUpdates call acknowledges them.
- [x] Keep pairing receipts for the OAuth state lifetime and group discovery metadata for a bounded period; no ordinary message content or raw state in the inbox.
- [x] Inject the durable store in server composition and the callback route; keep isolated unit-test transport fixtures local.
- [x] GREEN: DB inbox, BotClient and Telegram route suites.

## Final gate

- [x] npm run check with dedicated PostgreSQL.
- [x] Independent branch review, address material findings with RED/GREEN evidence.
- [x] Fill task results and add one handoff log; commit only task files.

## Ledger

- Baseline: origin/main `469825d1`, selected existing Telegram tests 3 files / 9 tests PASS, exit 0.
- Ruling: use a native managed worktree because the original checkout has other agents' uncommitted OAuth changes; no edits are copied.
- Ruling: durable inbox is necessary to advance getUpdates safely; acknowledging updates into only process memory would lose other pending users on restart.
- Dispatch RED: 4/4 new tests failed for the expected writes/receipt outcomes; GREEN: 6/6 with existing runner coverage. Added a real PostgreSQL NOWAIT lock assertion during send.
- GitHub RED: 4/4 new tests failed (unsupported tool or missing scope offered auto); GREEN: real adapter searches the two approved repos.
- Pairing RED: update101 not found; durable repo absent. Callback composition RED: successful HTTP callback had zero persisted inbox rows. Both now pass.
- Ruling: getUpdates needs a separate 1 MiB response cap for a valid 100-message page; the single-object 128k cap remains unchanged. Long-message page RED then BotClient7/7 GREEN.
- Reviewer found random lower update IDs after a week of bot inactivity. Three new RED tests proved PostgreSQL/memory cursor loss and empty-poll timestamp drift. Reset idle cursors after six days, retain last nonempty-batch timestamp, prune expired IDs before insert; GREEN19/19 in inbox/client/cancellation. Independent re-review14/14 PASS and closed the P2.
- Ruling: migration rerun fix is already PR #246; keep that separate and document deployment dependency rather than duplicate another agent's SQL changes.
- Final verification: npm run check exit0, 3160 v3 +406 eval fixture +99 Node/launcher tests. Implementation commit087ddd0f. Independent review closed its P2 after14/14 rerun; live acceptance remains NOT_RUN.
