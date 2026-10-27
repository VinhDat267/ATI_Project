# OAUTH-02 Personal Google Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable each signed-in ATI user to connect their own Google Calendar via a second Google OAuth client (`MYCALENDAR_ENABLED`), immediately pick which writable calendars ATI may access (`scope_required` → `connected`), and plan, preview, approve, and execute personal calendar workflows (`mycalendar.list_calendars`, `mycalendar.list_events`, `mycalendar.create_event`) with zero impact when the flag is off.

**Architecture:** `mycalendar` is modeled as an opt-in personal service outside `ALL_TOOLS` and `SERVICE_REGISTRY`, backed by a dedicated OAuth client so disconnecting Gmail never revokes Calendar grants. After OAuth code exchange, the credential row is saved with `selectedCalendars: []` (`personalStatus: 'scope_required'`) until the user confirms their allowed calendars on `/connections/mycalendar/callback` (or `/settings#mycalendar`) via `PUT /api/connections/mycalendar/scope`, which verifies calendar write access against Google's `calendarList` API and binds `allowedCalendars` into `PlanConnections.mycalendar` before SHA-256 plan hashing.

**Tech Stack:** TypeScript, Node.js, Express, PostgreSQL 16 (advisory + row locks), `@wap/tool-schemas`, `@wap/tool-adapters`, `@wap/planner`, `@wap/executor`, React 18, Vite, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md`](../specs/2026-10-26-oauth-02-personal-calendar-design.md)

## Global Constraints

- `MYCALENDAR_ENABLED` defaults to `off`; any value other than `'on'` or `'off'` throws a startup configuration error.
- When `MYCALENDAR_ENABLED=off`: `ALL_TOOLS` stays 33 tools, `SERVICE_REGISTRY` stays 8 services, system prompt and catalog SHA-256 hashes are unchanged byte-for-byte, 116-case offline routing is unchanged, `/api/connections/mycalendar/*` returns `404`, `/api/health` omits `mycalendarEnabled`, and `/api/services` omits `mycalendar`.
- All existing tests (`GMAIL-01 → 03`, `OAUTH-01`, `SCHED-01 → 03`) must pass without modifying any existing test assertion.
- Never fall back to the shared `calendar` Service Account when `mycalendar` is unconfigured, `scope_required`, or `reconnect_required`.
- Separate OAuth client (`MYCALENDAR_OAUTH_CLIENT_ID`, `MYCALENDAR_OAUTH_CLIENT_SECRET`, `MYCALENDAR_OAUTH_REDIRECT_URI` with pathname `/connections/mycalendar/callback`); disconnecting `mycalendar` must never revoke or delete `gmail` (and vice versa).
- `mycalendar.create_event` always sends `?sendUpdates=none`, never accepts or sends `attendees`, marks pre-dispatch failures with `details: { requestSent: false }` (`failed`), and marks post-dispatch network/5xx errors as `UNKNOWN`.
- Never log or expose `access_token`, `refresh_token`, `code`, `state`, or `code_verifier` in logs, error responses, SSE events, or `report.json`.
- Never use port `15433` for tests; run PostgreSQL integration tests against an isolated temporary PostgreSQL 16 container (e.g., port `56533` or `55533`).

## Review Focus

1. **Read-only calendars in Google `calendarList` (`accessRole: 'reader' | 'freeBusyReader'`):** `POST /callback`, `GET /calendars`, and `PUT /scope` must filter strictly to `accessRole === 'owner' || accessRole === 'writer'`, and `PUT /scope` must reject any read-only or unknown `calendarId` with `400 MYCALENDAR_SCOPE_INVALID` (tested in Task 3).
2. **Stale scope save after concurrent reconnect or disconnect:** If a user reconnects or disconnects in another tab while the calendar picker is open, `PUT /scope` (`updateConfigIfActive`) must check `expectedCredentialId === current.id` under the advisory + user lock and fail with `409 MYCALENDAR_NOT_CONNECTED` rather than overwriting the newer connection (tested in Task 3).
3. **Calendar deselected in `/settings` after plan preview:** If a user previews a plan using calendar `c_work@group.calendar.google.com` and then removes that calendar via `PUT /scope` before approving, `AdapterFactory` at execution phase must check that every ID in `connections.mycalendar.allowedCalendars` remains in the current `allowedScope.calendars` and reject execution with `AUTH_ERROR` (tested in Task 4).
4. **Cross-service calendar ID contamination (`calendar` vs `mycalendar`):** Grounding validation must reject a `mycalendar.create_event` step that uses a `calendarId` observed only from shared `calendar.list_calendars` (and vice versa) via distinct `'x-resource': 'mycalendar'` vs `'x-resource': 'calendar'` (tested in Task 1).
5. **Open redirect via `/connections/mycalendar/callback?mode=select&returnTo=...`:** In `MyCalendarCallbackView`, both OAuth callback completion and `?mode=select` scope selection must sanitize `returnTo` through `conversationReturnPath` (`^/c/<uuid>$`) and fall back to `/settings#mycalendar` on any external or malformed path (tested in Task 5).

---

### Task 1: Tool Schemas, Registry, Executor Write Catalog & DB Migration 0012

**Files:**
- Create: `packages/tool-schemas/src/mycalendar.ts`
- Create: `packages/tool-schemas/src/registry/mycalendar.ts`
- Modify: `packages/tool-schemas/src/types.ts:130-165`
- Modify: `packages/tool-schemas/src/index.ts:20-25`
- Modify: `packages/executor/src/runner.ts:1-20`
- Create: `db/v3/0012_mycalendar_personal_connections.sql`
- Test: `packages/tool-schemas/tests/mycalendar-schemas.test.ts`
- Test: `apps/chat-api/tests/db/mycalendar-migration.test.ts`

**Interfaces:**
- Produces in `@wap/tool-schemas`:
  - `MYCALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly'`
  - `MYCALENDAR_TOOLS: ToolDefinition[]` (`mycalendar.list_calendars` with `discovers: 'mycalendar', listable: true`; `mycalendar.list_events` and `mycalendar.create_event` with `calendarId` having `'x-resource': 'mycalendar'`)
  - `MYCALENDAR_SERVICE: ServiceDefinition` (`id: 'mycalendar'`, `name: 'Google Calendar của bạn'`, `connection: 'personal'`, `scopeKey: 'calendars'`)
  - `PersonalCalendarItem { id: string; summary: string; timeZone: string; primary?: boolean }`
  - `PlanConnections.mycalendar?: { credentialId: string; email: string; allowedCalendars: string[] }`
- Produces in `@wap/executor`: `isWriteTool('mycalendar.create_event') === true`, `isWriteTool('mycalendar.list_events') === false`, `isWriteTool('mycalendar.list_calendars') === false`.

- [ ] **Step 1: Write the failing schema, grounding, executor, and migration tests**

Create `packages/tool-schemas/tests/mycalendar-schemas.test.ts` and `apps/chat-api/tests/db/mycalendar-migration.test.ts`:
```ts
// packages/tool-schemas/tests/mycalendar-schemas.test.ts
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, SERVICE_REGISTRY, MYCALENDAR_TOOLS, MYCALENDAR_SERVICE, MYCALENDAR_SCOPE } from '../src/index.js';
import { isWriteTool } from '../../executor/src/runner.js';
import { validatePlan } from '../../planner/src/validator.js';

describe('MYCALENDAR_TOOLS and MYCALENDAR_SERVICE', () => {
  it('keeps ALL_TOOLS at 33 and SERVICE_REGISTRY at 8 while exporting MYCALENDAR_* separately', () => {
    expect(ALL_TOOLS).toHaveLength(33);
    expect(SERVICE_REGISTRY).toHaveLength(8);
    expect(MYCALENDAR_SCOPE).toBe('https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly');
    expect(MYCALENDAR_SERVICE.id).toBe('mycalendar');
    expect(MYCALENDAR_SERVICE.connection).toBe('personal');
    expect(MYCALENDAR_TOOLS.map(t => t.name)).toEqual([
      'mycalendar.list_calendars',
      'mycalendar.list_events',
      'mycalendar.create_event',
    ]);
  });

  it('marks mycalendar.create_event as a write tool in executor and separates x-resource mycalendar from shared calendar', () => {
    expect(isWriteTool('mycalendar.create_event')).toBe(true);
    expect(isWriteTool('mycalendar.list_events')).toBe(false);
    expect(isWriteTool('mycalendar.list_calendars')).toBe(false);

    // Review Focus #4: shared calendar ID in memory.calendar must not ground mycalendar.create_event
    const planJson = JSON.stringify({
      kind: 'plan',
      summary: 'Tạo lịch họp',
      steps: [{
        id: 's1',
        tool: 'mycalendar.create_event',
        description: 'Tạo sự kiện',
        args: {
          calendarId: 'shared_team@group.calendar.google.com',
          summary: 'Họp nhóm',
          start: '2026-10-30T09:00:00+07:00',
          end: '2026-10-30T10:00:00+07:00',
        },
      }],
    });
    const ungrounded = validatePlan(planJson, [...ALL_TOOLS, ...MYCALENDAR_TOOLS], {
      grounding: { memory: { calendar: [{ id: 'shared_team@group.calendar.google.com', title: 'Team' }] }, userTexts: [] },
    });
    expect(ungrounded.valid).toBe(false);
    if (!ungrounded.valid) expect(ungrounded.layer).toBe('grounding');

    const grounded = validatePlan(planJson, [...ALL_TOOLS, ...MYCALENDAR_TOOLS], {
      grounding: { memory: { mycalendar: [{ id: 'shared_team@group.calendar.google.com', title: 'My Cal' }] }, userTexts: [] },
    });
    expect(grounded.valid).toBe(true);
  });
});
```

And in `apps/chat-api/tests/db/mycalendar-migration.test.ts`, test that running all migrations (`0001`..`0012`) twice:
- accepts `oauth_states` with `mode = 'connect_mycalendar'`, non-null `user_id` & `session_id`, and `return_to = '/c/<uuid>'` or `NULL`;
- rejects `connect_mycalendar` without `user_id`/`session_id` or with invalid `return_to` (`code: '23514'`);
- rejects `service_credentials` with `service = 'mycalendar'` and `user_id IS NULL` (`code: '23514'`);
- keeps the exact 3 `mode` check constraint names `['oauth_states_mode_check', 'oauth_states_mode_owner_check', 'oauth_states_return_to_check']`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/tool-schemas/tests/mycalendar-schemas.test.ts apps/chat-api/tests/db/mycalendar-migration.test.ts`
Expected: FAIL with missing exports `MYCALENDAR_TOOLS`, `MYCALENDAR_SERVICE`, `MYCALENDAR_SCOPE` and missing migration `0012_mycalendar_personal_connections.sql`.

- [ ] **Step 3: Implement `mycalendar.ts`, `registry/mycalendar.ts`, `types.ts`, `runner.ts`, and `0012_mycalendar_personal_connections.sql`**

1. In `packages/tool-schemas/src/mycalendar.ts`, define `MYCALENDAR_SCOPE` and `MYCALENDAR_TOOLS` mirroring `packages/tool-schemas/src/calendar.ts` but with `service: 'mycalendar'`, `discovers: 'mycalendar'`, and `calendarId` having `'x-resource': 'mycalendar'`.
2. In `packages/tool-schemas/src/registry/mycalendar.ts`, define `MYCALENDAR_SERVICE` with `id: 'mycalendar'`, `name: 'Google Calendar của bạn'`, `connection: 'personal'`, `scopes: [MYCALENDAR_SCOPE]`, `scopeKey: 'calendars'`, `scopeLabel: 'Lịch Google Calendar của bạn'`, `credentialFields: []`, `intentKeywords: ['lịch của tôi', 'lịch của mình', 'lịch cá nhân', 'lịch riêng', 'my calendar', 'calendar của tôi', 'lịch google của tôi']`.
3. In `packages/tool-schemas/src/types.ts`, export `PersonalCalendarItem` and add `mycalendar?: { credentialId: string; email: string; allowedCalendars: string[] }` to `PlanConnections`.
4. Re-export `./mycalendar.js` and `./registry/mycalendar.js` from `packages/tool-schemas/src/index.ts` (outside `ALL_TOOLS` and `SERVICE_REGISTRY`).
5. In `packages/executor/src/runner.ts`, include `...MYCALENDAR_TOOLS` in `catalog`.
6. Create `db/v3/0012_mycalendar_personal_connections.sql` updating `oauth_states_mode_check`, `oauth_states_mode_owner_check`, `oauth_states_return_to_check` and adding `service_credentials_mycalendar_owner_check`.

- [ ] **Step 4: Run tests (including existing migration & catalog freeze tests) to verify they pass**

Run: `npx vitest run packages/tool-schemas/tests/mycalendar-schemas.test.ts apps/chat-api/tests/db/gmail-migration.test.ts apps/chat-api/tests/db/oauth-return-to-migration.test.ts apps/chat-api/tests/db/mycalendar-migration.test.ts`
Expected: PASS (all 4 test files green, existing Gmail/OAuth-01 migration assertions untouched).

- [ ] **Step 5: Commit**

```bash
git add packages/tool-schemas/src/mycalendar.ts packages/tool-schemas/src/registry/mycalendar.ts packages/tool-schemas/src/types.ts packages/tool-schemas/src/index.ts packages/tool-schemas/tests/mycalendar-schemas.test.ts packages/executor/src/runner.ts db/v3/0012_mycalendar_personal_connections.sql apps/chat-api/tests/db/mycalendar-migration.test.ts
git commit -m "feat(tool-schemas): add mycalendar personal schemas and migration 0012"
```

---

### Task 2: Personal Calendar Adapter & Shared Calendar Transport Reuse

**Files:**
- Create: `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts`
- Modify: `packages/tool-adapters/src/calendar/calendar-adapter.ts:1-176`
- Modify: `packages/tool-adapters/src/index.ts:1-16`
- Test: `packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts`

**Interfaces:**
- Consumes: `MYCALENDAR_TOOLS`, `CALENDAR_ID_PATTERN`, `CALENDAR_TIME_PATTERN` from `@wap/tool-schemas`; `GmailAccessTokenProvider` from `../gmail/token-provider.js`.
- Produces in `@wap/tool-adapters`:
  - `PersonalCalendarAdapterConfig extends BaseAdapterConfig { userId: string; tokens: GmailAccessTokenProvider; apiBaseUrl?: string; fetchFn?: typeof fetch }`
  - `class PersonalCalendarAdapter extends BaseAdapter` (`readonly service = 'mycalendar'`)
  - `createPersonalCalendarAdapter(config: PersonalCalendarAdapterConfig): PersonalCalendarAdapter`

- [ ] **Step 1: Write the failing unit tests for `PersonalCalendarAdapter`**

Create `packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts` covering:
- `mycalendar.list_calendars` returns only calendars in `allowedScope.calendars` matching `query` (`{ id, title, timeZone }`).
- `mycalendar.list_events` and `mycalendar.create_event` reject any `calendarId` not in `allowedScope.calendars` (`AUTH_ERROR`, `403`, `details.requestSent === false` on write).
- `mycalendar.create_event` sends `POST .../calendars/<id>/events?sendUpdates=none` without `attendees` and escapes HTML in `description`.
- On HTTP `401`, calls `tokens.getAccessToken({ signal, forceRefresh: true })` once and retries.
- When `tokens.getAccessToken` fails before `mycalendar.create_event` dispatches HTTP, throws `StepError` with `details: { requestSent: false }`.
- When `fetchFn` rejects or returns `503` after `mycalendar.create_event` is sent, throws `StepError` with `category: 'UNKNOWN'` (never retries a write).
- Real `AbortSignal` cancellation before and during fetch.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts`
Expected: FAIL with module `personal-calendar-adapter.js` not found.

- [ ] **Step 3: Implement `PersonalCalendarAdapter` in `packages/tool-adapters/src/calendar/personal-calendar-adapter.ts`**

Share validation/normalization helpers with `calendar-adapter.ts` without changing `CalendarAdapter` behavior. In `PersonalCalendarAdapter`:
- Enforce `this.calendars()` and `this.checkedId(args.calendarId)` before any network call; on write validation/scope/token errors prior to `fetchFn`, attach `details: { requestSent: false }`.
- Rate-limit key: `'mycalendar:' + this.userId`.
- Retry once with `forceRefresh: true` on `401` (for reads and writes alike, since `401` proves Google rejected the bearer token before creating the event; if retry also fails on write before/at 401, throw `AUTH_ERROR` with `details: { requestSent: false }`).

- [ ] **Step 4: Run adapter tests (both shared and personal) to verify they pass**

Run: `npx vitest run packages/tool-adapters/tests/calendar/`
Expected: PASS (all existing `calendar-adapter` tests and new `personal-calendar-adapter` tests pass).

- [ ] **Step 5: Commit**

```bash
git add packages/tool-adapters/src/calendar/calendar-adapter.ts packages/tool-adapters/src/calendar/personal-calendar-adapter.ts packages/tool-adapters/src/index.ts packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts
git commit -m "feat(tool-adapters): add PersonalCalendarAdapter with scope and write-safety guards"
```

---

### Task 3: Fake Google Server Calendar Support, Env Config & `/api/connections/mycalendar` Routes

**Files:**
- Modify: `scripts/fake-google-gmail.mjs`
- Modify: `apps/chat-api/src/config/env.ts:1-228`
- Modify: `.env.example`
- Modify: `.gitignore`
- Modify: `apps/chat-api/src/services/gmail/oauth-client.ts:1-84`
- Modify: `apps/chat-api/src/services/gmail/token-manager.ts:1-99`
- Modify: `apps/chat-api/src/db/repositories/gmail-connection-repo.ts:1-101`
- Create: `apps/chat-api/src/routes/connections/mycalendar.ts`
- Test: `apps/chat-api/tests/routes/mycalendar-connections.test.ts`

**Interfaces:**
- Consumes: `MYCALENDAR_SCOPE`, `CALENDAR_ID_PATTERN`, `PersonalCalendarItem` from `@wap/tool-schemas`.
- Produces:
  - `EnvConfig.MYCALENDAR_ENABLED: boolean`, `EnvConfig.MYCALENDAR_OAUTH?: GmailOAuthConfig` (with `MYCALENDAR_ENDPOINTS.apiBaseUrl = 'https://www.googleapis.com'` and `redirectUri` pathname `/connections/mycalendar/callback`).
  - `GmailOAuthClient.writableCalendars(accessToken: string, signal: AbortSignal): Promise<{ email: string; calendars: PersonalCalendarItem[] }>` (calls `GET ${apiBaseUrl}/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=250`, filters `accessRole === 'owner' || accessRole === 'writer'`, extracts primary calendar `id` as lower-case `email`).
  - `GmailConnectionRepo` constructor optional `service: 'gmail' | 'mycalendar' = 'gmail'`, `mode: 'connect_gmail' | 'connect_mycalendar' = 'connect_gmail'`, plus `updateConfigIfActive(userId: string, expectedCredentialId: string, transform: (config: string) => string): Promise<ServiceCredentialRow | null>`.
  - `createMyCalendarConnectionRoutes(options: MyCalendarConnectionsOptions): Router` and `isMyCalendarAvailable(options): boolean` in `apps/chat-api/src/routes/connections/mycalendar.ts` mounting:
    - `POST /start`
    - `POST /callback`
    - `GET /calendars`
    - `PUT /scope`
    - `DELETE /`

- [ ] **Step 1: Write the failing PostgreSQL + Fake Google integration tests for `/api/connections/mycalendar`**

Create `apps/chat-api/tests/routes/mycalendar-connections.test.ts` testing against real PostgreSQL and `scripts/fake-google-gmail.mjs`:
- `validateEnv` rules for `MYCALENDAR_ENABLED` (`off` default, invalid value throws, `live` + `on` requires `MYCALENDAR_OAUTH_*` with `/connections/mycalendar/callback`).
- `POST /start` (with and without `returnTo: '/c/<uuid>'`, rejecting foreign/unowned/malformed `returnTo` with `400 RETURN_TO_INVALID`).
- `POST /callback` exchanges code, filters out read-only calendars (`accessRole: 'reader'`) from `calendarList` (**Review Focus #1**), saves encrypted config with `selectedCalendars: []` (`scope_required`), and returns `{ email, calendars, returnTo? }`.
- `GET /calendars` uses stored connection token to return `{ email, calendars, selectedCalendarIds }`; returns `409 MYCALENDAR_NOT_CONNECTED` when not connected or `reconnect_required`.
- `PUT /scope` validates `calendarIds` against the user's live writable calendars on Google (**Review Focus #1**: rejects empty array, read-only calendar ID, or unowned calendar ID with `400 MYCALENDAR_SCOPE_INVALID`), checks `expectedCredentialId` under lock (**Review Focus #2**: concurrent reconnect/disconnect returns `409 MYCALENDAR_NOT_CONNECTED`), and saves `selectedCalendars` + `allowedScope.calendars`.
- `DELETE /` revokes the `mycalendar` token on client #2 and deletes the `mycalendar` row while leaving the same user's `gmail` row `active` and untouched (and vice versa).
- Secret sentinel scan: `ya29.SENTINEL-MYCALENDAR-TOKEN` never appears in error responses or logs.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/routes/mycalendar-connections.test.ts`
Expected: FAIL with missing `routes/connections/mycalendar.ts`.

- [ ] **Step 3: Implement fake Google calendar endpoints, `env.ts`, `oauth-client.ts`, `gmail-connection-repo.ts`, and `routes/connections/mycalendar.ts`**

1. Extend `scripts/fake-google-gmail.mjs` to support:
   - `GET /calendar/v3/users/me/calendarList` (returning primary calendar `{ id: email, summary: 'Lịch chính', timeZone: 'Asia/Ho_Chi_Minh', primary: true, accessRole: 'owner' }`, secondary writable calendar `{ id: 'c_work@group.calendar.google.com', summary: 'Lịch việc riêng', timeZone: 'Asia/Ho_Chi_Minh', accessRole: 'writer' }`, and a read-only holiday calendar `{ id: 'vi.vietnamese@holiday.calendar.google.com', summary: 'Ngày lễ Việt Nam', timeZone: 'Asia/Ho_Chi_Minh', accessRole: 'reader' }`).
   - `GET /calendar/v3/calendars/:id`, `GET /calendar/v3/calendars/:id/events`, `POST /calendar/v3/calendars/:id/events`.
2. Add `MYCALENDAR_ENABLED` and `MYCALENDAR_OAUTH` validation in `apps/chat-api/src/config/env.ts`, add blank variables to `.env.example`, and add `docs/ai-evidence/MYCALENDAR-LIVE/` to `.gitignore`.
3. Add `writableCalendars` to `GmailOAuthClient`, parameterize service name in `GmailTokenManager` (`service?: 'gmail' | 'mycalendar'`, `serviceLabel?: string`), parameterize `GmailConnectionRepo` with `(pool, service = 'gmail', mode = 'connect_gmail')` + `updateConfigIfActive`, and implement `apps/chat-api/src/routes/connections/mycalendar.ts`.

- [ ] **Step 4: Run tests (both Gmail and MyCalendar connection tests) to verify they pass**

Run: `npx vitest run apps/chat-api/tests/routes/gmail-connections.test.ts apps/chat-api/tests/routes/mycalendar-connections.test.ts apps/chat-api/tests/db/gmail-connection-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/fake-google-gmail.mjs apps/chat-api/src/config/env.ts .env.example .gitignore apps/chat-api/src/services/gmail/oauth-client.ts apps/chat-api/src/services/gmail/token-manager.ts apps/chat-api/src/db/repositories/gmail-connection-repo.ts apps/chat-api/src/routes/connections/mycalendar.ts apps/chat-api/tests/routes/mycalendar-connections.test.ts
git commit -m "feat(chat-api): add mycalendar OAuth, calendarList discovery and scope routes"
```

---

### Task 4: Runtime Wiring — AdapterFactory, Tool Catalog, ChatService, ResourceLabels, Services & Health

**Files:**
- Modify: `apps/chat-api/src/services/gmail/connection-reference.ts:1-19`
- Modify: `apps/chat-api/src/services/adapter-factory.ts:1-105`
- Modify: `apps/chat-api/src/services/registered-services.ts:65-76`
- Modify: `apps/chat-api/src/config/gmail-tools-runtime.ts:1-36`
- Modify: `apps/chat-api/src/services/chat-service.ts:45-125`
- Modify: `apps/chat-api/src/services/resource-labels.ts:1-25`
- Modify: `apps/chat-api/src/routes/services-routes.ts:15-100`
- Modify: `apps/chat-api/src/app.ts:25-155`
- Modify: `apps/chat-api/src/server.ts:205-345`
- Modify: `apps/chat-api/src/sandbox/index.ts` and `apps/chat-api/src/sandbox/scenarios.ts`
- Test: `apps/chat-api/tests/routes/mycalendar-services.test.ts`

**Interfaces:**
- Consumes: `PersonalCalendarAdapter` from `@wap/tool-adapters`; `createMyCalendarConnectionRoutes`, `isMyCalendarAvailable` from `./routes/connections/mycalendar.js`.
- Produces:
  - `createMyCalendarConnectionLookup(credentials, encryptionKey)` returning `async (userId: string): Promise<NonNullable<PlanConnections['mycalendar']> | null>` (returns `null` when `selectedCalendars` / `allowedScope.calendars` is empty).
  - `AdapterFactory` support for `'mycalendar'` enforcing both `credentialId` match and `allowedCalendars` subset match at execution phase (**Review Focus #3**).
  - `GET /api/services` returning `mycalendar` with `personalStatus: 'not_connected' | 'scope_required' | 'connected' | 'reconnect_required'`, `email`, `connectedAt`, `allowedScope`, `selectedCalendars`.
  - `GET /api/health` returning `mycalendarEnabled` only when `MYCALENDAR_ENABLED=on`.

- [ ] **Step 1: Write the failing integration tests for runtime wiring, `bindConnections`, `AdapterFactory`, `/api/services`, and `/api/health`**

Create `apps/chat-api/tests/routes/mycalendar-services.test.ts` testing:
- Flag off: `/api/health` has no `mycalendarEnabled`, `/api/services` has no `mycalendar`, `/api/connections/mycalendar/start` returns `404`, catalog and system prompt SHA-256 hashes match the 33-tool baseline.
- `scope_required` state (after callback, before `PUT /scope`): `/api/services` returns `personalStatus: 'scope_required', configured: false, connected: false`; `getToolCatalogFor` excludes `MYCALENDAR_TOOLS`; `ChatService.bindConnections` refuses a `mycalendar.*` plan with `unavailableServices: [{ id: 'mycalendar', name: 'Google Calendar của bạn' }]`.
- `connected` state (after `PUT /scope`): `/api/services` returns `personalStatus: 'connected', configured: true, connected: true, selectedCalendars: [...]`; `getToolCatalogFor` includes `MYCALENDAR_TOOLS`; `ChatService.bindConnections` attaches `connections.mycalendar = { credentialId, email, allowedCalendars }` before hashing; `resourceLabels` maps `calendarId` to the calendar's `title`.
- Execution guard (**Review Focus #3**): if `credentialId` changes OR if a previewed calendar is deselected via `PUT /scope` before execution, `AdapterFactory.getAdapterForService('mycalendar', { userId, phase: 'execution', connections })` throws `StepError` (`AUTH_ERROR`), and `ExecutionService` marks `mycalendar.create_event` as `failed` (never `unknown`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-api/tests/routes/mycalendar-services.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement runtime wiring across `connection-reference.ts`, `adapter-factory.ts`, `registered-services.ts`, `gmail-tools-runtime.ts`, `chat-service.ts`, `resource-labels.ts`, `services-routes.ts`, `app.ts`, `server.ts`, and `sandbox/`**

Ensure `bindConnections` in `ChatService` supports plans containing `gmail.*`, `mycalendar.*`, or both in the same plan, and validates that every `mycalendar.*` step's `calendarId` (when present) is in `mycalendar.allowedCalendars`.

- [ ] **Step 4: Run all `chat-api`, `planner`, and `executor` tests to verify they pass**

Run: `npx vitest run apps/chat-api/tests/routes/mycalendar-services.test.ts apps/chat-api/tests/routes/gmail-services.test.ts packages/planner/tests/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/chat-api/src/services/gmail/connection-reference.ts apps/chat-api/src/services/adapter-factory.ts apps/chat-api/src/services/registered-services.ts apps/chat-api/src/config/gmail-tools-runtime.ts apps/chat-api/src/services/chat-service.ts apps/chat-api/src/services/resource-labels.ts apps/chat-api/src/routes/services-routes.ts apps/chat-api/src/app.ts apps/chat-api/src/server.ts apps/chat-api/src/sandbox/ apps/chat-api/tests/routes/mycalendar-services.test.ts
git commit -m "feat(chat-api): wire mycalendar into planner catalog, adapter factory and services API"
```

---

### Task 5: Frontend — Callback Calendar Picker, Settings Row & Re-selection, RefusalMoment, Plan/Receipt & Privacy

**Files:**
- Modify: `apps/chat-web/src/types.ts`
- Modify: `apps/chat-web/src/routes.ts:12-56`
- Modify: `apps/chat-web/src/hooks/use-route.ts:7-25`
- Modify: `apps/chat-web/src/hooks/use-gmail-enabled.ts`
- Modify: `apps/chat-web/src/services/api-client.ts`
- Modify: `apps/chat-web/src/services/gmail-connection.ts`
- Modify: `apps/chat-web/src/services/tool-definitions.ts`
- Modify: `apps/chat-web/src/assets/cockpit-services.json` and `apps/chat-web/src/assets/settings-services.json`
- Modify: `apps/chat-web/src/components/ServiceLogo.tsx`
- Create: `apps/chat-web/src/views/MyCalendarCallbackView.tsx`
- Modify: `apps/chat-web/src/pages/Settings/PersonalGmail.tsx` (or add `PersonalMyCalendar.tsx` rendered in `SettingsPage.tsx`)
- Modify: `apps/chat-web/src/pages/Settings/SettingsPage.tsx`
- Modify: `apps/chat-web/src/pages/Responses/ResponseMoment.tsx:77-159`
- Modify: `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx:19-46`
- Modify: `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx` and `apps/chat-web/src/components/Workspace.tsx` (`destination` formatting)
- Modify: `apps/chat-web/src/pages/Privacy/PrivacyPage.tsx`
- Modify: `apps/chat-web/src/App.tsx`
- Test: `apps/chat-web/tests/mycalendar-ui.test.tsx`

**Interfaces:**
- Consumes: `/api/connections/mycalendar/{start,callback,calendars,scope}`, `/api/services`, `/api/health`.
- Produces:
  - Route `kind: 'mycalendar-callback'` matching `/connections/mycalendar/callback` with `mycalendarCallback: { code?: string; state?: string; error?: string; mode?: 'select'; returnTo?: string }`.
  - `apiClient.startMyCalendarConnection(options?: { returnTo?: string })`, `apiClient.completeMyCalendarConnection(code, state)`, `apiClient.listMyCalendarCalendars()`, `apiClient.saveMyCalendarScope(calendarIds: string[])`, `apiClient.disconnectMyCalendar()`.
  - `MyCalendarCallbackView`: exchanges OAuth code (or loads `GET /calendars` when `mode === 'select'`), pre-checks the primary calendar when `selectedCalendarIds` is empty, enforces at least 1 checked calendar before enabling Save, saves via `PUT /scope`, and navigates to validated `conversationReturnPath(returnTo)` (**Review Focus #5**) or `/settings#mycalendar`.
  - `RefusalMoment`: handles `mycalendar` in `not_connected` (**"Kết nối Google Calendar"**), `scope_required` (**"Chọn lịch Google Calendar"** → navigates to `/connections/mycalendar/callback?mode=select&returnTo=/c/<id>` without re-running Google OAuth), `reconnect_required` (**"Kết nối lại Google Calendar"**), and `connected` (**"Gửi lại yêu cầu"**).

- [ ] **Step 1: Write the failing frontend unit tests in `apps/chat-web/tests/mycalendar-ui.test.tsx`**

Create `apps/chat-web/tests/mycalendar-ui.test.tsx` testing:
- `MyCalendarCallbackView` after OAuth redirect: strips query params before paint, calls `completeMyCalendarConnection` once, renders writable calendars with primary pre-checked, disables Save when all unchecked, saves selected IDs via `saveMyCalendarScope`, and navigates to `/c/<uuid>` when `returnTo` is valid or falls back to `/settings#mycalendar` when `returnTo` is `//evil.example` or `https://evil.example` (**Review Focus #5**).
- `MyCalendarCallbackView` in `?mode=select&returnTo=/c/<uuid>` mode: calls `listMyCalendarCalendars()` without calling `completeMyCalendarConnection`, saves scope, and returns to `/c/<uuid>`.
- `/settings#mycalendar`: renders `not_connected`, `scope_required` (*"Đã cấp quyền · Chưa chọn lịch"* + *"Chọn lịch được dùng"*), `connected` (shows selected calendar badges + *"Chọn lại lịch được dùng"* + *"Ngắt kết nối"* confirmation dialog), and `reconnect_required`.
- `RefusalMoment`: renders *"Kết nối Google Calendar"* when `not_connected`, *"Chọn lịch Google Calendar"* when `scope_required` (navigating to `/connections/mycalendar/callback?mode=select&returnTo=/c/<uuid>`), and *"Gửi lại yêu cầu"* when `connected`.
- `PlanMoment` and `ReceiptMoment`: display `Tài khoản: <email> (Google Calendar của bạn)` and resolved calendar name from `resourceLabels`, plus safe `https://` event link.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/chat-web/tests/mycalendar-ui.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement frontend routes, API client methods, `MyCalendarCallbackView`, settings component, `RefusalMoment`, `PlanMoment`/`ReceiptMoment`, and `PrivacyPage`**

Follow the exact component patterns and styling tokens in `GmailCallbackView.tsx`, `PersonalGmail.tsx`, and `ResponseMoment.tsx`.

- [ ] **Step 4: Run the full `@wap/chat-web` unit test suite to verify everything passes**

Run: `VITEST_MAX_WORKERS=4 npm run test -w @wap/chat-web`
Expected: PASS (all existing web tests + `mycalendar-ui.test.tsx` pass).

- [ ] **Step 5: Commit**

```bash
git add apps/chat-web/
git commit -m "feat(chat-web): add mycalendar callback picker, settings scope editor and cockpit UI"
```

---

### Task 6: Playwright Browser E2E Suite, Golden Set (`cases-mycalendar.json`) & Mandatory Mutation Verification

**Files:**
- Modify: `scripts/test-v3-browser.mjs`
- Create: `evaluations/golden/cases-mycalendar.json`
- Modify: `packages/planner/tests/evaluation/golden.test.ts` (if `EVAL_SET=mycalendar` mapping is needed)
- Test: `scripts/test-v3-browser.mjs` (`mycalendar` group + `MYCALENDAR off:` in default group)

**Interfaces:**
- Consumes: Full backend + frontend stack and `scripts/fake-google-gmail.mjs`.
- Produces:
  - Browser E2E test group `mycalendar` in `scripts/test-v3-browser.mjs` and `MYCALENDAR off:` check in the default group.
  - 8-case golden evaluation dataset `evaluations/golden/cases-mycalendar.json` (2 personal create_event, 2 shared calendar routing, 1 read personal calendar -> Slack, 1 ambiguous clarification, 2 event-title prompt injections).

- [ ] **Step 1: Add `MYCALENDAR off:` assertion and `mycalendar` browser group to `scripts/test-v3-browser.mjs` and create `evaluations/golden/cases-mycalendar.json`**

In `scripts/test-v3-browser.mjs`:
- In the default group (where `MYCALENDAR_ENABLED` is unset/off), verify `/settings` has no `#service-row-mycalendar`, `/api/health` has no `mycalendarEnabled`, and `/api/connections/mycalendar/start` returns `404`.
- In the `mycalendar` group (`MYCALENDAR_ENABLED=on` against `fake-google-gmail.mjs`):
  1. Connect from `/settings#mycalendar` → callback picker shows writable calendars with primary pre-checked → check secondary calendar `"Lịch việc riêng"` and save → `/settings#mycalendar` shows `"Đã kết nối"` with `"Lịch chính"` and `"Lịch việc riêng"` badges → click `"Chọn lại lịch được dùng"` and update scope.
  2. In conversation `/c/<id>`, send `"Thêm lịch họp 15h ngày mai vào lịch việc riêng của tôi"` while disconnected → `RefusalMoment` shows `"Kết nối Google Calendar"` → click it → complete OAuth & calendar picker (`"Lưu lịch được dùng & quay lại hội thoại"`) → lands back on `/c/<id>` → click `"Gửi lại yêu cầu"` → `PlanMoment` displays `"Lịch việc riêng"` and connected email → approve → `ReceiptMoment` succeeds.
  3. Test `scope_required` recovery from `RefusalMoment` (`"Chọn lịch Google Calendar"`) without re-running Google OAuth.
  4. Verify `1440x900` and `375x812` viewports in light and dark modes with zero horizontal overflow and zero console/page errors.

- [ ] **Step 2: Run full typecheck, build, unit/integration suite, and Playwright browser tests**

Run:
```bash
npm run typecheck:v3
RUNTIME_MODE=sandbox npm run build:v3
npm run test:v3
node scripts/test-v3-browser.mjs
```
Expected: All commands exit `0`.

- [ ] **Step 3: Execute all 8 Mandatory Mutations from Spec §8.2 and verify each is caught (`exit != 0`) and cleanly restored**

Run a mutation script verifying all 8 mutations from Spec §8.2 are caught by automated tests and verify SHA-256 file restoration after the run.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-v3-browser.mjs evaluations/golden/cases-mycalendar.json
git commit -m "test(oauth-02): add browser E2E suite and golden evaluation cases for mycalendar"
```
