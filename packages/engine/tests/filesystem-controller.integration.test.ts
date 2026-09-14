import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { TraceSchema, WorkflowPlanSchema } from "@wap/dsl";
import {
  WorkflowEngine,
  openLocalGateway,
  type Gateway,
} from "../src/index.js";
import {
  fixtureFileExists,
  makeFsCardExportPlan,
  makeFsCopyPlan,
  makeFilesystemFixture,
  markerCount,
  localReceiptCount,
  notificationTexts,
  readTargetBytes,
  readFixtureFile,
  targetExists,
} from "./filesystem-fixture.js";
import { makeMovePlan } from "./task-hub-plans.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const execFileAsync = promisify(execFile);
const originalNotes = "Tiến độ ATI\nAPI: Done\n";

let fixture: Awaited<ReturnType<typeof makeFilesystemFixture>>;
let gateway: Gateway;

const copyPlan = makeFsCopyPlan();
const cardPlan = makeFsCardExportPlan();
const observations: Record<string, unknown> = {
  scope: "REAL_TWO_SERVER_CONTROLLER_POSTGRESQL_MCP_NO_HTTP_UI_LLM",
  matrix: [
    "E01",
    "E02",
    "E03",
    "E04",
    "E05",
    "E06",
    "E07",
    "E08",
    "E09",
    "E10",
    "E11",
    "E12",
    "E13",
    "E14",
  ],
};

const decision = (run: any) => ({
  approval_id: run.approval.id,
  workflow_version_id: run.workflow_version_id,
  snapshot_hash: run.approval.snapshot_hash,
  decision: "approved",
});

async function markerRows(runId?: string) {
  return runId
    ? fixture.db
        .client`SELECT * FROM filesystem_dispatches WHERE user_id=${fixture.userId} AND run_id=${runId}`
    : fixture.db
        .client`SELECT * FROM filesystem_dispatches WHERE user_id=${fixture.userId}`;
}

async function tableCount(table: "hub_receipts" | "hub_messages") {
  const rows = await fixture.db.client.unsafe(
    `SELECT count(*)::int AS n FROM ${table}`,
  );
  return rows[0]!.n as number;
}

async function cli(
  fixtureForCli: Awaited<ReturnType<typeof makeFilesystemFixture>>,
  command: string,
  ...args: string[]
) {
  const result = await execFileAsync(
    process.execPath,
    [
      path.join(fixtureForCli.projectRoot, "packages/engine/dist/cli.js"),
      command,
      ...args,
    ],
    {
      cwd: fixtureForCli.projectRoot,
      windowsHide: true,
      timeout: 30000,
      env: {
        ...process.env,
        G1_FILESYSTEM_ENABLED: "1",
        G1_DATABASE_URL: fixtureForCli.databaseUrl,
        G1_USER_ID: fixtureForCli.userId,
      },
    },
  );
  return JSON.parse(result.stdout);
}

beforeAll(async () => {
  fixture = await makeFilesystemFixture();
});

beforeEach(async () => {
  fs.writeFileSync(path.join(fixture.allowedRoot, "notes.txt"), originalNotes);
  fs.rmSync(path.join(fixture.allowedRoot, "reports", "notes-copy.txt"), {
    force: true,
  });
  fs.rmSync(path.join(fixture.allowedRoot, "reports", "card-title.txt"), {
    force: true,
  });
  gateway = await openLocalGateway(fixture.gatewayConfig);
});

afterEach(async () => {
  await gateway?.close();
});

afterAll(async () => {
  await fixture?.close();
  const requestedEvidence = process.env.ATI_EVIDENCE_DIR;
  if (requestedEvidence) {
    const dir = path.resolve(root, requestedEvidence);
    const evidenceRoot = path.resolve(root, "docs/task-hub-evidence");
    const relative = path.relative(evidenceRoot, dir);
    if (
      !relative ||
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative)
    )
      throw new Error(
        "ATI_EVIDENCE_DIR must name a batch directory under docs/task-hub-evidence",
      );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "filesystem-controller-observations.json"),
      JSON.stringify(
        {
          ...observations,
          recorded_at: new Date().toISOString(),
          cleanup: "fixture closed",
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
  }
});

