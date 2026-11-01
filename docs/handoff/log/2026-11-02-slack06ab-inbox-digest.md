# SLACK-06A & SLACK-06B · Protected Proposal Inbox, Cross-Service Workflows, Daily Digest & 7-Kind Physical Erasure

- **Date:** 2026-11-02
- **Branch:** `feat/slack-05-modes` (continuing from `6f5698a1c3ec29827dd50d3714d8670f5bd40c59`)
- **Worktree:** `615f/ATI_Project`
- **PostgreSQL 16 Container:** `ati-slack-m4-20261101` on port `56569`

## 1. Phase 1 — Audit of `SLACK-05A` (`6f5698a1`)
- Audited `SLACK-05A` across both User/Business value and Technical/Security invariants (owner/workspace isolation, CAS, budget reservation, physical erasure).
- **Finding & Fix:** In `apps/chat-api/src/services/slack/slack-rules-engine.ts`, `slackPersonalRelevance` previously checked `followed`, `mention`, `authorIds`, and `keywords`, which meant an eligible 1:1 DM (`channelType === 'im'`) in `ai` mode without an explicit `<@USER>` mention or rule keyword was rejected at the personal-relevance gate even when the model classified it as a direct request. Updated `slackPersonalRelevance` to recognize `input.channelType === 'im'` (`kind: 'dm'`) and added unit coverage in `apps/chat-api/tests/services/slack/slack-rules-engine.test.ts` (`5/5 PASS`).

## 2. Phase 2 — `SLACK-06A`: Protected Inbox, Refine/Approval & Cross-Service Workflows
- **Schemas (`packages/tool-schemas`):**
  - Added `SLACK_PROPOSAL_WORKFLOW_TOOLS`, `validateSlackProposalRevisionInput`, and `validateSlackProposalPrepareInput` in `packages/tool-schemas/src/myslack-assistant.ts`.
  - Added `validateSlackSourceReplyPlan` in `packages/tool-schemas/src/myslack-post-plan.ts` for source-bound referenced thread replies (`thread_ts` + `{{steps.step_1.output.url}}`).
- **Planner (`packages/planner`):**
  - Created `packages/planner/src/slack-proposal-plan.ts` (`planSlackProposalWorkflow`) supporting cross-service workflows:
    - Task creation (`trello.create_card`) + optional source-bound Slack thread reply (`myslack.chat_postMessage` with `thread_ts` and certified card URL reference).
    - Vague deadline detection (`sớm`, `tuần sau`, `khi có thể`, `asap`, etc.) returning `needs_info` until a concrete `YYYY-MM-DD` date is supplied.
    - Issue deduplication (`jira.search_issues` lookup before `jira.create_issue`).
    - Progress logging (`mysheets.append_rows`) gated on personal spreadsheet scope readiness.
- **Database Migration & Backend (`db/v3/0031_slack_inbox_and_digest.sql`, `apps/chat-api`, `packages/executor`):**
  - Added migration `db/v3/0031_slack_inbox_and_digest.sql` extending `slack_assistant_artifacts` with `active_plan_id`, `local_date`, status `'awaiting_approval'`, unique index `slack_assistant_digest_day`, and `thread_ts` on `slack_write_outbox`.
  - Updated `packages/executor/src/runner.ts` (`resolveTemplatesInObject`) so template references (`{{steps.step_1.output.url}}`) inside nested objects (`slackWrite.message`) resolve cleanly before tool execution.
  - Extended `SlackWriteOutboxRepo`, `SlackSafeWriter`, and `slack-write-plan.ts` to support the `source_thread_reply` family (`thread_ts` sent in `chat.postMessage` and verified via `conversations.replies` during `UNKNOWN` reconciliation with zero duplicate sends).
  - Fixed `guardPlanInTransaction` in `apps/chat-api/src/services/slack/slack-plan-lineage.ts` to refresh `copies` after acquiring the conversation lock (`prepareConversationWriteInTransaction`) so concurrent step creation/updates never see stale pre-lock lineage sets.
  - Implemented `SlackProposalService` (`apps/chat-api/src/services/slack/slack-proposal-service.ts`) and routes (`POST /api/slack/proposals/:id/refine`, `POST /api/slack/proposals/:id/prepare`, `POST /api/slack/proposals/:id/reject`) with owner/workspace isolation, `expectedRevision` CAS, and source/epoch/expiry checks before returning DTOs.
- **Frontend (`apps/chat-web`):**
  - Extended `apps/chat-web/src/services/slack-assistant.ts` with proposal and digest client methods.
  - Created `apps/chat-web/src/components/slack/SlackProposalCard.tsx` and `apps/chat-web/src/components/slack/SlackProposalInbox.tsx` and mounted `/inbox` in `apps/chat-web/src/routes.ts` and `apps/chat-web/src/App.tsx`.

## 3. Phase 3 — `SLACK-06B`: Daily Digest & 7-Kind Physical Erasure Chain
- Implemented `SlackDigestService` (`apps/chat-api/src/services/slack/slack-digest-service.ts`) and wired it to the assistant heartbeat runner (`apps/chat-api/src/config/slack-assistant-runtime.ts`) and routes (`GET /api/slack/digests`, `POST /api/slack/digests/:id/refresh-status`).
- Enforces IANA timezone local window (`>= configured HH:MM`, default `09:00`), at most one digest per `(connection_id, local_date)`, zero external writes during digest generation, and guarded provenance registration for `daily_digest_entry`.
- Added Daily Digest controls and `/inbox` link in `apps/chat-web/src/components/slack/SlackAutomationSettings.tsx`.
- Verified the full 7-kind physical erasure chain (`audit_log_entry`, `chat_history_message`, `daily_digest_entry`, `plan_step_arg`, `proposal_excerpt`, `scheduled_workflow_arg`, `working_memory_entity`) in `apps/chat-api/tests/services/slack/slack-digest-service.test.ts` when a source message is deleted even with runtime flags off.

## 4. Verification Summary
- `npx vitest run packages/tool-schemas/tests/myslack-assistant.test.ts packages/tool-schemas/tests/myslack-post-plan.test.ts packages/planner/tests/slack-proposal-plan.test.ts apps/chat-api/tests/services/slack/slack-rules-engine.test.ts apps/chat-api/tests/services/slack/slack-triage-worker.test.ts apps/chat-api/tests/routes/slack-assistant.test.ts apps/chat-api/tests/routes/slack-proposals.test.ts apps/chat-api/tests/services/slack/slack-digest-service.test.ts --maxWorkers=2`: **8 files, 77/77 PASS**
- `npm --workspace @wap/chat-web test -- tests/slack-assistant-settings.test.tsx tests/slack-proposal-inbox.test.tsx`: **2 files, 9/9 PASS**
- `npm run typecheck:v3`: **PASS (0 errors)**
- `npx vitest run evaluations --maxWorkers=2`: **25 files, 406/406 PASS** (including `evaluations/generic-plumbing/static-guard.test.ts`)
