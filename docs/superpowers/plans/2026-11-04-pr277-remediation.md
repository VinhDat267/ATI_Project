# PR #277 remediation implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` inline; one independent review of the complete change before handoff.

**Goal:** Fix the six reproduced PR #277 findings without expanding the service catalog.

**Architecture:** Share report intent and content-target selection; derive API policy from server-owned request history/correlation, render actual native observations, hash-check all report output fields. Preserve local defaults by actor/workspace. Keep offline composition separate from live acceptance.

**Tech Stack:** TypeScript, React, Vitest, PostgreSQL 16, Playwright, existing tool adapters.

**Spec:** [current-flow-completion-design](../specs/2026-11-04-current-flow-completion-design.md).
**Task:** [FLOW-08](../../handoff/tasks/FLOW-08-pr277-review-fixes.md).

## Global constraints

- One task branch/worktree; preserve the user's checkout and existing audit evidence.
- No new provider tool, resolver syntax, dependency, or DB migration.
- Final provider arguments remain ordinary strings. Model/client claims do not create server observations.
- No edits to CURRENT-STATE or ROADMAP; no automatic merge.
- Live model/OAuth/provider acceptance remains NOT_RUN unless actually evidenced.

## Review focus

Natural and quoted report topics; user-authored title/body/literal versus factual reports; every outgoing content field; headerless/A2 Sheets data; account/workspace changes while an editor is open; original request correlation under overlapping chat turns and sub-millisecond timestamps. These inputs have behavioral regressions.

## Task FLOW-08

**Files and interfaces:**

- `packages/tool-schemas/src/report-evidence.ts`: shared `requiresReportEvidence(userTexts)`, `reportOutputTargets(steps)`, source-tool allowlist and mixed-literal detection; test `tests/report-intent.test.ts`.
- `packages/planner/src/{planner,validator}.ts`, `reports/renderers.ts`: server observations, all-output binding/validation, native GitHub url, reject unsupported Sheet shapes and clarify header ambiguity; test `tests/report-native-contracts.test.ts` plus existing reports/planner/validator suites.
- `apps/chat-api/src/services/{chat-service,execution-service,report-evidence-guard}.ts`: context-aware pre-persist and pre-CAS checks; exact originating user via server assistant metadata and PostgreSQL timestamps. Extend `tests/integration/report-evidence.test.ts`.
- `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`: cancel/reset editor and verify opening scope at save. Test `tests/services/workflow-defaults-scope.test.tsx`.
- `evaluations/tests/current-flow-offline.test.ts` (renamed), fixtures, FLOW-07 card: accurately describe controlled-model/fixture tests and reopen live gates.

- [x] Reproduce original failures with failing behavioral tests before production edits.
- [x] Implement shared contract, planner/validator/API checks and renderers.
- [x] Implement defaults editor scope handling.
- [x] Reclassify offline tests and reopen unsupported live/oracle claims.
- [x] Address independent reviewer regressions with RED -> GREEN tests.
- [x] Verify actual native-adapter/SQL/executor/loopback dispatch and real browser behavior.
- [x] Complete final package/full checks and independent source review.
- [ ] Commit, exact-SHA independent recheck and CI.

## Rulings

- Mixed report and different literal/mutation bodies clarify instead of guessing which destination receives report facts. Standalone literal notifications remain supported.
- Do not force headerAware or change requested ranges. Unknown header semantics ask the user, preventing first-row loss in A2 or headerless grids.
- Contact-table recipient lookup and source issue creation/update remain ordinary workflows; explicit separate aggregation/report requests still require observations.
- Existing historical live logs are preserved; the current FLOW-07 card supersedes unsupported gate-complete statements. Operator attestation is not promoted into eighteen verified workflow runs.
