# Pilot Full DSL Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make a quality `PASS` require a raw Gemini plan to satisfy the full DSL, reviewed Pilot tool contract, and static reference checks, while fixing A4 and verified-assignee findings.

**Architecture:** Add a pure Pilot plan validator that composes `WorkflowPlanSchema`, `validatePlanTools`, and a static output-schema path check. Integrate it into the existing quality grader without repairing observations; separately correct planner instructions and checklist recognition, then bind the new validator into quality freezes and regrade the saved public observations offline.

**Tech Stack:** TypeScript, Zod, `@wap/dsl`, AJV 2020, Vitest, Node.js.

**Spec:** `docs/superpowers/specs/2026-09-26-pilot-full-dsl-quality-gate-design.md`

## Global Constraints

- The evaluator checks the unmodified model result and never fills or rewrites fields to make a plan pass.
- No proposed workflow is executed and no Trello or Sheets write occurs.
- Keep the Free Tier campaign cap at `0 USD`; implementation verification uses no provider call.
- Keep holdout sealed until the new public run passes the strict evaluator.
- Assignment without a verified exact Trello member ID remains clarification and cannot propose a card write.
- A quality manifest must fingerprint the grader, planner guidance, checklist, and new validator.

## Review Focus

- Missing write idempotency key: full schema fails with a bounded reason; pinned in `rejectsWriteMissingIdempotencyKey`.
- Reference with wrong root or missing output property: fails static reference validation; pinned in `rejectsMalformedAndUnknownOutputReferences`.
- Reference from a step not declared as a dependency: fails graph validation; pinned in `rejectsUndeclaredStepDependency`.
- A4 paper size in mixed-case source text: satisfies design dimensions without inventing orientation; pinned in `recognizesA4AsDesignDimensions`.
- Assignment by ambiguous name, username, or unverified ID: prompts for a verified member ID and stays write-free; pinned in planner and grader tests.

---

### Task 1: Add a strict Pilot workflow-plan validator

**Files:**
- Create: `packages/engine/src/pilot/quality-plan-validator.ts`
- Create: `packages/engine/tests/pilot-quality-plan-validator.test.ts`
- Modify: `packages/engine/src/pilot/quality-freeze.ts`
- Modify: `packages/engine/tests/pilot-quality-freeze.test.ts`

**Interfaces:**
- Produces `validatePilotQualityPlan(value: unknown): readonly PilotQualityPlanIssueCode[]`.
- `PilotQualityPlanIssueCode` is a closed union containing `workflow_schema_invalid`, `workflow_graph_invalid`, `tool_contract_invalid`, and `reference_path_invalid`.
- Adapts each catalog name such as `trello.create_card` to the observed DSL identity (`server: "trello"`, `name: "trello.create_card"`) and its reviewed schemas; it does not accept model-defined side-effect policy or registry entries.

- [x] **Step 1: Write failing validator tests** for a valid read plan, a valid write plan with a non-empty DSL idempotency key, missing write idempotency, an unknown tool, arguments outside the reviewed input schema, malformed references, missing step dependencies, and nonexistent output-schema paths.
- [x] **Step 2: Run the focused test** with `npm run test:unit -w @wap/engine -- tests/pilot-quality-plan-validator.test.ts`; confirm the new module or assertions fail before implementation.
- [x] **Step 3: Implement `validatePilotQualityPlan`** to parse with `WorkflowPlanSchema`, then call `validatePlanTools` with only the adapted reviewed catalog. Return deduplicated fixed issue codes, never model strings or raw validator messages.
- [x] **Step 4: Add static reference-path validation** for step-output references in tool args and workflow outputs. Resolve the referenced step to its trusted catalog output schema; walk object `properties` and array `items`; fail closed when the schema cannot prove a requested path. Do not resolve or fabricate runtime output values.
- [x] **Step 5: Add the new validator source to `ARTIFACTS.behavior`** in `quality-freeze.ts` and the fixture path list in `pilot-quality-freeze.test.ts`.
- [x] **Step 6: Run focused tests** for the new validator and quality freeze; confirm every malformed case returns a fixed reason and every accepted case has no issues.
- [x] **Step 7: Commit** the validator, its tests, and freeze fingerprint update.

### Task 2: Make the quality grader enforce the full DSL

**Files:**
- Modify: `packages/engine/src/pilot/quality-grader.ts`
- Modify: `packages/engine/tests/pilot-quality-grader.test.ts`

**Interfaces:**
- Consumes `validatePilotQualityPlan` from Task 1.
- Keeps `gradePilotQualityCase(input: PilotQualityGradeInput): PilotQualityGrade` as the public signature.

- [x] **Step 1: Update grader tests** so a complete valid `PlannerResult` with a valid full write plan can pass; a plan lacking `idempotency_key`, containing a broken reference, or using an unreviewed tool fails with the corresponding fixed reason.
- [x] **Step 2: Add branch tests** proving malformed `PlannerResult`, clarification/refusal with unexpected effects, and a plan on an unexpected branch cannot pass. For expected clarification variants `V2-10-vi/en`, assert any plan or write proposal fails; a clarification with no proposed effect retains the expected branch.
- [x] **Step 3: Run the focused grader test** with `npm run test:unit -w @wap/engine -- tests/pilot-quality-grader.test.ts`; verify new assertions fail before implementation.
- [x] **Step 4: Integrate strict validation** after checking the observed decision kind. Validate only `kind: "plan"`; continue exact tool/argument, write-count, unsafe-reason, and remote-effect checks. Do not mutate `observed.result` or `proposedEffects`.
- [x] **Step 5: Run focused grader and validator tests** and verify that no raw model prose appears in reason codes.
- [x] **Step 6: Commit** the grader change and tests.

