import { beforeAll, beforeEach, afterAll, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";
import { migrate, openDatabase, seedDemo, DEMO_USER_ID } from "@wap/db";
import { RunDetailSchema, TraceSchema, EventPageSchema } from "@wap/dsl";
import * as implementation from "../src/index.js";
import {
  makeMovePlan,
  makeCreatePlan,
  makeMembersPlan,
} from "./task-hub-plans.js";
const api = implementation as Record<string, any>;
const root = fileURLToPath(new URL("../../../", import.meta.url));
const plan = JSON.parse(
  readFileSync(path.join(root, "testdata/test-cases.json"), "utf8"),
).cases.find((x: any) => x.id === "b02").expected_result.plan;
const dbName = "engine_it_" + randomUUID().replaceAll("-", "");
const adminUrl = "postgresql://wap:wap@127.0.0.1:55432/wap_g1";
const address = new URL(adminUrl);
address.pathname = "/" + dbName;
const url = address.href;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
let db: ReturnType<typeof openDatabase>,
  raw: ReturnType<typeof postgres>,
  gateway: any,
  engine: any;
const resources: any[] = [];
const evidence: Record<string, unknown> = {
  scope: "REAL_CONTROLLER_POSTGRESQL_MCP_NO_HTTP_UI_LLM",
};
beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await migrate(url);
  db = openDatabase(url);
  raw = db.client;
});
beforeEach(async () => {
  await raw.unsafe("TRUNCATE users CASCADE"); // Only the UUID database created by this suite.
  await seedDemo(db);
});
afterEach(async () => {
  for (const g of resources.splice(0)) await g.close();
});
afterAll(async () => {
  await db?.close();
  await admin.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  await admin.end();
  if (evidence.b02 || evidence.card_move) {
    // Dated evidence carries baseline SHA-256 hashes; unattended runs must not rewrite it.
    const defaultDir = path.join(root, "runtime/test-evidence");
    const requestedEvidence = process.env.ATI_EVIDENCE_DIR;
    const dir = requestedEvidence
      ? path.resolve(root, requestedEvidence)
      : defaultDir;
    if (requestedEvidence) {
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
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "controller-observations.json"),
      JSON.stringify(
        { ...evidence, recorded_at: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
  }
});
async function start(userId = DEMO_USER_ID) {
  expect(api.WorkflowEngine).toBeTypeOf("function");
  expect(api.openLocalGateway).toBeTypeOf("function");
  const g = await api.openLocalGateway({ root, databaseUrl: url, userId });
  resources.push(g);
  return { gateway: g, engine: new api.WorkflowEngine(db, g, userId) };
}
async function prepared() {
  ({ gateway, engine } = await start());
  return engine.prepare(plan);
}
const decision = (r: any, choice = "approved") => ({
  approval_id: r.approval.id,
  workflow_version_id: r.workflow_version_id,
  snapshot_hash: r.approval.snapshot_hash,
  decision: choice,
});
async function count(table: "hub_receipts" | "hub_messages") {
  return (await raw.unsafe(`SELECT count(*)::int AS n FROM ${table}`))[0]!.n;
}

it("prepares one immutable approval for both writes without making any mutation", async () => {
  const run = await prepared();
  expect(RunDetailSchema.parse(run).status).toBe("awaiting_approval");
  expect(run.approval.actions).toHaveLength(2);
  expect(run.approval.decision).toBe("pending");
  expect(run.approval.actions[0].resolved_args.rows).toEqual([
    ["API", "Done"],
    ["UI", "Doing"],
  ]);
  expect(await count("hub_receipts")).toBe(0);
  expect(await count("hub_messages")).toBe(0);
  const preview = await engine.preview(run.run_id);
  expect(preview.read_outputs.read.row_count).toBe(2);
  const trace = TraceSchema.parse(await engine.trace(run.run_id));
  expect(trace.attempts).toHaveLength(1);
  expect(trace.attempts[0]!.evidence).toBe("complete");
});
it("runs b02 after one approval, preserving previewed source rows and complete trace", async () => {
  const run = await prepared();
  await raw`UPDATE hub_sheets SET cells='[["changed after preview"]]'::jsonb WHERE workbook_id='source'`;
  await engine.decide(run.run_id, decision(run));
  const finished = await engine.execute(run.run_id);
  expect(finished.status).toBe("succeeded");
  const [sheet] =
    await raw`SELECT cells FROM hub_sheets WHERE workbook_id='dest'`;
  expect(sheet!.cells).toEqual([
    ["API", "Done"],
    ["UI", "Doing"],
  ]);
  const msgs = await raw`SELECT channel,text FROM hub_messages`;
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toMatchObject({ channel: "#team", text: "Đã chép 2 dòng." });
  expect(await count("hub_receipts")).toBe(2);
  expect(
    await raw`SELECT * FROM approvals WHERE run_id=${run.run_id}`,
  ).toHaveLength(1);
  const trace = TraceSchema.parse(await engine.trace(run.run_id));
  expect(trace.attempts).toHaveLength(3);
  expect(
    trace.attempts.every(
      (a) =>
        a.evidence === "complete" &&
        a.outcome_certainty === "confirmed" &&
        a.ended_at,
    ),
  ).toBe(true);
  const events = EventPageSchema.parse(await engine.events(run.run_id));
  expect(events.events.map((e) => e.seq)).toEqual(
    Array.from({ length: events.events.length }, (_, i) => i + 1),
  );
  expect(events.events.at(-1)?.type).toBe("run.finished");
  await expect(engine.execute(run.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await count("hub_receipts")).toBe(2);
  evidence.b02 = {
    run: finished,
    preview: await engine.preview(run.run_id),
    trace,
    events,
    actual_rows: sheet!.cells,
    actual_messages: msgs,
    approvals: 1,
    receipts: 2,
  };
});
it("rejects wrong owner, hash, version and duplicate approval decisions", async () => {
  const run = await prepared();
  const other = randomUUID();
  await seedDemo(db, other);
  const foreign = (await start(other)).engine;
  await expect(foreign.detail(run.run_id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(foreign.decide(run.run_id, decision(run))).rejects.toMatchObject(
    { code: "NOT_FOUND" },
  );
  await expect(
    engine.decide(run.run_id, {
      ...decision(run),
      snapshot_hash: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    engine.decide(run.run_id, {
      ...decision(run),
      workflow_version_id: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const attempts = await Promise.allSettled([
    engine.decide(run.run_id, decision(run)),
    engine.decide(run.run_id, decision(run)),
  ]);
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  expect(await count("hub_receipts")).toBe(0);
});
it("expires or rejects pending approval without dispatching writes", async () => {
  const run = await prepared();
  await raw`UPDATE approvals SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${run.approval.id}`;
  await expect(engine.decide(run.run_id, decision(run))).rejects.toMatchObject({
    code: "EXPIRED",
  });
  expect((await engine.detail(run.run_id)).status).toBe("expired");
  const next = await engine.prepare(plan);
  expect(
    (await engine.decide(next.run_id, decision(next, "rejected"))).status,
  ).toBe("rejected");
  await expect(engine.execute(next.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await count("hub_receipts")).toBe(0);
});
it("denies preview tampering and a forged read label before any write", async () => {
  const run = await prepared();
  await raw`UPDATE approvals SET preview=jsonb_set(preview,'{actions,0,resolved_args,rows}','[["tampered"]]'::jsonb) WHERE id=${run.approval.id}`;
  await expect(engine.decide(run.run_id, decision(run))).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const forged = structuredClone(plan);
  forged.steps[1].side_effect = "read";
  delete forged.steps[1].idempotency_key;
  await expect(engine.prepare(forged)).rejects.toMatchObject({
    code: "INVALID_PLAN",
  });
  expect(await count("hub_receipts")).toBe(0);
});
it("completes a read-only plan and skips a false write condition", async () => {
  ({ engine } = await start());
  const readOnly = {
    ...plan,
    steps: [plan.steps[0]],
    outputs: { rows: "${steps.read.output.row_count}" },
  };
  const read = await engine.prepare(readOnly);
  expect(read.status).toBe("succeeded");
  expect(read.approval).toBeNull();
  const conditional = structuredClone(plan);
  conditional.steps[1].condition = "${steps.read.output.row_count} == 0";
  conditional.steps[2].condition = "${steps.read.output.row_count} == 0";
  const skipped = await engine.prepare(conditional);
  expect(skipped.status).toBe("succeeded");
  expect(skipped.approval).toBeNull();
  expect(await count("hub_receipts")).toBe(0);
});
it("rejects reads downstream of writes because a single preview cannot preserve their ordering", async () => {
  ({ engine } = await start());
  const invalid = structuredClone(plan);
  invalid.steps.push({
    ...invalid.steps[0],
    id: "read_after_write",
    depends_on: ["append"],
  });
  await expect(engine.prepare(invalid)).rejects.toMatchObject({
    code: "INVALID_PLAN",
  });
});
it.each(["separate", "shared"])(
  "claims an approved run only once under concurrent %s workers",
  async (mode) => {
    const run = await prepared();
    await engine.decide(run.run_id, decision(run));
    const second = mode === "shared" ? engine : (await start()).engine;
    const outcomes = await Promise.allSettled([
      engine.execute(run.run_id),
      second.execute(run.run_id),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await count("hub_receipts")).toBe(2);
    expect(await count("hub_messages")).toBe(1);
  },
);
it("stops on a lost write response, then inspects the committed receipt without replaying", async () => {
  ({ gateway } = await start());
  let writeCalls = 0;
  const unreliable = {
    ...gateway,
    async call(...args: any[]) {
      const response = await gateway.call(...args);
      if (args[2]) {
        writeCalls++;
        throw new Error("injected response loss after receiver commit");
      }
      return response;
    },
  };
  engine = new api.WorkflowEngine(db, unreliable, DEMO_USER_ID);
  const run = await engine.prepare(plan);
  await engine.decide(run.run_id, decision(run));
  expect((await engine.execute(run.run_id)).status).toBe(
    "reconciliation_required",
  );
  expect(writeCalls).toBe(1);
  expect(await count("hub_receipts")).toBe(1);
  expect(await count("hub_messages")).toBe(0);
  const before = await engine.trace(run.run_id),
    reconciled = await engine.reconcile(run.run_id);
  expect(
    reconciled.operations.find((op: any) => op.step_id === "append"),
  ).toMatchObject({
    state: "unknown",
    receipt: "confirmed",
    result: { appended_count: 2 },
  });
  expect(await engine.trace(run.run_id)).toEqual(before);
  await expect(engine.execute(run.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(writeCalls).toBe(1);
  evidence.response_loss = {
    run_id: run.run_id,
    write_calls: writeCalls,
    reconciliation: reconciled,
    trace: before,
  };
  const inspector = new api.WorkflowEngine(db, undefined, DEMO_USER_ID);
  expect(await inspector.reconcile(run.run_id)).toEqual(reconciled);
});
it("bounds transient read retries and records each attempt before eventually succeeding", async () => {
  ({ gateway } = await start());
  let calls = 0;
  const flaky = {
    ...gateway,
    async call(...args: any[]) {
      calls++;
      if (calls < 3) throw new Error("injected transport failure before read");
      return gateway.call(...args);
    },
  };
  engine = new api.WorkflowEngine(db, flaky, DEMO_USER_ID);
  const readPlan = structuredClone(plan);
  readPlan.steps = [
    {
      ...readPlan.steps[0],
      retry: { max_attempts: 3, initial_delay_ms: 5, backoff: "exponential" },
    },
  ];
  const run = await engine.prepare(readPlan);
  expect(run.status).toBe("succeeded");
  expect(calls).toBe(3);
  const trace = TraceSchema.parse(await engine.trace(run.run_id));
  expect(trace.attempts).toHaveLength(3);
  expect(trace.attempts.map((a) => a.attempt_no)).toEqual([1, 2, 3]);
  const retryEvents = (await engine.events(run.run_id)).events.filter(
    (e: any) => e.type === "step.retrying",
  );
  expect(retryEvents.map((e: any) => e.payload.delay_ms)).toEqual([5, 10]);
});
it("honors cancellation after the current write without dispatching the next write", async () => {
  ({ gateway } = await start());
  let runId: string;
  const cancelling = {
    ...gateway,
    async call(...args: any[]) {
      const result = await gateway.call(...args);
      if (args[2]) await engine.cancel(runId);
      return result;
    },
  };
  engine = new api.WorkflowEngine(db, cancelling, DEMO_USER_ID);
  const run = await engine.prepare(plan);
  runId = run.run_id;
  await engine.decide(runId, decision(run));
  expect((await engine.execute(runId)).status).toBe("cancelled");
  expect(await count("hub_receipts")).toBe(1);
  expect(await count("hub_messages")).toBe(0);
  const events = (await engine.events(runId)).events;
  expect(events.at(-1).type).toBe("run.finished");
});
it("blocks changed tool policy after preview and after approval", async () => {
  const run = await prepared();
  const tools = structuredClone(gateway.tools);
  tools[0].policyVersion = "changed";
  const changed = new api.WorkflowEngine(
    db,
    { ...gateway, tools },
    DEMO_USER_ID,
  );
  await expect(changed.decide(run.run_id, decision(run))).rejects.toMatchObject(
    { code: "CONFLICT" },
  );
  await engine.decide(run.run_id, decision(run));
  await expect(changed.execute(run.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await count("hub_receipts")).toBe(0);
});
it("rolls back decision and status if durable execute-job insertion fails", async () => {
  const run = await prepared();
  const before = await engine.events(run.run_id);
  await raw.unsafe(
    `CREATE FUNCTION fail_execute_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.job_kind='execute' THEN RAISE EXCEPTION 'injected outbox failure'; END IF; RETURN NEW; END $$`,
  );
  await raw.unsafe(
    "CREATE TRIGGER fail_job BEFORE INSERT ON run_outbox FOR EACH ROW EXECUTE FUNCTION fail_execute_job()",
  );
  try {
    await expect(engine.decide(run.run_id, decision(run))).rejects.toThrow();
    expect((await engine.detail(run.run_id)).status).toBe("awaiting_approval");
    expect((await engine.detail(run.run_id)).approval.decision).toBe("pending");
    expect(await engine.events(run.run_id)).toEqual(before);
    expect(
      await raw`SELECT * FROM run_outbox WHERE run_id=${run.run_id} AND job_kind='execute'`,
    ).toHaveLength(0);
  } finally {
    await raw.unsafe("DROP TRIGGER fail_job ON run_outbox");
    await raw.unsafe("DROP FUNCTION fail_execute_job()");
  }
});
it.each(["read", "write"])(
  "closes the trace if a %s completion transaction fails after the MCP reply",
  async (kind) => {
    ({ gateway, engine } = await start());
    const run = kind === "write" ? await engine.prepare(plan) : undefined;
    if (run) await engine.decide(run.run_id, decision(run));
    await raw.unsafe("CREATE SEQUENCE completion_failure_counter");
    await raw.unsafe(
      `CREATE FUNCTION fail_completion_once() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL AND nextval('completion_failure_counter')=1 THEN RAISE EXCEPTION 'injected completion failure'; END IF; RETURN NEW; END $$`,
    );
    await raw.unsafe(
      "CREATE TRIGGER fail_completion BEFORE UPDATE ON step_attempts FOR EACH ROW EXECUTE FUNCTION fail_completion_once()",
    );
    try {
      const result = run
        ? await engine.execute(run.run_id)
        : await engine.prepare(plan);
      expect(result.status).toBe(
        kind === "write" ? "reconciliation_required" : "failed",
      );
      const trace = TraceSchema.parse(await engine.trace(result.run_id));
      expect(trace.attempts.every((attempt) => attempt.ended_at !== null)).toBe(
        true,
      );
      expect(trace.attempts.at(-1)?.outcome_certainty).toBe(
        kind === "write" ? "unknown" : "known_not_applied",
      );
      expect(
        await raw`SELECT 1 FROM step_states WHERE run_id=${result.run_id} AND status='running'`,
      ).toHaveLength(0);
      expect(await count("hub_receipts")).toBe(kind === "write" ? 1 : 0);
      expect(await count("hub_messages")).toBe(0);
      if (run)
        expect(
          (await engine.reconcile(run.run_id)).operations.find(
            (op: any) => op.step_id === "append",
          ).receipt,
        ).toBe("confirmed");
    } finally {
      await raw.unsafe("DROP TRIGGER fail_completion ON step_attempts");
      await raw.unsafe("DROP FUNCTION fail_completion_once()");
      await raw.unsafe("DROP SEQUENCE completion_failure_counter");
    }
  },
);
it("recovers an actual engine process exit after receiver commit without resuming the workflow", async () => {
  const run = await prepared();
  await engine.decide(run.run_id, decision(run));
  const result = await promisify(execFile)(
    process.execPath,
    [
      path.join(root, "packages/engine/tests/crash-worker.mjs"),
      url,
      DEMO_USER_ID,
      run.run_id,
      root,
    ],
    { windowsHide: true, timeout: 15000 },
  ).then(
    () => ({ code: 0 }),
    (error: { code: number }) => ({ code: error.code }),
  );
  expect(result.code).toBe(86);
  expect(await count("hub_receipts")).toBe(1);
  expect((await engine.detail(run.run_id)).status).toBe("running");
  const recovered = await engine.recoverOrphans();
  expect(recovered).toContainEqual({
    run_id: run.run_id,
    status: "reconciliation_required",
  });
  const inspection = await engine.reconcile(run.run_id);
  expect(
    inspection.operations.find((op: any) => op.step_id === "append").receipt,
  ).toBe("confirmed");
  expect(await count("hub_messages")).toBe(0);
  expect(await count("hub_receipts")).toBe(1);
  await expect(engine.execute(run.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  evidence.process_crash = {
    exit_code: result.code,
    recovered,
    inspection,
    trace: await engine.trace(run.run_id),
  };
});
it("exposes prepare, exact approval, execution and trace through separate CLI processes", async () => {
  const cli = async (command: string, ...args: string[]) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [path.join(root, "packages/engine/dist/cli.js"), command, ...args],
      {
        cwd: root,
        windowsHide: true,
        timeout: 15000,
        env: { ...process.env, G1_DATABASE_URL: url, G1_USER_ID: DEMO_USER_ID },
      },
    );
    return JSON.parse(stdout);
  };
  const run = await cli("prepare-b02");
  expect(run.status).toBe("awaiting_approval");
  expect(await count("hub_receipts")).toBe(0);
  const approval = run.approval;
  await cli(
    "approve",
    run.run_id,
    approval.id,
    run.workflow_version_id,
    approval.snapshot_hash,
  );
  expect((await cli("execute", run.run_id)).status).toBe("succeeded");
  expect(
    TraceSchema.parse(await cli("trace", run.run_id)).attempts,
  ).toHaveLength(3);
  expect(await count("hub_receipts")).toBe(2);
  expect(await count("hub_messages")).toBe(1);
});

function transactionHook(after: () => Promise<void>) {
  const client = new Proxy(raw, {
    get(target, key) {
      if (key === "begin")
        return async (...args: unknown[]) => {
          const result = await Reflect.apply(target.begin, target, args);
          await after();
          return result;
        };
      return Reflect.get(target, key);
    },
  });
  return { ...db, client };
}
it.each(["known_failed", "unknown"])(
  "keeps one terminal event when cancel races after a %s attempt",
  async (kind) => {
    ({ gateway } = await start());
    let runId: string | undefined,
      fired = false;
    const data = structuredClone(plan);
    if (kind === "known_failed")
      data.steps[1].tool.args.spreadsheet_id = "missing";
    const port =
      kind === "unknown"
        ? {
            ...gateway,
            async call(...args: any[]) {
              const result = await gateway.call(...args);
              if (args[2]) throw Error("response lost");
              return result;
            },
          }
        : gateway;
    const cancelling = new api.WorkflowEngine(db, undefined, DEMO_USER_ID);
    const hooked = transactionHook(async () => {
      if (!runId || fired) return;
      const op = (
        await raw`SELECT state FROM tool_operations WHERE run_id=${runId} AND step_id='append'`
      )[0];
      if (op?.state === kind) {
        fired = true;
        await cancelling.cancel(runId);
      }
    });
    engine = new api.WorkflowEngine(hooked, port, DEMO_USER_ID);
    const run = await engine.prepare(data);
    runId = run.run_id;
    await engine.decide(runId, decision(run));
    const result = await engine.execute(runId);
    expect(fired).toBe(true);
    expect(result.status).toBe(
      kind === "unknown" ? "reconciliation_required" : "cancelled",
    );
    const events = (await engine.events(runId)).events;
    expect(events.filter((e: any) => e.type === "run.finished")).toHaveLength(
      1,
    );
    expect(events.at(-1).type).toBe("run.finished");
  },
);
it("records known before-dispatch cancellation without inventing an uncertain write", async () => {
  ({ gateway } = await start());
  let runId: string | undefined,
    fired = false,
    writes = 0;
  const cancelling = new api.WorkflowEngine(db, undefined, DEMO_USER_ID);
  const hooked = transactionHook(async () => {
    if (!runId || fired) return;
    const op = (
      await raw`SELECT state FROM tool_operations WHERE run_id=${runId} AND step_id='append'`
    )[0];
    if (op?.state === "in_flight") {
      fired = true;
      await cancelling.cancel(runId);
    }
  });
  engine = new api.WorkflowEngine(
    hooked,
    {
      ...gateway,
      async call(...args: any[]) {
        if (args[2]) writes++;
        return gateway.call(...args);
      },
    },
    DEMO_USER_ID,
  );
  const run = await engine.prepare(plan);
  runId = run.run_id;
  await engine.decide(runId, decision(run));
  expect((await engine.execute(runId)).status).toBe("cancelled");
  expect(writes).toBe(0);
  expect(
    (
      await raw`SELECT state FROM tool_operations WHERE run_id=${runId!} AND step_id='append'`
    )[0]!.state,
  ).toBe("known_failed");
});
it("reports a conflict when operation and receipt policy drift away from the approved snapshot", async () => {
  ({ gateway } = await start());
  engine = new api.WorkflowEngine(
    db,
    {
      ...gateway,
      async call(...args: any[]) {
        const response = await gateway.call(...args);
        if (args[2]) throw Error("response lost");
        return response;
      },
    },
    DEMO_USER_ID,
  );
  const run = await engine.prepare(plan);
  await engine.decide(run.run_id, decision(run));
  await engine.execute(run.run_id);
  const op = run.approval.actions[0].operation_id;
  await raw`UPDATE tool_operations SET policy_version='changed' WHERE operation_id=${op}`;
  await raw`UPDATE hub_receipts SET policy_version='changed' WHERE operation_id=${op}`;
  expect(
    (await engine.reconcile(run.run_id)).operations.find(
      (x: any) => x.operation_id === op,
    ).receipt,
  ).toBe("conflict");
  await raw`UPDATE tool_operations SET policy_version='b-local-1',step_id='wrong-attribution' WHERE operation_id=${op}`;
  await raw`UPDATE hub_receipts SET policy_version='b-local-1' WHERE operation_id=${op}`;
  expect(
    (await engine.reconcile(run.run_id)).operations.find(
      (x: any) => x.operation_id === op,
    ).receipt,
  ).toBe("conflict");
});
it("does not append a skipped event when cancel wins after the unlocked preview status read", async () => {
  ({ gateway } = await start());
  let fired = false;
  const cancelling = new api.WorkflowEngine(db, undefined, DEMO_USER_ID);
  const client = new Proxy(raw, {
    apply(target, thisArg, args) {
      const query = Reflect.apply(target, thisArg, args);
      const text = Array.isArray(args[0]) ? args[0].join("") : "";
      if (/SELECT \* FROM runs/.test(text) && !/FOR UPDATE/.test(text))
        return Promise.resolve(query).then(async (rows: any) => {
          const r = rows[0];
          if (!fired && r?.status === "dry_running") {
            const read = (
              await raw`SELECT status FROM step_states WHERE run_id=${r.id} AND step_id='read'`
            )[0];
            if (read?.status === "succeeded") {
              fired = true;
              await cancelling.cancel(r.id);
            }
          }
          return rows;
        });
      return query;
    },
  });
  engine = new api.WorkflowEngine({ ...db, client }, gateway, DEMO_USER_ID);
  const data = structuredClone(plan);
  data.steps[1].condition = "${steps.read.output.row_count} == 0";
  data.steps[2].condition = "${steps.read.output.row_count} == 0";
  const run = await engine.prepare(data);
  expect(fired).toBe(true);
  expect(run.status).toBe("cancelled");
  const events = (await engine.events(run.run_id)).events;
  expect(events.at(-1).type).toBe("run.finished");
});
it("fences an old worker after its advisory-lock backend disconnects", async () => {
  ({ gateway } = await start());
  const other = (await start()).engine;
  let killed = false;
  const paused = {
    ...gateway,
    async call(...args: any[]) {
      if (args[2] && !killed) {
        killed = true;
        const [lease] =
          await raw`SELECT pid FROM pg_locks WHERE locktype='advisory' AND objid=638019814 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`;
        expect(lease).toBeDefined();
        await raw`SELECT pg_terminate_backend(${lease!.pid})`;
        const next = await other.prepare({ ...plan, steps: [plan.steps[0]] });
        expect(next.status).toBe("succeeded");
      }
      return gateway.call(...args);
    },
  };
  engine = new api.WorkflowEngine(db, paused, DEMO_USER_ID);
  const run = await engine.prepare(plan);
  await engine.decide(run.run_id, decision(run));
  await engine.execute(run.run_id).catch(() => undefined);
  expect(killed).toBe(true);
  expect(await count("hub_receipts")).toBe(0);
  expect(await count("hub_messages")).toBe(0);
});

it("[TH-03] [TH-06] [E06] propagates run timeZone America/New_York across MCP wire to filter R07 boundaries and preserves authorization metadata", async () => {
  ({ gateway, engine } = await start());

  await raw`UPDATE hub_cards SET updated_at = '2026-01-01T00:00:00Z' WHERE user_id=${DEMO_USER_ID}`;
  await raw`INSERT INTO hub_cards (user_id, card_id, board_id, list_name, title, updated_at) VALUES
    (${DEMO_USER_ID}, 'ny_below', 'board_a', 'Doing', 'NY Below', '2026-03-08T04:59:59.999Z'),
    (${DEMO_USER_ID}, 'ny_lower', 'board_a', 'Doing', 'NY Lower', '2026-03-08T05:00:00.000Z'),
    (${DEMO_USER_ID}, 'ny_upper_minus_1', 'board_a', 'Doing', 'NY Upper - 1', '2026-03-09T03:59:59.999Z'),
    (${DEMO_USER_ID}, 'ny_above', 'board_a', 'Doing', 'NY Above', '2026-03-09T04:00:00.000Z')`;

  const readPlan = {
    version: "1.0",
    name: "NY Boundary Read",
    source_prompt: "List cards on 2026-03-08 in America/New_York timezone",
    steps: [
      {
        id: "read_ny",
        description: "list_cards for NY DST day",
        tool: {
          server: "task_hub",
          name: "list_cards",
          args: {
            board_id: "board_a",
            list_name: "Doing",
            since: "2026-03-08",
            until: "2026-03-08",
          },
        },
        depends_on: [],
        side_effect: "read",
      },
    ],
    outputs: {
      cards: "${steps.read_ny.output.cards}",
    },
  };

  const run = await engine.prepare(readPlan, { timeZone: "America/New_York" });
  expect(run.status).toBe("succeeded");
  expect(run.time_zone).toBe("America/New_York");

  const [persistedRun] =
    await raw`SELECT time_zone FROM runs WHERE id=${run.run_id}`;
  expect(persistedRun!.time_zone).toBe("America/New_York");

  const trace = TraceSchema.parse(await engine.trace(run.run_id));
  expect(trace.attempts).toHaveLength(1);
  const result = trace.attempts[0]!.result as {
    cards: Array<{
      id: string;
      board_id: string;
      title: string;
      list_name: string;
    }>;
    count: number;
  };
  expect(result.cards.map((c) => c.id)).toEqual([
    "ny_lower",
    "ny_upper_minus_1",
  ]);
  expect(result.count).toBe(2);

  evidence.card_timezone = {
    run_id: run.run_id,
    time_zone: "America/New_York",
    target_date: "2026-03-08",
    cards_returned: result.cards.map((c) => c.id),
    count: result.count,
    boundary_fixtures: [
      { id: "ny_below", updated_at: "2026-03-08T04:59:59.999Z", in_window: false },
      { id: "ny_lower", updated_at: "2026-03-08T05:00:00.000Z", in_window: true },
      { id: "ny_upper_minus_1", updated_at: "2026-03-09T03:59:59.999Z", in_window: true },
      { id: "ny_above", updated_at: "2026-03-09T04:00:00.000Z", in_window: false },
    ],
    trace,
  };

  const writePlan = structuredClone(plan);
  const writeRun = await engine.prepare(writePlan, {
    timeZone: "America/New_York",
  });
  expect(writeRun.status).toBe("awaiting_approval");
  await engine.decide(writeRun.run_id, decision(writeRun));
  const executed = await engine.execute(writeRun.run_id);
  expect(executed.status).toBe("succeeded");
  expect(await count("hub_receipts")).toBe(2);
  expect(await count("hub_messages")).toBe(1);
});

it("[TH-06] [E01] runs makeMovePlan, preserving original source title in notification even if card title changes after preview", async () => {
  ({ gateway, engine } = await start());
  const run = await engine.prepare(makeMovePlan());
  expect(run.status).toBe("awaiting_approval");
  expect(run.approval.actions).toHaveLength(2);
  expect(
    (await raw`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`)[0]!.list_name,
  ).toBe("Doing");
  expect(await count("hub_receipts")).toBe(0);

  await raw`UPDATE hub_cards SET title='Changed after preview' WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`;
  await engine.decide(run.run_id, decision(run));
  const finished = await engine.execute(run.run_id);
  expect(finished.status).toBe("succeeded");
  expect(
    (await raw`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`)[0]!.list_name,
  ).toBe("Done");
  const msgs = await raw`SELECT text FROM hub_messages WHERE user_id=${DEMO_USER_ID}`;
  expect(msgs).toHaveLength(1);
  expect(msgs[0]!.text).toBe("Đã chuyển Viết API sang Done.");
  expect(await count("hub_receipts")).toBe(2);
  expect(await raw`SELECT id FROM approvals WHERE run_id=${run.run_id}`).toHaveLength(1);

  const trace = TraceSchema.parse(await engine.trace(run.run_id));
  expect(trace.attempts).toHaveLength(3);
  expect(trace.attempts.every((a: any) => a.ended_at && a.outcome_certainty === "confirmed")).toBe(true);

  const rawReceipts = await raw`SELECT * FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`;
  evidence.card_move = {
    run_id: run.run_id,
    card_id: "c1",
    initial_list: "Doing",
    final_list: "Done",
    notification_text: msgs[0]!.text,
    approvals_count: 1,
    receipts: rawReceipts,
    observed_messages: msgs,
    trace,
    status: finished.status,
    operations: run.approval.actions.map((a: any) => ({
      step_id: a.step_id,
      operation_id: a.operation_id,
      tool: a.tool,
    })),
  };
});

it("[TH-06] [E02] prepares makeCreatePlan(false) with no mutations, and creates exactly one extra card and receipt upon execution", async () => {
  ({ gateway, engine } = await start());
  const initialCards = await raw`SELECT card_id FROM hub_cards WHERE user_id=${DEMO_USER_ID}`;
  expect(initialCards).toHaveLength(2);
  const run = await engine.prepare(makeCreatePlan(false));
  expect(run.status).toBe("awaiting_approval");
  expect(run.approval.actions).toHaveLength(1);
  expect(await raw`SELECT card_id FROM hub_cards WHERE user_id=${DEMO_USER_ID}`).toHaveLength(2);
  expect(await count("hub_receipts")).toBe(0);

  await engine.decide(run.run_id, decision(run));
  const executed = await engine.execute(run.run_id);
  expect(executed.status).toBe("succeeded");

  const currentCards = await raw`SELECT card_id, title, list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID}`;
  expect(currentCards).toHaveLength(3);
  const newCard = currentCards.find((c: any) => !["c1", "c2"].includes(c.card_id));
  expect(newCard).toBeDefined();
  expect(newCard!.title).toBe("Docs");
  expect(newCard!.list_name).toBe("Backlog");
  expect(await count("hub_receipts")).toBe(1);

  const [receipt] = await raw`SELECT operation_id, result FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`;
  expect(receipt!.operation_id).toBe(run.approval.actions[0].operation_id);
  expect(receipt!.result).toEqual({ id: newCard!.card_id });

  const trace = TraceSchema.parse(await engine.trace(run.run_id));
  expect(trace.attempts).toHaveLength(1);
  expect(trace.attempts[0]!.outcome_certainty).toBe("confirmed");

  evidence.card_create = {
    run_id: run.run_id,
    created_card: newCard,
    receipt,
    trace,
    status: executed.status,
    operation_id: run.approval.actions[0].operation_id,
  };
});

it("[TH-06] [E03] runs makeMembersPlan to completion without approval, confirming active task counts", async () => {
  ({ gateway, engine } = await start());
  const run = await engine.prepare(makeMembersPlan());
  expect(run.status).toBe("succeeded");
  expect(run.approval).toBeNull();
  expect(await count("hub_receipts")).toBe(0);

  const trace = TraceSchema.parse(await engine.trace(run.run_id));
  expect(trace.attempts).toHaveLength(1);
  expect(trace.attempts[0]!.outcome_certainty).toBe("confirmed");

  expect(trace.attempts[0]!.result).toEqual({
    members: [
      { id: "m1", name: "An", task_count: 1 },
      { id: "m2", name: "Bình", task_count: 0 },
    ],
  });
  const finishedEvent = (await engine.events(run.run_id)).events.find(
    (e: any) => e.type === "run.finished",
  );
  expect(finishedEvent?.payload?.outputs?.members).toEqual([
    { id: "m1", name: "An", task_count: 1 },
    { id: "m2", name: "Bình", task_count: 0 },
  ]);
});

it("[TH-06] [E04] runs dev b03 with seeded c1 to notify Task: Viết API with one receipt", async () => {
  ({ gateway, engine } = await start());
  const b03Plan = JSON.parse(
    readFileSync(path.join(root, "testdata/test-cases.json"), "utf8"),
  ).cases.find((x: any) => x.id === "b03" && x.split === "dev").expected_result.plan;
  const run = await engine.prepare(b03Plan);
  expect(run.status).toBe("awaiting_approval");
  expect(run.approval.actions).toHaveLength(1);

  await engine.decide(run.run_id, decision(run));
  const executed = await engine.execute(run.run_id);
  expect(executed.status).toBe("succeeded");

  const msgs = await raw`SELECT channel, text FROM hub_messages WHERE user_id=${DEMO_USER_ID}`;
  expect(msgs).toHaveLength(1);
  expect(msgs[0]!.text).toBe("Task: Viết API");
  expect(await count("hub_receipts")).toBe(1);
});

it("[TH-06] [E05] runs dev b01 adapted to fixed dates (b01-fixed-window) with c1 in-window and c2 outside", async () => {
  ({ gateway, engine } = await start());
  const b01PlanRaw = JSON.parse(
    readFileSync(path.join(root, "testdata/test-cases.json"), "utf8"),
  ).cases.find((x: any) => x.id === "b01" && x.split === "dev").expected_result.plan;

  await raw`UPDATE hub_cards SET title='API', list_name='Done', updated_at='2026-09-14T02:00:00Z' WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`;
  await raw`UPDATE hub_cards SET updated_at='2026-09-25T00:00:00Z' WHERE user_id=${DEMO_USER_ID} AND card_id='c2'`;

  const b01FixedPlan = structuredClone(b01PlanRaw);
  b01FixedPlan.name = "b01-fixed-window";
  b01FixedPlan.steps[0].tool.args.since = "2026-09-14";
  b01FixedPlan.steps[0].tool.args.until = "2026-09-20";

  const run = await engine.prepare(b01FixedPlan);
  expect(run.status).toBe("succeeded");
  expect(run.approval).toBeNull();
  expect(await count("hub_receipts")).toBe(0);

  const trace = TraceSchema.parse(await engine.trace(run.run_id));
  expect(trace.attempts).toHaveLength(1);
  expect(trace.attempts[0]!.outcome_certainty).toBe("confirmed");
  expect(trace.attempts[0]!.result).toEqual({
    cards: [
      { id: "c1", board_id: "board_a", title: "API", list_name: "Done" },
    ],
    count: 1,
  });
  const finishedEvent = (await engine.events(run.run_id)).events.find(
    (e: any) => e.type === "run.finished",
  );
  expect(finishedEvent?.payload?.outputs?.cards).toEqual([
    { id: "c1", board_id: "board_a", title: "API", list_name: "Done" },
  ]);
});

it("[TH-06] [E07] rejects forged plans relabelling create_card or move_card as read before dispatch", async () => {
  ({ gateway, engine } = await start());
  const forgedCreate = {
    version: "1.0",
    name: "Forged Create",
    source_prompt: "Forged create as read",
    steps: [
      {
        id: "create",
        description: "Forged create",
        tool: {
          server: "task_hub",
          name: "create_card",
          args: { board_id: "board_a", list_name: "Backlog", title: "Docs" },
        },
        side_effect: "read",
        depends_on: [],
      },
    ],
    outputs: {},
  };
  await expect(engine.prepare(forgedCreate)).rejects.toMatchObject({
    code: "INVALID_PLAN",
  });

  const forgedMove = {
    version: "1.0",
    name: "Forged Move",
    source_prompt: "Forged move as read",
    steps: [
      {
        id: "move",
        description: "Forged move",
        tool: {
          server: "task_hub",
          name: "move_card",
          args: { card_id: "c1", target_list: "Done" },
        },
        side_effect: "read",
        depends_on: [],
      },
    ],
    outputs: {},
  };
  await expect(engine.prepare(forgedMove)).rejects.toMatchObject({
    code: "INVALID_PLAN",
  });

  expect(await count("hub_receipts")).toBe(0);
  expect(
    (await raw`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`)[0]!.list_name,
  ).toBe("Doing");
  expect(await raw`SELECT card_id FROM hub_cards WHERE user_id=${DEMO_USER_ID}`).toHaveLength(2);
});

it("[TH-06] [E08] rejects plans referencing create_card output in downstream move args under write-output-reference rule", async () => {
  ({ gateway, engine } = await start());
  const planWithWriteRef = {
    version: "1.0",
    name: "Create and move",
    source_prompt: "Create then move",
    steps: [
      {
        id: "create",
        description: "Create card",
        tool: {
          server: "task_hub",
          name: "create_card",
          args: { board_id: "board_a", list_name: "Backlog", title: "Docs" },
        },
        side_effect: "write",
        depends_on: [],
        idempotency_key: "${runtime.run_id}_create",
      },
      {
        id: "move",
        description: "Move card",
        tool: {
          server: "task_hub",
          name: "move_card",
          args: { card_id: "${steps.create.output.id}", target_list: "Done" },
        },
        side_effect: "write",
        depends_on: ["create"],
        idempotency_key: "${runtime.run_id}_move",
      },
    ],
    outputs: {},
  };
  await expect(engine.prepare(planWithWriteRef)).rejects.toMatchObject({
    code: "INVALID_PLAN",
  });
  expect(await count("hub_receipts")).toBe(0);
  expect(await raw`SELECT card_id FROM hub_cards WHERE user_id=${DEMO_USER_ID}`).toHaveLength(2);
});

it("[TH-06] [E09] enforces owner, hash, version, rejection, and expiry for card workflows without mutating state", async () => {
  ({ gateway, engine } = await start());
  const run = await engine.prepare(makeMovePlan());
  const other = randomUUID();
  await seedDemo(db, other);
  const foreign = (await start(other)).engine;
  await expect(foreign.detail(run.run_id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(foreign.decide(run.run_id, decision(run))).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    engine.decide(run.run_id, {
      ...decision(run),
      snapshot_hash: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    engine.decide(run.run_id, {
      ...decision(run),
      workflow_version_id: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });

  const rejectRun = await engine.prepare(makeMovePlan());
  await engine.decide(rejectRun.run_id, decision(rejectRun, "rejected"));
  expect((await engine.detail(rejectRun.run_id)).status).toBe("rejected");
  await expect(engine.execute(rejectRun.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });

  const expireRun = await engine.prepare(makeMovePlan());
  await raw`UPDATE approvals SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${expireRun.approval.id}`;
  await expect(
    engine.decide(expireRun.run_id, decision(expireRun)),
  ).rejects.toMatchObject({ code: "EXPIRED" });

  expect(
    (await raw`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`)[0]!.list_name,
  ).toBe("Doing");
  expect(await count("hub_receipts")).toBe(0);
});

it("[TH-06] [E10] [move] prevents duplicate execution races on same approved card move run", async () => {
  ({ gateway, engine } = await start());
  const engine2 = new api.WorkflowEngine(db, gateway, DEMO_USER_ID);
  const runMove = await engine.prepare(makeMovePlan());
  await engine.decide(runMove.run_id, decision(runMove));
  const resultsMove = await Promise.allSettled([
    engine.execute(runMove.run_id),
    engine2.execute(runMove.run_id),
  ]);
  const fulfilled = resultsMove.filter(
    (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled",
  );
  const rejected = resultsMove.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(fulfilled[0]!.value.status).toBe("succeeded");
  expect(["CONFLICT", "BUSY"]).toContain(rejected[0]!.reason.code);
  expect(
    (await raw`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`)[0]!.list_name,
  ).toBe("Done");
  expect(await count("hub_receipts")).toBe(2);
  expect(await count("hub_messages")).toBe(1);
  await expect(engine.execute(runMove.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await count("hub_receipts")).toBe(2);
  expect(await count("hub_messages")).toBe(1);
});

it("[TH-06] [E10] [create] prevents duplicate execution races on same approved card create run", async () => {
  ({ gateway, engine } = await start());
  const engine2 = new api.WorkflowEngine(db, gateway, DEMO_USER_ID);
  const runCreate = await engine.prepare(makeCreatePlan(true));
  await engine.decide(runCreate.run_id, decision(runCreate));
  const resultsCreate = await Promise.allSettled([
    engine.execute(runCreate.run_id),
    engine2.execute(runCreate.run_id),
  ]);
  const fulfilled = resultsCreate.filter(
    (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled",
  );
  const rejected = resultsCreate.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(fulfilled[0]!.value.status).toBe("succeeded");
  expect(["CONFLICT", "BUSY"]).toContain(rejected[0]!.reason.code);
  const docsCards = await raw`SELECT * FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND title='Docs'`;
  expect(docsCards).toHaveLength(1);
  expect(await count("hub_receipts")).toBe(2);
  expect(await count("hub_messages")).toBe(1);
  await expect(engine.execute(runCreate.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await count("hub_receipts")).toBe(2);
  expect(await count("hub_messages")).toBe(1);
  expect(await raw`SELECT * FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND title='Docs'`).toHaveLength(1);
});

it("[TH-06] [E11] [create] simulates lost response after real create commit: run reconciliation_required, receipt confirmed, trace unknown, reconcile preserves trace", async () => {
  ({ gateway } = await start());
  let authorizedCalls = 0;
  let lost = false;
  const lossy = {
    ...gateway,
    async call(...args: Parameters<typeof gateway.call>) {
      if (args[2]) authorizedCalls++;
      const response = await gateway.call(...args);
      if (args[2] && !response.isError && !lost) {
        lost = true;
        throw new Error("Injected response loss after commit");
      }
      return response;
    },
  };
  const worker = new api.WorkflowEngine(db, lossy, DEMO_USER_ID);
  const run = await worker.prepare(makeCreatePlan(true));
  await worker.decide(run.run_id, decision(run));
  const result = await worker.execute(run.run_id);
  expect(result.status).toBe("reconciliation_required");
  expect(authorizedCalls).toBe(1);

  // Verify DB state: card Docs was actually created by real receiver!
  const [card] = await raw`SELECT * FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND title='Docs'`;
  expect(card).toBeDefined();
  expect(await count("hub_receipts")).toBe(1);
  expect(await count("hub_messages")).toBe(0);

  const [receipt] = await raw`SELECT * FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`;
  expect(receipt!.operation_id).toBe(run.approval.actions[0].operation_id);
  expect(receipt!.result).toEqual({ id: card!.card_id });

  // Snapshot entire trace before reconcile
  const traceBefore = TraceSchema.parse(await worker.trace(run.run_id));
  expect(traceBefore.attempts).toHaveLength(1);
  const attemptBefore = traceBefore.attempts[0]!;
  expect(typeof attemptBefore.ended_at).toBe("string");
  expect(attemptBefore.ended_at).toBeTruthy();
  expect(attemptBefore.outcome_certainty).toBe("unknown");

  // Reconcile via inspector engine
  const inspector = new api.WorkflowEngine(db, undefined, DEMO_USER_ID);
  const rec = await inspector.reconcile(run.run_id);
  const op = rec.operations.find((o: any) => o.step_id === "create");
  expect(op).toBeDefined();
  expect(op!.receipt).toBe("confirmed");
  expect(op!.result).toEqual({ id: card!.card_id });

  // Deep equality of trace before and after reconcile
  const traceAfter = TraceSchema.parse(await inspector.trace(run.run_id));
  expect(traceAfter).toEqual(traceBefore);

  // Re-execution must reject with CONFLICT, no new notify/receipt, and trace unchanged
  await expect(worker.execute(run.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await count("hub_messages")).toBe(0);
  expect(await count("hub_receipts")).toBe(1);
  const traceAfterReExecute = TraceSchema.parse(await worker.trace(run.run_id));
  expect(traceAfterReExecute).toEqual(traceBefore);

  if (!evidence.card_response_loss) evidence.card_response_loss = {};
  (evidence.card_response_loss as any).create = {
    fault: "Injected response loss after commit on gateway.call for authorized write",
    run_id: run.run_id,
    status: result.status,
    authorized_calls: authorizedCalls,
    created_card: card,
    receipt,
    reconciled_operation: op,
    trace: traceAfter,
  };
});

it("[TH-06] [E11] [move] simulates lost response after real move commit: run reconciliation_required, receipt confirmed, trace unknown, reconcile preserves trace", async () => {
  ({ gateway } = await start());
  let authorizedCalls = 0;
  let lost = false;
  const lossy = {
    ...gateway,
    async call(...args: Parameters<typeof gateway.call>) {
      if (args[2]) authorizedCalls++;
      const response = await gateway.call(...args);
      if (args[2] && !response.isError && !lost) {
        lost = true;
        throw new Error("Injected response loss after commit");
      }
      return response;
    },
  };
  const worker = new api.WorkflowEngine(db, lossy, DEMO_USER_ID);
  const run = await worker.prepare(makeMovePlan());
  await worker.decide(run.run_id, decision(run));
  const result = await worker.execute(run.run_id);
  expect(result.status).toBe("reconciliation_required");
  expect(authorizedCalls).toBe(1);

  // Verify DB state: card c1 was actually moved to Done by real receiver!
  const [card] = await raw`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`;
  expect(card!.list_name).toBe("Done");
  expect(await count("hub_receipts")).toBe(1);
  expect(await count("hub_messages")).toBe(0);

  const moveAction = run.approval.actions.find((a: any) => a.step_id === "move")!;
  const [receipt] = await raw`SELECT * FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`;
  expect(receipt!.operation_id).toBe(moveAction.operation_id);
  expect(receipt!.result).toEqual({ id: "c1", list_name: "Done" });

  // Snapshot entire trace before reconcile
  const traceBefore = TraceSchema.parse(await worker.trace(run.run_id));
  const moveAttempt = traceBefore.attempts.find(
    (a: any) => a.operation_id === moveAction.operation_id,
  );
  expect(moveAttempt).toBeDefined();
  expect(typeof moveAttempt!.ended_at).toBe("string");
  expect(moveAttempt!.ended_at).toBeTruthy();
  expect(moveAttempt!.outcome_certainty).toBe("unknown");

  // Reconcile via inspector engine
  const inspector = new api.WorkflowEngine(db, undefined, DEMO_USER_ID);
  const rec = await inspector.reconcile(run.run_id);
  const op = rec.operations.find((o: any) => o.step_id === "move");
  expect(op).toBeDefined();
  expect(op!.receipt).toBe("confirmed");
  expect(op!.result).toEqual({ id: "c1", list_name: "Done" });

  // Deep equality of trace before and after reconcile
  const traceAfter = TraceSchema.parse(await inspector.trace(run.run_id));
  expect(traceAfter).toEqual(traceBefore);

  // Re-execution must reject with CONFLICT, no new notify/receipt, and trace unchanged
  await expect(worker.execute(run.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await count("hub_messages")).toBe(0);
  expect(await count("hub_receipts")).toBe(1);
  const traceAfterReExecute = TraceSchema.parse(await worker.trace(run.run_id));
  expect(traceAfterReExecute).toEqual(traceBefore);

  if (!evidence.card_response_loss) evidence.card_response_loss = {};
  (evidence.card_response_loss as any).move = {
    fault: "Injected response loss after commit on gateway.call for authorized write",
    run_id: run.run_id,
    status: result.status,
    authorized_calls: authorizedCalls,
    card_final_list: card!.list_name,
    receipt,
    reconciled_operation: op,
    trace: traceAfter,
  };
});

it("[TH-06] [E12] [create] recovers real process crash (exit code 86) after create receiver commit", async () => {
  ({ gateway, engine } = await start());
  const run = await engine.prepare(makeCreatePlan(true));
  await engine.decide(run.run_id, decision(run));
  const result = await promisify(execFile)(
    process.execPath,
    [
      path.join(root, "packages/engine/tests/crash-worker.mjs"),
      url,
      DEMO_USER_ID,
      run.run_id,
      root,
    ],
    { windowsHide: true, timeout: 15000 },
  ).then(
    () => ({ code: 0 }),
    (error: { code: number }) => ({ code: error.code }),
  );
  expect(result.code).toBe(86);
  expect(await count("hub_receipts")).toBe(1);
  expect(await count("hub_messages")).toBe(0);

  const [card] = await raw`SELECT * FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND title='Docs'`;
  expect(card).toBeDefined();
  const [receipt] = await raw`SELECT * FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`;
  expect(receipt!.operation_id).toBe(run.approval.actions[0].operation_id);
  expect(receipt!.result).toEqual({ id: card!.card_id });

  expect((await engine.detail(run.run_id)).status).toBe("running");

  const recovered = await engine.recoverOrphans();
  expect(recovered).toContainEqual({
    run_id: run.run_id,
    status: "reconciliation_required",
  });

  // Snapshot trace after recover
  const traceAfterRecover = TraceSchema.parse(await engine.trace(run.run_id));
  expect(traceAfterRecover.attempts).toHaveLength(1);
  const attempt = traceAfterRecover.attempts[0]!;
  expect(typeof attempt.ended_at).toBe("string");
  expect(attempt.ended_at).toBeTruthy();
  expect(attempt.outcome_certainty).toBe("unknown");

  const rec = await engine.reconcile(run.run_id);
  const op = rec.operations.find((o: any) => o.step_id === "create");
  expect(op!.receipt).toBe("confirmed");
  expect(op!.result).toEqual({ id: card!.card_id });

  // Trace stays identical through reconcile
  const traceAfterReconcile = TraceSchema.parse(await engine.trace(run.run_id));
  expect(traceAfterReconcile).toEqual(traceAfterRecover);

  // Execute again rejects with CONFLICT, and trace stays identical
  await expect(engine.execute(run.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const traceAfterReExecute = TraceSchema.parse(await engine.trace(run.run_id));
  expect(traceAfterReExecute).toEqual(traceAfterRecover);

  // Second recoverOrphans does nothing
  const secondRecover = await engine.recoverOrphans();
  expect(secondRecover.find((r: any) => r.run_id === run.run_id)).toBeUndefined();

  // Zero notify messages and receipts remain 1
  expect(await count("hub_messages")).toBe(0);
  expect(await count("hub_receipts")).toBe(1);

  if (!evidence.card_process_crash) evidence.card_process_crash = {};
  (evidence.card_process_crash as any).create = {
    fault: "Process crashed with exit code 86 after receiver commit",
    exit_code: 86,
    run_id: run.run_id,
    card,
    receipt,
    recovered_status: "reconciliation_required",
    reconciled_operation: op,
    trace: traceAfterReconcile,
  };
});

it("[TH-06] [E12] [move] recovers real process crash (exit code 86) after move receiver commit", async () => {
  ({ gateway, engine } = await start());
  const run = await engine.prepare(makeMovePlan());
  await engine.decide(run.run_id, decision(run));
  const result = await promisify(execFile)(
    process.execPath,
    [
      path.join(root, "packages/engine/tests/crash-worker.mjs"),
      url,
      DEMO_USER_ID,
      run.run_id,
      root,
    ],
    { windowsHide: true, timeout: 15000 },
  ).then(
    () => ({ code: 0 }),
    (error: { code: number }) => ({ code: error.code }),
  );
  expect(result.code).toBe(86);
  expect(await count("hub_receipts")).toBe(1);
  expect(await count("hub_messages")).toBe(0);

  const [card] = await raw`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`;
  expect(card!.list_name).toBe("Done");

  const moveAction = run.approval.actions.find((a: any) => a.step_id === "move")!;
  const [receipt] = await raw`SELECT * FROM hub_receipts WHERE user_id=${DEMO_USER_ID}`;
  expect(receipt!.operation_id).toBe(moveAction.operation_id);
  expect(receipt!.result).toEqual({ id: "c1", list_name: "Done" });

  expect((await engine.detail(run.run_id)).status).toBe("running");

  const recovered = await engine.recoverOrphans();
  expect(recovered).toContainEqual({
    run_id: run.run_id,
    status: "reconciliation_required",
  });

  // Snapshot trace after recover
  const traceAfterRecover = TraceSchema.parse(await engine.trace(run.run_id));
  const moveAttempt = traceAfterRecover.attempts.find(
    (a: any) => a.operation_id === moveAction.operation_id,
  );
  expect(moveAttempt).toBeDefined();
  expect(typeof moveAttempt!.ended_at).toBe("string");
  expect(moveAttempt!.ended_at).toBeTruthy();
  expect(moveAttempt!.outcome_certainty).toBe("unknown");

  const rec = await engine.reconcile(run.run_id);
  const op = rec.operations.find((o: any) => o.step_id === "move");
  expect(op!.receipt).toBe("confirmed");
  expect(op!.result).toEqual({ id: "c1", list_name: "Done" });

  // Trace stays identical through reconcile
  const traceAfterReconcile = TraceSchema.parse(await engine.trace(run.run_id));
  expect(traceAfterReconcile).toEqual(traceAfterRecover);

  // Execute again rejects with CONFLICT, and trace stays identical
  await expect(engine.execute(run.run_id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const traceAfterReExecute = TraceSchema.parse(await engine.trace(run.run_id));
  expect(traceAfterReExecute).toEqual(traceAfterRecover);

  // Second recoverOrphans does nothing
  const secondRecover = await engine.recoverOrphans();
  expect(secondRecover.find((r: any) => r.run_id === run.run_id)).toBeUndefined();

  // Zero notify messages and receipts remain 1
  expect(await count("hub_messages")).toBe(0);
  expect(await count("hub_receipts")).toBe(1);

  if (!evidence.card_process_crash) evidence.card_process_crash = {};
  (evidence.card_process_crash as any).move = {
    fault: "Process crashed with exit code 86 after receiver commit",
    exit_code: 86,
    run_id: run.run_id,
    card_id: "c1",
    final_list: "Done",
    receipt,
    recovered_status: "reconciliation_required",
    reconciled_operation: op,
    trace: traceAfterReconcile,
  };
});

it("[TH-06] [E13] exposes prepare th-move, exact approval, execution and trace through separate CLI processes", async () => {
  const cli = async (command: string, ...args: string[]) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [path.join(root, "packages/engine/dist/cli.js"), command, ...args],
      {
        cwd: root,
        windowsHide: true,
        timeout: 15000,
        env: { ...process.env, G1_DATABASE_URL: url, G1_USER_ID: DEMO_USER_ID },
      },
    );
    return JSON.parse(stdout);
  };
  const movePlanPath = path.join(root, "testdata/dev-hand-plans/th-move.json");
  const run = await cli("prepare", movePlanPath);
  expect(run.status).toBe("awaiting_approval");
  expect(run.approval.actions).toHaveLength(2);

  const preview = await cli("preview", run.run_id);
  expect(preview.actions).toHaveLength(2);

  // Mutate card title after preview to verify CLI execution uses immutable previewed title
  await raw`UPDATE hub_cards SET title='Changed after CLI preview' WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`;

  const approval = run.approval;
  await cli(
    "approve",
    run.run_id,
    approval.id,
    run.workflow_version_id,
    approval.snapshot_hash,
  );
  expect((await cli("execute", run.run_id)).status).toBe("succeeded");
  const trace = TraceSchema.parse(await cli("trace", run.run_id));
  expect(trace.attempts).toHaveLength(3);
  expect(
    trace.attempts.every((a: any) => a.ended_at && a.outcome_certainty === "confirmed"),
  ).toBe(true);

  // Real database outputs match E01; no fabricated approval row
  const [card] = await raw`SELECT list_name FROM hub_cards WHERE user_id=${DEMO_USER_ID} AND card_id='c1'`;
  expect(card!.list_name).toBe("Done");
  const msgs = await raw`SELECT text FROM hub_messages WHERE user_id=${DEMO_USER_ID}`;
  expect(msgs).toHaveLength(1);
  expect(msgs[0]!.text).toBe("Đã chuyển Viết API sang Done.");
  expect(await count("hub_receipts")).toBe(2);
});


