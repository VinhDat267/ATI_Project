# Calendar digest audit fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Close Calendar audit F2/F3 without replaying ambiguous writes or approving changed resources.
**Architecture:** Persist a dispatch marker before the external write and map uncertain delivery to existing `needs_attention`. Bind approval to the immutable candidate config and displayed preview, rechecking live eligibility without replacing approved resources.
**Tech Stack:** TypeScript, PostgreSQL16, Vitest, React.
**Spec:** `docs/handoff/tasks/CALENDAR-01-audit-fixes.md`; v3 approval boundary in `docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`.

## Global Constraints

- Preserve unrelated checkouts; use isolated dependencies and database.
- No live provider/model acceptance claim; no production migration or flags.
- Reuse existing run state contract; keep other digest behavior unchanged.

## Review Focus

- A provider accepts POST but response is lost: no second POST through replan.
- Abort/restart after dispatch: preserve uncertainty; before dispatch: safe recovery.
- Confirmed send followed by cancellation or timeout: never become retryable failure.
- Source scope, account or destination changes between preview and create/update: reject atomically.
- Token rotation and calendar order changes with identical resources: retain the approved snapshot.

## Task 1 — Bind Calendar approval

Files: `calendar-digest-candidate.ts`, `schedule-service.ts`, `tests/services/calendar-digest-approval.test.ts`.

- [x] Add real DB regressions for create/update drift, legacy missing snapshot and unchanged resources.
- [x] Observe failures, include config in newly generated candidates and compare config plus displayed preview before approval.
- [x] Run Calendar proposal tests; record outcome.

## Task 2 — Preserve uncertain delivery

Files: `db/v3/0021_calendar_digest_delivery.sql`, `calendar-digest-runner.ts`, `schedule-runner.ts`, `tests/services/calendar-digest-delivery-safety.test.ts`, `ScheduleRunRecovery.tsx` and its UI test.

- [x] Add real HTTP/DB lost-response, rejection, timeout, stop and restart tests; observe failures.
- [x] Persist `delivery_started_at` before dispatch; retain `needs_attention` after ambiguous failures and startup recovery. Keep known pre-send/rejection failures recoverable.
- [x] Display verification instructions without a replan action; verify UI regression.
- [x] Run focused tests, full check, migration rerun checks, independent branch review and fix meaningful findings.
- [x] Fill task result and one handoff log, commit scoped files for PR handoff.

## Verification ledger

- `4b0ee709`: initial regressions RED→GREEN; full check3.186v3 +406eval +99Node PASS.
- Final review:1 P2 implicit update after eligibility drift. Fixed in `c8b516e1`:2 regressions RED→GREEN;14 confirmation tests PASS. No deferred minors.
- Integrated `afc25bd3` (#240) in `02012daa`. Full check3.507v3 +406eval +99Node PASS; browser2/2 PASS.
- Final review boundary: generic Telegram classification/destination identity contract stays outside this Calendar change; no demonstrated source/destination expansion, snapshot and runtime guards retained. Live provider/model acceptance remains NOT_RUN; CI exact-head is a merge gate.
