# AI Live T6–T7 Closure Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for direct implementation in the current checkout. Follow the tasks in dependency order, with failing regression tests before behavior changes. Obtain independent code review at the final gate.
>
> **Status:** IMPLEMENTED_PARTIAL — T1–T3 and the core T5–T7 technical gates are implemented; paid provider execution, human rubric approval and independent review remain open.
> **Evidence:** commits `95596f6`, `202738b`, `8f672df`, `4381c86`, `f94aa4e`, `df5230f`; verified 2026-09-20.

**Goal:** Close the remaining integration gaps in T6 and the readiness checks in T7, so the real CLI can safely compose OpenAI/Google adapters, a dedicated pgvector evaluation database, campaign accounting, and recoverable evidence. Earn `READY_FOR_LIVE_PROBE` from tests and review; actual provider compatibility, quality, cost and latency remain `NOT_RUN` until separately authorized T8.

**Architecture:** Keep an engine-owned evaluator composition root. One campaign coordinator owns accounting and writer exclusivity across phases; each invocation owns its run evidence and resources. Reuse native provider clients, reviewed catalog, pgvector and planner/replan boundaries. The production API continues to deny live provider calls by default.

**Tech Stack:** TypeScript, Node.js, Zod, Vitest, PostgreSQL/pgvector, native provider fetch adapters, PowerShell launcher.

**Spec:** `docs/superpowers/plans/2026-09-18-ai-live-evaluation.md`, especially T6–T8; scope authority `docs/BASELINE.md`. This plan follows the implementation at the pinned commit and closes remaining obligations from `docs/plans/2026-09-19-gitnexus-plan-live-evaluation-hardening.md` without repeating completed module work.

## Global constraints

- Implement directly in the current directory/branch, as previously requested; preserve unrelated user changes discovered at execution time.
- No paid call, key lookup, model substitution, rubric approval, frontend work, push or production database reset is authorized by this planning task.
- Preserve B/local: reviewed catalog 8 task_hub + 2 filesystem tools; 1536-dimensional vectors; one active embedding index per user/catalog; sequential execution; at most three planning calls and two local replans.
- `DATABASE_URL` and the effective application/demo database must never become the evaluator's fallback. Own and close only the evaluator's connections.
- Keep native OpenAI and Google planning, QE and embedding paths. A pure Google profile must work without resolving an OpenAI credential, and vice versa.
- Tests use fake provider HTTP and isolated database/no-op tool receivers. No test may become paid because a key happens to exist in the environment.
- Keep the checked-in rubric `PROPOSED_EXPLORATORY`. Formal quality acceptance needs actual human approval; probe readiness does not.
- Existing journal/freeze artifacts are evidence. Version new schemas, read old artifacts conservatively, never silently upgrade them into live or formal evidence.
- At execution, run impact analysis before symbol edits and inspect graph changes before any commit. Commit only intended paths according to the user's Git authorization; no automatic push.

## Review focus

1. A second process or a new run ID must not reset campaign spending or bypass a held reservation — Tasks 1–3.
2. A database URL alias, altered credentials, or omitted application URL must not target the demo database — Tasks 3 and 7.
3. An index can change after retrieval but before planning/repair; currentness must still block provider dispatch — Tasks 3–4 and 7.
4. A crash can leave a billed call without usage, settlement or summary; recovery must preserve uncertainty and never dispatch again — Tasks 1–2 and 6.
5. Passing fake tests and a complete report must not manufacture live provenance, rubric approval or quality acceptance — Tasks 5–8.

## 1. Verified starting point

Source is authoritative; these observations are not inferred from checklist ticks or commit titles.

