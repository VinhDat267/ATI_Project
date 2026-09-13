# Audit fixes implementation plan

> Execute inline in the current task. User authorization: “fix cho tôi” after the audit. No Git repository is initialized.

**Goal:** Repair the existing DSL and reconcile the project specification against F01–F14 in `docs/AUDIT-DOCS-2026-09-12.md`.

**Architecture:** Keep the declarative DAG, make planner outcomes explicit, enforce a trusted tool policy independently of LLM labels, and expose typed approval/run contracts. Application services remain planned work; a schema or helper is not runtime integration evidence.

**Tech stack:** TypeScript, Zod 4 native JSON Schema, Vitest, Ajv; PostgreSQL migration specification and OpenAPI 3.1.

**Constraints:** Preserve the audit and original documents in an archive; no external writes; no live LLM/MCP calls. Baseline B/local was explicitly selected by the user on 2026-09-13. Calendar dates use a persisted IANA timezone. Unknown write outcomes require reconciliation rather than blind retry.

## 1. DSL regressions

- [x] Add `packages/dsl/tests/regressions.test.ts`; run against current source and retain failing output.
- [x] Fix `reference.ts`, `graph.ts`, `schema.ts`, `prompts.ts`, `events.ts`, and `scripts/emit-json-schema.ts`.
- [x] Verify malformed/dangling references, object interpolation, Monday in Vietnam, planner refusal, terminal events and nonempty generated schemas.

## 2. Tool and approval contracts

- [x] Add behavioral tests for unknown tools, forged read labels, resolved args, write-dependent previews and stale approval snapshots.
- [x] Add `tool-policy.ts` and `contracts.ts`; export public contracts from `index.ts`. Trust registry policy and input/output schemas, never model labels.
- [x] Generate OpenAPI components from these Zod contracts; validate references and generated types.

## 3. Specification, data and evaluation

- [x] Archive superseded design documents; establish `docs/BASELINE.md` as scope authority and cross-link FR/profile, six-week milestones, API lifecycle and database rules.
- [x] Add migration for nullable pre-plan run version, planner outcomes, approval version binding, operation fingerprint/outcome, trace version and transactional outbox. Do not claim migration execution without PostgreSQL evidence.
- [x] Add small local catalog and hand-checked dev/holdout fixtures with semantic outcomes; mark old 30 cases as historical and out of the current evaluation.
- [x] Correct comparison claims, unsupported DSL examples, command readiness and duplicated source-of-truth documents.

## 4. Verification and handoff

- [x] Run root typecheck/build/test, JSON Schema generation, fixture contract checks and OpenAPI type generation.
- [x] Record actual results and per-finding resolution in `docs/FIX-REPORT-2026-09-13.md`, including application integration and live-provider checks still NOT_RUN.

Completion note: all remediation deliverables above are present. PostgreSQL/live app/provider integration remain NOT_RUN as specified; no claim that the six-week platform is built. Final independent review fixes and 38 passing tests are recorded in FIX-REPORT.
