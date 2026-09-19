# AI Live Evaluation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax and require red-green-refactor discipline.
>
> Task: Fix the T5/T6 AI live-evaluation safety, durability, provenance, runtime, and scoring gaps without weakening the production AI fail-closed boundary.
> Evidence verified at commit `dd340c2779aa0bf5693b96ad966ec884b22f59a7`; GitNexus index fresh at the same commit with PDG available (index refresh skipped because index exactly matched HEAD).
> Evidence provenance schema 2; global dirty digest `0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd`; cited-path manifest 34 sorted entries; exact generated plan path excluded.

**Goal:** Make T5/T6 capable of producing trustworthy live-evaluation evidence only when the exact execution scope is approved, every paid call is durably journaled and budgeted, the eval database/index is isolated and pinned, and report verdicts truthfully reflect evidence provenance.

**Architecture:** Keep the evaluator as an engine-owned, opt-in composition root. Reuse the existing provider registry, approval, accounting, catalog-embedding, and pgvector boundaries; add evaluator-specific authorization, journal/ledger, and runtime adapters. Preserve the API runtime's default denial of live calls. Recovery reconstructs state from an append-only journal and never reissues a provider request.

**Tech Stack:** TypeScript, Node.js file handles, Zod, Vitest, PostgreSQL/pgvector, `@wap/db`, existing OpenAI/Google provider transports, GitNexus/PDG.

**Spec:** `docs/superpowers/plans/2026-09-18-ai-live-evaluation.md`

## Global Constraints

- [verified] This plan does not authorize a paid provider call, rubric approval, production database access, secret creation, or source change.
- [verified] `apps/api/src/ai-runtime.ts` remains fail-closed by default; the live evaluator must not relax or bypass `denyAiLiveCalls`.
- [verified] `AI_EVAL_DATABASE_URL` must be present and unequal to `DATABASE_URL` before any evaluator database connection is opened.
- [inferred] Every command that can spend money must prove authorization, freeze/currentness, durable accounting availability, and budget headroom before credential lookup or transport invocation.
- [verified] Existing untracked `AGENTS.md` is user/workspace state. Implementation must preserve it and must not add it to a feature commit unless the user separately directs that action.

## Review Focus

- Exact approval scope and ordering before secrets/network.
- Crash-safe journal and pessimistic budget behavior.
- No fake or exploratory evidence reported as a formal live pass.
- Real `probe`/`index` effects, dedicated eval database, pinned pgvector provenance.
- Causal scoring based on graph reachability, not array position.
- Zero regression in provider clients, API runtime denial, offline evaluation, and full backend checks.

---

## 1. Objective

[verified] The current T5/T6 implementation has useful schemas, deterministic scheduling, scorer/report foundations, and provider/pgvector primitives, but it is not safe to treat a successful CLI run as production-grade live evidence. The objective is to close the reviewed blockers so that:

1. [inferred] Only the exact campaign, phase, profile, raw config bytes, reachable providers, and complete role-to-model map approved by a human can reach credentials or a transport.
2. [inferred] Every reserved, successful, failed, cancelled, interrupted, or ambiguous paid call survives process failure in a replayable journal and consumes budget conservatively.
3. [inferred] Formal `LIVE_EVALUATION_PASS` is possible only for live-provider evidence, an approved/frozen rubric, a matching freeze, complete trials, a current pinned index, and reconciled accounting.
4. [inferred] `probe`, `index`, `run`, and `report` perform their named effects; none may return a misleading no-op success.
5. [inferred] Scoring and scheduling reject false causal order and duplicate work before provider calls are made.

Out of scope: selecting/approving the final rubric, supplying live credentials, running a paid campaign, changing frontend/UI, or enabling live calls in the production API runtime.

## 2. Current Behaviour

- [verified] `runLiveEvaluationCli` parses and validates an approval, but its expected `configHash` is taken from the approval itself and its expected provider/model scope is incomplete. A syntactically valid arbitrary hash and an approval that covers only planning can authorize a mixed-provider profile (`packages/engine/src/ai/live-evaluation/cli.ts:306`, `:369`, `:489`; `packages/engine/src/ai/providers/approval.ts:149`).
- [verified] `assertAiLiveApproval` verifies expected model entries but does not require an exact model-role key set, so extra or omitted roles are not rejected symmetrically (`packages/engine/src/ai/providers/approval.ts:175`).
- [verified] The runner accepts a `ProviderCallLedger`, but the trial session factory receives only `profileId`; the CLI creates a fresh `InMemoryProviderCallLedger`, and the runner does not bind campaign/run/trial context to provider calls (`packages/engine/src/ai/live-evaluation/runner.ts:30`, `:215`; `packages/engine/src/ai/live-evaluation/cli.ts:531`).
- [verified] Model-call evidence is copied into the outcome only after `planner.produce` returns. A thrown timeout/429/cancellation skips that transformation and loses the captured failure evidence (`packages/engine/src/ai/live-evaluation/runner.ts:228`, `:252`, `:265`, `:284`).
- [verified] `createFileJournalWriter` performs plain `appendFile` without exclusive run creation, event schema validation, monotonic sequence checks, flush/sync, or replay (`packages/engine/src/ai/live-evaluation/runner.ts:58`).
- [verified] `report --run` reads an existing `summary.json`; it cannot reconstruct a missing/partial summary from `journal.jsonl` and therefore is not crash recovery (`packages/engine/src/ai/live-evaluation/cli.ts:602`).
- [verified] `probe` validates metadata and returns success without calling a provider. `index` validates the URL/approval and returns success without building, activating, or reading back a pgvector index (`packages/engine/src/ai/live-evaluation/cli.ts:269`, `:330`).
- [verified] The default CLI environment has no real `getSession`; consequently the package-level `ai:eval:live ... run --execute` path cannot construct a live evaluator session (`package.json`; `packages/engine/src/ai/live-evaluation/cli.ts:541`).
- [verified] The `run` command does not call `validateEvalDatabaseUrl`; database isolation is currently checked only in `index` (`packages/engine/src/ai/live-evaluation/cli.ts:354`, `:393`).
- [verified] `LiveRubricSchema` permits `APPROVED_FROZEN` with null `approvedBy`/`approvedAt`, while the checked-in rubric remains `PROPOSED_EXPLORATORY` (`packages/engine/src/ai/live-evaluation/contracts.ts:86`; `testdata/ai-live-rubric.json`).
- [verified] `buildLiveEvaluationReport` can emit `LIVE_EVALUATION_PASS` from semantic scores alone and the contracts do not distinguish live-provider evidence from a fake transport (`packages/engine/src/ai/live-evaluation/report.ts:229`; `packages/engine/src/ai/live-evaluation/contracts.ts:415`).
- [verified] `createLiveFreeze` fingerprints a handpicked source list and compares only part of the execution profile. It omits the complete runtime/source manifest, budget/price card, exact approval scope, git state, and active pinned index (`packages/engine/src/ai/live-evaluation/freeze.ts:18`, `:114`, `:204`).
- [verified] Causal ordering compares positions in `executedTools`; a successor in the same parallel layer can pass merely because it appears later in iteration order (`packages/engine/src/ai/live-evaluation/scorer.ts:592`).
- [verified] `scheduleLiveTrials` does not reject duplicate profiles/cases/cells, so duplicate input can schedule duplicate trial IDs and provider work (`packages/engine/src/ai/live-evaluation/schedule.ts:41`).

## 3. Relevant Architecture

- [verified] `createAiPorts` is the shared provider boundary and constructs planning, query-expansion, and embedding clients from config, credentials, an authorization callback, a ledger, call context, and fetch implementation (`packages/engine/src/ai/providers/registry.ts:54`, `:808`).
- [verified] The low-level provider path authorizes, obtains credentials, reserves budget, invokes `fetch`, and settles the ledger. This is the correct common enforcement point; evaluator-specific code should supply exact scope/context rather than duplicate transports (`packages/engine/src/ai/providers/registry.ts:317`).
- [verified] `ProviderCallReservation` already carries campaign, run, profile, provider, purpose, model, request hash, cap/purpose, and estimated cost. It lacks a trial identifier required for per-trial replay/reconciliation (`packages/engine/src/ai/providers/accounting.ts:3`).
- [verified] `openDatabase(url)` exposes independent postgres/drizzle clients and an explicit `close`, so the evaluator can own and close a dedicated connection without importing API process state (`packages/db/src/connection.ts:6`).
- [verified] `buildCatalogEmbeddingRows` calls the configured embedding port and validates dimensions, policy version, catalog hash, provenance consistency, completeness, and vector shape before activation (`packages/engine/src/ai/catalog-embedding.ts:62`).
- [verified] `PgvectorCatalogIndex.activate`, `activeIndex`, `pin`, and `assertCurrent` already establish the activation/currentness seam; `PinnedEmbeddingIndex` carries the exact id, provenance, vector hash, and policy hash needed by the freeze and runner (`packages/engine/src/ai/pgvector-index.ts:240`, `:311`).
- [verified] `apps/api/src/ai-runtime.ts` composes the same shared provider/pgvector primitives but defaults to `denyAiLiveCalls`. The evaluator may reuse primitives, but API production composition must not import live-evaluation modules or inherit evaluator authorization.
- [inferred] The clean boundary is therefore: shared provider and pgvector mechanisms remain generic; evaluator-only modules derive the approved scope, persist/replay the journal and ledger, create per-trial sessions, and build truthful evidence.

