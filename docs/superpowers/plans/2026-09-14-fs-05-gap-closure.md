# FS-05 Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three remaining FS-05 evidence gaps without weakening the B/local approval, marker, or unknown-result semantics.

**Architecture:** The runtime gateway stays unchanged. Test-owned Node child processes patch only their own MCP SDK `Client.prototype.callTool` before the real client sends a filesystem packet. This makes E08 stop precisely after the PostgreSQL reservation and before the original raw call, and makes E10 return reviewed-shaped raw fault packets without sending a write. E14 uses a task_hub-only gateway and a no-gateway inspector to prove snapshots remain readable when filesystem is absent.

**Tech Stack:** Node >=22, TypeScript, Vitest, PostgreSQL 16 loopback, MCP SDK stdio client, `@modelcontextprotocol/server-filesystem` 2026.8.31.

**Spec:** `docs/superpowers/plans/2026-09-13-filesystem-g1-completion.md` FS-05 matrix and `docs/task-hub-evidence/batch-02/FS-05/FS-05.md`.

## Global Constraints

- B/local remains one sequential worker. Do not add automatic filesystem-write retry, resume, receipt, or a new public tool.
- Preserve the current dirty working tree. Do not stage, commit, reset, checkout, clean, switch branches, or create a worktree.
- Do not modify migration/schema, reviewed policy, public catalog, dependency versions, or filesystem launch environment variables for fault injection. The sole production exception is the Task 2R `await`/post-dispatch-error correction, required by the E10 review's verified controller defect.
- E08/E10 hooks live only in child processes under `packages/engine/tests/`; each opens the real reviewed task_hub and filesystem gateway against a fresh `engine_it_*` database and a fixture-owned `ati-fs-it-*` root.
- An E08 child must call `process.exit(87)` after verifying the matching `filesystem_dispatches` row and before it invokes the original `Client.prototype.callTool` for `write_file`.
- E10 injected packets must be accepted by `CallToolResultSchema`: `is_error` returns `{ isError: true, content: [{ type: "text", text: "BAD_ARGS" }] }`; `malformed_ack` returns one text content and `{ content: "unexpected acknowledgement" }` structured content. Task 2R must delegate the one real write and then replace only its raw result, proving that a post-dispatch malformed/error acknowledgement cannot be upgraded to success.
- Every fault case must assert: exactly one durable marker for its run, no task_hub notification, one filesystem write attempt with `outcome_certainty: "unknown"`, `reconciliation_required`, immutable result from two `reconcile` calls, and a second `execute` refusal. Task 2R additionally proves that an actual target write does not make an error/malformed acknowledgement successful.
- E14 must use `openLocalGateway({ root, databaseUrl, userId })` with no `filesystem` property. Inspector reads use `new WorkflowEngine(db, undefined, userId)`.
- All tests use `makeFilesystemFixture`, fixture-owned cleanup, actual Node `execFile`, and no fake MCP server.

---

### Task 1: E08 reservation-window crash worker and integration test

**Status:** Complete. The focused E08 test passed after the exact-one-save-attempt review correction.

**Files:**
- Create: `packages/engine/tests/filesystem-marker-crash-worker.mjs`
- Modify: `packages/engine/tests/filesystem-controller.integration.test.ts`

**Interfaces:**
- The worker receives exactly `[databaseUrl, userId, runId, root, allowedRoot]` from `process.argv.slice(2)`.
- It imports `Client` from `@modelcontextprotocol/sdk/client/index.js`, `openDatabase` from `@wap/db`, and `WorkflowEngine`/`openLocalGateway` from `../dist/index.js`.
- It validates `new URL(databaseUrl).pathname` against `/^\/engine_it_[a-f0-9]{32}$/`, opens the real trusted filesystem launch config, and patches only its own `Client.prototype.callTool`.
- Parent test invokes the worker with `execFileAsync`, expects exit code `87`, then calls `recoverOrphans`, `trace`, `reconcile`, and `execute` through the existing parent engine.

- [x] **Step 1: Write the failing E08 test before the worker exists**

Add an `it("E08 ...")` case beside E07. Prepare and approve `copyPlan`, invoke `filesystem-marker-crash-worker.mjs`, and assert:

