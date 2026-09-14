# TH-05 independent review — ACCEPTED

Reviewed on 2026-09-13. Antigravity implemented `move_card` using Gemini 3.8 Flash High in the existing audited conversation. Codex reviewed the incremental change from the TH-04 working tree and ran an independent live MCP/PostgreSQL probe.

## Verified result

- Full `npm run check:engine`: **127 passed, zero failed/skipped** — 39 DSL, 63 MCP/DB, 25 engine tests. Typecheck, build, schema and API generation also completed. See [full log](../TH-05/check-01.log) and [Antigravity command records](../TH-05/commands.json).
- Targeted TH-05: **14 passed**, 42 filtered out; initial RED had 13 failures and one schema-only pass. Historical failed logs remain preserved.
- Codex independently executed [probe.mjs](probe.mjs): **12/12 groups passed**, [captured command and exit code](command-01.json), [raw result](probe-1789297811651.json), [stdout](probe-01.log). The earlier probe result in this folder was run by Antigravity using the Codex-authored probe; the result linked here is the subsequent direct Codex run.
- **107/107 protected files** match their pre-TH-05 SHA-256 values: earlier evidence, four migrations and lockfile. See [baseline](before.json) and [verified source hashes](verified-files.json).
- Eight live tools match built definitions and catalog, and the three original tool schemas remain equal to the baseline. Filesystem remains SPEC_ONLY.

## Behavior reviewed

The receiver locks the owner-scoped card before reading its current list, derives its board from the database, locks the matching owner/board target list, and rechecks approval expiry after lock waits. Changed targets update list/timestamp; same-target new intents retain the timestamp but still require approval and receive a new receipt. The existing transaction covers mutation, output validation and receipt insertion.

The independent probe exercises strict arguments, missing authorization including same-target calls, Doing-to-Done and Done-to-Doing workload, restart replay, concurrent duplicate operations, replay of an older receipt after a newer move, changed-payload rejection, cross-board/owner isolation, receipt failure rollback, corrupt receipt handling and overlapping distinct operations.

For the overlapping operations, the initial list was Doing; A moved to Done while blocked after its UPDATE, and B targeted Doing. B had to wait and read the new committed state instead of taking a premature no-op path. PostgreSQL reported A PID **13315** blocked by barrier PID **13317**, then B PID **13316** blocked by A. After releasing the barrier, both receipts persisted and the final list was Doing. The raw JSON includes both operation IDs, results and exact timestamp. This probe uses advisory key **197612**; the suite's different barrier test uses **987654** and ends in Done.

The probe created and dropped only its own database `g1_it_31e348c8849c42eda1553f9764d58572`; `database_dropped: true` is recorded. Approval rows are synthetic receiver fixtures, not proof of the TH-06 controller workflow.

## Review corrections

Antigravity corrected independent test setup for Done-to-Doing and same-target behavior, valid version-drift fixtures, isolation snapshots, barrier cleanup ordering and lock-expiry assertions. Codex corrected the final report's broken relative links and mixed concurrency data, identified the test database accurately, and narrowed the duplicate-call claim: receipt/state assertions do not directly count SQL UPDATE statements.

Five source/catalog files changed relative to the TH-04 snapshot: cards.ts, contracts.ts, tools.integration.test.ts, gateway.ts and tools.json. Service, server, sync-catalog, attempts and engine integration source hashes are unchanged from that snapshot. Prior uncommitted TH-03/04 work remains in the shared working tree.

No unresolved actionable finding remains within TH-05 scope. The four TH-05 implementation checkboxes are complete. No files were staged, committed or pushed in this task. TH-06 real controller create/move, snapshot, unknown-response and crash workflows remain **NOT_RUN**; this review does not declare G1, HTTP/UI or LLM complete.
