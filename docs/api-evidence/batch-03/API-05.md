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

`docs/api-evidence/batch-03/API-05/20260917072147-30545e43-9414-43c8-9386-7fed97acc4e0/manifest.json`

The manifest records these successful commands:

- `node --test scripts/check-api.test.mjs`
- `npm run check`
- `npm run test:unit -w @wap/api`
- `npm run test:integration -w @wap/api` — includes the complete H01–H20 HTTP/process acceptance matrix.
- `npm run test:integration -w @wap/mcp-task-hub` — 64 tests passed.
- `npm run test:integration -w @wap/engine` — 63 tests passed across controller and filesystem suites.

The gate also records an independent cleanup delta after every command and 182 source fingerprints. Rebuildable `dist`, `generated`, `runtime`, Playwright report and test-result directories are deliberately excluded from source provenance.

## NOT_RUN / OPEN

- Browser E2E, reconnect behavior in the real frontend, visual/readability checks, and AI planner quality evaluation remain `NOT_RUN`.
- Official G3 rubric and representative group work remain `OPEN`; `DEV_FIXTURE_PLANNER` proves lifecycle wiring and safety gates, not planner quality.
