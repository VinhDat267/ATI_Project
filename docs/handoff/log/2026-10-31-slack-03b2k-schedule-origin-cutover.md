# 31/10/2026 · 03B2K schedule origin cutover

Worktree `feat/slack-03b2k-schedule-origin` from `35ffe24e` (PR #218 merged). Temporary Postgres `ati-03b2j-pg` at `127.0.0.1:56541`. The long-lived Slack database on port 55439 was not used.

RED: `tests/integration/slack-schedule-origin-runtime.test.ts` failed to import `slack-schedule-origin-backfill.ts`.

GREEN: same file 4/4. Schedule suites 67/67. Slack runtimes that touch schedules 61/61. Typecheck of chat-api and chat-web exit 0.

Source-free schedules are certified in the writer transaction. Slack-sourced schedules stay on 03B2G and are not written into `slack_schedule_origins`. `tick` refuses before `insertRun`. Backfill defaults to dry run. No production backfill.

M2 remains open. 03B3 and 03B4 are not in this branch. The delivery matrix is unchanged until a record PR after merge.

Review of `b92f6564` was Chưa đạt. The same branch now quarantines unmarked legacy and a mismatched certificate, continues the due scan past uncertified rows, and includes `schedules.user_id` in the fingerprint. Focused rerun: origin file 6/6, schedule suites 59/59, Slack schedule runtime and locks 18/18. Typecheck exit 0.
