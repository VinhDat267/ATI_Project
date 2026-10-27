# OAUTH-02 Review Fixes Implementation Plan

> **For agentic workers:** Use TDD for each owned correction and request a fresh whole-branch review after integration.

**Goal:** Correct F1–F6 from the review of `c774af3a` without enabling MyCalendar or calling live providers.

**Architecture:** Keep personal Calendar separate from shared Calendar. Declare separate Google Cloud project identities for personal Gmail and Calendar in live configuration, model project-wide revocation in the HTTP fixture, complete evaluation fixtures, and preserve approved account identity through receipt rendering.

**Tech Stack:** TypeScript, React, Vitest, PostgreSQL 16, Playwright, Node HTTP fixtures.

**Spec:** `docs/superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md`, corrected for F1 by the user's request to fix the review findings.

## Constraints and decisions

- Work on the existing clean isolated worktree and feature branch. Do not change CURRENT-STATE or ROADMAP, enable flags, merge, or call live Google/model endpoints.
- Separate Cloud projects are necessary for independent revocation. Runtime configuration must reject explicitly shared or undeclared project identities in live Calendar configuration; Gmail-only behavior remains compatible.
- Fix golden labels before model calls and record their provenance in a separate commit. No provider campaign is authorized or necessary for these fixes.
- Preserve old Gmail assertions. Add regression tests rather than weakening checks.
- Keep evidence of RED and GREEN, and append one handoff log for this fix session.

## Review focus

- Same-account Gmail and Calendar in separate projects retain independently refreshable grants after disconnect.
- Personal intent remains personal while unavailable; shared intent stays shared, and the disabled catalog/prompt remains unchanged.
- Injection evaluations require actual event data from successful personal Calendar lookups rather than passing on fixture failures.
- StrictMode cleanup, unmount during a pending save, OAuth exchange once, and session changes suppress stale navigation.
- Receipt email comes from the approved snapshot even when current service email differs or the target is a secondary calendar.

## Task 1 — OAuth project isolation (root ownership)

Files: `apps/chat-api/src/config/env.ts`, new config tests, `scripts/fake-google-gmail.mjs`, fake-server tests, `.env.example`, MyCalendar specification and task configuration instructions.

- [ ] Write and run failing tests for live project configuration and project-wide revocation with real fixture HTTP/token refresh.
- [ ] Implement explicit project identity validation, project-aware fixture grants, and corrected configuration documentation.
- [ ] Run the new tests and existing Gmail/MyCalendar suites without changing old assertions.

## Task 2 — Routing, evaluation fixtures and labels (AI Engineer ownership)

Files: `packages/tool-schemas/src/registry/mycalendar.ts`, `packages/planner/tests/evaluation/golden.test.ts`, `evaluations/golden*/cases-mycalendar.json`, `evaluations/golden-v2/fixtures.ts`, new focused evaluation tests; minimal runner/scorer changes only if required.

- [ ] Add failing routing cases for English personal calendar, connected/unavailable, and shared Calendar.
- [ ] Add failing fixture/runner tests for personal discovery, event reads, grounding, and injected event titles.
- [ ] Fix fixtures and register corrected mc04/injection labels in a separate label commit before any model calls.
- [ ] Make tests pass and verify old evaluation sets and schema/catalog invariants.

## Task 3 — Callback cleanup and receipt account (Frontend ownership)

Files: `apps/chat-web/src/views/MyCalendarCallbackView.tsx`, `apps/chat-web/src/components/Cockpit.tsx`, `apps/chat-web/src/pages/Cockpit/ReceiptMoment.tsx`, focused web tests and optional scoped browser tests.

- [ ] Preserve the two reviewer reproductions as regression tests and observe their failures.
- [ ] Fix effect cleanup while keeping the OAuth callback single-use; cover pending save and session invalidation.
- [ ] Pass the approved personal Calendar connection into receipts and assert its email with a secondary calendar and a different current connection.
- [ ] Run focused web tests and typecheck.

## Task 4 — Integration, handoff and independent review

- [ ] Run full workspace tests, evaluation tests, typecheck, build, launcher/security checks and MyCalendar/default-off browser tests using isolated migrated PostgreSQL.
- [ ] Request a fresh reviewer for the fixes, resolve material findings and rerun affected checks.
- [ ] Fill the OAUTH-02 results section, add a new handoff log with exact commands/counts/limits, and preserve NOT_RUN status for live acceptance and CI.
