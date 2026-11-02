# Handoff Log — 2026-11-03 — PR #259 Review Remediation Round 2 (R1–R8 & F11)

- **Branch**: `feat/slack-complete-integration` (PR #259)
- **Review Reference**: `2026-11-03-review-pr259-r2.md` (5 P1 + 3 P2 findings against `9590cc9c`)

## Summary of Fixes

1. **R1 (P1 — Native denial `hasStored` queried non-existent `slack_sources.channel_id` column and swallowed errors)**:
   - Updated `SlackPrivateReadWrapper` (`apps/chat-api/src/services/slack/slack-private-read-wrapper.ts`) to query `slack_sources` via `(metadata->>'channelId' = $2 OR (resource_type = 'conversation' AND resource_id = $2)) AND purged_at IS NULL` and `slack_derived_provenance_segments` via `(channel_id = $2 OR (resource_type = 'conversation' AND resource_id = $2))`.
   - Replaced the silent `catch {}` block with fail-closed `throw new SlackPrivateReadError('SLACK_READ_INTERNAL')`.

2. **R2 (P1 — `group_left` / `member_left_channel` without `event.user` set `slackUserId = null` and purged other users' data)**:
   - Updated `SlackIngressService` (`apps/chat-api/src/services/slack/slack-ingress-service.ts`) to extract `slackUserIds` from `event.user`, `envelope.authorizations[*].user_id` (matching `team_id`), and `envelope.authed_users[*]`.
   - Rejected `member_left_channel` and `group_left` events lacking any valid user identity with `400 MALFORMED_EVENT`.
   - Updated `SlackEventReceiptRepo.recordLifecycle` (`apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts`) to require `descriptor.slackUserIds.length > 0` and filter `slack_connections` strictly with `AND actor_id = ANY($3::text[])`.

3. **R3 (P1) & R4 (P1) — Trello `boardIds` bound `taskListId` instead of `boardId`, and empty `credentialId: ''` acted as a post-preview wildcard**:
   - Removed all `previewed.credentialId !== ''` wildcards and synthetic scope fallbacks in `AdapterFactory` (`apps/chat-api/src/services/adapter-factory.ts`).
   - Updated `SlackProposalService.prepare` (`apps/chat-api/src/services/slack/slack-proposal-service.ts`) and `planSlackProposalWorkflow` (`packages/planner/src/slack-proposal-plan.ts`) to query `trello_team_boards` (`board_id`), `github_team_repos` (`full_name`), and decrypt `service_credentials.config` (`tryDecryptCredentialConfig`) so `connections.trello.boardIds` uses real `boardId` (`['B_1']`, never `[taskListId]`) and `connections.gmail.email` uses the sender credential email (never recipient `toEmail`).

4. **R5 (P1) & R6 (P2) — Delayed `prepareProposal` response overwrote newer redacted/stale proposal, and `SlackProposalCard` omitted bound execution identities**:
   - Added `latestProposalRef`, `prepareSeqRef`, and `isPreviewCurrent` in `SlackProposalCard.tsx` (`apps/chat-web/src/components/slack/SlackProposalCard.tsx`) so delayed `prepareProposal` responses cannot overwrite a newer/redacted proposal (`revision: '3'`) and new revisions invalidate `planPreview`.
   - Preserved `plan.connections` in `planPreview` (`apps/chat-web/src/services/slack-assistant.ts`, `SlackProposalCard.tsx`) and rendered bound destination account identities (`username`, `login`, `email`, `boardIds`, `repos`, `allowedCalendars`, `allowedSpreadsheets`, `credentialId`) alongside Slack source `workspaceId` and `slackUserId`.

5. **R7 (P2) & R8 (P2) — Extended emoji + skin-tone normalization and bounded `oldest`/`latest` readback in `SlackSafeWriter`**:
   - Added `SLACK_SKIN_TONES` (`:skin-tone-2:`..`:skin-tone-6:`), expanded `SLACK_EMOJI_SHORTCODES` (including `:blush:`), and added `slackReadbackTextMatches` in `SlackSafeWriter` (`apps/chat-api/src/services/slack/slack-safe-writer.ts`).
   - Passed `oldest: row.provider_ts, latest: row.provider_ts, inclusive: true` on the initial `conversations.history` / `conversations.replies` call when `row.provider_ts` is recorded, ensuring delayed reconciliation succeeds even after >500 newer messages arrive.

6. **F11 (P2 — `scripts/eval-slack-triage.mjs` exercises `SlackProposalService.prototype.prepare` and owner-isolated leases)**:
   - Wired `SlackProposalService` into `runSlackTriageBenchmark` (`scripts/eval-slack-triage.mjs`), enforced `repo.assertCurrent(lease)` and distinct `atiUserId` per workspace (`T_PRO_01` vs `T_FREE_01`), and verified in `evaluations/tests/slack-eval-harness.test.mjs` that `SlackProposalService.prototype.prepare` is invoked (`prepareCalls > 0`) while `StepRunner.prototype.executeStep` remains `0`.

## Verification Evidence

- Round 2 reproduction scripts & regression suites:
  - `repro-r2-access.mjs`: `denial_only: { barriers: 1, cached_content: "Slack content is unavailable." }`, `group_left: { leaving_barriers: 1, staying_barriers: 0, staying_after: "STILL_AUTHORIZED_CONTENT", staying_native_read: "OK" }`
  - `slack-proposals.test.ts` (8 tests): Trello `boardIds: ['B_1']` + `AdapterFactory` execution (`200`), empty `credentialId: ''` rejected (`400`) when Gmail connected after preview
  - `slack-proposal-inbox.test.tsx` (5 tests): delayed `prepareProposal` discarded after revision 3 stale redaction; `plan.connections` identities rendered in preview DOM
  - `slack-write-safety.test.ts` (43 tests): `:blush:` (`😊`), `:+1::skin-tone-4:` (`👍🏽`), and delayed reconcile after >500 newer messages confirmed
  - `trace-eval`: `{"observed":{"classify":84,"privateReads":318,"prepare":86,"executorSteps":0},"totalCases":52,"totalRuns":3,"hardGates":{"passed":true,"unapprovedWrites":0,"crossUserLeaks":0},"hybridRecall":0.9688}`
- Full repository gate (`npm run check` against dedicated PostgreSQL 16 test DB on port `56534`, single uninterrupted run, exit code `0`):
  - `typecheck:v3`: exit 0
  - `test:v3`: **5,043 Vitest tests + 32 probe tests PASS** (`tool-schemas` 556, `tool-adapters` 596 + 32, `planner` 479, `executor` 54, `chat-api` 2,278, `chat-web` 1,080)
  - `test:eval:v3`: **27 test files, 418 tests PASS** (including `static-guard.test.ts` and `slack-eval-harness.test.mjs`)
  - `build:v3` & `test-v3-web-build-security.mjs`: PASS
  - `test:launcher:v3` & Node test suites: **99 Node/probe/launcher tests PASS** (32 probe + 1 launcher + 66 Node tests)