## 4. GitNexus Findings

- [graph] `codegraph explore "live-evaluation-authorization-ledger-journal-freeze-scorer"` identified the live evaluator, Providers, AI, and Evaluation modules; the relevant process includes `RunLiveEvaluationCli → LiveDatasetError`, while provider construction flows through `CreateAiRuntime → CreateEmbeddingClient/CreateModelClient/CreateQueryExpansionClient`.
- [graph] `gitnexus context runLiveEvaluationCli --content` showed that the CLI directly coordinates contracts, dataset, schedule, freeze, runner, report, approval, and accounting. It is the orchestration hotspot and should become thinner rather than absorb journal/runtime implementations.
- [graph] `gitnexus impact runLiveEvaluationCli --direction upstream --depth 3` reported a critical radius (101 symbols, 21 direct dependencies, 42 processes, 6 modules). The implementation must preserve the CLI result contract and isolate changes behind focused modules/tests.
- [graph] `gitnexus impact runLiveEvaluation --direction upstream --depth 3` found four consumers, with direct impact concentrated in `ai-live-runner.test.ts` and `runLiveEvaluationCli`. This makes a context-rich session factory change bounded and testable.
- [graph] `gitnexus context createAiPorts --content` plus upstream impact found direct consumers in provider-client tests and `apps/api/src/ai-runtime.ts`, with API main/tests at depths two and three. Shared context/accounting changes require API regression tests.
- [graph] `gitnexus context buildCatalogEmbeddingRows --content` found the exact provenance-validation path and an existing integration test consumer in `packages/engine/tests/ai-live-index.integration.test.ts`; the index command should compose this function rather than invent a second embedding pipeline.
- [graph] `gitnexus impact invokeProvider --mode pdg --line 341` found no statement block at that exact line and fell back to a callgraph bridge reaching `complete` and `expand`. This is explicitly not statement-level proof; source ordering remains the authority for authorization/reservation/network ordering.
- [graph] GitNexus index statistics at the pinned commit: 470 files, 25,741 symbols, 57,657 edges, 285 clusters, 350 processes. The index was not refreshed because its commit exactly matched HEAD.

## 5. Statement-Level PDG Findings

### CLI approval gate

- [graph] PDG slice for `runLiveEvaluationCli` at the `assertAiLiveApproval` statement (`cli.ts:489`, upstream depth 5) connected argument parsing, approval read/parse, config parsing, and profile validation to the gate.
- [verified] The expected hash is not independently derived and the session/network path is hidden behind a callback boundary, so the absence of a direct PDG path from the gate to `fetch` is not proof of safety.
- [inferred] Planning consequence: compute an immutable execution scope from raw config bytes and the selected command/profile before constructing credentials, database runtime, provider ports, or trial sessions; pass that same scope into every authorization callback.

### Causal scoring

- [graph] PDG slice for `scoreLiveCandidate` at `scorer.ts:607` connected candidate parsing, `validateManualPlan`, `validateGraph`, rubric causal pairs, and `executedTools` indices; the interprocedural bridge reaches the runner and CLI.
- [verified] The current decision uses list indices rather than dependency edges.
- [inferred] Planning consequence: evaluate each rubric predecessor/successor pair over the validated plan's dependency graph, requiring a predecessor-to-successor path for every matched successor invocation; iteration position must be irrelevant.

### Report verdict

- [graph] PDG slice for `buildLiveEvaluationReport` at `report.ts:233` connected terminal accounting and the `allPassed` value to the verdict branch; the bridge reaches CLI exit-code selection.
- [verified] Evidence kind, rubric approval state, index currentness, freeze match, and exact cost reconciliation do not currently control the PASS branch.
- [inferred] Planning consequence: make those values explicit report inputs and blocking predicates; semantic quality remains necessary but cannot be sufficient.

### Provider authorization/accounting ordering

- [graph] The attempted PDG criterion at `registry.ts:341` had epistemic result `pdg-no-block-at-line`; only callgraph-bridge evidence to `complete` and `expand` was available.
- [verified] Source inspection shows the intended local order is authorization before credential lookup/reservation/fetch, followed by settlement in success/error paths (`packages/engine/src/ai/providers/registry.ts:317`).
- [inferred] Planning consequence: preserve that order and add targeted tests that make credentials/fetch throw if touched before approval, because PDG alone cannot certify callback ordering here.

PDG limitation: [graph] the indexed layer is strongest intra-procedurally and uses symbol-graph bridges across callbacks. A future executor should use an MCP taint/explain capability if available, but lack of that output must not replace source-based negative-path tests.

## 6. Proposed Changes

### 6.1 Exact authorization scope

- **Files:** `packages/engine/src/ai/providers/approval.ts`, `packages/engine/src/ai/live-evaluation/cli.ts`, new `packages/engine/src/ai/live-evaluation/authorization.ts`.
- **Existing symbols:** `parseAiLiveApprovalRecord`, `assertAiLiveApproval`, `runLiveEvaluationCli`.
- [inferred] Hash the exact raw config file bytes with SHA-256; never take the expected hash from the approval record.
- [inferred] Derive command-specific reachable roles: `run` uses planning/repair/replan/query-expansion/embedding; `probe` covers every configured role; `index` uses embedding. Providers are the exact deduplicated set and models are the exact role map.
- [inferred] Make `assertAiLiveApproval` compare both providers and model-role keys/values exactly, reject duplicates/extras/omissions, and keep time/campaign/phase/profile/budget validation fail-closed.
- [inferred] Complete this gate before credentials, `openDatabase`, session construction, or provider calls. Unit tests use spies that fail if a rejected approval touches any downstream capability.

### 6.2 Durable event journal and replay

- **Files:** new `packages/engine/src/ai/live-evaluation/journal.ts`, `packages/engine/src/ai/live-evaluation/contracts.ts`, `packages/engine/src/ai/live-evaluation/runner.ts`, `packages/engine/src/ai/live-evaluation/cli.ts`.
- **Existing symbols:** `LiveJournalEvent`, `createFileJournalWriter`, `runLiveEvaluation`, `runLiveEvaluationCli`.
- [inferred] Replace unstructured append with a versioned Zod event schema containing run id, monotonic sequence, event id, timestamp, optional trial/call id, type, and typed payload.
- [inferred] Create the run directory and journal exclusively; an existing run id fails before append. Hold one file handle, append one JSON line, and call `FileHandle.sync()` after schedule, trial start/terminal, provider reserve/settle, halt, and run terminal events.
- [inferred] Replay rejects unknown versions/types, invalid payloads, duplicate/gapped sequences, conflicting terminal states, and non-final malformed lines. Only an incomplete final fragment may be ignored, and that fact becomes a recovery limitation/blocking reason.
- [inferred] `report --run` replays the journal without constructing credentials, database/provider ports, or issuing network calls. It marks started-but-not-terminal trials and reserved-but-unsettled calls as interrupted/ambiguous; it never automatically retries them.

### 6.3 Journal-backed accounting and exact call context

- **Files:** `packages/engine/src/ai/providers/accounting.ts`, `packages/engine/src/ai/providers/registry.ts`, new `packages/engine/src/ai/live-evaluation/ledger.ts`, `packages/engine/src/ai/live-evaluation/runner.ts`.
- **Existing symbols:** `ProviderCallReservation`, `ProviderCallLedger`, `AiProviderCallContext`, `createAiPorts`, `runLiveEvaluation`.
- [inferred] Add optional `trialId` to the shared reservation/context for backward compatibility; the evaluator-specific ledger requires it and rejects missing/mismatched campaign/run/profile/trial context.
- [inferred] Make the runner session factory receive the full immutable trial context rather than only `profileId`, and bind it to all planning, repair, replan, query-expansion, and embedding calls.
- [inferred] The durable ledger writes and syncs a reserve event before returning a call id, then writes one terminal settlement. A same-digest repeat is idempotent; a conflicting repeat is corruption.
- [inferred] Budget computation includes settled exact/unknown costs plus held estimates for reserved or ambiguous calls. A call without exact provider price remains unknown and blocks a formal pass; it never becomes zero.
- [inferred] Capture model evidence in a `finally`-safe path so timeout, 429, cancellation, and parser failures retain the call evidence and reconcile to the ledger.

### 6.4 Complete freeze, rubric invariants, and evidence truthfulness

