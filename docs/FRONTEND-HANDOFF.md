# Frontend handoff — WEB-03 Browser Verification & Gate G3 Closure

Status: `WEB_BROWSER_EXERCISED_PASS` on branch `feat/web-03-browser-runner-g3` (2026-09-19). Live frontend browser verification and Gate G3 acceptance are complete. See `docs/WEB-STATUS.md` for the formal verification report and gate manifest references. TanStack Query v5 caches server projections while session-scoped pure-TypeScript controllers manage atomic event sequence ingestion, uncertain write mutations, command mutual exclusion, and trace cursor pagination.

## Verification Summary

- **Web Gate Runner**: `npm run check:web` executes all 6 gate commands sequentially with automated delta cleanup tracking and sanitized evidence capture.
- **TypeScript Typecheck**: `npm run typecheck -w @wap/web` passed (0 errors across app, tools, tests).
- **Unit Tests**: `npm run test:unit -w @wap/web` passed (21 files, 128 tests green). Runner unit tests: `node --test scripts/check-web.test.mjs` passed (14 tests green).
- **StrictMode Development Browser Test**: `npm exec -w @wap/web -- playwright test --config=playwright.strict.config.ts` passed (1 test green, verified polling continuity across React StrictMode effect replay and SPA navigation).
- **Fixture Browser Tests**: `npm run test:browser -w @wap/web` passed (27 tests green, 0 axe violations, 0 horizontal overflow, zero credential persistence across 5 routes, XSS canary text rendering, multi-tab session isolation, logout generation fencing).
- **Live Browser E2E Tests**: `npm run test:live -w @wap/web` passed (10 tests green across receiver database receipts oracle, negative rejection & cancellation 0 writes, partial cleanup, DB drop/port release, create uncertainty fence, lifecycle, login, NFR-03 latency gate).
- **NFR-03 Local Latency Gate**: Event-to-DOM render latency $\ge$ 30 observations, $p50 = 1876$ms, $p95 = 1996$ms (target: $p95 \le 3000$ms).
- **Production Bundle Budgets**:
  - Live bundle JS: 175.34 KiB initial gzip (budget: ≤ 200 KiB / 204,800 bytes).
  - Live bundle CSS: 6.31 KiB initial gzip (budget: ≤ 30 KiB / 30,720 bytes).
  - Fixture leakage audit: 0 synthetic fixture modules in live bundle.
- **Delta Cleanup Oracle**: PASS (0 leaked `api_it_*` databases, 0 leaked temporary roots, 0 leaked processes after every gate command).

## Architecture & Guarantees

### 1. In-Memory Session Isolation & Generation Fencing
- Bearer tokens, active request abort controllers, and draft stores reside strictly in JavaScript memory for the active browser tab.
- Zero persistence: `localStorage`, `sessionStorage`, cookies, query parameters, HTML, and logs never store credentials or tokens.
- An integer `generation` advances on login, logout, or session reset. All in-flight requests and callbacks check `isCurrent()`, discarding late responses or stale 401s across session boundaries.

### 2. Contiguous Ordered Event Ingestion (`ingestEvents`)
- `apps/web/src/core/events.ts`: Pure immutable reducer enforces monotonically increasing contiguous `seq`.
- Sequence gaps halt cursor advancement and flag protocol errors; duplicate events with identical payloads are idempotent no-ops; conflicting payloads at the same sequence raise fatal errors.
- Tail drainage continues until the terminal `run.finished` event is ingested or polling times out.

