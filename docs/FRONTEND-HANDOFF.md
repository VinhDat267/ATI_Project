# Frontend handoff — API-05 B/local

Status: `API_TECHNICAL_PASS` for the local DEV_FIXTURE planner path (H01–H20 plus independent cleanup delta passed on 2026-09-17). WEB-01B is a **PROVISIONAL_IMPLEMENTATION** (fixture shell only); browser E2E against the real API, polling and AI evaluation are still `NOT_RUN`; official rubric and representative group work remain `OPEN`.

Navigation for the next frontend batch: [platform UX](superpowers/specs/2026-09-15-platform-ux-design.md), six views/four navigation items. WEB-00 synchronizes the UI baseline and selects [React + TypeScript + Vite](ADR-001-FRONTEND-STACK.md) for the [WEB-01–03 implementation plan](superpowers/plans/2026-09-15-frontend-platform.md). The system design gate is [platform system design](superpowers/specs/2026-09-15-platform-system-design.md); review it and audit WEB-01B before adding views or live controllers. Workflow editing/reuse remains outside B.

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