- **Files:** `packages/engine/src/ai/live-evaluation/contracts.ts`, `packages/engine/src/ai/live-evaluation/freeze.ts`, `packages/engine/src/ai/live-evaluation/report.ts`, `testdata/ai-live-rubric.json` only if a human separately approves it.
- **Existing symbols:** `LiveRubricSchema`, `LiveEvaluationFingerprintsSchema`, `createLiveFreeze`, `assertLiveFreezeMatches`, `buildLiveEvaluationReport`, `renderLiveEvaluationMarkdown`.
- [inferred] Add cross-field rubric validation: `APPROVED_FROZEN` requires non-empty approver and offset timestamp; proposed rubrics require null approval fields. Implementation must not manufacture approval or mutate the checked-in proposed rubric.
- [inferred] Add `evidenceKind` (`LIVE_PROVIDER` or `FAKE_TRANSPORT_TEST`) and a blocked verdict/state. Only live evidence with an approved frozen rubric, matching freeze, complete outcomes, current pinned index, no semantic `needs_review`, and fully reconciled accounting can emit `LIVE_EVALUATION_PASS`.
- [inferred] Freeze all role configs, provider capabilities, price-card hash, budget, approval-scope hash, exact active index identity/provenance/vector/policy hashes, Node/package versions, git HEAD/status digest, and a deterministic recursively enumerated source manifest. `createdAt` is excluded from semantic equality; all other frozen fields compare exactly.
- [inferred] Build the source manifest from explicit evaluator/provider/AI/DSL/database-schema/testdata roots, raw file bytes, normalized repo-relative paths, sorted order, and symlink rejection. Exclude generated outputs (`dist`, `.artifacts`, `.git`, `node_modules`) explicitly.

### 6.5 Real evaluator runtime, probe, and index

- **Files:** new `packages/engine/src/ai/live-evaluation/runtime.ts`, `packages/engine/src/ai/live-evaluation/cli.ts`, `packages/db/src/connection.ts` only if a missing exported type/lifecycle hook is proven, `packages/engine/src/ai/catalog-embedding.ts`, `packages/engine/src/ai/pgvector-index.ts` only for narrowly required seams.
- **Existing symbols:** `runLiveEvaluationCli`, `validateEvalDatabaseUrl`, `openDatabase`, `createAiPorts`, `buildCatalogEmbeddingRows`, `PgvectorCatalogIndex.activate`, `activeIndex`, `pin`, `assertCurrent`, `PgvectorToolRetriever`.
- [inferred] Compose provider ports from the selected profile, durable ledger, exact call context, credentials, and existing transports only after authorization/freeze gates pass.
- [inferred] Validate database isolation for `freeze`, `index`, and `run`; open `AI_EVAL_DATABASE_URL`, own its lifecycle, and close it on all paths.
- [inferred] `probe --execute` performs one minimal journaled request per distinct configured role/provider/model capability, validates the parsed provider-native result, records returned model/usage, and halts on any unauthorized/unpriced/ambiguous call.
- [inferred] `index --execute` builds catalog rows through `buildCatalogEmbeddingRows`, activates through `PgvectorCatalogIndex`, reads the active index back, pins/asserts currentness, records exact fingerprints, and fails if any row/provenance/hash differs.
- [inferred] `run --execute` creates a session per trial context, pins the active index once for the run, and asserts currentness before each semantic/QE trial. The `all_tools` path cannot silently substitute for a missing semantic index.

### 6.6 Runner recovery and report reconstruction

- **Files:** `packages/engine/src/ai/live-evaluation/runner.ts`, `packages/engine/src/ai/live-evaluation/report.ts`, `packages/engine/src/ai/live-evaluation/cli.ts`.
- **Existing symbols:** `runLiveEvaluation`, `buildLiveEvaluationReport`, `renderLiveEvaluationMarkdown`, `runLiveEvaluationCli`.
- [inferred] Journal the deterministic schedule/freeze before the first trial, then transition each trial through scheduled → started → terminal exactly once.
- [inferred] Build outcomes and reports from replayed canonical state, not from an independent in-memory list. The live runner may return the replay result after closing/syncing the journal.
- [inferred] Write summaries via exclusive temp-plus-atomic-rename semantics after replay validation. On crash, `report --run` regenerates summaries from the journal and marks formal gate status blocked/partial as appropriate.
- [inferred] Do not resume or reissue a reserved/ambiguous provider call automatically. A new campaign/run id and new human authorization are required for a retry campaign.

### 6.7 Graph-correct scoring and duplicate-free scheduling

- **Files:** `packages/engine/src/ai/live-evaluation/scorer.ts`, `packages/engine/src/ai/live-evaluation/schedule.ts`.
- **Existing symbols:** `scoreLiveCandidate`, `scheduleLiveTrials`, `assertSequentialProfileIsolation`.
- [inferred] Evaluate causal rubric pairs against transitive dependency reachability in the validated plan graph. Every successor invocation must have at least one matching predecessor on an ancestor path; same-layer/list order never satisfies causality.
- [inferred] Reject duplicate profile ids, case ids, repeated cells, and duplicate derived trial ids before schedule persistence or session creation.
- [inferred] Preserve deterministic seed/order and sequential profile isolation after validation.

### 6.8 Production boundary and documentation

- **Files:** `apps/api/src/ai-runtime.ts`, `apps/api/tests/ai-runtime.test.ts`, original T6 plan/doc only after implementation evidence exists.
- **Existing symbols:** `createAiRuntimePorts`, `createAiRuntime`, `denyAiLiveCalls`.
- [inferred] Keep API defaults unchanged and add regression coverage proving evaluator modules are not required to construct the API runtime and that missing explicit authorization still denies live provider use.
- [inferred] Update T6 checklist/status only after all tests and an independent review pass; do not check off live execution or formal rubric approval without real external evidence.

## 7. Implementation Sequence

### Task 1 — Lock contracts and authorization before downstream work

- [ ] Add failing tests in `packages/engine/tests/ai-provider-approval.test.ts` and `packages/engine/tests/ai-live-cli.test.ts` for wrong raw-config hash, missing/extra model roles, mixed-provider profiles, expired/future approvals, and proof that credentials/database/fetch are untouched.
- [ ] Run the targeted tests and confirm they fail for the intended reason.
- [ ] Implement exact model-key comparison and evaluator scope derivation; keep config hashing over raw bytes.
- [ ] Re-run targeted tests; refactor only after green.
- [ ] Suggested commit: `fix(ai-live): bind approval to exact execution scope`.

### Task 2 — Introduce strict durable journal/replay

- [ ] Add `packages/engine/tests/ai-live-journal.test.ts` with exclusive-run, monotonic sequence, schema, fsync-spy, truncated-final-line, gap/duplicate/conflict, and replay scenarios.
- [ ] Confirm tests fail because the durable journal module does not exist.
- [ ] Implement the versioned event schema, exclusive run store, synced appends, strict replay, and read-only recovery state.
- [ ] Replace `createFileJournalWriter` usage without yet changing provider accounting semantics.
- [ ] Suggested commit: `feat(ai-live): add durable journal and replay state`.

### Task 3 — Connect provider calls to the journal-backed ledger

- [ ] Add `packages/engine/tests/ai-live-ledger.test.ts`; extend `ai-provider-clients.test.ts` and `ai-live-runner.test.ts` for full call context, reserve-before-fetch, settlement, held-budget exhaustion, unknown cost, idempotent replay, conflicting settlement, and failure evidence retention.
- [ ] Confirm the real provider-client path reaches the failing assertions; do not simulate budget failure by manually throwing from the test planner.
- [ ] Extend shared context/reservation compatibly and implement the evaluator ledger on the journal.
- [ ] Change the runner session factory to full per-trial context and reconstruct outcomes from replay.
- [ ] Suggested commit: `feat(ai-live): persist and reconcile every provider call`.

### Task 4 — Make freeze and report gates truthful

- [ ] Extend `ai-live-freeze.test.ts`, `ai-live-report.test.ts`, and `ai-live-cli.test.ts` with one mutation test per frozen input and explicit fake/proposed-rubric blocked-verdict cases.
- [ ] Confirm the current fake transport can produce PASS and the current freeze misses at least one mutation.
- [ ] Implement rubric cross-field invariants, evidence kind, blocked verdict/reasons, complete manifest/index/budget/pricing/runtime/git fingerprints, and exact comparison.
- [ ] Leave `testdata/ai-live-rubric.json` proposed unless a human provides approval metadata outside this implementation task.
- [ ] Suggested commit: `fix(ai-live): gate verdicts on frozen live evidence`.

### Task 5 — Compose real runtime and replace probe/index no-ops

- [ ] Add `packages/engine/tests/ai-live-runtime.test.ts`; update CLI tests so probe must touch the injected transport and index must execute build/activate/read-back against an injected database boundary.
- [ ] Extend `packages/engine/tests/ai-live-index.integration.test.ts` for a dedicated eval database, real activation/read-back, provenance mismatch, currentness drift, and guaranteed close.
- [ ] Confirm old no-op implementations fail the new assertions.
- [ ] Implement evaluator runtime composition using `openDatabase`, `createAiPorts`, `buildCatalogEmbeddingRows`, `PgvectorCatalogIndex`, and `PgvectorToolRetriever`; validate DB isolation for freeze/index/run.
- [ ] Wire the package CLI's default environment to this composition only after safety gates; no credential access during preflight/freeze/report.
- [ ] Suggested commit: `feat(ai-live): execute real probe index and runtime paths`.

### Task 6 — Add crash recovery and canonical report reconstruction

