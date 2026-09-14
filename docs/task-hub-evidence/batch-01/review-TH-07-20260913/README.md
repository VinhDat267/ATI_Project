# TH-07 independent review — 2026-09-13

**ACCEPTED after documentation corrections.** Antigravity implemented TH-07 in the existing audited conversation with Gemini 3.8 Flash High. This review adds no production behavior and does not run the manual demo against `wap_g1`.

- Fresh Antigravity gate: `npm ci` exit 0; `check:engine` exit 0; 39 DSL unit tests + 63 MCP/database integration tests + 40 engine integration tests = **142 passed, 0 failed, 0 skipped**. The full gate includes the real controller/CLI and fault cases from TH-06.
- Independent [verification](verification.json): 162 protected files unchanged, 23 pre-TH07 source/fixture hashes unchanged; all 40 manifest hashes and required source/test/script paths checked; old three tool contracts identical. All eight live tool names and exact outputs of all four reads match seed data, including member workload 1/0. Four migration checksums match disk. The snapshot database was independently confirmed absent through a read-only PostgreSQL query.
- [PowerShell checks](powershell-doc-check.json): 16 example blocks parse without errors; direct CLI `--help` JSON pipeline succeeds. This is syntax/CLI-output verification, not a new execution of the manual write demo. Its command and JSON-field contract were checked against `cli.ts` and `Store.detail`.
- [Final documentation and preservation check](completion-check.json) captures the link checker exit code, timestamps and log, source preservation, final document hashes and empty Git index. The checker verifies local Markdown link targets, not external URLs or anchor spelling; code fences and the explicitly identified future/skeleton paths are excluded from link claims.

## Corrections made during review

1. Replaced nonexistent approval flags with the four actual positional arguments. Corrected nested fields to `approval.id` and `approval.snapshot_hash`; used Node directly for machine-readable JSON and checked process exit before parsing.
2. Corrected the shared gate to `TaskHub.call` in `service.ts`; removed nonexistent `TaskHubService.write`, `executeAuthorizedWrite`, and `this.write` references. Card mutation dispatch remains inside the existing receiver transaction.
3. Corrected DB-generated card IDs to UUID text, added actual schema/date/timezone/workload constraints, and updated the engine README to eight tools. Distinguished 39 offline unit tests from 103 real integration tests.
4. Corrected preview/trace/reconciliation descriptions: approval IDs/hash come from prepare/detail; trace retains actual certainty, including unknown after response loss or crash. Reconcile inspects receipts without rewriting trace.
5. Expanded manifest coverage to 40 source/test/script/config/migration/fixture files and an auditable 162-file preservation map. G1 remains PARTIAL; filesystem, rubric, API/session/UI/polling, AI and BullMQ remain outside completed scope.

## Failures and evidence provenance

- Antigravity snapshot attempt 1 failed due to an incorrect `get_card` assertion in the evidence script. Attempt 2 passed after fixing the assertion; both logs/exit codes remain in `final/`. Production code did not change.
- The initial independent verifier failed while parsing ANSI-colored test-count output. Only the review parser was corrected to strip ANSI sequences; the subsequent verifier passed. This was not a product test failure or a suite rerun.
- First four entries in `final/commands.json` have process-captured runtime command timing. Antigravity added the link-check timing retrospectively; these values are retained as `reported_*`, with actual timestamps set to null and provenance explained. Fresh independently captured documentation timing is in `completion-check.json`.
- Historical TH-06 r2 database-down evidence remains unchanged. Fresh TH-07 runtime evidence was obtained with PostgreSQL available; the older setup failure is not substituted for the fresh gate.

No stage, commit, push, next-batch implementation, demo reset, or demo migration/seed was performed by this review. Next scope requires the user's next task.