| Evidence | Current behavior | Consequence |
| --- | --- | --- |
| `packages/engine/src/ai/live-evaluation/cli.ts:618` | Creates the durable trial writer, but constructs `InMemoryProviderCallLedger` at line 620 | Provider accounting is not connected to the durable run evidence |
| `packages/engine/src/ai/live-evaluation/ledger.ts:153` | `JournaledProviderCallLedger` implements reserve/settle/replay primitives and accepts initial records | Reuse it; add campaign ownership, integration and failure handling rather than another ledger implementation |
| `packages/engine/src/ai/live-evaluation/runtime.ts:90` | Wraps injected probe/index/session functions | It is not yet the concrete provider/database composition root |
| `packages/engine/src/ai/live-evaluation/cli.ts:777` | Standalone entry calls CLI without a runtime | The package command does not construct a working live session |
| `packages/engine/src/ai/live-evaluation/runner.ts:225` | Session context carries campaign/run/profile/trial IDs; session exposes model and retriever only | Add ledger identity and pinned-currentness plumbing through the composition boundary |
| `packages/engine/src/ai/live-evaluation/freeze.ts` | `execution` is optional; default behavior fingerprint uses an enumerated file list | Complete schema exists, but default CLI does not populate a complete execution snapshot |
| `packages/engine/src/ai/live-evaluation/cli.ts:585` | Creates freeze without execution context | Completeness cannot be repaired by setting report booleans to true |
| `packages/engine/src/ai/live-evaluation/cli.ts:725` | Recovery defaults evidence to fake/proposed and reads metadata from an optional previous summary | Safe denial exists, but accurate recovery needs authoritative run metadata in the journal |
| `packages/engine/src/ai/providers/registry.ts:483` and other settlement branches | Settlements use `costMicros: null`, including successful usage-bearing responses | Add price-bound accounting; do not convert missing usage to zero |
| `packages/engine/tests/ai-live-index.integration.test.ts` | Uses fake embedding/index boundaries, no database connection | Its seven cases do not establish evaluator composition against PostgreSQL |
| `packages/engine/tests/ai-pgvector.integration.test.ts` | Creates a uniquely named DB, migrates, seeds and tests real pgvector | Reuse this isolation pattern for evaluator tests |
| `apps/api/src/ai-runtime.ts:49` | Default authorization rejects live execution | Keep this regression invariant |

Existing authorization exact-match checks, schema validation, durable journal primitives, duplicate scheduling checks, graph-reachability scoring and conservative verdict gates are retained and tested as dependencies.

### Graph evidence and limits

- GitNexus index was reported at the same commit. `impact runLiveEvaluationCli --direction upstream --depth 3` returned LOW and one direct caller: the standalone code in `cli.ts`. Account for that caller plus injected CLI test consumers; LOW does not establish payment safety.
- `context JournaledProviderCallLedger` found test construction, exports and recovery imports. It explicitly reported a lower bound at the `ProviderCallLedger` interface boundary; the implementer must trace injected consumers too.
- `pdg_query controls runLiveEvaluationCli` returned an empty slice. This is not proof that guards are absent or sufficient. The ordering requirements below are source-derived, not fabricated PDG edges.
- CodeGraph warned of stale line slices for several files. Direct source reads superseded those slices. No analyzer rebuild or index mutation was needed for this plan.
- Publication uses the normal documentation workflow: the GitNexus skill's descriptor-anchored writer does not support this Windows environment. This document does not claim its schema-2 publication receipt.

## 2. Decisions and interfaces

The signatures below are proposed implementation contracts, not claims that these symbols already exist.

### Campaign and run ownership

One campaign coordinator serializes phase invocations across processes. Use an exclusive campaign lock with a random owner token and diagnostic PID/start time. Release only a lock still owned by the process. A crash leaves a lock that requires explicit operator recovery after checking the original process; elapsed time alone never grants ownership.

Each invocation creates an exclusive run directory and one durable journal. Before dispatch, replay all registered earlier runs in that campaign while holding the lock. Register the new run durably before its first reservation. Missing or corrupt registered journals block further spending. A new run ID retains prior costs and held reservations. Namespace call IDs by run, so aggregation cannot collide on `provider-call-1` from different runs.

```ts
// Proposed in live-evaluation/campaign.ts
interface LiveCampaignCoordinator {
  readonly ledger: JournaledProviderCallLedger;
  readonly journal: LiveJournal;
  readonly campaignId: string;
  readonly runId: string;
  close(): Promise<void>;
}
// Existing types are imported from ledger.ts and journal.ts.
// openLiveCampaign takes validated campaign/run identity, artifact root,
// approved campaign/profile/phase limits, and immutable scope/price hashes.
```

