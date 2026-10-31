# SLACK-03B2K - Schedule origin cutover

Status: PLAN_ONLY. Start only after 03B2J is accepted on `integration/slack-personal-20261029` (exact-head CI, identical merge tree, reviewer checkpoint). Do not implement in the 03B2J branch.

Scope: `schedules` and the run that `tick`, `planNow` and `planOne` would start. `sealMessageOrigin` on a conversation title does not certify the schedule row. 03B2G lineage stays in place for Slack-sourced schedules.

- Next migration after `0026`. Do not alter `0026`.
- Lock `conversations`, then `schedules`, then the run row.
- Real schedule writers seal the row in the same transaction. `tick`, `planNow` and `planOne` refuse a schedule with no matching certificate or a mutated remainder.
- Backfill dry by default. No production run. Raw SQL fixtures that insert schedules must be converted to the real writer before the read gate is enabled, as 03B2I required for messages.
- One PostgreSQL integration file, RED before the writer change.

This card does not close M2 and does not add a public Slack read.
