# API-03 — owned read model, events, trace and reconciliation

Date: 2026-09-15
Scope: B/local HTTP API over the existing PostgreSQL engine.

## CONFIRMED

- `GET /api/v1/runs` returns only the authenticated principal's runs, ordered by `created_at DESC, id DESC`.
- `GET /api/v1/runs/:id` includes additive `source_prompt`, `created_at`, and durable `read_outputs` fields. Legacy CLI detail payloads remain valid against the shared schema.
- `GET /api/v1/runs/:id/events?since_seq=N` validates a decimal non-negative cursor and caps each page at 200 events.
- `GET /api/v1/runs/:id/trace` materializes a PostgreSQL `REPEATABLE READ` snapshot, pages 100 attempts, signs cursors with HMAC-SHA256, binds them to user/run, and expires snapshots after 15 minutes. More than 10,000 attempts returns `409 HISTORY_LIMIT`.
- `GET /api/v1/runs/:id/reconciliation` validates and returns a `read_only: true` receipt/dispatch-marker projection. It performs no retry or resume.
- API projections recursively redact sensitive keys such as `token`, `authorization`, `password`, `secret`, and cookies.

## Verification

- `npm run test:integration -w @wap/api`: 8 passed (API-01, API-02, API-03).
- `npm test -w @wap/dsl`: 42 passed.
- `npm run build -w @wap/dsl`, `@wap/engine`, `@wap/api`: passed.
- `npm run api:generate`: pending final full check after this evidence update.

## NOT_RUN / OPEN

- Live deployment, browser UI, external MCP, and AI planner evaluation remain `NOT_RUN`.
- PostgreSQL production retention/cleanup scheduling for expired trace snapshots is not yet implemented; expiry is enforced on read.
