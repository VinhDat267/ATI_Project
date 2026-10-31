# SLACK-03B2J - Plan, step and audit origin cutover

Status: CODE_COMPLETE on `feat/slack-03b2j`. Base `6dbbaa9b` (PR #216 head). Independent review, exact-head CI and staging publication are pending. M2 stays open.

Deliverable: a source-free plan and its execution steps carry a private origin certificate from the real writer transaction. Approval, execution snapshot and dispatch reject an unmarked or mutated plan. Audit is `output_json` and `error_json` on `execution_steps`. This does not redo 03B2F lineage for Slack-sourced plans.

Owner: `apps/chat-api/`, migration `db/v3/0026_slack_plan_origin.sql`, this card and one log. No schedule rows. No `myslack` catalog entry. No live flag.

Acceptance:

- [x] Raw SQL plan text stays stored but is hidden, and approval and dispatch throw or return false.
- [x] `PlanRepo.createPlan` plus `StepRepo.createStep` and `updateStepStatus` seal and then read back.
- [x] A later SQL insert or a mutated `plan_text` is hidden.
- [x] Backfill defaults to dry run. `--apply` certifies plans with no Slack marker and leaves text containing `myslack` quarantined.
- [x] Focused PostgreSQL test `tests/integration/slack-plan-origin-runtime.test.ts` 3/3 on temporary Postgres `127.0.0.1:56541`.
- [ ] Exact published-head check and browser CI, identical merge tree, reviewer checkpoint.

## Kết quả

RED: the new test file failed to load because `slack-plan-origin-backfill.ts` did not exist. After the writer and gate, 3/3 passed. `execution-routes`, `execution-security` and `memory-execution-snapshot` then passed 15/15 together with this file (18/18). Full `chat-api` suite on this machine also fails on the pre-change base (`validateSlackBinding is not a function`, Slack plan fixture `fixture policy denied`); those are not regressions of this card.

Schedule origin is 03B2K and is not implemented here. Public read 03B3/03B4 is not implemented here. No production backfill was run.
