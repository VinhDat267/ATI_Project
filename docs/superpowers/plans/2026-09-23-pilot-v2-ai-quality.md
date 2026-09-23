# Pilot v2 AI Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the pilot's provider-backed decisions on the frozen v2 dataset and holdout, with independent grading, actual call accounting and explicit safety verdicts.

**Architecture:** Build a new v2 evaluation composition around the pilot's source/checklist/policy path and the engine's AI provider ports, with read-only or fake tool effects for repeated trials. The current pilot path is not provider-backed. Keep the existing `runPilotQualityEvaluation` labeled simulated; it reads oracle fields and estimates usage, so it cannot provide live AI evidence. Reuse the B/local campaign, approval, ledger and freeze controls only after their compatibility with the v2 runner is tested; keep the B/local and v2 results separate.

**Tech Stack:** TypeScript, existing engine AI provider ports, PostgreSQL campaign ledger, Vitest, `testdata/v2-dataset`, JSON evidence and reviewer rubric.

**Spec:** `docs/superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md` sections 8 and 9; `docs/MVP-V2-DATASET.md`; `docs/plans/2026-09-22-mvp-v2-backend/06-LIVE-HANDOFF.md` BE-28/29. The related [SaaS plan](2026-09-23-pilot-v2-saas-live.md) supplies the single real UC2 receipt.

## Global Constraints

- Public acceptance is 20 cases × vi/en = 40 records; separate holdout is 10 cases × vi/en = 20 records. Both are reconstructed synthetic data, not customer data.
- Freeze dataset, holdout, prompt, catalog, provider/model, mode, price card, rubric, thresholds and budget before the measured campaign. Any change starts a new campaign ID.
- Provider input and outcome generation must not read `expected`, `evidence.verdict`, case ID or fault labels. The grader reads the oracle only after observed outputs are immutable.
- Zero unauthorized write, zero preapproval write, zero wrong-board write and zero blind retry are release gates. Deliberate V2-19 fault injection stays on fake transport.
- Count every provider call, failed call and retry. Mark usage/cost unknown when not observable; estimated tokens are never reported as actual.
- `AI_QUALITY_MEASURED` means a valid measured report exists; meeting the predeclared quality thresholds is a separate acceptance verdict. Customer validation remains separate.

## Review Focus

1. The current P6 evaluator branches on `caseId`, `fault` and `expected`; a new runner must prove the provider path cannot see those oracle fields.
2. A provider error or missing usage must stay in the denominator and ledger rather than disappear from accuracy or cost reporting.
3. A model output proposing a write on UC1/UC3 or preapproval UC2 must be graded unsafe even if the adapter blocks the remote call.
4. Repeated test cases must not create Trello cards; the one SaaS live UC2 receipt is separate evidence.
5. Holdout cannot be used to tune prompts or thresholds and then reported as unseen.

## File map and order

| Unit | Files | Independently testable result |
|---|---|---|
| Evaluation contract/freeze | new `packages/engine/src/pilot/quality-freeze.ts`, `testdata/v2-dataset/cases.json`, `testdata/v2-dataset/holdout.json`, new engine tests | Frozen manifest with hashes, modes, rubric, prices and budget, rejected if changed. |
| Provider-backed v2 runner | new `packages/engine/src/pilot/provider-quality-runner.ts`, new `packages/engine/src/pilot/provider-quality-cli.ts`, existing `packages/engine/src/ai/planner.ts` and provider ports as candidate integration points, new engine tests | Observed decisions from provider response, with oracle inaccessible to the invocation. |
| Accounting/report | existing `packages/engine/src/pilot/accounting.ts` and `packages/engine/src/ai/live-evaluation/` controls where compatible, new `packages/engine/src/pilot/quality-report.ts`, new tests | Complete case and call ledgers, metrics and reproducible report. |
| BE-29 handoff | `docs/MVP-V2-DATASET.md`, `docs/PILOT-V2-RUNBOOK.md`, redacted campaign artifacts under `docs/ai-evidence/PILOT-V2-AI/` | Independent quality and safety verdict, with explicit limits. |

### Task 1: Freeze the measurement contract before provider work

**Interfaces:** Produce an immutable manifest with commit, dataset/holdout hashes, prompt/catalog hashes, provider/model IDs, semantic and semantic+QE modes, price source/time, max calls/tokens/cost, rubric version and numeric acceptance thresholds. Each execution accepts only a matching manifest hash.

- [ ] Inspect the 40 public and 20 holdout records for schema validity, duplicated variants, accidental secrets and overlapping prompts. Keep the existing oracle unchanged after freeze; record any correction as a new version before running.
- [ ] Write a scoring sheet with per-case fields: branch, facts, missing-field checklist, tool/argument validity, state, remote effect, refusal reason, language and grader confidence. Predeclare the numeric success thresholds and who adjudicates disagreement; safety gates remain zero violations. Use the same data and permissions for manual role-play, fixed workflow and AI where compared.
- [ ] Add freeze tests that change each hash, budget, mode and threshold in turn and assert the runner refuses execution. Run the targeted tests, then `npm run typecheck`; commit the contract/test batch.
- [ ] Obtain approval of the exact provider/model, budget, price evidence and frozen rubric before a provider call. If any is absent, stop at `AI_QUALITY_NOT_RUN`; local tests may still proceed.

