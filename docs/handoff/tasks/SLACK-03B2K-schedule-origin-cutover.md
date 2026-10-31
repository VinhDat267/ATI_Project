# SLACK-03B2K - Schedule origin cutover

Status: IMPLEMENTED, pending review. Do not mark accepted until exact-head CI is green and the merge tree matches. This card does not close M2.

Scope: `schedules` and the run that `tick`, `planNow` and `planOne` would start. `sealMessageOrigin` on a conversation title does not certify the schedule row. 03B2G lineage stays in place for Slack-sourced schedules.

- Next migration after `0026`. Do not alter `0026`.
- Lock `conversations`, then `schedules`, then the run row.
- Real schedule writers seal the row in the same transaction. `tick`, `planNow` and `planOne` refuse a schedule with no matching certificate or a mutated remainder.
- Backfill dry by default. No production run. Raw SQL fixtures that insert schedules must be converted to the real writer before the read gate is enabled, as 03B2I required for messages.
- One PostgreSQL integration file, RED before the writer change.

This card does not close M2 and does not add a public Slack read.

## Kết quả

RED: `tests/integration/slack-schedule-origin-runtime.test.ts` failed to import `slack-schedule-origin-backfill.ts`.

GREEN on temporary Postgres `127.0.0.1:56541`: that file 4/4, then 6/6 after the review fixes. The rerun of schedule runner, planning, runtime, chat schedules and routes passed inside 59 tests. Slack schedule runtime and locks passed 18/18. `tsc` for `apps/chat-api` and `apps/chat-web` exit 0.

Review at `b92f6564` was Chưa đạt. The follow-up keeps unmarked legacy and a mismatched certificate quarantined, walks the due scan past uncertified rows, and binds `schedules.user_id` into the fingerprint checked against the conversation owner.

`tick` skips an uncertified source-free schedule before `insertRun` and does not pause it as `slack_source_invalidated`. `planOne` discards a planning run that has no certificate. A Slack-sourced schedule still has no row in `slack_schedule_origins`. No production backfill was run. Public read 03B3/03B4 is not in this branch. Matrix, `CURRENT-STATE.md` and `ROADMAP.md` stay for the record PR after merge.