```ts
expect(child.code).toBe(87);
expect(fixtureFileExists(fixture, "reports/notes-copy.txt")).toBe(false);
expect(await markerCount(fixture, run.run_id)).toBe(1);
expect(await notificationTexts(fixture, run.run_id)).toEqual([]);
await expect(engine.recoverOrphans()).resolves.toContainEqual({
  run_id: run.run_id,
  status: "reconciliation_required",
});
const trace = await engine.trace(run.run_id);
expect(trace.attempts.find((attempt) => attempt.step_id === "save")!.outcome_certainty).toBe("unknown");
const first = await engine.reconcile(run.run_id);
expect(first.operations).toEqual(expect.arrayContaining([
  expect.objectContaining({ step_id: "save", dispatch_marker: "present", receipt: "not_supported" }),
]));
expect(await engine.reconcile(run.run_id)).toEqual(first);
await expect(engine.execute(run.run_id)).rejects.toMatchObject({ code: "CONFLICT" });
```

- [x] **Step 2: Run the focused test and record RED evidence**

Run:

```powershell
npm run build -w @wap/engine
npm run test:integration -w @wap/engine -- --run tests/filesystem-controller.integration.test.ts
```

Expected: the E08 case fails because `filesystem-marker-crash-worker.mjs` does not exist; existing tests may remain green.

- [x] **Step 3: Create the test-owned worker**

Implement a worker structurally equivalent to `filesystem-crash-worker.mjs`, but before opening the real gateway capture the original method and replace it:

```js
const originalCallTool = Client.prototype.callTool;
Client.prototype.callTool = async function patchedCallTool(request, ...rest) {
  if (request.name === "write_file") {
    const marker = await db.client`
      SELECT 1 FROM filesystem_dispatches
      WHERE user_id=${userId} AND run_id=${runId}`;
    if (marker.length !== 1) throw Error("Expected committed filesystem dispatch marker");
    process.exit(87);
  }
  return originalCallTool.call(this, request, ...rest);
};
```

Keep the existing `finally` close path; `process.exit(87)` intentionally bypasses it for this crash fixture. The code after the patch must construct `openLocalGateway({ root, databaseUrl, userId, filesystem: launch })` and call `new WorkflowEngine(db, gateway, userId).execute(runId)`.

- [x] **Step 4: Run the focused E08 test and verify GREEN**

Run the same command. Expected: E08 passes, the child exits 87, the target file is absent, the marker survives, and recovery remains conservative.

- [x] **Step 5: Self-review the worker boundary**

Confirm the worker changes only `Client.prototype.callTool` in its own process, invokes `process.exit(87)` before `originalCallTool.call`, validates the isolated DB name, and contains no production configuration switch.

### Task 2: E10 raw error and malformed-ack worker with controller assertions

**Status:** Initial no-write packet harness complete, then superseded by Task 2R below when review proved that a post-dispatch acknowledgement test must include an actual filesystem write.

**Files:**
- Create: `packages/engine/tests/filesystem-raw-fault-worker.mjs`
- Modify: `packages/engine/tests/filesystem-controller.integration.test.ts`

**Interfaces:**
- Worker argv is `[mode, databaseUrl, userId, runId, root, allowedRoot]`, with `mode` exactly `is_error` or `malformed_ack`.
- Worker prints exactly one final JSON object to stdout: `{ status, injected_write_calls }`.
- Parent test parses the child stdout and runs each mode in its own approved copy run.

- [x] **Step 1: Write a failing parameterized E10 test**

Add:

```ts
it.each(["is_error", "malformed_ack"])(
  "E10 treats raw %s filesystem write output as unknown and does not notify or retry",
  async (mode) => {
    // prepare + approve copyPlan, invoke worker, inspect parent DB
  },
);
```

For each mode assert child `status === "reconciliation_required"`, `injected_write_calls === 1`, marker count one, notification texts empty, save attempt certainty unknown, one save attempt, `receipt: "not_supported"`, identical double reconciliation, and `execute` conflict. The final post-dispatch form of these assertions is defined by Task 2R below.

- [x] **Step 2: Run the focused test and record RED evidence**

Run:

```powershell
npm run build -w @wap/engine
npm run test:integration -w @wap/engine -- --run tests/filesystem-controller.integration.test.ts
```