### Task 2: Build an oracle-blind, source-aware provider runner

**Interfaces:** The invocation takes only `prompt`, `language`, `principal`, `resourcePolicy` and source fixture or allowlisted live read. It returns observed branch, structured plan/tool args, source citations, status, proposed effects, timing, provider/model and call IDs. A separate grader joins the immutable observation to `expected` by variant ID. The CLI accepts a frozen manifest and one explicit phase (`probe`, `smoke`, `public`, `holdout`); it refuses provider calls unless `--execute` is present.

- [ ] Add fake-provider tests: change only `expected`, `caseId`, `fault` or `evidence` on a case and assert the provider request and decision are byte-equivalent; change source content and assert the decision input changes. Assert UC1/UC3 and unapproved UC2 have zero remote POST even when the model proposes one.
- [ ] Run `npm run test:unit -w @wap/engine -- tests/pilot-live-eval.test.ts` plus the new provider-runner tests and confirm the new tests fail before implementation.
- [ ] Compose the existing source/checklist/decision path with real AI provider ports, verifying whether `ai/planner.ts` is reusable for v2 before binding to it. Add the phase-gated CLI. Keep tool execution read-only or simulated for repeated evaluation; do not call `trello.create_card` from this runner. Keep `live-eval-runner.ts` explicitly labeled `SIMULATED_ONLY` for contract tests.
- [ ] Rerun targeted tests and `npm run check:backend`; review a sample provider request to confirm no oracle or secret fields. Commit the runner/test batch.

### Task 3: Account for every call and grade independently

**Interfaces:** One append-only observation per attempted provider call, including errors/retries and provider usage if supplied; one case verdict per attempted variant; report denominators for all selected modes, languages and branches.

- [ ] Add tests for provider timeout, partial response, absent usage, budget exhaustion, retry and report interruption. Assert failed calls count, budget cannot be exceeded by another dispatch, unknown usage is flagged, and report generation never turns unknown cost into zero.
- [ ] Implement campaign gating and durable accounting, reusing B/local approval/ledger only if the v2 campaign/profile binding and price calculation tests pass. Persist raw observed output before the grader reads the oracle. Restrict the reviewer view to redacted content.
- [ ] Compute per-case pass/fail and aggregate exact denominators; missing-field precision/recall, hallucination and unsafe-action counts, median/p95 latency, call/token/cost totals, manual role-play time, and semantic versus semantic+QE comparison. Include every failure and mark non-observed metrics `NOT_RUN` or `UNKNOWN`.
- [ ] Run new accounting/report tests and `npm run check:backend`. Independently reconcile report totals with call records and budget; commit the accounting/report batch.

### Task 4: Run provider probe, public set and untouched holdout

**Entry gate:** Tasks 1–3 pass; provider compatibility, price evidence, approved cap and campaign manifest are recorded. The [SaaS plan](2026-09-23-pilot-v2-saas-live.md) has supplied a correct single UC2 receipt before any final end-to-end claim. Probe readiness alone does not count as AI quality.

- [ ] Run a capped compatibility probe with a harmless synthetic prompt and record provider/model identity, response shape, usage fields, time and charge. Stop on incompatible schema or cost accounting failure.
- [ ] Run a small declared smoke sample across vi/en and UC1/UC2/UC3 branches; inspect safety and source grounding. Stop the campaign on any unsafe proposed effect, unauthorized call, leaked secret or budget breach. Changes after smoke require a new manifest/campaign.
- [ ] Run all 40 public variants for each predeclared comparison mode without remote writes. Seal observations and grader verdicts. Then run the 20 holdout variants once; do not tune and rerun them under the same unseen claim.
- [ ] Reconcile every provider attempt with the call ledger, compare outputs to the frozen oracle through independent grading, and attach the already verified SaaS UC2 receipt as a separate observation. Report exact counts, confidence limits where meaningful, failures, threshold pass/fail and all unknowns.

### Task 5: Independent review and status update

- [ ] Have a reviewer reproduce manifest hashes, sample the raw redacted observations, check oracle separation, grader disagreements, ledger reconciliation, safety outcomes and the actual price source. Keep failed or partial campaigns in the report.
- [ ] Update `docs/MVP-V2-DATASET.md`, `docs/PILOT-V2-RUNBOOK.md` and P6 review with the campaign ID, commit, model, modes, sample counts, rubric, budget, measured results and exact evidence label. `AI_QUALITY_MEASURED` is permitted only after this review; `CUSTOMER_VALIDATED_NOT_RUN` remains until representative-user acceptance.
- [ ] Run `git diff --check`, inspect the exact diff for secrets and customer data, and commit the evidence/doc batch.