Persist a versioned campaign manifest with the aggregate cap and explicit profile/phase sublimits. Extend approval parsing compatibly with a versioned form bound to that manifest hash. Legacy approval records may remain readable, but cannot authorize the new paid composition unless they carry all required scope/budget evidence. Changing the manifest cap requires new approval; restarting or changing phase does not create headroom.

### Resource and authorization order

```text
parse command/config/approval and validate scope
  -> validate requested DB identity and execution inputs
  -> acquire campaign ownership; replay budget; create durable run header
  -> construct evaluator runtime lazily
  -> open isolated DB only when phase needs it; verify DB identity and pin
  -> before each provider request: recheck authorization/currentness/budget
  -> persist reservation and sync -> dispatch -> persist settlement and sync
  -> derive report from evidence -> close runtime/journal -> release own lock
```

Read-only `preflight --offline` and `report` have no provider or DB factory. A complete freeze may read an explicitly isolated DB to capture the active index, but cannot read provider credentials or call a provider. Probe has no index dependency. Index builds a new index and records its result, so it cannot require an already existing index. Run requires the pinned index when semantic variants are scheduled.

### Frozen evidence and truthfulness

Use phase-specific strict snapshot schemas: a preparation snapshot for probe/index and a full execution freeze for run. The full freeze includes role settings, capability identity, price card, campaign budget manifest, exact approval scope, source manifest, runtime/build identity, dataset/rubric/catalog, seed/schedule and read-back index hashes. Hash the whole canonical freeze, not just `fingerprints.dataset`.

Evidence kind is set by the trusted composition factory, never a CLI `--live-evidence` flag or a generated model response. A fake transport always yields fake evidence. Recovery reconstructs the run's recorded evidence; it does not relabel genuine live observations as fake simply because execution was interrupted. Completeness, accounting, currentness and formal acceptance are separate findings.

## 3. Task 1 — Durable campaign coordinator and ledger wiring

**Files:** modify `live-evaluation/{journal,ledger,runner,cli,contracts}.ts`; create `packages/engine/src/ai/live-evaluation/campaign.ts`; update `providers/approval.ts`. Tests: existing `ai-live-{journal,ledger,runner,cli}.test.ts`, `ai-provider-approval.test.ts`; new `ai-live-campaign.test.ts` under `packages/engine/tests/`.

**Consumes:** existing `LiveJournal`, `JournaledProviderCallLedger`, approval parser, `restoreProviderCallRecords`.
**Produces:** campaign coordinator described above; explicit shared ledger supplied to every provider port/session.

- [ ] Add failing tests: two processes acquire the same campaign, only one gets dispatch permission; phase B sees phase A spending; new run with held reservation cannot reset cap; missing registered journal blocks; mismatched campaign/profile/phase manifest is rejected before credentials.
- [ ] Add reserve/settle concurrency and I/O failure cases. Serialize ledger mutations and journal append operations. A write/sync/settle failure poisons that coordinator: subsequent provider attempts fail before fetch. Duplicate settlement is idempotent only for exactly identical content.
- [ ] Implement campaign registration and lock lifecycle; use path-safe opaque IDs and reject traversal. Persist full run metadata/header before scheduled inventory and calls. Namespace call IDs by run and validate campaign/run/trial consistency during replay.
- [ ] Replace CLI in-memory accounting with the coordinator ledger. Pass the same ledger object through the runtime factory; remove paid-path alternate factories that can silently create unrelated ledgers.
- [ ] Close resources in `finally`, including creation failure, cancellation and report failure. Preserve original failure and record cleanup failure without logging secrets.
- [ ] Run targeted tests, inspect changes, then prepare commit `fix(ai-live): persist campaign accounting across phases`.

Test sketch (new fixture helper `runCampaignPhase` belongs to the new campaign test file and wraps the real coordinator with a fake dispatch):

```ts
await runCampaignPhase({ campaign: "c1", run: "r1", cap: 100, reserve: 70,
  outcome: "ambiguous" });
await expect(runCampaignPhase({ campaign: "c1", run: "r2", cap: 100,
  reserve: 40, outcome: "succeeded" })).rejects.toMatchObject({
  code: "BUDGET_EXCEEDED",
});
expect(fetchSpy).toHaveBeenCalledTimes(1);
```