- [ ] Add crash-injection tests at: after reserve; after response before settle; after trial terminal before summary; and during final journal line.
- [ ] Assert `report --run` performs zero fetches, marks ambiguous calls conservatively, regenerates summaries, and never resumes a provider request.
- [ ] Implement canonical replay-to-outcome/report transformation and atomic summary publication.
- [ ] Ensure CLI exit is success only for a true formal pass; blocked/fail/partial remain non-zero with machine-readable reasons.
- [ ] Suggested commit: `feat(ai-live): recover reports without replaying paid calls`.

### Task 7 — Correct graph causality and reject duplicate schedules

- [ ] Add scorer tests where a same-layer successor appears after the predecessor but lacks a dependency (fail), a transitive dependency exists (pass), and duplicate tool identities include one unguarded successor (fail).
- [ ] Add schedule tests for duplicate profile ids, case ids, cells, and derived trial ids; assert rejection occurs before session/fetch.
- [ ] Implement reachability-based causal scoring and duplicate validation while preserving deterministic ordering.
- [ ] Suggested commit: `fix(ai-live): enforce graph causality and unique trials`.

### Task 8 — Regression, artifacts, and independent review

- [ ] Run formatter only on touched paths; inspect `git diff --check` and remove the known extra EOF blank line in `contracts.ts` if still present.
- [ ] Run targeted unit/integration suites, then `npm run check`, then `npm run check:backend` serially with the test database available.
- [ ] Run a zero-paid-call CLI matrix with fake transports to prove authorization/freeze/journal/report behavior; do not run a live campaign.
- [ ] Refresh generated freeze/report fixtures once, at the tip, only when their source inputs and assertions are final.
- [ ] Request independent code review focused on the eight blockers and two high-risk correctness defects; resolve findings before updating the original T6 checklist.
- [ ] Suggested commit: `test(ai-live): close T6 hardening regressions`.

## 8. Test Strategy

### Authorization and negative capability tests

- `packages/engine/tests/ai-provider-approval.test.ts`: exact provider set; exact role-key/value set; raw config hash mismatch; time bounds; no secrets in approval.
- `packages/engine/tests/ai-live-cli.test.ts`: rejected approval/config/freeze/database state → credentials, DB opener, session factory, ledger reserve, and fetch all remain untouched.
- `apps/api/tests/ai-runtime.test.ts`: default API runtime authorization continues to deny provider calls.

### Journal, accounting, and crash tests

- New `packages/engine/tests/ai-live-journal.test.ts`: schema/version, sequence, exclusive run id, synced event classes, replay, final truncation, corruption rejection.
- New `packages/engine/tests/ai-live-ledger.test.ts`: reserve/settle lifecycle, exact context, budget with held estimates, unknown-cost policy, idempotency/conflict, replay equality.
- `packages/engine/tests/ai-live-runner.test.ts`: 429/timeout/cancel/parser failure evidence retained; abort halts new starts; no duplicate terminal event; canonical replay result.
- `packages/engine/tests/ai-live-report.test.ts`: ambiguous reservation blocks pass and is counted conservatively.

### Runtime, database, and index tests

- New `packages/engine/tests/ai-live-runtime.test.ts`: lifecycle ownership, per-trial context, live/fake evidence labels, pin/currentness, close on every error.
- `packages/engine/tests/ai-live-index.integration.test.ts`: real test PostgreSQL/pgvector activation, active read-back, vector/policy/catalog provenance, currentness drift, eval/prod URL rejection.
- `packages/engine/tests/ai-provider-clients.test.ts`: authorize → reserve → fetch → settle ordering for OpenAI and Google, including thrown fetch and abort.

### Freeze/report/scorer/schedule tests

- `packages/engine/tests/ai-live-freeze.test.ts`: mutate every role config, price card, budget, approval scope, capability, source file, git-state digest, runtime version, and active index field independently → mismatch.
- `packages/engine/tests/ai-live-report.test.ts`: fake transport, proposed rubric, partial/ambiguous calls, stale index, freeze drift, unknown cost, and `needs_review` all prohibit PASS.
- `packages/engine/tests/ai-live-scorer.test.ts`: direct/transitive causality, same-layer false positive, duplicates, cycles/invalid graph.
- `packages/engine/tests/ai-live-schedule.test.ts`: duplicate input rejection and stable unique order.

### Verification commands

Run serially from the repository root:

```powershell
npm run test:unit -w @wap/engine -- ai-provider-approval.test.ts ai-provider-clients.test.ts ai-live-cli.test.ts ai-live-journal.test.ts ai-live-ledger.test.ts ai-live-runner.test.ts ai-live-freeze.test.ts ai-live-report.test.ts ai-live-scorer.test.ts ai-live-schedule.test.ts ai-live-runtime.test.ts
npm run test:unit -w @wap/api -- ai-runtime.test.ts
npm run build -w @wap/dsl
npm run build -w @wap/db
npm run build -w @wap/engine
npm run test:integration -w @wap/engine -- ai-live-index.integration.test.ts
npm run check
npm run check:backend
git diff --check
```

[verified] These script entry points exist in the root, engine, and API `package.json` files. [inferred] Integration commands require the repository's test database prerequisites and must not point at production. No command above should require paid provider credentials; all provider behavior is injected/faked.

## 9. Risk and Impact Analysis

| Risk | Evidence / impact | Mitigation |
| --- | --- | --- |
| Shared provider context regression | [graph] `createAiPorts` directly affects provider tests and API runtime; API main/tests are downstream. | Keep `trialId` optional in shared types, required only by evaluator ledger; run provider and API regressions. |
| Authorization checked too late | [verified] CLI callbacks hide transport ordering from cross-function PDG. | Negative capability spies; gate before credentials/DB/session; retain provider-level authorization immediately before reservation/fetch. |
| Crash between request and settlement | [verified] current in-memory ledger loses state. | Sync reserve before fetch; ambiguous/unknown consumes held budget and blocks pass; recovery never retries. |
| Windows durability semantics | [inferred] `FileHandle.sync()` is available, while directory fsync behavior varies. | Add a startup durability self-check and process-crash integration tests; block live execution if required file sync/exclusive-create primitives fail. Record durability mode in freeze/report. |
| Duplicate spend | [verified] duplicate schedule entries are not rejected. | Validate uniqueness before journal/sessions; exclusive run id; deterministic call ids and idempotent settlement. |
| Misleading successful verdict | [verified] fake transport + proposed rubric can reach PASS. | Evidence kind and blocked verdict are explicit report predicates; CLI non-zero for blocked/partial/fail. |
| Index drift during run | [verified] pgvector exposes pin/currentness seams but runner does not enforce them. | Pin exact index before schedule; assert currentness before semantic/QE trials; include all hashes in freeze/journal/report. |
| Freeze churn/non-determinism | [verified] current freeze is partial. | Normalize/sort paths; hash raw bytes; exclude only named generated roots; exclude timestamps from semantic comparison. |
| Report compatibility | [graph] `buildLiveEvaluationReport` has direct test and CLI consumers. | Version report schema; update parser/markdown/CLI atomically; recovery rejects unsupported versions. |
| Performance/cost | [inferred] sync per critical event adds I/O latency; probes/index can spend money. | Keep trial concurrency at the established sequential boundary; batch no paid calls; use minimal probes and approved budget; measure journal sync latency in report. |
| Untracked workspace instruction file | [verified] provenance records `AGENTS.md` as untracked. | Preserve it; do not stage/commit it as part of this fix; executor re-anchors provenance before edits. |

Direct-dependency accounting: [graph] `runLiveEvaluationCli`'s 21 direct dependencies are kept behind its orchestration contract; `runLiveEvaluation` direct consumers (`ai-live-runner.test.ts`, CLI) are updated together; `createAiPorts` direct consumers (provider tests and API runtime) receive regression coverage; `buildLiveEvaluationReport` direct consumers (report tests and CLI) migrate with the versioned report contract.

## 10. Files Expected to Change

