# API-01 — local HTTP boundary and authentication

Date: 2026-09-15
Scope: `apps/api` only, plus shared DSL/OpenAPI contracts required by the boundary.

## Verdict

`CONFIRMED` for the API-01 scope below. This checkpoint does not claim that run creation, planning, execution, polling, approval, trace, or browser UI are implemented.

## Delivered

- Loopback Node HTTP server with request, header, keep-alive, body-size, JSON content-type, request-id, no-store, and `nosniff` boundaries.
- Strict shared Zod contracts for login, API errors, and server summaries; `docs/openapi.yaml` is regenerated from those contracts.
- Single configured local demo principal backed by the real `users` table, scrypt password verification, opaque in-memory bearer sessions, TTL, bounded login attempts, and bounded concurrent KDF work.
- `POST /api/v1/auth/login` and authenticated `GET /api/v1/servers`.
- Unknown routes and methods return structured errors. Run routes authenticate but intentionally return `501 NOT_IMPLEMENTED` until API-02.
- Required environment configuration is documented without default credentials.

## Verification evidence

The following commands completed successfully from the repository root:

| Check | Result |
| --- | --- |
| `npm test` | `40/40` DSL tests passed |
| `npm run test:unit -w @wap/api` | `7/7` API unit tests passed |
| `npm run typecheck` | passed |
| `npm run build` | DSL, DB, MCP, engine, and API builds passed |
| `npm run api:generate` | OpenAPI YAML and generated TypeScript emitted successfully |
| `npm run test:integration -w @wap/api -- tests/auth.integration.test.ts` | real PostgreSQL database + real HTTP socket passed (`1/1`) |

The integration fixture creates a uniquely named temporary PostgreSQL database, seeds the demo user, verifies wrong-password rejection and successful bearer access to `/servers`, then drops the temporary database in teardown.

## Not run / deferred

- `NOT_RUN`: API-02 queue/worker integration and durable outbox.
- `NOT_RUN`: run lifecycle endpoints, SSE/WebSocket, trace cursor pagination, approvals, cancellation, reconciliation, planner/LLM, MCP, and filesystem calls.
- `NOT_RUN`: browser/UI end-to-end and production deployment hardening.
