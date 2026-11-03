# SLACK-03B2J plan and step origin cutover

Base: PR #216 head `6dbbaa9b`. Do not redo 03B2F. Slack-sourced plans keep derived lineage. This card certifies source-free plans and steps.

1. Migration `0026` adds `slack_plan_origin_cutovers` (`plan-origin-v1`) and `slack_plan_origins` for `plans` and `execution_steps` only.
2. `sealPlanOrigin` locks conversation, then plan, then the artifact, and writes the fingerprint from the locked row. Callers do not supply the hash.
3. `PlanRepo.createPlan` seals `plan_writer`. `createSlackPlan` does not. `StepRepo.createStep` seals `step_writer` only for a non-source plan. `updateStepStatus` reseals `step_status`.
4. `guardPlanInTransaction` hides and sets `allowed: false` when a non-source plan has no matching certificate. `guardStepRowsInTransaction` tombstones a step with no certificate. `approvePlan` and `assertSourceDispatchAllowed` already stop when `allowed` is false.
5. Real `ExecutionService` dispatch calls `assertSourceDispatchAllowed` when that method exists. Mocks without it keep the previous path.
6. `SlackPlanOriginBackfill.page` is dry unless `apply` is true. A `myslack` string or a lineage manifest stays quarantined.
7. Physical purge reseals a plan or step only when the previous certificate still matched.

Tests: `apps/chat-api/tests/integration/slack-plan-origin-runtime.test.ts`.
CLI: `apps/chat-api/src/cli/slack-plan-origin-backfill.ts [--apply]`.
