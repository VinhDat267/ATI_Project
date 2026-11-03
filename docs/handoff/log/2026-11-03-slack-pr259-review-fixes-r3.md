# Handoff Log — 2026-11-03 — PR #259 Review Remediation Round 3 (R2 — `member_left_channel` Actor Isolation)

- **Branch**: `feat/slack-complete-integration` (PR #259)
- **Review Reference**: `2026-11-03-review-pr259-r3.md` (1 P1 finding against `9b8b04ad`)

## Summary of Fix

1. **R2 (P1 — `member_left_channel` merged `event.user` with `envelope.authorizations`, causing cross-owner Slack data purge)**:
   - Separated `member_left_channel` and `group_left` handling in `classifyLifecycle` (`apps/chat-api/src/services/slack/slack-ingress-service.ts`):
     - For `member_left_channel`: strictly requires `event.user` and sets `slackUserIds: [eventUserId]`, never reading `envelope.authorizations` or `envelope.authed_users` (which represent event visibility targets rather than the departing actor).
     - For `group_left`: uses `event.user` if present; only when `event.user` is omitted does it consult non-bot `envelope.authorizations` (matching `team_id`) or `envelope.authed_users`, and strictly requires an unambiguous single actor (`slackUserIds.length === 1`), rejecting `0` or `>1` actors with `400 MALFORMED_EVENT`.
   - Enforced single-actor invariant (`ids.length === 1` and `WHERE actor_id = $3`) for `channel_membership_lost` in `SlackEventReceiptRepo` (`apps/chat-api/src/db/repositories/slack-event-receipt-repo.ts`).
   - Added regression test `T3.12` in `apps/chat-api/tests/services/slack-ingress-service.test.ts`.

## Verification Evidence

- Round 3 probe (`r3-member-left-auth-probe.mts` with `event.user = 'U_LEAVING'` and `authorizations = [{ team_id: 'T_TEAM', user_id: 'U_STAYING', is_bot: false }]`):
  - Output: `{"response":{"status":200,"body":{"ok":true,"status":"recorded"}},"slackUserIds":["U_LEAVING"],"actorsThatWillBeSelectedByRepo":["U_LEAVING"]}`
- `npm run typecheck:v3`: exit 0
- `npx vitest run apps/chat-api/tests/services/slack-ingress-service.test.ts apps/chat-api/tests/services/slack-private-read-wrapper.test.ts`: 42 tests PASS (exit 0)
- `npm run test:eval:v3`: 27 test files, 418 tests PASS (exit 0)
