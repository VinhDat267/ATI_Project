# API-04 — approval, cancellation, expiry and execute dispatch

Date: 2026-09-15

## CONFIRMED

- `POST /api/v1/runs/:id/approval` accepts only strict `ApprovalDecisionSchema`, rechecks owner/version/snapshot/TTL in the engine transaction, returns the new `RunDetail`, and wakes the outbox worker after commit.
- Concurrent approval requests produce exactly one `200` and one `409`; the execute outbox row is created once.
- `POST /api/v1/runs/:id/cancel` uses strict terminal mode: queued runs become `cancelled` with `202`, while a second terminal cancel returns `409` without another event.
- A separate one-second maintenance loop expires pending approvals using PostgreSQL `clock_timestamp()`, emits the terminal lifecycle events atomically, and does not require MCP/gateway access.
- The dispatcher consumes both `prepare` and `execute` outbox jobs. Startup runs orphan recovery before picking jobs; duplicate/terminal jobs do not dispatch a tool again.

## Verification

- `npm run test:integration -w @wap/api -- tests/approval.integration.test.ts tests/cancel-expiry.integration.test.ts`: 3 passed.
- `npm run build -w @wap/dsl`, `@wap/engine`, `@wap/api`: passed.
- `npm run typecheck`: passed after implementation.
- `npm run test:integration -w @wap/engine`: 103 passed across controller and filesystem suites.

## NOT_RUN / OPEN

- Full crash/lost-response matrix over both live MCP servers and HTTP subprocess restart is reserved for the API-05 acceptance gate.
- Browser UI, AI planner evaluation, and official rubric/user-work validation remain `NOT_RUN`/`OPEN`.
