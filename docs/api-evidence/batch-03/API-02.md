# API-02 — durable acceptance and asynchronous preparation

Date: 2026-09-15

## Verdict

`CONFIRMED` for durable acceptance and the development planner/prepare worker described below. The planner is a server-owned fixture (`DEV_FIXTURE_PLANNER`), not an AI evaluation.

## Delivered

- `WorkflowEngine.accept()` validates `CreateRunSchema`, snapshots runtime/time zone, enforces one active run with a PostgreSQL advisory transaction lock, and commits workflow/run/status event/prepare outbox atomically.
- `POST /api/v1/runs` returns `202 {run_id,status:"planning"}` after commit and never waits for MCP or planner work.
- `GET /api/v1/runs/:id` reads the owner-bound detail; planning runs retain `workflow_version_id: null`.
- `PlannerPort` and a strict server-owned dev planner load exactly `b02`, `fs-copy-notify`, and `fs-card-export`; prompt matching is exact after trim and unknown prompts become clarification.
- A single non-overlapping dispatcher claims pending prepare jobs, runs the planner, persists `planner_result`, and prepares the same run. The b02 path uses the reviewed task_hub gateway for read-only preview and leaves receiver writes untouched before approval.
- Existing manual CLI preparation was preserved and the full controller regression suite remains green.

## Verification evidence

| Check                                                                              | Result                                                                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run test:integration -w @wap/api -- tests/create-run.integration.test.ts`     | accepted run, detail, one outbox row, and `delivered_at IS NULL` passed                                   |
| `npm run test:integration -w @wap/api -- tests/prepare-worker.integration.test.ts` | real PostgreSQL + real task_hub MCP read reached `awaiting_approval`; two actions, zero receipts/messages |
| `npm run test:unit -w @wap/api`                                                    | `8/8` passed, including exact-match dev planner                                                           |
| `npm run test:integration -w @wap/engine -- tests/controller.integration.test.ts`  | existing controller regression `40/40` passed                                                             |
| `npm run typecheck` and `npm run build -w @wap/api`                                | passed                                                                                                    |

The API fixture creates a uniquely named PostgreSQL database and cleans it up. No credentials or tokens are written to this report.

## Deferred

- `NOT_RUN`: approval/cancel/expiry/execute HTTP routes and execute dispatcher.
- `NOT_RUN`: trace/event/history pagination, reconciliation read model, filesystem worker path, browser UI, and AI planner quality/cost evaluation.