| File | Existing symbols / module | Reason |
| --- | --- | --- |
| `packages/engine/src/ai/providers/approval.ts` | `parseAiLiveApprovalRecord`, `assertAiLiveApproval` | Exact role/provider/config scope comparison. |
| `packages/engine/src/ai/providers/accounting.ts` | `ProviderCallReservation`, `ProviderCallRecord` | Carry optional trial correlation without breaking API consumers. |
| `packages/engine/src/ai/providers/registry.ts` | `AiProviderCallContext`, `createAiPorts`, provider invoke path | Propagate exact profile/trial context and preserve ordering. |
| `packages/engine/src/ai/live-evaluation/authorization.ts` | New module, no existing symbol | Derive raw-config hash and phase-specific execution scope. |
| `packages/engine/src/ai/live-evaluation/journal.ts` | New module, no existing symbol | Versioned durable writer, exclusive run store, strict replay. |
| `packages/engine/src/ai/live-evaluation/ledger.ts` | New module, no existing symbol | Journal-backed ledger and pessimistic budget reconciliation. |
| `packages/engine/src/ai/live-evaluation/runtime.ts` | New module, no existing symbol | Dedicated DB/provider/index/session composition. |
| `packages/engine/src/ai/live-evaluation/contracts.ts` | rubric/freeze/outcome/journal/report schemas | Cross-field invariants, evidence kind, blocked verdict, replay contracts. |
| `packages/engine/src/ai/live-evaluation/freeze.ts` | `createLiveFreeze`, `assertLiveFreezeMatches` | Complete deterministic freeze and semantic comparison. |
| `packages/engine/src/ai/live-evaluation/runner.ts` | `createFileJournalWriter`, `runLiveEvaluation` | Full trial context, durable transitions, failure evidence, replay result. |
| `packages/engine/src/ai/live-evaluation/report.ts` | `buildLiveEvaluationReport`, `renderLiveEvaluationMarkdown` | Truthful gate predicates and recovery output. |
| `packages/engine/src/ai/live-evaluation/scorer.ts` | `scoreLiveCandidate` | Dependency-reachability causal scoring. |
| `packages/engine/src/ai/live-evaluation/schedule.ts` | `scheduleLiveTrials`, `assertSequentialProfileIsolation` | Reject duplicate inputs/trials before spend. |
| `packages/engine/src/ai/live-evaluation/cli.ts` | `validateEvalDatabaseUrl`, `runLiveEvaluationCli` | Gate ordering, real commands, runtime lifecycle, recovery. |
| `packages/engine/src/ai/catalog-embedding.ts` | `buildCatalogEmbeddingRows` | Expected reuse; change only if a narrow injection seam is proven necessary. |
| `packages/engine/src/ai/pgvector-index.ts` | `PgvectorCatalogIndex`, `PgvectorToolRetriever` | Expected reuse; change only for a proven currentness/lifecycle seam. |
| `packages/db/src/connection.ts` | `openDatabase` | Expected reuse; change only if lifecycle typing cannot be expressed externally. |
| `apps/api/src/ai-runtime.ts` | `createAiRuntimePorts`, `createAiRuntime`, `denyAiLiveCalls` | Preserve boundary; production code change only if shared optional context requires typing. |
| `packages/engine/tests/ai-provider-approval.test.ts` | existing approval suite | Exact authorization cases. |
| `packages/engine/tests/ai-provider-clients.test.ts` | existing provider suite | Enforcement ordering and context propagation. |
| `packages/engine/tests/ai-live-cli.test.ts` | existing CLI suite | Real-effects and fail-before-capability tests. |
| `packages/engine/tests/ai-live-journal.test.ts` | new test module | Durability/replay/corruption. |
| `packages/engine/tests/ai-live-ledger.test.ts` | new test module | Accounting/budget/idempotency. |
| `packages/engine/tests/ai-live-runtime.test.ts` | new test module | Composition/isolation/currentness/lifecycle. |
| `packages/engine/tests/ai-live-runner.test.ts` | existing runner suite | Failure evidence, transitions, abort/recovery. |
| `packages/engine/tests/ai-live-freeze.test.ts` | existing freeze suite | Complete mutation matrix. |
| `packages/engine/tests/ai-live-report.test.ts` | existing report suite | Verdict/evidence/accounting predicates. |
| `packages/engine/tests/ai-live-scorer.test.ts` | existing scorer suite | Graph causality. |
| `packages/engine/tests/ai-live-schedule.test.ts` | existing schedule suite | Duplicate rejection. |
| `packages/engine/tests/ai-live-index.integration.test.ts` | existing pgvector integration suite | Real index lifecycle and isolated DB. |
| `apps/api/tests/ai-runtime.test.ts` | existing API runtime suite | Fail-closed regression. |
| `docs/superpowers/plans/2026-09-18-ai-live-evaluation.md` | T6 checklist | Update only after evidence exists. |
| `testdata/ai-live-rubric.json` | proposed rubric artifact | No automatic change; only human-approved metadata in a separately authorized step. |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: 'Harden T5/T6 live evaluation so exact authorization, durable call accounting, isolated pgvector runtime, crash recovery, and truthful provenance jointly gate formal PASS.'
  acceptance_criteria:
    - 'Approval is bound to raw config bytes, phase, campaign, profile, exact reachable providers, and exact role-to-model keys/values.'
    - 'Every paid call is durably reserved before fetch and terminally settled or conservatively ambiguous after recovery.'
    - 'Fake transport or PROPOSED_EXPLORATORY rubric evidence cannot emit LIVE_EVALUATION_PASS.'
    - 'probe and index perform real injected effects; run has a default evaluator composition and isolated DB validation.'
    - 'report --run reconstructs from the journal and performs zero provider calls.'
    - 'Causal scoring uses dependency reachability; scheduling rejects duplicates before spend.'
    - 'API runtime remains fail-closed and all listed verification commands pass.'

  evidence_provenance: 
    {
      "schema_version": 2,
      "head_commit": "dd340c2779aa0bf5693b96ad966ec884b22f59a7",
      "generated_plan_path": "docs/plans/2026-09-19-gitnexus-plan-live-evaluation-hardening.md",
      "global_dirty_digest": {
        "algorithm": "sha256",
        "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
        "value": "0a9c85780067d9afcd0764f307b60891e3cee927ee11eaeb5ec7826d10fd82cd"
      },
      "cited_path_manifest": [
        {
          "path": "AGENTS.md",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:ca6df4011b2d78f961fb218ef63e0fb1fe92d07f45b5be3150ca77722fc4dfd8"
        },
        {
          "path": "apps/api/src/ai-runtime.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:6d5e59ca1680c455d56a092c4d00f24faa6df757535e7fc13e708fb5b28b5a66",
          "index_digest": "sha256:6d5e59ca1680c455d56a092c4d00f24faa6df757535e7fc13e708fb5b28b5a66",
          "worktree_digest": "sha256:6d5e59ca1680c455d56a092c4d00f24faa6df757535e7fc13e708fb5b28b5a66",
          "untracked_digest": "absent"
        },
        {
          "path": "apps/api/tests/ai-runtime.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:22275f575c9060da50e5e731815694b4e9ad1c3be1cb98c77a41083e8acff61f",
          "index_digest": "sha256:22275f575c9060da50e5e731815694b4e9ad1c3be1cb98c77a41083e8acff61f",
          "worktree_digest": "sha256:22275f575c9060da50e5e731815694b4e9ad1c3be1cb98c77a41083e8acff61f",
          "untracked_digest": "absent"
        },
        {
          "path": "docs/BASELINE.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:0b79c3a2d598e3dea3540fa855a4453421f8973204bfd620675b58c162755c38",
          "index_digest": "sha256:0b79c3a2d598e3dea3540fa855a4453421f8973204bfd620675b58c162755c38",
          "worktree_digest": "sha256:0b79c3a2d598e3dea3540fa855a4453421f8973204bfd620675b58c162755c38",
          "untracked_digest": "absent"
        },
        {
          "path": "docs/superpowers/plans/2026-09-18-ai-live-evaluation.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:1914c52d31f175738f70031dc3535ef5e11fb798f35fad5fc62d54e4b912477c",
          "index_digest": "sha256:1914c52d31f175738f70031dc3535ef5e11fb798f35fad5fc62d54e4b912477c",
          "worktree_digest": "sha256:1914c52d31f175738f70031dc3535ef5e11fb798f35fad5fc62d54e4b912477c",
          "untracked_digest": "absent"
        },
        {
          "path": "package.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:4da1abf4708e5452b65b6de7207a8275496a8ac88107a5dfb91a3c60a2eb01f3",
          "index_digest": "sha256:4da1abf4708e5452b65b6de7207a8275496a8ac88107a5dfb91a3c60a2eb01f3",
          "worktree_digest": "sha256:4da1abf4708e5452b65b6de7207a8275496a8ac88107a5dfb91a3c60a2eb01f3",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/db/src/connection.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:f05fac18153e31d9cd0bc1aa67d68e306de326d7735171dd278107b68fd9112b",
          "index_digest": "sha256:f05fac18153e31d9cd0bc1aa67d68e306de326d7735171dd278107b68fd9112b",
          "worktree_digest": "sha256:f05fac18153e31d9cd0bc1aa67d68e306de326d7735171dd278107b68fd9112b",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/catalog-embedding.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:a7cf7afc0faaeb728a42c15ea6c44e4a85fc2743d166d26796135b1e83a6e8cd",
          "index_digest": "sha256:a7cf7afc0faaeb728a42c15ea6c44e4a85fc2743d166d26796135b1e83a6e8cd",
          "worktree_digest": "sha256:a7cf7afc0faaeb728a42c15ea6c44e4a85fc2743d166d26796135b1e83a6e8cd",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/authorization.ts",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "absent"
          },
          "state": "absent",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/cli.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:2cfa1d0e97cc75b07a54831580043515a2c22ef2a714d9a7760fe0821f2de215",
          "index_digest": "sha256:2cfa1d0e97cc75b07a54831580043515a2c22ef2a714d9a7760fe0821f2de215",
          "worktree_digest": "sha256:2cfa1d0e97cc75b07a54831580043515a2c22ef2a714d9a7760fe0821f2de215",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/contracts.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:8b226ce73b40517dd06808fed71a3be26b4f0a93d15bf27e70a43623970fa722",
          "index_digest": "sha256:8b226ce73b40517dd06808fed71a3be26b4f0a93d15bf27e70a43623970fa722",
          "worktree_digest": "sha256:8b226ce73b40517dd06808fed71a3be26b4f0a93d15bf27e70a43623970fa722",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/freeze.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:12db919111a89ed6117a4dfd68ff2db525498bd1a413ef93c7199b3d922ade36",
          "index_digest": "sha256:12db919111a89ed6117a4dfd68ff2db525498bd1a413ef93c7199b3d922ade36",
          "worktree_digest": "sha256:12db919111a89ed6117a4dfd68ff2db525498bd1a413ef93c7199b3d922ade36",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/journal.ts",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "absent"
          },
          "state": "absent",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/ledger.ts",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "absent"
          },
          "state": "absent",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/report.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3649c6957e734bac43da799ed8a7ebbf04094d7ad52dc27df3ba939667972d9e",
          "index_digest": "sha256:3649c6957e734bac43da799ed8a7ebbf04094d7ad52dc27df3ba939667972d9e",
          "worktree_digest": "sha256:3649c6957e734bac43da799ed8a7ebbf04094d7ad52dc27df3ba939667972d9e",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/runner.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:08a2e27f3e096f7391fa0020332da7f1f76b5f021c9a55eb77032cf5c7782a8a",
          "index_digest": "sha256:08a2e27f3e096f7391fa0020332da7f1f76b5f021c9a55eb77032cf5c7782a8a",
          "worktree_digest": "sha256:08a2e27f3e096f7391fa0020332da7f1f76b5f021c9a55eb77032cf5c7782a8a",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/runtime.ts",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "absent"
          },
          "state": "absent",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/schedule.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:13c9e947ea7d90456540720b5e07bfdf7814e3e1c52ecf49460310bde5fbc904",
          "index_digest": "sha256:13c9e947ea7d90456540720b5e07bfdf7814e3e1c52ecf49460310bde5fbc904",
          "worktree_digest": "sha256:13c9e947ea7d90456540720b5e07bfdf7814e3e1c52ecf49460310bde5fbc904",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/live-evaluation/scorer.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:27737443f50999e13a80a258aa2a2190cd019256292d8efffde14ea6eb837f0e",
          "index_digest": "sha256:27737443f50999e13a80a258aa2a2190cd019256292d8efffde14ea6eb837f0e",
          "worktree_digest": "sha256:27737443f50999e13a80a258aa2a2190cd019256292d8efffde14ea6eb837f0e",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/pgvector-index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:e230df96ae125d9b26d9ecd641f9561fbe405651734cb973c282ac71b76d51b6",
          "index_digest": "sha256:e230df96ae125d9b26d9ecd641f9561fbe405651734cb973c282ac71b76d51b6",
          "worktree_digest": "sha256:e230df96ae125d9b26d9ecd641f9561fbe405651734cb973c282ac71b76d51b6",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/providers/accounting.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:869d4b81588abe5d04fa27cccdac8a8526124d8aa3cfb2aa85afda93ac24bb9b",
          "index_digest": "sha256:869d4b81588abe5d04fa27cccdac8a8526124d8aa3cfb2aa85afda93ac24bb9b",
          "worktree_digest": "sha256:869d4b81588abe5d04fa27cccdac8a8526124d8aa3cfb2aa85afda93ac24bb9b",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/providers/approval.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:15c0fbe3d3a856bc308a813504d4120f8c04a2e529e0e34a9ee38cd04cfc2cef",
          "index_digest": "sha256:15c0fbe3d3a856bc308a813504d4120f8c04a2e529e0e34a9ee38cd04cfc2cef",
          "worktree_digest": "sha256:15c0fbe3d3a856bc308a813504d4120f8c04a2e529e0e34a9ee38cd04cfc2cef",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/src/ai/providers/registry.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3b4cfc78f73c100268d83c6bcba7955e92bcfabda1299c901d9bab7b4d6cb4ae",
          "index_digest": "sha256:3b4cfc78f73c100268d83c6bcba7955e92bcfabda1299c901d9bab7b4d6cb4ae",
          "worktree_digest": "sha256:3b4cfc78f73c100268d83c6bcba7955e92bcfabda1299c901d9bab7b4d6cb4ae",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/tests/ai-live-cli.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:09fd80bdabd7717aa02a8c4ea501f05e3d562d7494c59dcc4504b71013373754",
          "index_digest": "sha256:09fd80bdabd7717aa02a8c4ea501f05e3d562d7494c59dcc4504b71013373754",
          "worktree_digest": "sha256:09fd80bdabd7717aa02a8c4ea501f05e3d562d7494c59dcc4504b71013373754",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/tests/ai-live-freeze.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b860ae329db33c78fceb28548fcc9ba41796fe11daa64797d8b7a6bd9c6886ba",
          "index_digest": "sha256:b860ae329db33c78fceb28548fcc9ba41796fe11daa64797d8b7a6bd9c6886ba",
          "worktree_digest": "sha256:b860ae329db33c78fceb28548fcc9ba41796fe11daa64797d8b7a6bd9c6886ba",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/tests/ai-live-index.integration.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:76e73c7eb3e774d4656dbb70aa45f4a4f2b146514b73ac646769e70bc8fbd08c",
          "index_digest": "sha256:76e73c7eb3e774d4656dbb70aa45f4a4f2b146514b73ac646769e70bc8fbd08c",
          "worktree_digest": "sha256:76e73c7eb3e774d4656dbb70aa45f4a4f2b146514b73ac646769e70bc8fbd08c",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/tests/ai-live-report.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:9abe6c41a8c11854534d8265618dcdaff421b3f202809fab852d7bdba82d13b5",
          "index_digest": "sha256:9abe6c41a8c11854534d8265618dcdaff421b3f202809fab852d7bdba82d13b5",
          "worktree_digest": "sha256:9abe6c41a8c11854534d8265618dcdaff421b3f202809fab852d7bdba82d13b5",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/tests/ai-live-runner.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:8e36fdf5a14731ffd74eedaf103dfe5ce66e665ca334debf0b5b96f81f094ed2",
          "index_digest": "sha256:8e36fdf5a14731ffd74eedaf103dfe5ce66e665ca334debf0b5b96f81f094ed2",
          "worktree_digest": "sha256:8e36fdf5a14731ffd74eedaf103dfe5ce66e665ca334debf0b5b96f81f094ed2",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/tests/ai-live-schedule.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:fe3f03cb5d61b70ef1117e503f020836d5823f0c6dd6928819f59a77b6a4f680",
          "index_digest": "sha256:fe3f03cb5d61b70ef1117e503f020836d5823f0c6dd6928819f59a77b6a4f680",
          "worktree_digest": "sha256:fe3f03cb5d61b70ef1117e503f020836d5823f0c6dd6928819f59a77b6a4f680",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/tests/ai-live-scorer.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b0d3cf205de67d7af023c511399751da8963a550d8c1e12f89ebc0031ea6c766",
          "index_digest": "sha256:b0d3cf205de67d7af023c511399751da8963a550d8c1e12f89ebc0031ea6c766",
          "worktree_digest": "sha256:b0d3cf205de67d7af023c511399751da8963a550d8c1e12f89ebc0031ea6c766",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/tests/ai-provider-approval.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:46bde2f2514af50c86c20c897afc26d15bb0359fe64338ec3101154418b35379",
          "index_digest": "sha256:46bde2f2514af50c86c20c897afc26d15bb0359fe64338ec3101154418b35379",
          "worktree_digest": "sha256:46bde2f2514af50c86c20c897afc26d15bb0359fe64338ec3101154418b35379",
          "untracked_digest": "absent"
        },
        {
          "path": "packages/engine/tests/ai-provider-clients.test.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:9317e4a9261c2122e29b9e17697de338a1150cea6c8092ac1c0b4ce6587dca33",
          "index_digest": "sha256:9317e4a9261c2122e29b9e17697de338a1150cea6c8092ac1c0b4ce6587dca33",
          "worktree_digest": "sha256:9317e4a9261c2122e29b9e17697de338a1150cea6c8092ac1c0b4ce6587dca33",
          "untracked_digest": "absent"
        },
        {
          "path": "testdata/ai-live-eval-config.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3bbfdd8f84bcbce4083ececb0e57334324814638d1efe429c4be843131d0472c",
          "index_digest": "sha256:3bbfdd8f84bcbce4083ececb0e57334324814638d1efe429c4be843131d0472c",
          "worktree_digest": "sha256:3bbfdd8f84bcbce4083ececb0e57334324814638d1efe429c4be843131d0472c",
          "untracked_digest": "absent"
        },
        {
          "path": "testdata/ai-live-rubric.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:4fb02ac30a0d5f0ae39fa81ca39213a5e88b50319b928de6d6b3d5b8415a4e33",
          "index_digest": "sha256:4fb02ac30a0d5f0ae39fa81ca39213a5e88b50319b928de6d6b3d5b8415a4e33",
          "worktree_digest": "sha256:4fb02ac30a0d5f0ae39fa81ca39213a5e88b50319b928de6d6b3d5b8415a4e33",
          "untracked_digest": "absent"
        }
      ]
    }

  primary_symbols:
    - symbol: 'runLiveEvaluationCli'
      file: 'packages/engine/src/ai/live-evaluation/cli.ts'
      lines: '152-656'
      role: 'CLI orchestration and safety gate entry point'
    - symbol: 'runLiveEvaluation'
      file: 'packages/engine/src/ai/live-evaluation/runner.ts'
      lines: '72-317'
      role: 'Trial lifecycle, session creation, evidence capture, and halt behavior'
    - symbol: 'assertAiLiveApproval'
      file: 'packages/engine/src/ai/providers/approval.ts'
      lines: '149-187'
      role: 'Existing exact-scope enforcement seam requiring stricter key-set comparison'
    - symbol: 'createAiPorts'
      file: 'packages/engine/src/ai/providers/registry.ts'
      lines: '808-817'
      role: 'Shared OpenAI/Google planning, query-expansion, and embedding composition'
    - symbol: 'buildLiveEvaluationReport'
      file: 'packages/engine/src/ai/live-evaluation/report.ts'
      lines: '71-459'
      role: 'Quality/accounting aggregation and formal verdict'
    - symbol: 'scoreLiveCandidate'
      file: 'packages/engine/src/ai/live-evaluation/scorer.ts'
      lines: '365-689'
      role: 'Plan validation, graph execution, rubric scoring, and causal check'
    - symbol: 'createLiveFreeze'
      file: 'packages/engine/src/ai/live-evaluation/freeze.ts'
      lines: '114-181'
      role: 'Current partial execution fingerprint'
    - symbol: 'PgvectorCatalogIndex'
      file: 'packages/engine/src/ai/pgvector-index.ts'
      lines: '311-543'
      role: 'Activation, active read-back, pin, and currentness enforcement'

  related_symbols:
    - symbol: 'ProviderCallReservation'
      relationship: 'consumed by ProviderCallLedger.reserve'
      relevance: 'Needs optional trial correlation; evaluator ledger requires it.'
    - symbol: 'AiProviderCallContext'
      relationship: 'input to createAiPorts/provider invoke path'
      relevance: 'Carries campaign/run and must propagate profile/trial.'
    - symbol: 'buildCatalogEmbeddingRows'
      relationship: 'calls EmbeddingPort.embed; precedes PgvectorCatalogIndex.activate'
      relevance: 'Existing validated index-build path.'
    - symbol: 'openDatabase'
      relationship: 'runtime composition dependency'
      relevance: 'Owns dedicated eval database clients and close lifecycle.'
    - symbol: 'createAiRuntimePorts'
      relationship: 'shared createAiPorts consumer'
      relevance: 'Production fail-closed regression boundary.'

  execution_path:
    - 'CLI reads raw config/approval/rubric/freeze inputs and derives exact command/profile execution scope.'
    - 'Approval, database-isolation, freeze/currentness, durable-store, and budget gates complete before credentials or network.'
    - 'Exclusive run store persists schedule/freeze; journal-backed ledger reserves each provider call before fetch.'
    - 'Per-trial runtime binds campaign/run/profile/trial context and a pinned current pgvector index.'
    - 'Provider path authorizes, resolves credential, reserves, fetches, parses, and settles success/failure.'
    - 'Runner persists trial terminal evidence; replay reconstructs outcomes and reconciles ledger records.'
    - 'Report applies evidence/rubric/freeze/index/completeness/accounting gates before semantic PASS.'
    - 'Recovery replays journal and writes summaries without creating provider or database capabilities.'

  pdg_constraints:
    - description: 'CLI approval inputs control the gate, but callback/network flow is not statement-visible across functions.'
      affected_statements:
        - 'packages/engine/src/ai/live-evaluation/cli.ts:489'
        - 'packages/engine/src/ai/providers/registry.ts:341'
      implementation_consequence: 'Use negative capability tests and preserve authorize-before-credential/reserve/fetch source ordering.'
    - description: 'Causal verdict currently data-depends on executedTools indices rather than graph ancestry.'
      affected_statements:
        - 'packages/engine/src/ai/live-evaluation/scorer.ts:592'
        - 'packages/engine/src/ai/live-evaluation/scorer.ts:607'
      implementation_consequence: 'Replace index comparison with transitive dependency reachability for every successor invocation.'
    - description: 'Formal report verdict depends on allPassed/accounting but omits evidence-kind and approval/currentness blockers.'
      affected_statements:
        - 'packages/engine/src/ai/live-evaluation/report.ts:229'
        - 'packages/engine/src/ai/live-evaluation/report.ts:236'
      implementation_consequence: 'Add explicit blocking predicates that dominate the PASS branch and CLI success exit.'

  architectural_patterns:
    - pattern: 'Fail-closed authorization callback at the shared provider boundary'
      example_location: 'packages/engine/src/ai/providers/registry.ts:317'
      usage_guidance: 'Supply exact evaluator scope/context; do not fork transports.'
    - pattern: 'Owned database lifecycle'
      example_location: 'packages/db/src/connection.ts:6 openDatabase'
      usage_guidance: 'Open only AI_EVAL_DATABASE_URL after validation and always call close.'
    - pattern: 'Validated catalog embedding before activation'
      example_location: 'packages/engine/src/ai/catalog-embedding.ts:62 buildCatalogEmbeddingRows'
      usage_guidance: 'Reuse for index command; do not bypass provenance/vector validation.'
    - pattern: 'Pin and assert index currentness'
      example_location: 'packages/engine/src/ai/pgvector-index.ts:510'
      usage_guidance: 'Persist pinned fingerprints and assert before semantic/QE trials.'

  files_to_modify:
    - file: 'packages/engine/src/ai/providers/approval.ts'
      symbols: ['parseAiLiveApprovalRecord', 'assertAiLiveApproval']
      intended_change: 'Exact role/provider/config-scope enforcement.'
    - file: 'packages/engine/src/ai/providers/accounting.ts'
      symbols: ['ProviderCallReservation', 'ProviderCallRecord']
      intended_change: 'Optional shared trial correlation.'
    - file: 'packages/engine/src/ai/providers/registry.ts'
      symbols: ['AiProviderCallContext', 'createAiPorts']
      intended_change: 'Propagate full evaluator call context without weakening API defaults.'
    - file: 'packages/engine/src/ai/live-evaluation/authorization.ts'
      symbols: []
      intended_change: 'New exact execution-scope derivation module.'
    - file: 'packages/engine/src/ai/live-evaluation/journal.ts'
      symbols: []
      intended_change: 'New durable journal and replay module.'
    - file: 'packages/engine/src/ai/live-evaluation/ledger.ts'
      symbols: []
      intended_change: 'New journal-backed ledger and budget module.'
    - file: 'packages/engine/src/ai/live-evaluation/runtime.ts'
      symbols: []
      intended_change: 'New dedicated DB/provider/index/session composition.'
    - file: 'packages/engine/src/ai/live-evaluation/contracts.ts'
      symbols: ['LiveRubricSchema', 'LiveEvaluationFingerprintsSchema', 'LiveJournalEvent', 'LiveEvaluationReport']
      intended_change: 'Strict rubric, evidence, journal, freeze, and report schemas.'
    - file: 'packages/engine/src/ai/live-evaluation/freeze.ts'
      symbols: ['createLiveFreeze', 'assertLiveFreezeMatches']
      intended_change: 'Complete deterministic freeze.'
    - file: 'packages/engine/src/ai/live-evaluation/runner.ts'
      symbols: ['createFileJournalWriter', 'runLiveEvaluation']
      intended_change: 'Durable transitions, full session context, failure evidence, replay result.'
    - file: 'packages/engine/src/ai/live-evaluation/report.ts'
      symbols: ['buildLiveEvaluationReport', 'renderLiveEvaluationMarkdown']
      intended_change: 'Truthful formal gate and recovery output.'
    - file: 'packages/engine/src/ai/live-evaluation/scorer.ts'
      symbols: ['scoreLiveCandidate']
      intended_change: 'Dependency-reachability causal validation.'
    - file: 'packages/engine/src/ai/live-evaluation/schedule.ts'
      symbols: ['scheduleLiveTrials', 'assertSequentialProfileIsolation']
      intended_change: 'Pre-spend uniqueness validation.'
    - file: 'packages/engine/src/ai/live-evaluation/cli.ts'
      symbols: ['validateEvalDatabaseUrl', 'runLiveEvaluationCli']
      intended_change: 'Safety gate order, real commands, runtime lifecycle, replay report.'

  tests:
    - file: 'packages/engine/tests/ai-provider-approval.test.ts'
      scenarios: ['wrong raw hash -> reject', 'missing/extra role -> reject', 'exact mixed-provider scope -> accept']
    - file: 'packages/engine/tests/ai-provider-clients.test.ts'
      scenarios: ['reject before credential/fetch', 'reserve before fetch', 'failure/abort -> terminal settlement']
    - file: 'packages/engine/tests/ai-live-cli.test.ts'
      scenarios: ['probe calls transport', 'index calls activation/read-back', 'run validates eval DB', 'fake/proposed evidence -> blocked']
    - file: 'packages/engine/tests/ai-live-journal.test.ts'
      scenarios: ['exclusive create', 'synced sequence', 'strict replay', 'final truncation', 'corruption rejection']
    - file: 'packages/engine/tests/ai-live-ledger.test.ts'
      scenarios: ['held budget', 'unknown cost', 'idempotent same settlement', 'conflicting settlement', 'replay equality']
    - file: 'packages/engine/tests/ai-live-runtime.test.ts'
      scenarios: ['dedicated DB lifecycle', 'full trial context', 'pin/currentness', 'close on error']
    - file: 'packages/engine/tests/ai-live-runner.test.ts'
      scenarios: ['429/timeout/cancel evidence retained', 'abort stops starts', 'one terminal event', 'canonical replay result']
    - file: 'packages/engine/tests/ai-live-freeze.test.ts'
      scenarios: ['each frozen input mutation -> mismatch', 'timestamp-only change -> semantic match']
    - file: 'packages/engine/tests/ai-live-report.test.ts'
      scenarios: ['fake/proposed/stale/unknown/ambiguous/needs-review -> no PASS', 'all formal gates -> PASS']
    - file: 'packages/engine/tests/ai-live-scorer.test.ts'
      scenarios: ['same-layer order -> fail', 'transitive dependency -> pass', 'one unguarded duplicate successor -> fail']
    - file: 'packages/engine/tests/ai-live-schedule.test.ts'
      scenarios: ['duplicate profile/case/cell/trial -> reject before session']
    - file: 'packages/engine/tests/ai-live-index.integration.test.ts'
      scenarios: ['build/activate/read-back/pin', 'provenance mismatch', 'currentness drift', 'eval/prod URL rejection']
    - file: 'apps/api/tests/ai-runtime.test.ts'
      scenarios: ['default deny remains', 'shared optional context does not enable live calls']

  verification_commands:
    - 'npm run test:unit -w @wap/engine -- ai-provider-approval.test.ts ai-provider-clients.test.ts ai-live-cli.test.ts ai-live-journal.test.ts ai-live-ledger.test.ts ai-live-runner.test.ts ai-live-freeze.test.ts ai-live-report.test.ts ai-live-scorer.test.ts ai-live-schedule.test.ts ai-live-runtime.test.ts'
    - 'npm run test:unit -w @wap/api -- ai-runtime.test.ts'
    - 'npm run build -w @wap/dsl'
    - 'npm run build -w @wap/db'
    - 'npm run build -w @wap/engine'
    - 'npm run test:integration -w @wap/engine -- ai-live-index.integration.test.ts'
    - 'npm run check'
    - 'npm run check:backend'
    - 'git diff --check'

  risks:
    - 'Shared provider context changes affect API runtime and provider tests.'
    - 'A crash after remote acceptance but before settlement is inherently ambiguous and must consume held budget.'
    - 'Windows process-crash durability is testable; power-loss guarantees depend on filesystem semantics and must be recorded honestly.'
    - 'Formal PASS remains unavailable until a human approves/freezes the rubric and supplies complete live price/config evidence.'
    - 'Untracked AGENTS.md is existing workspace state and must remain unmodified/uncommitted by this work.'

  assumptions:
    - 'Re-verify HEAD, GitNexus index commit, and schema-2 provenance before editing; if drifted, re-plan impacted symbols.'
    - 'Confirm Node FileHandle.sync and exclusive-create behavior with journal integration tests on the target Windows filesystem before permitting --execute.'
    - 'Confirm provider response adapters expose model/usage fields required by probe; when unavailable, record explicit unknown and block formal PASS rather than invent values.'
    - 'Confirm AI_EVAL_DATABASE_URL points to the disposable eval database with validateEvalDatabaseUrl before opening it.'

  open_questions:
    - 'Who will approve the final rubric? Resolution: a named human reviewer must provide approvedBy/approvedAt in a separately reviewed artifact change; code must not self-approve.'
    - 'Are complete OpenAI/Google price cards and model-revision evidence available for the chosen profiles? Resolution: preflight validates the configured price-card hash and probe records provider-returned identifiers; missing values produce a blocking reason.'
    - 'What durability claim is acceptable on the target Windows filesystem? Resolution: document measured process-crash guarantees from the new integration suite and record the durability mode in freeze/report; do not claim power-loss durability without evidence.'

  avoid:
    - 'Do not repeat full repository discovery unless provenance or HEAD drifts.'
    - 'Do not replace established provider transports or pgvector activation patterns without evidence.'
    - 'Do not read credentials, open the eval DB, or call fetch before exact approval/freeze gates.'
    - 'Do not use an in-memory ledger for --execute.'
    - 'Do not auto-resume or retry an ambiguous paid call during recovery.'
    - 'Do not report fake, proposed-rubric, stale-index, unknown-cost, or partial evidence as LIVE_EVALUATION_PASS.'
    - 'Do not weaken apps/api fail-closed authorization.'
    - 'Do not modify or stage the existing untracked AGENTS.md.'
