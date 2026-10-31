# Read path after schedule origin is accepted

Do not implement [2026-10-30-slack-03b3-executor-binding-and-approval.md](2026-10-30-slack-03b3-executor-binding-and-approval.md) as written. That plan is anchored at `612ac427`, before 03B2F, 03B2G, 03B2I and 03B2J.

Start only after 03B2K is accepted.

## 03B3 read only

- Server builds the five-field Slack binding before the plan hash. The model does not supply it.
- The guard checks the same envelope that would be dispatched.
- Only the eight 03C1 reads may pass: `conversations.list`, `conversations.info`, `conversations.history`, `conversations.replies`, `conversations.members`, `users.list`, `users.info`, `chat.getPermalink`.
- Any other `myslack.*` name, and every write, fails before transport. Writes stay blocked until 04C. That is milestone 3, not milestone 2.
- Reuse `assertSourceDispatchAllowed` and the plan-origin gate. Do not add a second approval hash.

## 03B4 one read through the app

- 03B3 without a workspace choice stays fail closed. 03B4 adds the route, planner step and the existing settings choice so one of the eight reads runs through the app on the fixture HTTP server.
- The test shows owner and workspace isolation, and that revoke or a policy change blocks a second use and erases the derived copy.
- Passing that test is the milestone 2 close. It is not the inbox, the three modes, or a live Slack workspace.

Flags stay off. `myslack` stays out of `ALL_TOOLS`.
