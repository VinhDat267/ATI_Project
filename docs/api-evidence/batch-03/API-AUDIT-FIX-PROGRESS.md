# API audit fix progress

Baseline: e71ebf4. Requirements: docs/AUDIT-API-01-05-2026-09-15.md and the HTTP lifecycle spec.

- Worker/recovery (root): A01, A02, A03, A05; regression tests then engine-owned settlement and recovery gating.
- HTTP/security (api_http_fixes): A04, A07, A08, A09; separate edits to constructor/security projection only in shared engine files.
- Gate (api_gate_fixes): A10 and runner/provenance portion of A11.
- Integration/bootstrap/acceptance (root): A06 and remaining A11, followed by review and fresh full gate.

Ruling: work on a dedicated fix branch in the existing checkout. Preserve installed reviewed MCP artifacts and all pre-existing untracked evidence; no reset/clean or migration rewrites.
Shared-file agreement: root owns Store.claimPrepare, recovery, worker and bootstrap; HTTP agent owns secret constructor options, safe trace projection and prepare secret guard. Gate files are independent. Root integrates test fixture changes.

Status: implementation complete for the identified A01–A10 code defects and A11 evidence defects. API-GATE closed as `API_TECHNICAL_PASS` on 2026-09-17; the fresh manifest records H01–H20 `PASS`, six command exits `0`, and cleanup `PASS`.

Verification recorded on 2026-09-15:

- A01/A02/A03/A05: worker recovery, claim fencing, transient query retry and terminal settlement regressions pass (`audit-worker.integration.test.ts`, `audit-worker.test.ts`).
- A04/A07/A08/A09: secret guard/projection, `EXPIRED` 409 mapping, internal-vs-input validation and live server lifecycle tests pass (`audit-http*`, `audit-saved-secret*`, `audit-transport*`).
- A06/A11: disabled-planner execution, production bootstrap with unavailable MCP, event tail draining, concurrent admission, rollback and rejection/no-write checks pass.
- Gate helper: `node --test scripts/check-api.test.mjs` passes 13/13; the runner parses structured Vitest reports, fingerprints broad source provenance and fails closed on missing H01–H20 identities or cleanup-oracle errors.
- Fresh full gate after the repository-hygiene provenance fix: [manifest](API-05/20260917072147-30545e43-9414-43c8-9386-7fed97acc4e0/manifest.json) records `API_TECHNICAL_PASS`, process exit `0`, H01–H20 `PASS`, no newly leaked owned DB/temp/process resources after any command, and 182 source fingerprints with generated/test-result directories excluded.

Remaining evidence limits: browser E2E, AI evaluation, official rubric and representative group work are independent `NOT_RUN`/`OPEN` items. The cleanup proof is intentionally a before/after delta and does not claim the host was globally clean before the gate.
