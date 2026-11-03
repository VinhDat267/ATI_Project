# JIRA-09B Cockpit UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Cockpit UI integration for personal Jira (`myjira.*` tools, `JiraPlanConnection` preview/receipt display, refusal connect-from-chat/settings navigation, and Settings Cockpit CTA).

**Architecture:** Wire `MYJIRA_TOOLS` into `tool-definitions.ts`, add `myjira` metadata to `cockpit-services.json` and `types.ts`, display `plan.connections.myjira` (Atlassian account, workspace, and per-step site/project binding) in `PlanMoment.tsx` and `ReceiptMoment.tsx`, support `myjira` refusal states in `ResponseMoment.tsx`, and enable `#jira-start-conversation` in `JiraConnection.tsx` when connection + active workspace + capability sites are ready.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Write RED unit tests for Jira Cockpit UI (`apps/chat-web/tests/jira-cockpit.test.tsx`)

**Files:**
- Create: `apps/chat-web/tests/jira-cockpit.test.tsx`

- [ ] **Step 1: Write failing tests covering `toolDefinition`, `PlanMoment`, `PreviewContents`, `ReceiptMoment`, `RefusalMoment`, and `JiraConnection` CTA**
- [ ] **Step 2: Run `npx vitest run apps/chat-web/tests/jira-cockpit.test.tsx` and confirm RED failure**

### Task 2: Wire `MYJIRA_TOOLS`, `cockpit-services.json`, `types.ts`, and `presentation.tsx`

**Files:**
- Modify: `apps/chat-web/src/services/tool-definitions.ts`
- Modify: `apps/chat-web/src/assets/cockpit-services.json`
- Modify: `apps/chat-web/src/types.ts`
- Modify: `apps/chat-web/src/pages/Cockpit/presentation.tsx`

- [ ] **Step 1: Add `MYJIRA_TOOLS` to `tool-definitions.ts`**
- [ ] **Step 2: Add `myjira` service, `jira_site`/`jira_project`/`jira_issue` resource names, and `myjira.*` operations to `cockpit-services.json`**
- [ ] **Step 3: Add `myjira?: JiraPlanConnection` to `ActivePlan['connections']` and `'identity_connected' | 'needs_workspace'` to `PersonalStatus` in `types.ts`**
- [ ] **Step 4: Add `myjira` fallback label in `presentation.tsx`**

### Task 3: Render `myjira` in `Cockpit.tsx`, `PlanMoment.tsx`, `ReceiptMoment.tsx`, `PreviewContents.tsx`, `ResponseMoment.tsx`, and `JiraConnection.tsx`

**Files:**
- Modify: `apps/chat-web/src/components/Cockpit.tsx`
- Modify: `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`
- Modify: `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`
- Modify: `apps/chat-web/src/pages/Cockpit/PreviewContents.tsx`
- Modify: `apps/chat-web/src/pages/Responses/ResponseMoment.tsx`
- Modify: `apps/chat-web/src/pages/Settings/JiraConnection.tsx`
- Modify: `apps/chat-web/tests/jira-connection.test.tsx`
- Modify: `apps/chat-web/tests/browser/jira-09a.spec.ts`

- [ ] **Step 1: Support `projectKey` / `issueKey` fallback in `resourceDestination` and pass `myjiraConnection` to `ReceiptMoment` in `Cockpit.tsx`**
- [ ] **Step 2: Render `plan.connections.myjira` account, workspace, and per-step bound site/project in `PlanMoment.tsx` and `ReceiptMoment.tsx`**
- [ ] **Step 3: Add `issueKey`, `projectKey`, `issueType` field labels in `PreviewContents.tsx`**
- [ ] **Step 4: Support `myjira` in `RefusalMoment` (`ResponseMoment.tsx`)**
- [ ] **Step 5: Enable `#jira-start-conversation` in `JiraConnection.tsx` when prerequisites are met**
- [ ] **Step 6: Run tests, `static-guard.test.ts`, and `npm run typecheck:v3` to verify GREEN**
