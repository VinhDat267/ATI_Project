# Pilot Full DSL Quality Gate

**Status:** Design approved in conversation; implementation not started
**Date:** 2026-09-26
**Scope:** Provider quality evaluation for ATI Pilot v2, the checklist facts it evaluates, and planner guidance used by that evaluation.

## Goal

Make a quality `PASS` mean that a planner's proposed workflow is structurally valid against the project's full DSL and reviewed Pilot tool contract, rather than merely being a well-formed `PlannerResult` with expected decision kind and selected tool arguments. Correct the public findings for A4 size recognition and assignment clarification at the same time.

The evaluator remains a no-dispatch path. It must never execute a proposed tool, write to Trello or Sheets, repair model output, or turn invalid output into an accepted plan.

## Evidence and current gaps

The public Gemini report dated 2026-09-26 records 26/26 `PlannerResult`-level automatic passes, but independent review found 5 of 8 observed plans fail `WorkflowPlanSchema`; two more contain output references that are syntactically plausible but cannot be resolved. The current grader does not inspect the full plan. The checklist misses `A4`, although it is present in the source. Assignment clarification permits weaker identifiers than the previously agreed verified Trello member requirement.

The DSL contract in `packages/dsl/src/schema.ts` requires a non-empty `idempotency_key` on every write step. The Pilot prompt currently says execution adds idempotency after approval, which conflicts with the full workflow contract. The evaluator must not silently add a key to make an observed model plan pass.

## Approaches considered

1. **Strict raw-plan acceptance (recommended):** parse the `PlannerResult`, validate the unchanged plan using the full DSL and reviewed tool catalog, and fail the grade on any issue. Fix planner guidance to satisfy the existing contract. This preserves the meaning of PASS and exposes future drift.
2. **Non-blocking DSL diagnostics:** retain the current verdict and attach schema/reference warnings. This reports findings but leaves false PASS results in the headline metric.
3. **Evaluator-side normalization:** fill or rewrite missing fields before validation. This hides model defects, risks changing intent, and makes the result differ from the actual proposal.

Approach 1 is selected. No schema relaxation or semantic repair is in scope.

## Design

### Grading pipeline

For every observation, the grader will:

1. Parse the unmodified `result` with `PlannerResultSchema`.
2. Check decision kind, safety reasons, remote effects, write count, and expected reviewed tool arguments as it does today.
3. For `kind: "plan"`, parse `plan` with `WorkflowPlanSchema`, allowing only the DSL's documented defaults. A write missing `idempotency_key` remains invalid; the evaluator will not generate one.
4. Run the existing DSL graph/tool validation against an adapter of `PILOT_TOOL_CATALOG`. This checks trusted tool identity and side-effect policy, argument schemas, reference syntax, declared inputs, existing step IDs, dependencies, cycles, and the execution-profile restrictions enforced by `validatePlanTools`.
5. Validate every step-output reference path in args and workflow outputs against the referenced tool's reviewed output schema. A reference must use the documented `${steps.<id>.output...}` shape and point to a declared output field. Dynamic references remain unresolved at evaluation time; this gate checks their static contract, not runtime SaaS values.
6. Return bounded reason codes such as `workflow_schema_invalid`, `workflow_graph_invalid`, `tool_contract_invalid`, or `reference_path_invalid`. Do not persist raw model prose or arbitrary schema messages in the grade reasons.

Clarification and refusal results must remain plan-free and write-free. Any unexpected plan or write on those branches fails grading. An invalid plan is retained only as the already-authorized observation evidence; it is never dispatched.

### Planner and checklist corrections

- Update Pilot planner guidance so generated write plans include the required DSL idempotency field. The evaluator must inspect the raw generated candidate, not a server-patched copy. This changes evaluation guidance only; it does not connect the model to the production API or alter Pilot dispatch.
- Add recognized paper-size tokens including `A4` to design-asset dimension detection. Keep evidence tied to the source row and bump `PILOT_CHECKLIST_VERSION` so source revisions change when checklist semantics change.
- Tighten assignment clarification wording to require choosing a Trello board member by a verified exact member ID. A username or an ambiguous display name is insufficient. Without verified assignment identity, the expected branch remains clarification and no write may be proposed.

### Freeze, reports, and live-evaluation boundary

The grader, checklist, and planner prompt are already included in quality freeze fingerprints. Any implementation change will therefore require a new freeze before an evaluated campaign can run. Re-grade archived observations locally where supported; do not reuse the old 26/26 PASS as acceptance evidence for the stricter evaluator.

Maintain the existing `0 USD` cap and Free Tier controls. The implementation and targeted tests require no provider call. If a new public provider run is later performed, it must use the updated freeze and current bounded campaign authorization; do not open holdout until public cases pass the new gate. No paid fallback, Trello write, or production API integration is part of this design.

## Test requirements

- Grader tests prove that a valid full plan can pass and that missing write idempotency, invalid outputs, malformed references, missing step dependencies, undeclared inputs, unreviewed tools, and wrong tool arguments fail with bounded reasons.
- Branch tests prove clarifications/refusals with any write proposal fail.
- Checklist tests prove A4 is sufficient evidence for the intended design-size field and still report dimensions missing when no supported size/dimension exists.
- Assignment tests prove ambiguous names/usernames still require clarification and never permit a write; prompt tests assert the exact verified-member-ID policy.
- Freeze tests prove behavior, checklist, and prompt changes invalidate old manifests.
- Run focused evaluator/checklist tests, affected package typecheck, then the repository-prescribed `npm run check`. A provider campaign is separate and is not required to verify implementation correctness.

## Acceptance criteria

- No plan receives `PASS` unless it passes full workflow schema, reviewed tool validation, graph checks, and static output-reference validation.
- Existing public findings are represented as evaluator failures on their unchanged recorded observations; corrections are made in planner/checklist behavior, not by grader repair.
- A4 source evidence no longer causes a false missing-dimensions clarification.
- Assignment ambiguity continues to block card creation until a verified Trello member identity is supplied.
- No network write or paid provider call occurs in implementation verification.
- New quality runs cannot use the previous freeze after code changes.

## Out of scope

- Connecting source-aware AI to the production Pilot API.
- Executing plans, approving workflows, changing Trello cards, or changing Google Sheets.
- Opening or tuning against the holdout oracle before the new public run passes.
- Relaxing `WorkflowPlanSchema`, inventing successful tool outputs, or treating a syntactically valid reference as proof of live data.
- Changing the user's Free Tier / `0 USD` limit.
