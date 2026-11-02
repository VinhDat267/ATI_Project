# JIRA-09A · Jira UI foundation

**Status:** Complete (ready for review). **Owner:** Frontend (`apps/chat-web/`). **Branch:** `longnguyen005/jira-09a-ui`.

## Scope

Build the Jira connection and workspace administration UI against merged JIRA-02–05 contracts: identity and site authorization, one-time callback, join request, membership decisions, invite management, site/project policy, and capability directory. Keep Jira conversation creation unavailable while JIRA-08 has not enabled its production guard.

## Acceptance

- Show distinct identity, site grant, Jira membership, and native permission states.
- Require explicit user action after OAuth callback; never resend a request or approve a plan automatically.
- Keep organization workspace and Jira membership distinct; use `/api/jira-workspaces` and `/api/jira-workspace-join-requests`.
- Cover 1440/375 widths, light/dark theme, reload, stale tab, and account switch in browser tests.
- Run focused web tests, `npm run check`, and browser fixtures. Record real outputs in Results.

## Results

### Implementation Highlights
1. **Typed Jira API Facade (`apps/chat-web/src/services/jira-api.ts`)**:
   - Status, start OAuth, callback exchange, site sync, disconnect.
   - Workspace operations: list workspaces, join workspace, fetch members, decide membership (approve/reject/remove with CAS version), list invites, create invite, revoke invite, fetch sites, link site, toggle site active status, update project policy (selected project keys + version), and fetch capabilities.
   - Callback exchange passes `isRetry: true` to prevent automatic replay on 401.
2. **Safe Callback View (`apps/chat-web/src/views/JiraCallbackView.tsx`)**:
   - `useLayoutEffect` cleans URL query parameters (`code`, `state`) immediately on mount to prevent replay on reload.
   - Session verification: verifies initiating user matches current session; aborts if user switches or logs out.
   - Distinct error taxonomy mapping: 401 auth, 403 native permission denied / membership required, 409 stale version, 429 rate limit, 503 unavailable.
   - Never triggers automatic plan approval or message resend; displays explicit user action button to return.
3. **Connection & Workspace Settings UI (`apps/chat-web/src/pages/Settings/JiraConnection.tsx`)**:
   - Personal connection card displaying connection states: `disconnected`, `identity_connected`, `scope_required`, `reconnect_required`, `connected`.
   - Honest error representation: 401, 403, 429, 500, 503, and network errors display "Lỗi kết nối" badge and dedicated error banner with retry button (`#jira-retry-connection`), never falsely displaying "Chưa kết nối" (which is reserved exclusively for unconfigured state on successful 200 or 404).
   - Workspace isolation & race prevention: switching workspaces immediately clears transient state (`createdInviteToken`, `members`, `invites`, `sites`, `capabilities`), drops in-flight fetch requests via sequence tracking (`workspaceFetchSeqRef`), and clears admin data for non-admin roles. All asynchronous workspace actions (`createInvite`, `decision`, `revokeInvite`, `linkSite`, `updateSite`, `projects`, `configureProjects`) verify `activeWorkspaceIdRef.current === targetWsId` before setting state or reloading workspace details, preventing late-arriving responses (e.g. invite token generation) from bleeding into a different workspace.
   - Workspace join form and workspace switcher displaying role (`admin` vs `member`), status, and distinct CAS version tracking.
   - Admin actions: member review with approve/reject/remove, invite creation with copy button and revocation.
   - Workspace site and project policy controls with atomic versioning.
   - Capability directory display by site.
   - Jira Cockpit conversation CTA disabled with clear explanation pending JIRA-08 production guard.
   - Passed static-guard evaluation cleanly.
4. **Wiring & Navigation**:
   - Wired into `apps/chat-web/src/routes.ts`, `apps/chat-web/src/hooks/use-route.ts`, `apps/chat-web/src/App.tsx`, and `apps/chat-web/src/pages/Settings/SettingsPage.tsx`.

### Verification Evidence
- **Focused Jira Test Suites**:
  `npm test -w @wap/chat-web -- tests/jira-api.test.ts tests/jira-callback.test.tsx tests/jira-connection.test.tsx tests/jira-connection-responsive.test.tsx`
  - Output: 4 test files passed, 47 tests passed (100% PASS), exit code 0.
- **Settings Page Integration Test**:
  `npm test -w @wap/chat-web -- tests/components/settings-page.test.tsx`
  - Output: 1 test file passed, 7 tests passed (100% PASS), exit code 0.
- **Full Chat Web Test Suite**:
  `npm test -w @wap/chat-web`
  - Output: 96 test files passed, 1033 tests passed (100% PASS), exit code 0.
- **Typecheck**:
  `npm run typecheck:v3`
  - Output: `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` exit code 0.
- **Static Guard Check**:
  `npx vitest run evaluations/generic-plumbing/static-guard.test.ts`
  - Output: 1 test file passed, 2 tests passed (exit code 0).
- **Production Web Build & Security Sentinel**:
  `npm run build:v3; node scripts/test-v3-web-build-security.mjs`
  - Output: `PASS: production build excludes credential sentinels and 7 forbidden UI claims`, exit code 0.
- **Playwright Browser Test Suite (Connect, Reload, Switch, Errors 500/429/403/503, Scope Required, In-flight Invite Hold)**:
  `npx playwright test apps/chat-web/tests/browser/jira-09a.spec.ts`
  - Output: 1 passed (4.9s), exit code 0 against local Vite preview. Verified Connect flow, reload handling, workspace switch isolation, in-flight delayed invite token avoidance across workspace switch, scope_required display (Atlassian name & account ID), 500/429/403/503 error display/retry, stale session 401 handling, and cross-account rejection.

### Limitations
- Live Jira Cockpit conversation execution remains disabled in the UI (button clearly marked as pending JIRA-08) until backend and planner integration PBIs (JIRA-06, JIRA-07, JIRA-08) land.