Expected: both E10 modes fail because `filesystem-raw-fault-worker.mjs` is absent.

- [x] **Step 3: Create the test-owned raw-fault worker**

Patch the SDK client before the gateway opens. For all methods except `write_file`, delegate to `originalCallTool`. The initial harness may return the exact raw result without transport; Task 2R below supersedes that boundary with one real post-dispatch write before the raw result is replaced:

```js
if (mode === "is_error")
  return { isError: true, content: [{ type: "text", text: "BAD_ARGS" }] };
return {
  structuredContent: { content: "unexpected acknowledgement" },
  content: [{ type: "text", text: "unexpected acknowledgement" }],
};
```

After `engine.execute(runId)`, write the final JSON once with `process.stdout.write(JSON.stringify({ status: result.status, injected_write_calls: injectedWriteCalls }) + "\n")`. Close gateway and DB in `finally`.

- [x] **Step 4: Run focused E10 tests and verify GREEN**

Run the command from Step 2. Expected: both injected raw cases are unknown, produce no notification, and do not replay the write; the final Task 2R cases also verify the actual target bytes.

- [x] **Step 5: Self-review packet shapes and transport behavior**

Confirm both injected objects parse through `CallToolResultSchema` and only `write_file` is intercepted. Task 2R additionally confirms a single real target write precedes the corrupted reply.

### Task 2R: E10 post-dispatch acknowledgement correction

**Status:** Complete. Production correction and actual-write fault evidence passed independent review.

**Why this amendment is required:** The Task 2 review traced a real controller defect. `normalizeFilesystemWriteResult` is async, but `gateway-filesystem.ts` called it without `await`; a malformed acknowledgement rejected in an unobserved promise while the gateway proceeded to read-back. The original zero-write worker only reached `reconciliation_required` because its target was absent, and therefore did not prove acknowledgement validation determined the result.

**Files:**
- Modify: `packages/engine/src/gateway-filesystem.ts`
- Modify: `packages/engine/tests/filesystem-raw-fault-worker.mjs`
- Modify: `packages/engine/tests/filesystem-controller.integration.test.ts`

- [x] First write the failing post-dispatch E10 expectation: both synthetic raw modes must delegate exactly one real filesystem `write_file` invocation, then replace the raw response. Assert the copied target exists with the expected content, yet execution is `reconciliation_required`, there is no task_hub notification, one marker, one unknown save attempt, immutable reconciliation, and re-execution refuses `CONFLICT`.
- [x] Capture RED with the focused controller suite. Current behavior is expected to accept an actual write paired with a synthetic malformed/error acknowledgement because the normalizer promise is not awaited.
- [x] At the gateway call site, await `normalizeFilesystemWriteResult(CallToolResultSchema.parse(raw), expectedAck)`. If the normalized result has `isError`, throw a post-dispatch error so the existing execution boundary records the write as unknown. Do not add a retry, receipt, new tool, or a public configuration switch.
- [x] Change the raw-fault worker to call the original client once for `write_file`, then return only the required injected raw result. Remove the `unhandledRejection` suppression completely. It still patches only its child process and uses the real fixture filesystem server.
- [x] Run the focused controller suite and the relevant adapter unit test. The actual target content proves the test models a post-dispatch fault, while the no-notification/unknown/reconciliation assertions prove the runtime is conservative.
- [x] Self-review the exception boundary: `isError` and malformed acknowledgement both fail after marker reservation; neither can be converted to a successful step by read-back.

### Task 3: E14 task_hub-only persisted-snapshot compatibility

**Status:** Complete. Focused suite passed 14/14 and independent review PASS.

**Files:**
- Modify: `packages/engine/tests/filesystem-controller.integration.test.ts`
- Reuse: `packages/engine/tests/task-hub-plans.ts`

**Interfaces:**
- Import `makeMovePlan` from `./task-hub-plans.js`.
- A legacy gateway is exactly `await openLocalGateway({ root: fixture.projectRoot, databaseUrl: fixture.databaseUrl, userId: fixture.userId })`, with `tools` length eight and no filesystem server.
- No-gateway inspection uses `new WorkflowEngine(fixture.db, undefined, fixture.userId)`.

