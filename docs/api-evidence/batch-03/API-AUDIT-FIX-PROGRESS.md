# API audit fix progress

Baseline: e71ebf4. Requirements: docs/AUDIT-API-01-05-2026-09-15.md and the HTTP lifecycle spec.

- Worker/recovery (root): A01, A02, A03, A05; regression tests then engine-owned settlement and recovery gating.
- HTTP/security (api_http_fixes): A04, A07, A08, A09; separate edits to constructor/security projection only in shared engine files.
- Gate (api_gate_fixes): A10 and runner/provenance portion of A11.
- Integration/bootstrap/acceptance (root): A06 and remaining A11, followed by review and fresh full gate.

Ruling: work on a dedicated fix branch in the existing checkout. Preserve installed reviewed MCP artifacts and all pre-existing untracked evidence; no reset/clean or migration rewrites.
Shared-file agreement: root owns Store.claimPrepare, recovery, worker and bootstrap; HTTP agent owns secret constructor options, safe trace projection and prepare secret guard. Gate files are independent. Root integrates test fixture changes.

Status: implementation complete for the identified A01–A10 code defects and the exercised A11 evidence defects. The API verdict remains `API_PARTIAL` until the runner's remaining negative/process matrix and independently verified cleanup evidence are complete.

Verification recorded on 2026-09-15:

- A01/A02/A03/A05: worker recovery, claim fencing, transient query retry and terminal settlement regressions pass (`audit-worker.integration.test.ts`, `audit-worker.test.ts`).
- A04/A07/A08/A09: secret guard/projection, `EXPIRED` 409 mapping, internal-vs-input validation and live server lifecycle tests pass (`audit-http*`, `audit-saved-secret*`, `audit-transport*`).
- A06/A11: disabled-planner execution, production bootstrap with unavailable MCP, event tail draining, concurrent admission, rollback and rejection/no-write checks pass.
- Gate helper: `node --test scripts/check-api.test.mjs` passes 9/9; the runner now includes engine unit tests, broad provenance and conservative `PARTIAL` assessment.

Remaining evidence limits: browser E2E, AI evaluation, official rubric and representative group work are independent `NOT_RUN`/`OPEN` items. Slow/chunked HTTP, OS-crash restart, complete fault-injection matrix and independent fixture cleanup observation remain `NOT_ESTABLISHED`.
