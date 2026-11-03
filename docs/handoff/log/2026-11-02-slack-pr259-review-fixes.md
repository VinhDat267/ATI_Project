# Handoff Log — 2026-11-02 — PR #259 Review Remediation (F1–F11)

- **Branch**: `feat/slack-complete-integration` (PR #259)
- **Review Reference**: `2026-11-02-review-pr259.md` (4 P1 + 7 P2 findings against `53b19707`)

## Summary of Fixes

1. **F1 (P1 — Stored private Slack content readable after channel access loss)**:
   - `SlackIngressService` classifies signed `member_left_channel` events (`user`, `channel`, `event_ts`) as lifecycle `channel_membership_lost` descriptors.
   - `SlackEventReceiptRepo.recordLifecycle` resolves matching active `slack_connections` (`app_id`, `workspace_id`, `actor_id = userId`) and stages `channel` barrier + `channel_membership_lost` purge target via `SlackInvalidationService.stageInTransaction`.
   - `SlackPrivateReadWrapper` stages a `channel_membership_lost` barrier/purge when a channel-scoped read fails with `SLACK_READ_NOT_FOUND` (`not_in_channel` / `channel_not_found`) and stored Slack sources or derived provenance segments exist for that `(connection_id, channel_id)`.

2. **F2 (P1 — Inbox-prepared plans missing destination connection bindings for 5 services)**:
   - Updated `validateSlackSourceReplyPlan` (`packages/tool-schemas/src/myslack-post-plan.ts`) to allow destination connection keys (`trello`, `github`, `gmail`, `mycalendar`, `mysheets`, `myjira`) alongside `myslack`.
   - Updated `planSlackProposalWorkflow` (`packages/planner/src/slack-proposal-plan.ts`) and `SlackProposalService.prepare` (`apps/chat-api/src/services/slack/slack-proposal-service.ts`) to populate `connections.<service>` with active personal credentials and allowed scope.
   - Extended `CredentialRepo.getCredentialByIdAndUser` and `AdapterFactory.getAdapterForService` so `trello`, `github`, `gmail`, `mycalendar`, and `mysheets` resolve credentials by `credentialId` when `email` / `githubUserId` / `memberId` are omitted in Inbox-prepared plans.

3. **F3 (P1), F4 (P1), F5 (P2) — `SlackProposalCard.tsx` preview redaction, destination edit invalidation, and full step args preview**:
   - Cleared `planPreview` / `needsInfoQuestion` whenever `proposal.status === 'stale'`, `proposal.body === null`, or `proposal.id` / `proposal.revision` changes, and guarded `planPreview` rendering behind `!isStaleOrRedacted`.
   - Invalidated `planPreview` whenever instruction, destination service/resource target, or `replyInThread` changes after preparing a preview, requiring re-preparation before approval (`Vui lòng bấm "Xem trước kế hoạch" lại trước khi phê duyệt`).
   - Rendered concrete `step.args` and `connections.myslack` binding metadata inside the preview card and disabled `Phê duyệt và thực thi` until `planPreview?.id` is loaded.

4. **F6 (P2 — Workspace directory race condition in `SlackReadControls.tsx`)**:
   - Added a monotonic `directoryRequestSeqRef` request token and `selectedConnectionRef` check so stale `getDirectory` responses from a previous workspace or disabled state are discarded.

5. **F7 (P2) & F8 (P2) — `SlackSafeWriter.readback` dense channel pagination and emoji shortcode normalization**:
   - Added `oldest`/`latest` timestamp window (`±60s`) when `providerTs` is known and removed the `!hasMore` requirement once a unique correlated match (`user === slackUserId` + `ts === providerTs` or `client_msg_id === clientMsgId`) is found.
   - Normalized common Unicode emoji characters (`🎉` ↔ `:tada:`, `✅` ↔ `:white_check_mark:`, `🚀` ↔ `:rocket:`, etc.) during readback text comparison.

6. **F9 (P2 — Recovery blocked on failed non-Slack steps in multi-step source-reply plans)**:
   - Updated `ExecutionService` (`restoreController`, `requiresSlackPostReconcile`, `continueExecution`, `continueStep`) so `retryStep`, `skipStep`, and `continueExecution` are only blocked when a `myslack.*` write step itself is in an unconfirmed (`running`/`failed`) state; non-Slack steps that fail before the Slack post step has started can be retried or skipped.

7. **F10 (P2 — Cross-project Jira deduplication in `StepRunner`)**:
   - Restricted `jira.create_issue` lookup-before-create deduplication in `packages/executor/src/runner.ts` so an existing issue is only reused when its key prefix or `project.key` matches `args.projectKey`.

8. **F11 (P2 — `scripts/eval-slack-triage.mjs` connected to real runtime pipeline)**:
   - Replaced standalone regex/in-script copies with dynamic imports via `tsx/esm/api` of production modules (`SlackRulesEngine`, `SlackTriagePlanner`, `SlackSafeWriter`, `SlackInMemoryOutboxStore`, `planSlackProposalWorkflow`, `StepRunner`, `validateSlackAssistantConfig`) and enforced `assertRuntimeSourcesExist()` so running the script without `apps/` and `packages/` fails closed with `SLACK_EVAL_RUNTIME_SOURCES_MISSING`.

## Verification Evidence

- Reviewer reproduction scripts:
  - `repro-access-loss.mjs`: `fresh_native_read_denied SLACK_READ_NOT_FOUND`, `active_channel_barriers 1`, `after_access_loss Slack content is unavailable.` (exit 0)
  - `repro-target-bindings.mts`: all 10 service × reply combinations return `"ok"` (exit 0)
  - `reproduce-slack-ui.ps1`: 5/5 tests PASS (exit 0)
  - `repro-dense-history.mts`: `sixPageChannel { status: "confirmed", sendCalls: 1, reconcileStatus: "confirmed" }` (exit 0)
  - `repro-emoji-readback.mts`: `emoji { status: "confirmed", sendCalls: 1, reconcileStatus: "confirmed" }` (exit 0)
  - `repro-source-reply-recovery.mts`: `retry { status: 200 }` (exit 0)
  - `repro-jira-cross-project-dedup.mjs`: `calledTools ["jira.search_issues", "jira.create_issue"]`, `step2Key "NEW-1"` (exit 0)
  - Standalone `eval-slack-triage.mjs` without `apps/` & `packages/`: fails closed with `SLACK_EVAL_RUNTIME_SOURCES_MISSING` (exit 1)
- Full repository gate (`npm run check` against PostgreSQL 16 test DB on port 56534):
  - `typecheck:v3`: exit 0
  - `test:v3`: 5,039 Vitest tests + 32 probe tests PASS (`tool-schemas` 556, `tool-adapters` 596 + 32, `planner` 479, `executor` 54, `chat-api` 2,275, `chat-web` 1,079)
  - `test:eval:v3`: 27 test files, 418 tests PASS (including `static-guard.test.ts` and `slack-eval-harness.test.mjs`)
  - `build:v3` & `test-v3-web-build-security.mjs`: PASS
  - `test:launcher:v3` & Node test suites: 99 tests PASS
