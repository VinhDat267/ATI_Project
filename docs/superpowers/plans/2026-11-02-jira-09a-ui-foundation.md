# JIRA-09A UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Jira personal connection and workspace management UI before the live cockpit flow is enabled.

**Architecture:** Add a typed frontend API facade over the merged JIRA-03–05 endpoints. Compose connection and workspace management views within existing settings/navigation patterns. Keep the Jira cockpit action disabled until JIRA-08 removes the production 503 gate.

**Tech Stack:** React, TypeScript, Vitest, Playwright, existing ATI CSS/design system.

**Spec:** `docs/superpowers/specs/2026-10-30-jira-personal-workspaces-design.md` §10–12 and `docs/superpowers/specs/2026-11-02-jira-shared-workspace-amendment.md`.

## Global Constraints

- Frontend ownership: edit only `apps/chat-web/` plus this task's docs and one handoff log.
- Jira workspace UUID is the existing organization UUID; Jira membership is separate.
- `MYJIRA_ENABLED` remains off by default; Jira conversation production creation still returns 503 until JIRA-08.
- OAuth callback is one-use and must never automatically resend or approve.

## Review Focus

- Expired or repeated callback: show recoverable error without replay.
- Different signed-in user after OAuth: do not complete another user's callback.
- CAS conflict during membership/project edit: reload authoritative state.
- Account loses native Jira permission: show precise unavailable state, never infer access from OAuth grant.
- Stale workspace selection: do not display old workspace capability data under a new workspace.

### Task 1: Typed Jira API and callback

**Files:** `apps/chat-web/src/services/jira-api.ts`, `apps/chat-web/src/views/JiraCallbackView.tsx`, `apps/chat-web/src/routes.ts`, `apps/chat-web/src/App.tsx`, focused tests.

- [x] Write failing API/callback tests.
- [x] Implement typed facade for status/start/callback/sync/disconnect and one-use callback route.
- [x] Run focused tests and commit scoped files.

### Task 2: Connection and workspace management

**Files:** `apps/chat-web/src/pages/Settings/JiraConnection.tsx`, Jira workspace management view/components, settings/navigation wiring, focused tests.

- [x] Write failing state/action tests.
- [x] Implement identity/site permission, join, admin/member/invite/site/project/capability flows from merged DTOs.
- [x] Keep Jira conversation CTA unavailable with clear copy until JIRA-08.
- [x] Run focused tests and commit scoped files.

### Task 3: Browser verification and handoff

**Files:** `apps/chat-web/tests/browser/jira-09a.spec.ts`, this task card, one new `docs/handoff/log/` file.

- [x] Exercise connection → join → approve → grant sites and error/reload/account switch fixtures.
- [x] Verify 1440/375 in light/dark mode.
- [x] Run web tests, full check, browser tests; record real output.
- [x] Open PR with changed files, test output, and commit hash; do not merge.