### 3. Session-Scoped Pure-TypeScript Controllers
- **`RunSyncController`** (`apps/web/src/controllers/run-sync.ts`): Single-flight polling coordinator synchronizing `RunDetail` and event stream without concurrent duplicated requests. Tracks `pollingEpoch`, `isTickInProgress`, and `hasPendingImmediateIntent` with sibling `Promise.allSettled` settlement, ensuring clean restart without dropping ticks or running overlapping requests during React StrictMode effect replay or rapid navigation.
- **`CreateRunController`** (`apps/web/src/controllers/create-run.ts`): Manages run creation lifecycle (`idle | submitting | confirming | accepted | error`). Lost responses/timeouts transition to `confirming` with `lostAt` timestamp. Because the backend API lacks request correlation / idempotency keys, prompt equality or history queries cannot prove a lost POST succeeded. The uncertainty fence remains locked in `confirming` for the remainder of the session tab. `submit()` is blocked at the controller level during `submitting` or `confirming`, `reset()` is a no-op when unknown, and unsafe prompt-based reconciliation is completely eliminated. Replay-safe `teardown()` aborts in-flight requests while preserving uncertainty fences across StrictMode effect replays.
- **`RunCommandController`** (`apps/web/src/controllers/run-commands.ts`): Coordinates shared approval and cancellation for each run with mutual exclusion (approving locks cancel; cancelling locks approve/reject). Reconciles uncertain command outcomes via `reconcileWithDetail(run)`.
- **`TraceController`** (`apps/web/src/controllers/trace.ts`): Paginates attempts with opaque cursors; automatically restarts pagination from the beginning upon receiving a 400 Bad Request (expired/invalid cursor).
- **`ControllerRegistry`** (`apps/web/src/controllers/registry.ts`): Session-scoped store registry instantiated per session generation and cleaned up on logout/clear.

### 4. Local Loopback Proxy & Live Test Fixture
- `apps/web/tooling/local-proxy.ts`: Vite plugin forwarding relative `/api/v1` requests to loopback API targets, stripping forbidden headers and rejecting foreign origins.
- `apps/web/tests/live/fixtures.ts` & `cleanup.ts`: Launches isolated backend API fixture (`makeApiFixture`) on dynamic ports, provisions ephemeral databases (`api_it_*`), serves preview builds on dynamic ports. Guarantees cleanup-on-failure: if preview startup or port resolution fails midway, previously acquired API processes and databases are reliably closed and dropped, and environment variables are restored. Safe teardown guarantees both preview and API closures even if one throws.

### 5. Receiver Database Oracle, Browser Security & Latency Gates
- **Receiver Database Oracle**: `apps/web/tests/live/lifecycle.spec.ts` verifies PostgreSQL `hub_receipts` table via structural client typing (`ReceiverDatabaseClient`) without static imports from backend packages. Verifies 0 receipts prior to approval, exactly 2 receiver receipts upon successful b02 execution completion, and 0 receiver receipts on rejection or cancellation.
- **XSS Canary & Zero Storage Persistence**: `apps/web/tests/browser/security.spec.ts` asserts that unescaped markup payloads render strictly as text children without script execution or DOM image injection. Audits all 5 core routes asserting zero authentication persistence in `localStorage`, `sessionStorage`, or cookies.
- **Multi-Tab Session Isolation**: `apps/web/tests/browser/session-races.spec.ts` verifies that independent browser tabs/contexts do not share in-memory session tokens, and logging out advances session generation without leaving persistent residual storage.
- **NFR-03 Local Latency Gate**: `apps/web/tests/live/nfr03-latency.spec.ts` collects $\ge$ 30 server event timestamp $\to$ DOM status paint observations, memoizing initial render timestamps per sequence via `useRef<Map<number, string>>` in `RunView.tsx` to prevent re-render measurement skew, asserting $p95 \le 3000$ms.

## Test Commands

```bash
# Full automated web gate runner (typecheck, unit, strict, fixture, live, bundle, cleanup oracle)
npm run check:web

# Run unit tests
npm run test:unit -w @wap/web

# Run fixture browser tests (synthetic world, a11y, security, session races)
npm run test:browser -w @wap/web

# Run live E2E tests against real ephemeral backend API (oracle receipts, negative paths, NFR-03 latency)
npm run test:live -w @wap/web

# Typecheck frontend and tooling
npm run typecheck -w @wap/web

# Build production live bundle
npm run build -w @wap/web -- --mode live
```

The API listens on loopback and uses the `/api/v1` prefix. The frontend keeps the bearer token in memory for the current tab and sends it only as `Authorization: Bearer <token>`. Do not store it in localStorage, cookies, URLs, logs, or HTML.

## Wire examples