**Exit:** every paid-path phase uses durable accounting; no lost writer permits another request; restart and new IDs preserve obligations.

## 4. Task 2 — Price-bound accounting and all-call identity

**Files:** modify `providers/{registry,accounting}.ts`, `live-evaluation/{ledger,contracts}.ts`; create `packages/engine/src/ai/live-evaluation/pricing.ts`; tests `ai-provider-{clients,accounting}.test.ts`, `ai-live-ledger.test.ts`; new `ai-live-pricing.test.ts`.

**Consumes:** Task 1 coordinator, native usage records, frozen per-provider/model price card.
**Produces:** validated price-card hash, conservative reservation estimate, settled micro-USD or explicitly unknown cost; ledger call IDs propagated into planner observations.

- [ ] Add failing usage-to-cost tests for planning, repair, replan, QE, document/query embeddings; successful malformed model output is still billed. Cover missing usage, partial token breakdown, cached/thinking tokens and arithmetic overflow. Unsupported billing detail stays unknown.
- [ ] Represent rates as integer/rational values, compute with exact integer arithmetic and conservative rounding. Use provider-reported usage and a pinned operator-supplied price card; do not hardcode assumed current prices in this change.
- [ ] Derive pre-dispatch reservation from bounded request size and output cap with model-specific validated upper-bound rules. Block paid execution when a safe reservation bound or price entry cannot be established. A flat optimistic estimate must not authorize unbounded exposure.
- [ ] Extend the provider accounting hook compatibly so evaluator composition supplies pricing while ordinary API remains denied. Keep existing fake client consumers functional. Include actual usage even when output parsing/validation fails; any post-response ambiguity retains the reservation.
- [ ] Preserve ledger call ID independently of provider request ID. Reconcile all provider purposes, not just planner callbacks; external request IDs are not trusted public artifact identifiers.
- [ ] Verify targeted tests and prepare commit `feat(ai-live): reconcile usage with frozen price evidence`.

```ts
// Pure pricing API proposed in pricing.ts.
// All rates are micro-USD per million tokens; cached input is a subset.
type PriceRates = { input: bigint; cachedInput: bigint; output: bigint };
function priceTokens(
  usage: { input: bigint; cachedInput: bigint; output: bigint },
  rates: PriceRates,
): bigint {
  const numerator = (usage.input - usage.cachedInput) * rates.input
    + usage.cachedInput * rates.cachedInput + usage.output * rates.output;
  return (numerator + 999_999n) / 1_000_000n;
}
// Schema validation rejects negative values and cachedInput > input before use.
// Provider-specific usage normalization must establish whether thinking tokens
// are already included in output; never count them twice.
```

**Exit:** known supported usage reconciles exactly under the pinned card; unknowns remain held and visible. Test prices are explicitly synthetic.

## 5. Task 3 — Real evaluator runtime and dedicated DB lifecycle

**Files:** modify `live-evaluation/{runtime,cli,contracts}.ts`; create `packages/engine/src/ai/live-evaluation/composition.ts`; update existing `ai-live-runtime.test.ts`, `ai-live-cli.test.ts`, `ai-live-index.integration.test.ts`. Reuse `catalog-embedding.ts`, `pgvector-index.ts`, provider registry and `@wap/db` connection primitives.

**Consumes:** Tasks 1–2, validated selected profile/scope, isolated DB identity, reviewed catalog, fake-or-native transport capability.
**Produces:** a concrete `LiveEvaluationRuntime` factory receiving coordinator ledger, authorization callback, profile and lazy credentials; each session carries pinned-currentness checking.

