# JIRA-09B · Jira Cockpit UI integration — 2026-11-03

- **Task:** `docs/handoff/tasks/JIRA-09B-cockpit-ui.md`
- **Plan:** `docs/superpowers/plans/2026-11-03-jira-09b-cockpit-ui.md`
- **Branch:** `feat/jira-09b-cockpit-ui`
- **Scope (`apps/chat-web/`):**
  1. `apps/chat-web/src/services/tool-definitions.ts`: registered `MYJIRA_TOOLS` in `toolDefinition(name)`.
  2. `apps/chat-web/src/assets/cockpit-services.json`: added `myjira` service palette/logo, `jira_site` / `jira_project` / `jira_issue` resource names, and `myjira.list_sites` / `myjira.search_projects` / `myjira.search_issues` / `myjira.create_issue` / `myjira.add_comment` operations.
  3. `apps/chat-web/src/types.ts`: added `myjira?: JiraPlanConnection` to `ActivePlan['connections']` and `'disconnected' | 'identity_connected' | 'needs_workspace'` to `PersonalStatus`.
  4. `apps/chat-web/src/pages/Cockpit/presentation.tsx`: added fallback `serviceName` for `'myjira'` (`'Atlassian Jira'`).
  5. `apps/chat-web/src/components/Cockpit.tsx`: updated `resourceDestination(step, labels)` to resolve `${resource}:${value}` labels and fallback to raw `projectKey`/`issueKey` strings; passed `myjiraConnection={plan?.connections?.myjira}` to `ReceiptMoment`.
  6. `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx` & `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`: rendered bound `atlassianAccountId`, `workspaceId`, and per-step `siteSteps[step.id]` site/project information on `myjira.*` cards.
  7. `apps/chat-web/src/pages/Cockpit/PreviewContents.tsx`: added Vietnamese labels for `issueKey`, `projectKey`, and `issueType`.
  8. `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`: added `myjira` support in `RefusalMoment` (status badges for `disconnected`, `reconnect_required`, `scope_required`, `identity_connected`, `needs_workspace`, `needs_membership`, and `#myjira-connect` action).
  9. `apps/chat-web/src/pages/Settings/JiraConnection.tsx`: enabled `#jira-start-conversation` when `data.connectionState === 'connected' && isWorkspaceActive && capabilities.sites.length > 0`, and kept it disabled otherwise.
  10. `apps/chat-web/tests/jira-cockpit.test.tsx` & `apps/chat-web/tests/browser/jira-09a.spec.ts`: added 7 unit/integration tests for Cockpit UI integration and updated browser CTA assertions.

## Verification Evidence
- `npm test -w @wap/chat-web -- tests/jira-api.test.ts tests/jira-callback.test.tsx tests/jira-connection.test.tsx tests/jira-connection-responsive.test.tsx tests/jira-cockpit.test.tsx`: **5/5 files PASS, 54/54 tests PASS** (exit code 0).
- `npx vitest run evaluations/generic-plumbing/static-guard.test.ts`: **1/1 file PASS, 2/2 tests PASS** (exit code 0).
- `npm run typecheck:v3`: **0 errors** (exit code 0).
- `npm run build:v3 && node scripts/test-v3-web-build-security.mjs`: **PASS** (exit code 0).