describe("FS-05 filesystem controller and CLI", () => {
  it("E01 copies exact UTF-8 bytes, notifies only after the file write, and records certainty", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const beforeReceipts = await tableCount("hub_receipts");
    const beforeMessages = await tableCount("hub_messages");
    const run = await engine.prepare(copyPlan);
    expect(run.status).toBe("awaiting_approval");
    expect(run.approval!.actions).toHaveLength(2);
    expect(await markerRows(run.run_id)).toHaveLength(0);
    await engine.decide(run.run_id, decision(run));
    const finished = await engine.execute(run.run_id);
    expect(finished.status).toBe("succeeded");
    expect(targetExists(fixture)).toBe(true);
    expect(readTargetBytes(fixture)).toEqual(
      Buffer.from(originalNotes, "utf8"),
    );
    const markers = await markerRows(run.run_id);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.relative_path).toBe("reports/notes-copy.txt");
    expect(await markerCount(fixture, run.run_id)).toBe(1);
    expect(await localReceiptCount(fixture, run.run_id)).toBe(1);
    expect(await notificationTexts(fixture, run.run_id)).toEqual([
      "Đã lưu bản sao notes.txt.",
    ]);
    expect(await tableCount("hub_receipts")).toBe(beforeReceipts + 1);
    expect(await tableCount("hub_messages")).toBe(beforeMessages + 1);
    const messages = await fixture.db
      .client`SELECT channel,text FROM hub_messages WHERE user_id=${fixture.userId} ORDER BY created_at DESC LIMIT 1`;
    expect(messages[0]).toMatchObject({
      channel: "#team",
      text: "Đã lưu bản sao notes.txt.",
    });
    const trace = TraceSchema.parse(await engine.trace(run.run_id));
    expect(trace.attempts).toHaveLength(3);
    expect(
      trace.attempts.every(
        (attempt) => attempt.outcome_certainty === "confirmed",
      ),
    ).toBe(true);
    const reconciliation = await engine.reconcile(run.run_id);
    expect(reconciliation.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step_id: "save",
          dispatch_marker: "present",
          receipt: "not_supported",
        }),
        expect.objectContaining({ step_id: "notify", receipt: "confirmed" }),
      ]),
    );
    observations.E01 = {
      run_id: run.run_id,
      target_sha256: createHash("sha256")
        .update(readTargetBytes(fixture))
        .digest("hex"),
      marker_count: await markerCount(fixture, run.run_id),
      local_receipt_count: await localReceiptCount(fixture, run.run_id),
      notifications: await notificationTexts(fixture, run.run_id),
      certainty: trace.attempts.map((attempt) => attempt.outcome_certainty),
    };
  });

  it("E02 exports a task_hub card title through the same approved FS write boundary", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const run = await engine.prepare(cardPlan);
    expect(run.approval!.actions.map((a: any) => a.server)).toEqual([
      "filesystem",
      "task_hub",
    ]);
    await engine.decide(run.run_id, decision(run));
    expect((await engine.execute(run.run_id)).status).toBe("succeeded");
    expect(readFixtureFile(fixture, "reports/card-title.txt")).toBe("Viết API");
    expect(await markerRows(run.run_id)).toHaveLength(1);
    const messages = await fixture.db
      .client`SELECT channel,text FROM hub_messages WHERE user_id=${fixture.userId} ORDER BY created_at DESC LIMIT 1`;
    expect(messages[0]).toMatchObject({
      channel: "#team",
      text: "Đã xuất: Viết API",
    });
  });

  it("E03 uses the saved read output when the source changes after preview", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const run = await engine.prepare(copyPlan);
    fs.writeFileSync(
      path.join(fixture.allowedRoot, "notes.txt"),
      "CHANGED AFTER PREVIEW\n",
    );
    await engine.decide(run.run_id, decision(run));
    expect((await engine.execute(run.run_id)).status).toBe("succeeded");
    expect(readFixtureFile(fixture, "reports/notes-copy.txt")).toBe(
      originalNotes,
    );
  });

  it("E04 rejects a changed filesystem root before reserving or dispatching the first write", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const beforeMessages = await tableCount("hub_messages");
    const run = await engine.prepare(copyPlan);
    const markerPath = path.join(fixture.allowedRoot, ".ati-root.json");
    const originalMarker = fs.readFileSync(markerPath, "utf8");
    const changed = JSON.parse(originalMarker);
    changed.root_id = randomUUID();
    fs.writeFileSync(markerPath, JSON.stringify(changed));
    try {
      await engine.decide(run.run_id, decision(run));
      expect((await engine.execute(run.run_id)).status).toBe("failed");
      expect(await markerRows(run.run_id)).toHaveLength(0);
      expect(fixtureFileExists(fixture, "reports/notes-copy.txt")).toBe(false);
      expect(await tableCount("hub_messages")).toBe(beforeMessages);
    } finally {
      fs.writeFileSync(markerPath, originalMarker);
    }
  });

  it("E05 lets exactly one concurrent controller claim the approved run", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const beforeMessages = await tableCount("hub_messages");
    const run = await engine.prepare(copyPlan);
    await engine.decide(run.run_id, decision(run));
    const secondGateway = await openLocalGateway(fixture.gatewayConfig);
    try {
      const second = new WorkflowEngine(
        fixture.db,
        secondGateway,
        fixture.userId,
      );
      const outcomes = await Promise.allSettled([
        engine.execute(run.run_id),
        second.execute(run.run_id),
      ]);
      expect(
        outcomes.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1);
      expect(await markerRows(run.run_id)).toHaveLength(1);
      expect(
        await fixture.db
          .client`SELECT * FROM hub_messages WHERE user_id=${fixture.userId}`,
      ).toHaveLength(beforeMessages + 1);
    } finally {
      await secondGateway.close();
    }
  });

  it("E06 marks a lost filesystem response unknown without dispatching notification", async () => {
    const real = gateway;
    const beforeMessages = await tableCount("hub_messages");
    const unreliable: Gateway = {
      ...real,
      async call(...args) {
        const response = await real.call(...args);
        if (args[0].server === "filesystem" && args[0].name === "write_file")
          throw new Error("injected response loss after filesystem commit");
        return response;
      },
    };
    const engine = new WorkflowEngine(fixture.db, unreliable, fixture.userId);
    const run = await engine.prepare(copyPlan);
    await engine.decide(run.run_id, decision(run));
    const result = await engine.execute(run.run_id);
    expect(result.status).toBe("reconciliation_required");
    expect(readFixtureFile(fixture, "reports/notes-copy.txt")).toBe(
      originalNotes,
    );
    expect(await markerRows(run.run_id)).toHaveLength(1);
    expect(await tableCount("hub_messages")).toBe(beforeMessages);
    const trace = TraceSchema.parse(await engine.trace(run.run_id));
    expect(
      trace.attempts.find((attempt) => attempt.step_id === "save")!
        .outcome_certainty,
    ).toBe("unknown");
    const beforeReconcileFile = readFixtureFile(
      fixture,
      "reports/notes-copy.txt",
    );
    const reconciliation = await engine.reconcile(run.run_id);
    expect(reconciliation.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step_id: "save",
          dispatch_marker: "present",
          receipt: "not_supported",
        }),
      ]),
    );
    expect(await engine.reconcile(run.run_id)).toEqual(reconciliation);
    expect(await engine.trace(run.run_id)).toEqual(trace);
    expect(readFixtureFile(fixture, "reports/notes-copy.txt")).toBe(
      beforeReconcileFile,
    );
    observations.E06 = {
      run_id: run.run_id,
      status: result.status,
      target_sha256: createHash("sha256")
        .update(readTargetBytes(fixture))
        .digest("hex"),
      marker_count: await markerCount(fixture, run.run_id),
      notifications: await notificationTexts(fixture, run.run_id),
      certainty: trace.attempts.map((attempt) => attempt.outcome_certainty),
      reconciliation_receipt: reconciliation.operations.find(
        (operation: any) => operation.step_id === "save",
      )?.receipt,
    };
    await expect(engine.execute(run.run_id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("E07 recovers a real child-process exit after the filesystem bytes commit", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const beforeMessages = await tableCount("hub_messages");
    const run = await engine.prepare(copyPlan);
    await engine.decide(run.run_id, decision(run));
    const child = await execFileAsync(
      process.execPath,
      [
        path.join(
          fixture.projectRoot,
          "packages/engine/tests/filesystem-crash-worker.mjs",
        ),
        fixture.databaseUrl,
        fixture.userId,
        run.run_id,
        fixture.projectRoot,
        fixture.allowedRoot,
      ],
      { cwd: fixture.projectRoot, windowsHide: true, timeout: 30000 },
    ).then(
      () => ({ code: 0 }),
      (error: any) => ({ code: error.code }),
    );
    expect(child.code).toBe(86);
    expect(readFixtureFile(fixture, "reports/notes-copy.txt")).toBe(
      originalNotes,
    );
    expect(await markerRows(run.run_id)).toHaveLength(1);
    expect(await tableCount("hub_messages")).toBe(beforeMessages);
    expect((await engine.detail(run.run_id)).status).toBe("running");
    await expect(engine.recoverOrphans()).resolves.toContainEqual({
      run_id: run.run_id,
      status: "reconciliation_required",
    });
    const traceBeforeReconcile = await engine.trace(run.run_id);
    const reconciliation = await engine.reconcile(run.run_id);
    expect(reconciliation.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step_id: "save",
          dispatch_marker: "present",
          receipt: "not_supported",
        }),
      ]),
    );
    expect(await engine.reconcile(run.run_id)).toEqual(reconciliation);
    expect(await engine.trace(run.run_id)).toEqual(traceBeforeReconcile);
    observations.E07 = {
      run_id: run.run_id,
      child_exit_code: child.code,
      target_sha256: createHash("sha256")
        .update(readTargetBytes(fixture))
        .digest("hex"),
      marker_count: await markerCount(fixture, run.run_id),
      notifications: await notificationTexts(fixture, run.run_id),
      reconciliation_receipt: reconciliation.operations.find(
        (operation: any) => operation.step_id === "save",
      )?.receipt,
    };
  });

  it("E08 recovers a crash after durable filesystem reservation and before write dispatch", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const run = await engine.prepare(copyPlan);
    await engine.decide(run.run_id, decision(run));
    const child = await execFileAsync(
      process.execPath,
      [
        path.join(
          fixture.projectRoot,
          "packages/engine/tests/filesystem-marker-crash-worker.mjs",
        ),
        fixture.databaseUrl,
        fixture.userId,
        run.run_id,
        fixture.projectRoot,
        fixture.allowedRoot,
      ],
      { cwd: fixture.projectRoot, windowsHide: true, timeout: 30000 },
    ).then(
      () => ({ code: 0 }),
      (error: any) => ({ code: error.code }),
    );
    expect(child.code).toBe(87);
    expect(fixtureFileExists(fixture, "reports/notes-copy.txt")).toBe(false);
    expect(await markerCount(fixture, run.run_id)).toBe(1);
    expect(await notificationTexts(fixture, run.run_id)).toEqual([]);
    await expect(engine.recoverOrphans()).resolves.toContainEqual({
      run_id: run.run_id,
      status: "reconciliation_required",
    });
    const trace = TraceSchema.parse(await engine.trace(run.run_id));
    const saveAttempts = trace.attempts.filter(
      (attempt) => attempt.step_id === "save",
    );
    expect(saveAttempts).toHaveLength(1);
    expect(saveAttempts[0]!.outcome_certainty).toBe("unknown");
    const first = await engine.reconcile(run.run_id);
    expect(first.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step_id: "save",
          dispatch_marker: "present",
          receipt: "not_supported",
        }),
      ]),
    );
    expect(await engine.reconcile(run.run_id)).toEqual(first);
    await expect(engine.execute(run.run_id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    observations.E08 = {
      run_id: run.run_id,
      child_exit_code: child.code,
      marker_count: await markerCount(fixture, run.run_id),
      notifications: await notificationTexts(fixture, run.run_id),
      certainty: trace.attempts.map((attempt) => attempt.outcome_certainty),
      reconciliation_receipt: first.operations.find(
        (operation: any) => operation.step_id === "save",
      )?.receipt,
    };
  });

  it.each(["is_error", "malformed_ack"])(
    "E10 treats post-dispatch raw %s filesystem write output as unknown and does not notify or retry",
    async (mode) => {
      const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
      const run = await engine.prepare(copyPlan);
      await engine.decide(run.run_id, decision(run));
      const child = await execFileAsync(
        process.execPath,
        [
          path.join(
            fixture.projectRoot,
            "packages/engine/tests/filesystem-raw-fault-worker.mjs",
          ),
          mode,
          fixture.databaseUrl,
          fixture.userId,
          run.run_id,
          fixture.projectRoot,
          fixture.allowedRoot,
        ],
        { cwd: fixture.projectRoot, windowsHide: true, timeout: 30000 },
      );
      const result = JSON.parse(child.stdout.trim());
      expect(result).toEqual({
        status: "reconciliation_required",
        injected_write_calls: 1,
      });
      expect(readFixtureFile(fixture, "reports/notes-copy.txt")).toBe(
        originalNotes,
      );
      expect(await markerCount(fixture, run.run_id)).toBe(1);
      expect(await notificationTexts(fixture, run.run_id)).toEqual([]);
      const trace = TraceSchema.parse(await engine.trace(run.run_id));
      const saveAttempts = trace.attempts.filter(
        (attempt) => attempt.step_id === "save",
      );
      expect(saveAttempts).toHaveLength(1);
      expect(saveAttempts[0]!.outcome_certainty).toBe("unknown");
      const first = await engine.reconcile(run.run_id);
      expect(first.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            step_id: "save",
            dispatch_marker: "present",
            receipt: "not_supported",
          }),
        ]),
      );
      expect(await engine.reconcile(run.run_id)).toEqual(first);
      await expect(engine.execute(run.run_id)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      observations.E10 ??= [];
      (observations.E10 as Array<Record<string, unknown>>).push({
        mode,
        run_id: run.run_id,
        child_status: result.status,
        injected_write_calls: result.injected_write_calls,
        marker_count: await markerCount(fixture, run.run_id),
        notifications: await notificationTexts(fixture, run.run_id),
        certainty: trace.attempts.map((attempt) => attempt.outcome_certainty),
        reconciliation_receipt: first.operations.find(
          (operation: any) => operation.step_id === "save",
        )?.receipt,
      });
    },
  );

  it("E09 expires the approval after the file commit and stops before notification", async () => {
    const real = gateway;
    const beforeMessages = await tableCount("hub_messages");
    let engine: WorkflowEngine;
    const expiring: Gateway = {
      ...real,
      async call(...args) {
        const response = await real.call(...args);
        if (args[0].server === "filesystem" && args[0].name === "write_file")
          await fixture.db
            .client`UPDATE approvals SET expires_at=clock_timestamp()-interval '1 second' WHERE run_id=${runId}`;
        return response;
      },
    };
    let runId = "";
    engine = new WorkflowEngine(fixture.db, expiring, fixture.userId);
    const run = await engine.prepare(copyPlan);
    runId = run.run_id;
    await engine.decide(run.run_id, decision(run));
    const result = await engine.execute(run.run_id);
    expect(result.status).toBe("expired");
    expect(readFixtureFile(fixture, "reports/notes-copy.txt")).toBe(
      originalNotes,
    );
    expect(await markerRows(run.run_id)).toHaveLength(1);
    expect(await tableCount("hub_messages")).toBe(beforeMessages);
  });

  it("E11 and E12 keep read-only runs mutation-free and allow an intentional new run", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const readOnly = WorkflowPlanSchema.parse({
      ...copyPlan,
      name: "Read-only notes",
      steps: [copyPlan.steps[0]],
      outputs: { text: "${steps.read.output.text}" },
    });
    const first = await engine.prepare(readOnly);
    expect(first.status).toBe("succeeded");
    expect(first.approval).toBeNull();
    expect(await markerRows(first.run_id)).toHaveLength(0);
    const second = await engine.prepare(copyPlan);
    await engine.decide(second.run_id, decision(second));
    expect((await engine.execute(second.run_id)).status).toBe("succeeded");
    expect(await markerRows(second.run_id)).toHaveLength(1);
    const third = await engine.prepare(copyPlan);
    await engine.decide(third.run_id, decision(third));
    expect((await engine.execute(third.run_id)).status).toBe("succeeded");
    expect(await markerRows(third.run_id)).toHaveLength(1);
    expect(third.approval!.actions[0]!.operation_id).not.toBe(
      second.approval!.actions[0]!.operation_id,
    );
  });

  it("E14 reads persisted task_hub snapshots without filesystem and rejects a stale in-memory catalog before writing", async () => {
    const legacy = await openLocalGateway({
      root: fixture.projectRoot,
      databaseUrl: fixture.databaseUrl,
      userId: fixture.userId,
    });
    try {
      expect(legacy.tools).toHaveLength(8);
      expect(legacy.tools.every((tool) => tool.server === "task_hub")).toBe(
        true,
      );
      const completedEngine = new WorkflowEngine(
        fixture.db,
        legacy,
        fixture.userId,
      );
      const completed = await completedEngine.prepare(makeMovePlan());
      await completedEngine.decide(completed.run_id, decision(completed));
      expect((await completedEngine.execute(completed.run_id)).status).toBe(
        "succeeded",
      );

      const inspector = new WorkflowEngine(
        fixture.db,
        undefined,
        fixture.userId,
      );
      expect((await inspector.detail(completed.run_id)).status).toBe(
        "succeeded",
      );
      const completedTrace = TraceSchema.parse(
        await inspector.trace(completed.run_id),
      );
      expect(completedTrace.attempts).toHaveLength(3);
      expect(
        completedTrace.attempts.every(
          (attempt) => attempt.outcome_certainty === "confirmed",
        ),
      ).toBe(true);
      const completedReconciliation = await inspector.reconcile(
        completed.run_id,
      );
      expect(completedReconciliation.operations).toHaveLength(2);
      expect(
        completedReconciliation.operations.every(
          (operation) => operation.receipt === "confirmed",
        ),
      ).toBe(true);

      const pending = await completedEngine.prepare(makeMovePlan());
      await completedEngine.decide(pending.run_id, decision(pending));
      const [beforeApproval] = await fixture.db
        .client`SELECT snapshot_hash FROM approvals WHERE run_id=${pending.run_id}`;
      const beforeReceipts = await tableCount("hub_receipts");
      const traceBeforeStaleExecution = await inspector.trace(pending.run_id);
      let staleCalls = 0;
      const staleGateway: Gateway = {
        userId: legacy.userId,
        get tools() {
          return legacy.tools.map((tool, index) =>
            index === 0
              ? { ...tool, artifactHash: "f".repeat(64) }
              : tool,
          );
        },
        assertCurrent: () => legacy.assertCurrent(),
        call: (...args) => {
          staleCalls++;
          return legacy.call(...args);
        },
        close: () => legacy.close(),
      };
      const staleEngine = new WorkflowEngine(
        fixture.db,
        staleGateway,
        fixture.userId,
      );
      await expect(staleEngine.execute(pending.run_id)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(staleCalls).toBe(0);
      const [afterApproval] = await fixture.db
        .client`SELECT snapshot_hash FROM approvals WHERE run_id=${pending.run_id}`;
      expect(afterApproval!.snapshot_hash).toBe(beforeApproval!.snapshot_hash);
      expect(await tableCount("hub_receipts")).toBe(beforeReceipts);
      expect((await inspector.detail(pending.run_id)).approval?.snapshot_hash).toBe(
        beforeApproval!.snapshot_hash,
      );
      expect(await inspector.trace(pending.run_id)).toEqual(
        traceBeforeStaleExecution,
      );
      const pendingReconciliation = await inspector.reconcile(pending.run_id);
      expect(pendingReconciliation.operations).toHaveLength(
        pending.approval!.actions.length,
      );
      expect(
        pendingReconciliation.operations.every(
          (operation) => operation.receipt === "not_observed",
        ),
      ).toBe(true);
      observations.E14 = {
        completed_run_id: completed.run_id,
        pending_run_id: pending.run_id,
        task_hub_tool_count: legacy.tools.length,
        completed_attempt_certainty: completedTrace.attempts.map(
          (attempt) => attempt.outcome_certainty,
        ),
        completed_receipts: completedReconciliation.operations.map(
          (operation) => operation.receipt,
        ),
        stale_execute: "CONFLICT",
        snapshot_hash_preserved: afterApproval!.snapshot_hash,
        hub_receipts_before_and_after: beforeReceipts,
      };
    } finally {
      await legacy.close();
    }
  });

  it("E13 drives the real built CLI through prepare, approve, execute, trace, and reconcile", async () => {
    const cliFixture = await makeFilesystemFixture(randomUUID());
    const runtimeRoot = path.join(
      cliFixture.projectRoot,
      "runtime",
      "filesystem",
      cliFixture.userId,
    );
    fs.mkdirSync(path.join(runtimeRoot, "reports"), { recursive: true });
    fs.copyFileSync(
      path.join(cliFixture.allowedRoot, ".ati-root.json"),
      path.join(runtimeRoot, ".ati-root.json"),
    );
    fs.copyFileSync(
      path.join(cliFixture.allowedRoot, "notes.txt"),
      path.join(runtimeRoot, "notes.txt"),
    );
    const planPath = path.join(
      cliFixture.projectRoot,
      "testdata/dev-hand-plans/fs-copy-notify.json",
    );
    try {
      const prepared = await cli(cliFixture, "prepare", planPath);
      expect(prepared.status).toBe("awaiting_approval");
      const approval = prepared.approval;
      await cli(
        cliFixture,
        "approve",
        prepared.run_id,
        approval.id,
        prepared.workflow_version_id,
        approval.snapshot_hash,
      );
      expect((await cli(cliFixture, "execute", prepared.run_id)).status).toBe(
        "succeeded",
      );
      expect(
        fs.readFileSync(
          path.join(runtimeRoot, "reports/notes-copy.txt"),
          "utf8",
        ),
      ).toBe(originalNotes);
      expect(
        (await cli(cliFixture, "trace", prepared.run_id)).attempts,
      ).toHaveLength(3);
      expect(
        (await cli(cliFixture, "reconcile", prepared.run_id)).operations,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            step_id: "save",
            dispatch_marker: "present",
            receipt: "not_supported",
          }),
        ]),
      );
      observations.E13 = {
        run_id: prepared.run_id,
        principal: cliFixture.userId,
        target_sha256: createHash("sha256")
          .update(
            fs.readFileSync(path.join(runtimeRoot, "reports/notes-copy.txt")),
          )
          .digest("hex"),
        commands: ["prepare", "approve", "execute", "trace", "reconcile"],
      };
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
      await cliFixture.close();
    }
  });
});