- [ ] Add RED CLI tests proving the standalone/default factory is wired, not just a manually injected complete runtime. Fake only fetch/DB boundary where appropriate; use the actual provider codec and registry.
- [ ] Implement lazy phase-specific composition. Probe constructs selected ports without DB; index builds ten reviewed document embeddings, activates atomically, reads back and verifies every row/hash; run binds model/QE/query embeddings to the pinned pgvector profile and same ledger.
- [ ] Harden DB validation: parse URL independently, validate supported protocol, effective host/default port/database identity, ignore credentials/query-string differences when comparing destination. Include effective app fallback identity even if `DATABASE_URL` is absent. Reject known localhost aliases to the same DB; when isolation cannot be proven, fail closed. Verify connected DB identity before mutation. Never create/drop a database in the ordinary paid CLI.
- [ ] Bind to a valid evaluation user UUID present in that isolated DB; document explicit preparation. Keep the reviewed 8+2 catalog separate from gold oracle data; no MCP write or arbitrary discovery during evaluation.
- [ ] Extend `LiveEvaluationSession` with `assertCurrent`; feed it into the existing planner currentness hook, including before repair/provider dispatch. A retriever profile check alone is insufficient once retrieval has finished.
- [ ] Test partially failed document embedding leaves old active index intact; wrong provider/model/purpose/dimension/hash rejects; close both DB clients on all exits.
- [ ] Verify targeted tests and prepare commit `feat(ai-live): compose native providers with isolated pgvector`.

```ts
// Extend the existing session contract in runner.ts.
interface LiveEvaluationSession {
  readonly model: StructuredModelClient;
  readonly retriever: ToolRetriever;
  readonly assertCurrent: () => Promise<void>;
}
// The composition factory creates these from the selected profile, not from
// full ParsedLiveCase objects. Existing test sessions inject a no-op check.
```

**Exit:** probe/index/run go through concrete composition and shared accounting; all tests still use fake HTTP; real DB integration is added in Task 7.

## 6. Task 4 — Complete phase snapshots, freeze and dispatch guards

**Files:** modify `live-evaluation/{freeze,contracts,authorization,cli}.ts`; new `packages/engine/src/ai/live-evaluation/execution-snapshot.ts`; tests `ai-live-{freeze,cli}.test.ts` and `ai-provider-approval.test.ts`.

**Consumes:** Tasks 1–3, exact raw config bytes, campaign manifest, price card, phase authorization, pinned index when applicable.
**Produces:** versioned preparation snapshot/full run freeze and an immutable verified context, regenerated from actual inputs before dispatch.

- [ ] Add mutation tests for each role's provider/model/API/settings, source file addition/deletion, compiled runtime drift, lockfile, capabilities, pricing, budget, approval, rubric, catalog and vector contents. Every mutation must stop before fetch.
- [ ] Build deterministic source manifests from relevant engine AI, DSL, DB source/config and tool-policy artifacts. Include new journal/ledger/runtime/codec modules automatically. Reject symlink escapes and missing files. Exclude outputs/artifacts so freeze does not hash itself.
- [ ] Bind executed build artifacts/runtime identity as well as source hashes; a stale `dist` cannot masquerade as current source. Preserve raw config identity consistently across authorization, runtime construction and freeze.
- [ ] Capture read-back index provenance/vector/policy hashes for full freezes. Validate snapshot completeness and exact profile before each paid phase, index currentness before each relevant request, and expiry at each call. Do not repeat expensive full file hashing per token/request; cache immutable inputs and detect source/config changes at defined phase/trial boundaries.
- [ ] Handle phase approval renewal explicitly: compare stable approved execution scope independently from approval timestamps, then validate the current phase record and expiry. Do not require reusing an expired probe approval for a later regression freeze.
- [ ] Allow old incomplete freezes for historical reporting only; reject them for new paid run authorization. Keep formal acceptance blocked by proposed rubric even when technical freeze is complete.
- [ ] Verify targeted tests and prepare commit `fix(ai-live): bind every phase to complete execution evidence`.

**Exit:** a missing snapshot field cannot silently become a safe default. Probe/index bootstrap works without pretending an index already exists.

## 7. Task 5 — CLI phase behavior, schedule and cancellation

**Files:** modify `live-evaluation/{cli,runtime,runner,schedule,contracts}.ts`, root `package.json` if DB build prerequisites are needed; tests `ai-live-{cli,runtime,runner,schedule}.test.ts`.

**Consumes:** concrete composition, durable coordinator and verified phase context.
**Produces:** working package entry point and exact phase inventories; signals flow to every provider request.

