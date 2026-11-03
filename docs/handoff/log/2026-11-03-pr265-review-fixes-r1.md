# Handoff Log — 2026-11-03 — PR #265 Review Remediation Round 1 (5 P1 + 9 P2 + 1 Bonus)

- **Branch**: `feat/trello-notion-oauth-and-digest-upgrade` (PR #265)
- **Review Reference**: `2026-11-03-review-pr265-cb26cf94.md` (5 P1 findings, 9 P2 findings, and 1 bonus observation against `cb26cf94`)

## Summary of Fixes

1. **F1 & F2 (P1 — Notion UI/API Wire Contract & Database Scope Save + Max 10 Limit)**:
   - Standardized `GET /api/v1/connections/notion` in `apps/chat-api/src/routes/connections/notion.ts` to expose top-level `available`, `activeConnectionId`, `workspaceId`, `workspaceName`, `botId`, and `selectedDatabases` alongside `activeConnection` and `databases`, plus `isActive: Boolean(row.is_default)` on connection views and `healthStatus: 'healthy'` on `POST /:id/check`.
   - Updated `PUT /api/v1/connections/notion/:id/scope` to accept both `databaseIds` and `databases` (`string[]` or `{ id, url }[]`) and unified the OAuth callback auto-discovery threshold to `<= 10` databases.
   - Updated `apps/chat-web/src/services/api-client.ts` (`saveNotionScope`) to send `{ databaseIds, databases }` and `apps/chat-web/src/pages/Settings/NotionConnection.tsx` (`normalizeNotionStatus`) to normalize legacy/new status payloads (`disconnected` -> `not_connected`, `scope_required` -> `needs_scope`), accept `healthStatus: 'healthy'`, and enforce a 1–10 database limit in the UI.

2. **F3 & F4 (P1 — Trello & Notion Digest Ambiguous Delivery & Post-Cancel Send)**:
   - Added `TRELLO_DELIVERY_UNKNOWN` / `NOTION_DELIVERY_UNKNOWN` and `{ state: 'delivery_unknown'; error: string }` to `apps/chat-api/src/services/schedules/trello-digest-runner.ts` and `apps/chat-api/src/services/schedules/notion-digest-runner.ts`.
   - Added transactional `claimTrelloDigestDelivery` and `claimNotionDigestDelivery` acquiring canonical row locks (`conversations` -> `schedules` -> `schedule_runs` `FOR UPDATE NOWAIT` with `55P03` retry) to verify the schedule is still `status = 'active'` and set `delivery_started_at = now()` immediately before dispatching to Slack or Telegram.
   - Classified transport/timeout failures where `!isDefiniteWriteRejection(err)` as `delivery_unknown` (preserving `delivery_started_at` so `ScheduleRunner` transitions the run to `needs_attention` and blocks duplicate `replan`), while clearing `delivery_started_at = NULL` on definite pre-write rejections (`400`/`401`/`403`/`404`/`422`).

3. **F5, F8, F9, F10, F11 (P1 & P2 — Google Sheets Shared & Personal Adapters)**:
   - **F5 (`create_sheet` header overwrite)**: In `packages/tool-adapters/src/sheets/sheets-adapter.ts` and `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`, read `${quotedExisting}!A1:Z1` when an existing tab has no cached headers and preserve any non-empty row 1 headers instead of overwriting them via `values:batchUpdate`.
   - **F8 (`filterDuplicateRows` header comparison)**: In `packages/tool-adapters/src/sheets/sheets-shared.ts`, start the `existingRows` loop at index `1` (`rowNumber = i + 1`) so row 1 headers are never treated as duplicate data rows.
   - **F9 (`parseSheetNumber` 3-digit English decimals)**: In `packages/tool-adapters/src/sheets/sheets-shared.ts`, only treat `.` as a thousands separator when there are 2+ dot groups, dot thousands + comma decimal, or explicit Vietnamese currency markers, preserving English decimals such as `'0.125'` (`0.125`) and `'0.875'` (`0.875`).
   - **F10 (`search_rows` pre-filter truncation)**: Pass unclipped rows to `filterSearchedRows` and `computeSheetAggregation`, then clip returned `headers`, `values`, and `record` entries to `SHEETS_MAX_CELL_CHARS` (500) and set `truncated: true` when any cell/header/row was clipped.
   - **F11 (`delete_rows` > 20 rows via union)**: In `buildDeleteRowRequests`, reject combining `rowNumbers` with `matchColumn`/`matchValue` (`VALIDATION`) and enforce `targetRowSet.size < 20` before adding matched rows.

4. **F6 & F7 (P2 — Notion Shared Tool Fallback & 403 Token Preservation) + Bonus (`notion.get_page` Nested Blocks)**:
   - **F6**: In `apps/chat-api/src/services/chat-service.ts` (`bindConnections`), only refuse when `!notion || notion.status === 'not_connected'` if the plan uses personal-only Notion tools (`notion.get_page`, `notion.update_page`); plans using shared `NOTION_TOOLS` proceed with shared credentials.
   - **F7**: In `apps/chat-api/src/services/adapter-factory.ts`, only map HTTP `401` (not `403`) to `NotionOAuthError(err.message, true)`. In `apps/chat-api/src/services/notion/token-manager.ts`, separate `oauth.refresh()` from the post-refresh `operation(...)` call so refreshed tokens remain `healthy` if the post-refresh operation fails with a non-auth error (such as 403 out-of-scope).
   - **Bonus**: In `packages/tool-adapters/src/notion/notion-adapter.ts`, `notion.get_page` now fetches 1-level child blocks (`blocks/${blkId}/children`, up to 5 parent blocks with `has_children === true`) and includes them in `blocks` and `content`.

5. **F12, F13, F14 (P2 — Trello Checklist Validation & Cockpit Previews)**:
   - **F12 & F13**: In `packages/tool-adapters/src/trello/write-tools.ts`, `updateChecklistItem` always fetches `/cards/${args.cardId}/checklists`, verifies `checkItemId` exists and matches `itemName` when both are provided, and rejects ambiguous partial `itemName` matches (`partialMatches.length > 1`) with `VALIDATION` (400). In `packages/planner/src/validator.ts` (`findUngrounded`), validate `trello.update_checklist_item` against observed `card.checklists` in working memory.
   - **F14**: In `apps/chat-web/src/pages/Cockpit/PreviewContents.tsx`, enhanced `formatRecurrenceLabel` (`INTERVAL`, `COUNT`, `UNTIL`, `BYDAY`), rendered `closed === false` (`📂 Mở lại thẻ (Unarchive)`), and displayed both `itemName` and `checkItemId` on `trello.update_checklist_item`.

## Verification Evidence

- `npm run typecheck:v3`: exit 0
- `npm run build:v3 && node scripts/test-v3-web-build-security.mjs`: exit 0 (`PASS: production build excludes credential sentinels and 7 forbidden UI claims`)
- `npm test -w @wap/tool-schemas`: 24 files, 559 tests PASS (exit 0)
- `npm test -w @wap/tool-adapters`: 22 files, 623 unit tests + 32 OAuth probe tests PASS (exit 0)
- `npm test -w @wap/planner`: 35 files, 497 tests PASS (exit 0)
- `npm test -w @wap/executor`: 7 files, 55 tests PASS (exit 0)
- `npm test -w @wap/chat-web`: 105 files, 1,134 tests PASS (exit 0)
- `npx vitest run --root apps/chat-api tests/routes/notion-connections.test.ts tests/routes/trello-connections.test.ts tests/services/notion-planning.test.ts tests/services/trello-digest.test.ts tests/services/schedules/notion-digest.test.ts tests/services/notion-oauth.test.ts`: 6 files, 32 tests PASS against PostgreSQL (exit 0)