### Task 3: Recognize A4 in the intake checklist

**Files:**
- Modify: `packages/engine/src/pilot/checklist.ts`
- Modify: `packages/engine/tests/pilot-checklist.test.ts`

**Interfaces:**
- Keeps `evaluateChecklist` signature unchanged.
- Changes `PILOT_CHECKLIST_VERSION` from `pilot-checklist-2` to `pilot-checklist-3`.

- [x] **Step 1: Add failing checklist tests** proving case-insensitive `A4` counts as design dimensions, while a generic banner request still reports `dimensions` missing.
- [x] **Step 2: Run the focused checklist test** with `npm run test:unit -w @wap/engine -- tests/pilot-checklist.test.ts`; confirm the A4 assertion fails before implementation.
- [x] **Step 3: Implement bounded A4 recognition** in the existing design-dimension detector, bump the checklist version, and keep evidence position tied to request context.
- [x] **Step 4: Run the focused checklist test** and commit the checklist source and tests.

### Task 4: Align planner guidance with the strict contracts

**Files:**
- Modify: `packages/engine/src/pilot/planner-context.ts`
- Modify: `packages/engine/tests/pilot-planner-prompt.test.ts`

**Interfaces:**
- Keeps `buildPilotPlannerContext` signature unchanged.

- [x] **Step 1: Add failing prompt tests** requiring a write step to include `idempotency_key: "${runtime.run_id}_create_card"` (the established DSL pattern) and requiring assignment clarification to request a verified exact Trello member ID; username/display name alone must not be treated as verified.
- [x] **Step 2: Run the focused planner-prompt test** with `npm run test:unit -w @wap/engine -- tests/pilot-planner-prompt.test.ts`; confirm the new contract assertions fail before implementation.
- [x] **Step 3: Update planner guidance** to match full DSL validation and assignment policy; use the established `${runtime.run_id}` reference for write idempotency and remove the conflicting claim that execution adds the DSL field only after approval. Do not change Pilot dispatch or imply that an unverified ID is authorized.
- [x] **Step 4: Run the focused planner-prompt test** and commit the prompt source and tests.

### Task 5: Regrade saved public observations and update evidence

**Files:**
- Create: `docs/ai-evidence/PILOT-V2-AI/FULL-DSL-REGRADING-2026-09-26.md`
- Modify: `docs/ai-evidence/PILOT-V2-AI/PUBLIC-2026-09-26.md`

**Interfaces:**
- Consumes the current grader and public dataset expectations.
- Uses the existing local journal `pilot-public-inputs-journal-20260926-1306` under `%TEMP%` if it is present and its journal hash chain validates. No provider API, manifest preparation, or write-capable tool is used.

- [x] **Step 1: Build current DSL and engine packages** with `npm run build -w @wap/dsl` and `npm run build -w @wap/engine`.
- [x] **Step 2: Regrade only the 26 saved public observations offline** against their unchanged `cases.json` expectations; validate the local journal sequence/hash chain before using observations. Print and retain only variant IDs, fixed reason codes, and aggregate counts.
- [x] **Step 3: Confirm each prior schema/reference finding is now a strict evaluator failure** on the unchanged saved observation, and confirm A4/assignment source findings are distinguished from plan-schema failures.
- [x] **Step 4: Write a concise evidence note** with original campaign/freeze provenance, current grader commit, public case counts and fixed reason codes. If the saved journal is absent or corrupt, mark the regrade `NOT_RUN`; do not substitute synthetic output for historical evidence.
- [x] **Step 5: Update the earlier report** to label its 26/26 as historical `PlannerResult`-level grading and link the strict offline regrade. Keep the old campaign result immutable in meaning.
- [x] **Step 6: Review evidence files for leaked prompts, provider prose, credentials, or holdout data**, then commit the evidence update.

### Task 6: Verify the integrated change

**Files:**
- No additional source files.

- [x] **Step 1: Run focused tests** for the grader, plan validator, checklist, planner context, and quality freeze.
- [x] **Step 2: Run `npm run typecheck`** from the repository root; expected result: success.
- [x] **Step 3: Run `npm run check`** from the repository root; expected result: all configured build, unit, schema, and API-generation checks pass.
- [x] **Step 4: Review `git diff --check`, the complete diff, and `git status`**; ensure no generated drift, credentials, or unrelated changes remain.
- [x] **Step 5: Run GitNexus `detect-changes --scope all`** and resolve any reported graph changes before final review or commit.
- [x] **Step 6: Request an independent Code Reviewer review** focused on full-plan gating, reference validation, assignment no-write behavior, and no provider/network side effects; fix confirmed findings and rerun only affected checks.
- [x] **Step 7: Report implementation checks separately from any later Gemini campaign.** No new live call, holdout run, or product API write is part of implementation verification.
