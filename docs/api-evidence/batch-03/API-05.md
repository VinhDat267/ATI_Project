# API-05 — loopback acceptance gate and frontend handoff

Date: 2026-09-15

## CONFIRMED

- A real Node HTTP client can create a run, poll strictly increasing event sequences, read the run detail, submit the exact persisted approval tuple, drain the paged trace, and read the reconciliation projection.
- The `b02` task_hub workflow performs no hub mutation before approval and produces a receipt only after the approved execute outbox job completes.
- The two-server `fs-copy-notify` fixture performs no filesystem mutation before approval, writes exact UTF-8 bytes after approval, records one filesystem dispatch marker, and records one task_hub receipt.
- The Windows gate uses `cmd.exe` for npm commands, captures stdout/stderr, records command exit codes and source hashes, and redacts credential-shaped values before writing evidence.
- `docs/FRONTEND-HANDOFF.md` maps the API contract to the two-screen wireframes, polling/reconnect behavior, approval actions, trace disclosure, and reconciliation read-only behavior.

## Verification

The reproducible gate was run with `node scripts/check-api.mjs` and exited `0`. It created the sanitized manifest at:

`docs/api-evidence/batch-03/API-05/20260914235751-9441e880-0a87-48ea-89b3-c6c6a7b5120d/manifest.json`

The manifest records these successful commands:

- `npm run check`
- `npm run test:unit -w @wap/api`
- `npm run test:integration -w @wap/api` — includes the two API-05 socket acceptance tests.
- `npm run test:integration -w @wap/mcp-task-hub` — 64 tests passed.
- `npm run test:integration -w @wap/engine` — 63 tests passed across controller and filesystem suites.

The focused acceptance command also passed 2 tests:

`npm run test:integration -w @wap/api -- tests/http-acceptance.integration.test.ts`

## NOT_RUN / OPEN

- The complete negative matrix from the implementation plan is not yet closed: HTTP refusal/rejection/clarification combinations, wrong-owner checks across every route, token-expiry renewal, MCP-dead trace reads, and API restart/history/session checks need dedicated acceptance cases. Existing API-01–04 tests cover individual validation, ownership, approval race, cancellation and expiry guards.
- Browser E2E, reconnect behavior in the real frontend, visual/readability checks, and AI planner quality evaluation remain `NOT_RUN`.
- Official G3 rubric and representative group work remain `OPEN`; `DEV_FIXTURE_PLANNER` proves lifecycle wiring and safety gates, not planner quality.