```

## 12. Assumptions and Open Questions

### Confirmed constraints

- [verified] The checked-in rubric is exploratory and lacks human approval; therefore the implementation can close the mechanism but cannot legitimately produce a formal PASS from that artifact.
- [verified] The current provider configuration supports OpenAI and Google across planning/query-expansion/embedding roles, and the shared registry already owns both transports.
- [verified] The repository has an existing pgvector integration test and a dedicated database URL guard to extend.

### Assumptions to re-verify at execution start

- [assumed] HEAD and the GitNexus index still equal `dd340c2779aa0bf5693b96ad966ec884b22f59a7`. Re-run `git rev-parse HEAD`, `git status --porcelain=v2 --untracked-files=all`, and `node .gitnexus/run.cjs list`; stop and re-anchor if relevant files drift.
- [assumed] Node's file-handle sync and exclusive-create behavior is reliable for process-crash recovery on the actual Windows workspace filesystem. Prove with the Task 2 integration tests before enabling `--execute`.
- [assumed] Provider response adapters can expose sufficient model/usage metadata for a truthful probe. Inspect the existing parsed response shapes during Task 5; missing data remains explicit unknown and blocks formal PASS.

### Open questions with resolution path

1. **Rubric owner:** A named human must decide and record final rubric approval. Resolution is a separate reviewed artifact change; implementation must leave the current proposed rubric unchanged.
2. **Price/model revision completeness:** Preflight must validate the price-card artifact and probe must record provider-returned model identifiers. If either provider cannot supply an exact revision, freeze the configured alias plus returned identifier/unknown state and block claims that require exact revision evidence.
3. **Durability claim:** Task 2 tests establish process-crash behavior. Power-loss durability is claimed only if the target filesystem/runtime demonstrates it; otherwise freeze/report explicitly say `file-fsync/process-crash` rather than stronger wording.
4. **Adjacent follow-up, deferred:** A paid smoke campaign and rubric adjudication are intentionally excluded. They require fresh approval, credentials, a frozen rubric, a dedicated eval DB, and an explicit user instruction after this hardening is reviewed.

## 13. Definition of Done

- [ ] Exact raw-config hash, phase, campaign, profile, provider set, and complete role/model map are enforced before any credential, DB, session, or fetch access.
- [ ] Shared provider authorization remains immediately before credentials/reserve/fetch, and OpenAI/Google negative-path tests prove the ordering.
- [ ] `--execute` uses an exclusive, synced, versioned journal and a journal-backed ledger; in-memory accounting is impossible on the live path.
- [ ] Every provider call has campaign/run/profile/trial identity and exactly one durable terminal state or a replayed ambiguous state that consumes held budget.
- [ ] 429, timeout, cancellation, parse failure, and crash evidence remains in the report and reconciles with the ledger.
- [ ] `probe` makes the intended minimal injected provider calls; `index` builds/activates/reads back/pins the real eval index; neither can succeed as a no-op.
- [ ] `freeze`, `index`, and `run` validate dedicated DB isolation, close DB resources, and record/assert the exact active index provenance.
- [ ] Freeze comparison covers all role configs, capabilities, price card, budget, approval scope, source/git/runtime state, and index identity; one-field mutation tests fail.
- [ ] Fake transport, proposed rubric, incomplete/ambiguous run, stale index, freeze drift, unknown cost, or `needs_review` can never emit `LIVE_EVALUATION_PASS` or exit successfully as a formal gate.
- [ ] `report --run` reconstructs canonical outcomes/accounting from the journal, emits zero provider calls, and never resumes ambiguous work.
- [ ] Causal scoring uses graph reachability and schedule validation rejects all duplicate work before provider/session creation.
- [ ] API runtime remains fail-closed by default and does not depend on evaluator-specific runtime modules.
- [ ] All targeted tests, engine integration, `npm run check`, `npm run check:backend`, and `git diff --check` pass serially with no paid credentials.
- [ ] An independent review finds no remaining blocker/high issue from the T5/T6 audit, and only then may the original T6 checklist be updated.