- [x] **Step 1: Write the failing E14 test**

Create one test with two independent task_hub-only runs:

```ts
const completed = await legacy.prepare(makeMovePlan());
await legacy.decide(completed.run_id, decision(completed));
await legacy.execute(completed.run_id);
const inspector = new WorkflowEngine(fixture.db, undefined, fixture.userId);
expect((await inspector.detail(completed.run_id)).status).toBe("succeeded");
expect((await inspector.trace(completed.run_id)).attempts.every(
  (attempt) => attempt.outcome_certainty === "confirmed",
)).toBe(true);
expect((await inspector.reconcile(completed.run_id)).operations.every(
  (operation) => operation.receipt === "confirmed",
)).toBe(true);
```

For a separate approved pending run, create a gateway object whose first reviewed tool has a different `artifactHash`, call `execute`, expect `CONFLICT`, and assert both approval `snapshot_hash` and `hub_receipts` count are unchanged.

- [x] **Step 2: Run the focused test and record RED evidence**

Run:

```powershell
npm run test:integration -w @wap/engine -- --run tests/filesystem-controller.integration.test.ts
```

Expected: the new E14 test fails before its compatibility behavior is implemented.

- [x] **Step 3: Implement only the missing test fixture/assertion code**

Do not change production snapshot, gateway, or recovery code unless the red test exposes a real regression. The stale gateway must alter only the in-memory reviewed tool value passed to `WorkflowEngine`; it must not edit artifacts, policy files, migrations, or the persisted preview.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: task_hub-only snapshot remains readable while no filesystem gateway is present, and stale execution is rejected without changing the persisted approval or creating a receipt.

- [x] **Step 5: Self-review scope**

Verify the test proves inspection without filesystem, does not claim legacy data was rewritten, and does not add a new compatibility mode to production.

### Task 4: Evidence, checklist, and regression gate

**Status:** Complete. Fresh captures, documentation review, and final whole-scope review PASS.

**Files:**
- Modify: `docs/superpowers/plans/2026-09-13-filesystem-g1-completion.md`
- Modify: `docs/task-hub-evidence/batch-02/FS-05/FS-05.md`
- Create: a fresh `docs/task-hub-evidence/batch-02/FS-05/<timestamp>-gap-closure-check/` runner directory through `scripts/capture-command.mjs`

**Interfaces:**
- Evidence command is `node scripts/capture-command.mjs FS-05 gap-closure-check cmd.exe /d /s /c npm run check:engine`.
- Report must distinguish durable filesystem markers from task_hub receipts and preserve any non-green result only if an actual test remains missing.

- [x] **Step 1: Run the focused controller/fault suite after Tasks 1–3**

Run:

```powershell
node scripts/capture-command.mjs FS-05 gap-closure-controller cmd.exe /d /s /c npm run test:integration -w @wap/engine -- --run tests/filesystem-controller.integration.test.ts
```

Expected: all controller/fault cases pass and the run captures exit code, timestamps, and output.

- [x] **Step 2: Run the full regression gate in a fresh evidence directory**

Run the command in Interfaces. Expected: exit code 0; derive exact per-suite totals from its `output.log` rather than copying historical counts.

- [x] **Step 3: Update the FS-05 matrix from evidence**

Set E08, E10, and E14 to PASS only if the captured focused/full outputs prove every listed oracle. Link the final command JSON, output log, and controller observations. Update the FS-05 verdict to technical PASS only if no required matrix case remains NOT_RUN or PARTIAL.

- [x] **Step 4: Self-review the evidence claims**

Check every reported count against the final `output.log`, verify all relative Markdown links exist, run `git diff --check` on FS-05 files, and do not stage or commit.

## Self-Review

- Spec coverage: Task 1 maps to E08, Task 2 to E10, Task 3 to E14, and Task 4 refreshes verification/reporting. No public runtime feature is added.
- Placeholder scan: no `TBD`, `TODO`, or deferred implementation instructions appear in task requirements.
- Type consistency: each worker uses the existing `openLocalGateway` and `WorkflowEngine` contracts; parent tests retain `makeFilesystemFixture`, `copyPlan`, `decision`, and `execFileAsync` names already present in the controller suite.