- [ ] Test the required probe inventory: planning, repair, replan, QE, document embedding and query embedding per selected profile. A nonempty calls array alone is insufficient. Record nominal versus actual calls and charge every one.
- [ ] Correct smoke inventory to the spec's nine trials: one dev plan, one refusal, one clarification × three variants at K=10 × one repetition. Resolve those cases from existing dataset oracle metadata only inside the evaluator; never send oracle fields to providers.
- [ ] Keep dev at 126 trials and legacy regression at 84 per selected profile. Reject duplicate/missing IDs before resources or dispatch. Persist seeded schedule and disclose profile-order confounding; do not automatically execute mixed profiles.
- [ ] Connect Ctrl+C/deadline to one abort signal across probe/index/runner. Stop scheduling new calls after cancellation; flush evidence and close resources; classify in-flight ambiguous calls conservatively.
- [ ] Separate process completion from scientific verdict: preflight/probe/index/freeze/report may exit 0 when their operation succeeds, with explicit non-pass quality status. Run exits nonzero for interrupted/failed execution; a completed exploratory run is not a formal pass. If a formal-gate option is added, it exits 0 only for approved formal PASS. Pin these meanings in tests/runbook.
- [ ] Verify the package build script constructs required DB artifacts in a clean checkout. Use dependency injection for subprocess tests without enabling arbitrary endpoint overrides in paid mode.
- [ ] Verify targeted tests and prepare commit `fix(ai-live): complete CLI phase and cancellation contracts`.

**Exit:** actual public entry point, counts, phase guards, signal handling and exit semantics are tested and documented.

## 8. Task 6 — Recoverable reporting and reconciliation

**Files:** modify `live-evaluation/{recovery,report,journal,contracts,runner,cli}.ts`; tests `ai-live-{recovery,report,journal,runner,cli}.test.ts`.

**Consumes:** durable run header, frozen schedule, trial transitions, all ledger reservations/settlements and recorded index/currentness observations.
**Produces:** summaries fully reconstructable without an existing summary file or live provider/database access.

- [ ] Add failure tests at reservation sync, response-before-settlement, trial-terminal-before-summary, truncated final line and summary rename. Replay must produce the same completed observations and held unknowns with zero new fetches.
- [ ] Persist enough versioned header data to recover identity, snapshot hash, evidence kind, rubric/exposure, planned inventory and price/budget references. Use summary files only as derived outputs, never authority for verdict gates.
- [ ] Derive reconciliation from call IDs and terminal records. Reject duplicate/foreign settlements, missing trial outcomes and unresolved accounting. Keep setup/probe/index costs outside trial quality denominators but inside campaign totals.
- [ ] Preserve actual live provenance on recovery; incomplete evidence blocks a complete verdict. Historical incomplete headers get explicit unknown/provenance-unavailable reasons, not fabricated facts.
- [ ] Capture QE, query embedding, pgvector, full retrieval and planning latency separately with sample counts; unavailable measurements remain unavailable. Do not claim provider retrieval p95 from database timing.
- [ ] Validate and redact public artifacts via an allowlist; test secret/header/body/prompt/output/request-ID canaries across error paths. Store only the minimum sanitized private evidence needed for adjudication; never publish unrestricted generated strings.
- [ ] Verify targeted tests and prepare commit `fix(ai-live): reconstruct truthful reports from durable evidence`.

**Exit:** report-only recovery works after process failure; it cannot retry, resume, change spend authorization or manufacture formal acceptance.

## 9. Task 7 — T7 integration matrix and replan safety

**Files:** extend `packages/engine/tests/ai-live-index.integration.test.ts`; create `packages/engine/tests/ai-live-replan.integration.test.ts` and `apps/api/tests/ai-live-wiring.integration.test.ts`; reuse `ai-pgvector.integration.test.ts`, `ai-replan.integration.test.ts`, API `ai-runtime.test.ts` and `ai-planner-http.test.ts` fixtures as applicable.

**Consumes:** Tasks 1–6 and existing isolated DB/engine testing patterns.
**Produces:** evidence for four planning × embedding profiles plus independent QE override, through native codecs/fake fetch and actual isolated pgvector.

