# TH-06 independent review — ACCEPTED

Reviewed 2026-09-13. Antigravity implemented the TH-06 test/fixture extension using Gemini 3.8 Flash High in the existing audited conversation. Codex reviewed the incremental diff and directly ran an independent real controller/MCP/PostgreSQL/CLI probe.

## Evidence

- Full gate: **142 passed, zero failed/skipped** (39 DSL + 63 MCP/DB + 40 engine), plus typecheck/build/schema/API generation. See [check-03.log](../TH-06/check-03.log). This run completed after correcting TypeScript errors in the new tests.
- Targeted: **16 passed, 24 filtered out**, [targeted-07.log](../TH-06/targeted-07.log). This comprises 15 new tests plus the existing TH-03 timezone integration test tagged E06, whose original assertions remain unchanged.
- Independent probe: **7/7 groups passed**, [raw results](probe-1789307650486.json), [command/exit/timing captured by Codex](command-01.json), [probe source](probe.mjs). Probe ran after the full suite and used its own database `engine_it_d0a16a33d5bb4855b4a7d93d74edefc7`, which was dropped in finally.
- **126/126 historical protected file hashes match**. Production source, receiver schemas/catalog, crash harness, migrations, lockfile and original dataset remain unchanged from the TH-05 snapshot. See [baseline](before.json) and [verified file hashes](verified-files.json).

## Independent checks

| Group | Verified behavior |
|---|---|
| CLI lifecycle | Separate prepare, preview, approve, execute and trace processes; original title in notification after SQL title change between preview and approval; one approval, two receipts, three ended confirmed attempts |
| Create response loss | Actual card insert and exactly one matching receipt; one authorized dispatch; zero notify; historical unknown trace preserved |
| Move response loss | Actual c1 move to Done and exactly one matching receipt; one authorized dispatch; zero notify; historical unknown trace preserved |
| Create process crash | Existing crash worker exits 86 after real receiver commit; recovery closes attempt as unknown and sets reconciliation_required; card ID matches receipt |
| Move process crash | Same real child-process sequence; Done state matches receipt; no notify or automatic resume |
| Create concurrent execution | Two separate real gateways/controllers compete for the run; one succeeds; exactly one new card, one message and two receipts |
| Move concurrent execution | Two separate real gateways/controllers compete; one succeeds; final Done state, one message and two receipts |

For all four fault cases, an inspector without a gateway reconciles the matching operation/receipt, leaves the complete trace unchanged, and repeated recovery does nothing. A subsequent execute rejects with CONFLICT, counts and trace remain unchanged. Response loss is injected only after the real gateway returns a successful authorized write; process crash uses the unchanged test-owned worker. Approvals come from real prepare/decide or CLI, never a synthetic grant fixture.

## Review and corrections

The extension covers E01–E13; E14 is the existing regression suite. Review required independent seeds for create/move, whole-trace equality, actual receipt/operation/result matching, ended timestamps, no retry/notify after faults and CLI title mutation after preview. Those checks were added before acceptance. Fixed-window b01 is a dev-only adaptation, not a claim that an unmodified current-week plan ran.

Several early expectations were incorrect: read-only approval is null, outputs are in run.finished/trace rather than detail.outputs, and concurrent execution can reject with BUSY while the worker lease is occupied. Codex's early insistence on CONFLICT for the concurrent loser was corrected after inspecting Store.withWorker; post-terminal execution still requires CONFLICT. Runtime was not changed to satisfy these incorrect expectations.

Historical failed logs remain: targeted-01 failed DB connection setup; targeted-02 failed null expectations; targeted-04 failed output-access and concurrency expectations; targeted-05 failed concurrency expectations; check-01 failed test TypeScript checks. targeted-03 has only a start header and no completion result, so its result is UNKNOWN/INCOMPLETE, not PASS. Antigravity's commands.json is a retrospective record; the raw logs are authoritative for test counts, and its early timing entries require the corrections/provenance recorded there. The directly captured independent command record is separate.

## Scope

Source/fixture delta: controller.integration.test.ts, new task-hub-plans.ts and new dev-hand-plans/th-move.json. The old regression assertions are preserved; evidence capture adds card records and permits a targeted card run to emit observations. No unresolved actionable finding remains in TH-06 scope. No stage, commit or push was performed by Codex in this task. TH-07 final documentation/runtime inventory and later filesystem/API/UI/LLM work remain outside this checkpoint; this is not a claim that G1 overall is complete.

Final gate check-03 also passed 142/142, including the last extra assertions that a post-terminal execute leaves counts unchanged. This test-only addition followed the independent probe; production source hashes are unchanged. Final hashes are recorded in verified-files.json. All 8 TH-06 implementation checkboxes are complete.