```json
POST /api/v1/runs
{"source_prompt":"Chép nguyên các dòng Progress!A1:B2 trong bảng source sang sheet Report của bảng dest, rồi gửi vào #team thông báo số dòng đã chép.","inputs":{},"time_zone":"Asia/Ho_Chi_Minh"}

202
{"run_id":"11111111-1111-4111-8111-111111111111","status":"planning"}
```

`RunDetail` contains `run_id`, `status`, `workflow_version_id`, `plan`, `planner_result`, `approval`, `time_zone`, `runtime`, `last_seq`, and the API-03 additions `source_prompt`, `created_at`, `read_outputs`. The three additions are optional in the shared schema for legacy CLI payloads; API responses always include them.

```json
{
  "run_id":"11111111-1111-4111-8111-111111111111",
  "status":"planning",
  "workflow_version_id":null,
  "plan":null,
  "planner_result":null,
  "approval":null,
  "time_zone":"Asia/Ho_Chi_Minh",
  "runtime":{},
  "last_seq":4,
  "source_prompt":"Chép nguyên các dòng Progress!A1:B2 trong bảng source sang sheet Report của bảng dest, rồi gửi vào #team thông báo số dòng đã chép.",
  "created_at":"2026-09-15T08:00:00.000Z",
  "read_outputs":{}
}
```

Approval uses the exact persisted fields; the wire name is `workflow_version_id`:

```json
POST /api/v1/runs/{run_id}/approval
{"approval_id":"33333333-3333-4333-8333-333333333333","workflow_version_id":"22222222-2222-4222-8222-222222222222","snapshot_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","decision":"approved"}
```

`POST /api/v1/runs/{run_id}/cancel` is cooperative and returns `202` with an empty body. A terminal run returns `409`. Approval expiry is decided by the server clock; the client must refetch detail after `409`.

Poll `GET /api/v1/runs/{run_id}/events?since_seq=<last_seq>` every two seconds. Accept only strictly increasing `seq`; merge pages only after successful ingest. An empty page keeps the cursor. `dryrun.ready` means fetch `RunDetail` for the full approval preview. `Trace` is paged with opaque `next_cursor`; restart without a cursor after expiry. `Reconciliation` is read-only and never supplies a replay action.

```json
{"events":[],"next_seq":4}
```

Trace attempts expose evidence, tool snapshot, resolved args, result, certainty and error metadata. Sensitive payload keys and configured secret values are redacted in transport and materialized trace projections. Writes containing configured secret values are blocked before approval and checked again against saved previews. Render all tool output as text; never use `innerHTML`.

## Status mapping

The 14 server statuses are: `planning`, `validating`, `dry_running`, `awaiting_approval`, `running`, `replanning`, `succeeded`, `failed`, `rejected`, `cancelled`, `expired`, `refused`, `needs_input`, `reconciliation_required`.

Terminal statuses are: `succeeded`, `failed`, `rejected`, `cancelled`, `expired`, `refused`, `needs_input`, `reconciliation_required`. There are no transitions or events after the terminal `run.finished` event. `reconciliation_required` intentionally has no retry button.

## Error handling

The error envelope is `{ "error": { "code", "message", "request_id" } }`. Handle `400` invalid shape/UUID/timezone/cursor, `401` missing or expired bearer, `404` absent or foreign run, `409` conflict/expiry/history limit, `413` body too large, `415` non-JSON request, `429` login throttle, `503` unavailable planner/dependency, and `500` unexpected invariant failure. Preserve `request_id` for support diagnostics without logging request bodies or credentials.

## Component inputs

- `StatusPill` ← `RunDetail.status`; map every enum explicitly and provide an accessible label.
- `TechDisclosure` ← preview/trace/reconciliation safe projections; disclosure is text-only and can be opened with keyboard.
- `ProgressStrip` ← status plus ordered event sequence; never infer a later status from a local animation.
- `ActionCard` ← `approval.actions`; only show approve/reject while decision is pending and TTL is live.
- `TimelineRow` ← event and attempt snapshots; show unknown certainty and keep replay unavailable.

The proposed layouts in `docs/screens.html` and `docs/wireframes.html` remain design references. Container queries, mobile order, focus visibility, disclosure overflow and browser pixel/readability checks belong to WEB-01/WEB-03.
