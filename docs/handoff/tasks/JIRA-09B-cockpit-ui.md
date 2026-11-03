# JIRA-09B · Jira Cockpit UI integration

**Status:** Complete (ready for review). **Owner:** Frontend (`apps/chat-web/`). **Branch:** `feat/jira-09b-cockpit-ui`.

## Scope

Complete the Cockpit UI integration for personal Jira (`myjira.*` tools and `JiraPlanConnection`) following `JIRA-02`–`JIRA-08` and `JIRA-09A`:
- Register `MYJIRA_TOOLS` in `tool-definitions.ts` and `myjira` service/resource/operation entries in `cockpit-services.json`.
- Add `myjira?: JiraPlanConnection` to `ActivePlan['connections']` and `'disconnected' | 'identity_connected' | 'needs_workspace'` to `PersonalStatus` in `types.ts`.
- Render `myjira` connection metadata (Atlassian account, workspace, and per-step bound site/project) in `PlanMoment.tsx` and `ReceiptMoment.tsx`, and support `projectKey`/`issueKey` destination labels in `Cockpit.tsx` (`resourceDestination`).
- Render `myjira.create_issue` and `myjira.add_comment` step field previews (`issueKey`, `projectKey`, `issueType`, `summary`, `description`, `body`) in `PreviewContents.tsx`.
- Support `myjira` in `ResponseMoment.tsx` (`RefusalMoment`): connect-from-chat via `jiraApi.start('identity', back)` when `disconnected`/`reconnect_required`, and navigate to `/settings#jira` when `scope_required`/`identity_connected`/`needs_workspace`, preserving explicit user action after callback (no auto-send or auto-approve).
- Enable the Cockpit conversation CTA (`#jira-start-conversation`) in `JiraConnection.tsx` when `isConnected && isWorkspaceActive && capabilities.sites.length > 0`, while keeping it disabled when prerequisites are missing.

## Acceptance

- `PlanMoment` and `ReceiptMoment` display the bound Atlassian account, workspace, and per-step Jira site/project from `plan.connections.myjira`, not just a generic "Jira connected" label.
- `PreviewContents` and `resourceDestination` render readable Vietnamese labels and target site/project/issue keys for `myjira.*` steps.
- `RefusalMoment` handles `myjira` unavailable service states (`disconnected`, `reconnect_required`, `scope_required`, `identity_connected`, `needs_workspace`) with appropriate CTA actions.
- `JiraConnection` enables `#jira-start-conversation` only when personal connection, active workspace membership, and at least one capability site are ready.
- Pass `static-guard.test.ts`, `npm run typecheck:v3`, and focused `chat-web` test suites with real output recorded in Results.

## Results

### Implementation Highlights
1. **Tool & Asset Registration (`apps/chat-web/src/services/tool-definitions.ts`, `apps/chat-web/src/assets/cockpit-services.json`, `apps/chat-web/src/types.ts`, `apps/chat-web/src/pages/Cockpit/presentation.tsx`)**:
   - Added `MYJIRA_TOOLS` lookup to `toolDefinition(name)`.
   - Added `myjira` service palette/logo, `jira_site` / `jira_project` / `jira_issue` resource names, and `myjira.*` operation definitions to `cockpit-services.json`.
   - Added `myjira?: JiraPlanConnection` to `ActivePlan['connections']` and `'disconnected' | 'identity_connected' | 'needs_workspace'` to `PersonalStatus`.
2. **Cockpit Plan & Receipt Rendering (`apps/chat-web/src/components/Cockpit.tsx`, `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`, `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`, `apps/chat-web/src/pages/Cockpit/PreviewContents.tsx`)**:
   - Updated `resourceDestination(step, labels)` to resolve `${resource}:${value}` labels and fallback to raw `projectKey`/`issueKey` strings.
   - Rendered `plan.connections.myjira` (`atlassianAccountId`, `workspaceId`) and per-step `siteSteps[step.id]` site/project binding in `PlanMoment` and `ReceiptMoment`.
   - Added Vietnamese labels for `issueKey`, `projectKey`, and `issueType` in `PreviewContents`.
3. **Refusal & Settings CTA (`apps/chat-web/src/pages/Responses/ResponseMoment.tsx`, `apps/chat-web/src/pages/Settings/JiraConnection.tsx`)**:
   - Added `myjira` status badges and `#myjira-connect` action in `RefusalMoment` (OAuth start with `returnTo` when disconnected/reconnect_required, and navigation to `/settings#jira` when `scope_required`/`identity_connected`/`needs_workspace`).
   - Enabled `#jira-start-conversation` in `JiraConnection.tsx` when `data.connectionState === 'connected' && isWorkspaceActive && capabilities.sites.length > 0`.

### Verification Evidence
- **Focused Jira Web Test Suites**:
  `npm test -w @wap/chat-web -- tests/jira-api.test.ts tests/jira-callback.test.tsx tests/jira-connection.test.tsx tests/jira-connection-responsive.test.tsx tests/jira-cockpit.test.tsx`
  - Output: 5 test files passed, 54 tests passed (100% PASS), exit code 0.
- **Static Guard Check**:
  `npx vitest run evaluations/generic-plumbing/static-guard.test.ts`
  - Output: 1 test file passed, 2 tests passed (exit code 0).
- **Typecheck**:
  `npm run typecheck:v3`
  - Output: `tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit` exit code 0 (0 errors).
- **Production Build & Security Sentinel**:
  `npm run build:v3; node scripts/test-v3-web-build-security.mjs`
  - Output: `PASS: production build excludes credential sentinels and 7 forbidden UI claims`, exit code 0.

### Limitations
- Live Atlassian OAuth 3LO and live LLM evaluation campaign (`JIRA-10` / `JIRA-11`) remain `NOT_RUN` pending live credentials and model campaign execution.