- [ ] Create one uniquely named test DB per suite; migrate and seed its evaluation user. Verify cleanup targets are the created DB only. Never drop/reset `wap_g1` or Docker volumes. Integration suites run serially.
- [ ] For each of OpenAI/OpenAI, Google/Google, OpenAI/Google and Google/OpenAI: fake-native responses → ten catalog embeddings → activation/read-back → semantic retrieval/QE → planning and ledger reconciliation. Add QE override and assert credentials only for used providers.
- [ ] Fail tests for stale index immediately before planning/repair, mismatched embedding spaces, late approval expiry, budget depletion in QE, journal sync failure, and cancellation between embedding requests. Assert zero subsequent dispatch.
- [ ] Exercise configured API/engine replan with fake/no-op receivers: replace only failed/uncompleted work; redact completed outputs; discard stale owner/version/lease results; stop after lost heartbeat; enforce at-most-two replans and max-three planning attempts per invocation. Unknown write outcome must enter reconciliation with zero blind retry/replan.
- [ ] Prove ordinary API startup/manual/dev_fixture/offline commands remain network-free even with credential canaries set. Default `denyAiLiveCalls` still rejects before key lookup and fetch.
- [ ] Run targeted integration tests, record actual counts/skip reasons and prepare commit `test(ai-live): verify provider matrix and durable runtime integration`.

```ts
// Example assertion required in each matrix case, using an injected fake fetch:
expect(documentEmbeddingRequests).toHaveLength(10);
expect(await evalIndex.activeIndex(reviewedCatalog)).toMatchObject({
  id: activated.id,
  vectorHash: activated.vectorHash,
});
expect(replayedRecords.map(record => record.callId)).toEqual(
  liveLedger.records().map(record => record.callId),
);
expect(unselectedCredentialReads).toBe(0);
expect(realToolWriteDispatches).toBe(0);
```

**Exit:** integration means the actual DB and composition path was used; fake transport is explicitly labelled in all resulting evidence.

## 10. Task 8 — Regression, independent review and operator handoff

**Files:** update `docs/AI-STATUS-2026-09-17.md`, original T6/T7 checklist and `packages/engine/README.md`; create `docs/ai-evidence/AI-LIVE/READINESS-RUNBOOK.md`. Touch `README.md`/`docs/BASELINE.md` only to reconcile stale status, not to change scope.

- [ ] Run relevant unit suites while developing; final gate runs `npm run check:backend` once, which already includes `npm run check`, build and all backend integration suites. Do not run both full gates consecutively without a reason.
- [ ] Run offline CLI smoke and report recovery with fake/local evidence. Record command, commit, date, exit code, test counts and skipped cases; do not reuse old green counts as evidence for new code.
- [ ] Obtain independent read-only review of campaign locking/budget, exact role approval, credentials, DB identity, snapshot completeness, oracle separation, currentness and replay. Resolve blocker/high findings and rerun affected checks. If review is unavailable, record the readiness gate as incomplete.
- [ ] Write the runbook: profile fields, isolated DB preparation, hidden local key launcher, approval/price/budget manifests, exact preflight/probe/index/smoke/dev/freeze/regression/report sequence, safe index switching, cancellation and stale-lock recovery. Use actual implemented flags. Do not create a fake human approval record.
- [ ] Mark preparation `READY_FOR_LIVE_PROBE` only when all technical checks and review pass; record every provider/profile's actual live status as `NOT_RUN`. Preserve proposed rubric and fresh holdout OPEN. Update old checklists using evidence, not wholesale ticks.
- [ ] Run `git diff --check`, review intended file list, run `node .gitnexus/run.cjs detect-changes --scope all`, and prepare final documentation commit under existing Git authorization. Preserve unrelated work and do not push automatically.

## 11. Verification commands

These npm scripts exist at the pinned commit. Commands below are for implementation; no tests/builds/paid calls are run solely to publish this plan.

```powershell
# Compile dependencies once before targeted suites that import package exports.
npm run build
npm run test:unit -w @wap/engine -- ai-provider ai-live
npm run test:unit -w @wap/api -- ai-runtime ai-planner-http

# Requires reachable PostgreSQL; each suite owns an isolated database.
npm run test:integration -w @wap/engine -- ai-live
npm run test:integration -w @wap/api -- ai-live-wiring

# Final combined gate includes check/build and all backend integrations.
npm run check:backend
npm run ai:eval:live -- preflight --offline
git diff --check
node .gitnexus/run.cjs detect-changes --scope all
```

Prerequisite failures (Docker unavailable, permission to create test DB absent) are reported as unverified integration evidence, never converted to a passing skipped gate. Targeted test file names created by this plan are explicitly new, not existing evidence.

## 12. Risks and decisions deferred to T8

- Campaign ownership is more than exclusive journal creation. Test separate processes; PID reuse or lock age alone cannot prove the owner is dead. Recovery must be explicit and must retain journal history and held reservations.
- A claimed reservation is only a bound if model limits and pricing support it. Missing reliable bounds block that paid profile; tests can use documented synthetic caps and rates.
- Effective database identity can be obscured by aliases. Favor an explicitly prepared evaluator database/role and verified identity over URL inequality alone. No general DNS/security redesign is part of this task.
- Native provider model support and current prices require official verification at T8. Do not infer API model IDs from Codex UI names or silently substitute providers/models.
- Exact T8 choices remain with the operator: actual provider/model profiles, permitted synthetic data, keys, budget, expiry, and human rubric approval for formal claims. None blocks implementing/testing the preparation layer.
- No fresh holdout is fabricated. Existing exposed regression cases retain their exposure labels. No frontend, multi-worker queue, broader DSL, production live API enablement or new SaaS integrations belong in this slice.
- Existing GitNexus/CodeGraph limitations mean fresh execution-time impact analysis plus source verification is needed for shared registry/approval edits; an empty caller/PDG result is not a safety certificate.

## 13. Definition of done

- [ ] The public CLI constructs the actual evaluator runtime after authorization, and all paid phases share durable campaign accounting.
- [ ] Cross-process ownership, cap carry-over, conservative reservations and failure poisoning are proven by tests.
- [ ] Known usage has price-bound costs; unknown or ambiguous exposure remains visible and held; provider IDs and ledger IDs cannot be confused.
- [ ] Real isolated PostgreSQL tests prove ten-tool activation/read-back, provenance, profile switching/currentness and guaranteed cleanup.
- [ ] Freeze evidence is complete, phase-aware, bound to executed code/config/index and mutation-tested before dispatch.
- [ ] Probe inventory, nine-trial smoke, dev/regression matrices, deadlines and cancellation match the spec.
- [ ] Recovery derives reports from durable evidence, with zero provider calls and no automatic resume.
- [ ] Four provider combinations, QE override, replan/lease/approval and production denial are covered with fake HTTP.
- [ ] Final backend regression gate and independent review pass; runbook/status reflect actual evidence.
- [ ] Readiness is `READY_FOR_LIVE_PROBE`; paid execution and formal AI quality acceptance remain separate, explicit T8 work.

## 14. Execution record

Implemented in the current checkout:

- T1: durable campaign lock, cross-run replay and shared journal ledger.
- T2: cached-token usage normalization and exact integer micro-USD pricing with
  unknown-cost preservation.
- T3: concrete OpenAI/Google composition, isolated PostgreSQL/pgvector
  lifecycle, provenance read-back and session currentness.
- T4/T5/T6 hardening: effective DB identity checks, nine-trial smoke inventory,
  signal propagation, whole-freeze hashing, durable `run_started` metadata and
  report recovery without relying on `summary.json`.
- T7 core: one isolated integration suite covers all four role combinations,
  ten embeddings, semantic+QE retrieval, planning codec and credential scope.

Remaining by design: complete execution snapshots tied to a live approved price
card/index, provider account probes, formal rubric/fresh holdout approval,
independent read-only review, and the final operator `READY_FOR_LIVE_PROBE`
decision. These are not inferred from fake transport or local test passes.

**Planning self-review:** This plan closes the remaining integration obligations, reuses existing modules, includes pricing and campaign-wide durability that a simple runtime hookup would miss, and preserves an executable bootstrap order. The original proposed rubric is not a preparation blocker. All eight implementation tasks are pending; only this document is created in the planning turn.
