import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { WorkflowPlanSchema } from "@wap/dsl";
import { openLocalGateway, WorkflowEngine, type Gateway } from "../src/index.js";
import { makeFilesystemFixture } from "./filesystem-fixture.js";

let fixture: Awaited<ReturnType<typeof makeFilesystemFixture>>;
let gateway: Gateway;

const writePlan = WorkflowPlanSchema.parse({
  version: "1.0",
  name: "Write filesystem demo",
  source_prompt: "Ghi báo cáo FS-04 vào root filesystem demo.",
  inputs: {},
  steps: [
    {
      id: "write",
      description: "Write report",
      tool: {
        server: "filesystem",
        name: "write_file",
        args: { path: "reports/fs04.txt", content: "Nội dung FS-04\n" },
      },
      depends_on: [],
      condition: null,
      retry: { max_attempts: 1, backoff: "exponential", initial_delay_ms: 0 },
      idempotency_key: "${runtime.run_id}_write",
      side_effect: "write",
      on_error: "fail",
      timeout_ms: 30000,
    },
  ],
  outputs: { path: "${steps.write.output.path}" },
});

const decision = (run: any) => ({
  approval_id: run.approval.id,
  workflow_version_id: run.workflow_version_id,
  snapshot_hash: run.approval.snapshot_hash,
  decision: "approved",
});

beforeAll(async () => {
  fixture = await makeFilesystemFixture();
  gateway = await openLocalGateway(fixture.gatewayConfig);
});

afterAll(async () => {
  await gateway?.close();
  await fixture?.close();
});

describe("approved filesystem write adapter", () => {
  it("publishes the reviewed write tool only after the FS-04 guard is active", () => {
    expect(gateway.tools).toHaveLength(10);
    expect(gateway.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          server: "filesystem",
          name: "write_file",
          sideEffect: "write",
          policyVersion: "b-local-fs-1",
        }),
      ]),
    );
  });

  it("writes exact UTF-8 bytes after approval and records a dispatch marker, not a hub receipt", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const run = await engine.prepare(writePlan);
    expect(run.status).toBe("awaiting_approval");
    await engine.decide(run.run_id, decision(run));
    const finished = await engine.execute(run.run_id);
    expect(finished.status).toBe("succeeded");
    expect(readFileSync(`${fixture.allowedRoot}/reports/fs04.txt`, "utf8")).toBe(
      "Nội dung FS-04\n",
    );
    const markers = await fixture.db.client`
      SELECT operation_id,relative_path,content_sha256,launch_hash
      FROM filesystem_dispatches
      WHERE user_id=${fixture.userId} AND run_id=${run.run_id}`;
    expect(markers).toHaveLength(1);
    expect(markers[0]!.relative_path).toBe("reports/fs04.txt");
    expect(
      await fixture.db.client`SELECT * FROM hub_receipts WHERE user_id=${fixture.userId} AND operation_id=${markers[0]!.operation_id}`,
    ).toHaveLength(0);
    await expect(engine.reconcile(run.run_id)).resolves.toMatchObject({
      operations: [
        expect.objectContaining({
          receiver_mode: "non_idempotent",
          receipt: "not_supported",
          dispatch_marker: "present",
          result: null,
        }),
      ],
    });
    await expect(engine.execute(run.run_id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await fixture.db.client`SELECT operation_id FROM filesystem_dispatches WHERE user_id=${fixture.userId} AND run_id=${run.run_id}`,
    ).toHaveLength(1);
  });

  it("rejects a direct write without approval metadata before creating a marker", async () => {
    await expect(
      gateway.call(
        { server: "filesystem", name: "write_file" },
        { path: "reports/forged.txt", content: "forged\n" },
        undefined,
        30000,
      ),
    ).rejects.toMatchObject({ code: "BEFORE_DISPATCH" });
    expect(
      await fixture.db.client`SELECT * FROM filesystem_dispatches WHERE user_id=${fixture.userId} AND relative_path='reports/forged.txt'`,
    ).toHaveLength(0);
    expect(() => readFileSync(`${fixture.allowedRoot}/reports/forged.txt`, "utf8")).toThrow();
  });

  it("does not write after the approved operation payload is changed", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const run = await engine.prepare(writePlan);
    await engine.decide(run.run_id, decision(run));
    const operationId = run.approval!.actions[0]!.operation_id;
    await fixture.db.client`
      UPDATE tool_operations
      SET resolved_args=${fixture.db.client.json({ path: "reports/changed.txt", content: "changed\n" })}
      WHERE operation_id=${operationId}`;
    expect((await engine.execute(run.run_id)).status).toBe("failed");
    expect(
      await fixture.db.client`SELECT * FROM filesystem_dispatches WHERE operation_id=${operationId}`,
    ).toHaveLength(0);
    expect(readFileSync(`${fixture.allowedRoot}/reports/fs04.txt`, "utf8")).toBe("Nội dung FS-04\n");
    expect(() => readFileSync(`${fixture.allowedRoot}/reports/changed.txt`, "utf8")).toThrow();
  });

  it("reserves two approved writes independently under one snapshot", async () => {
    const templateStep = writePlan.steps[0]!;
    const plan = WorkflowPlanSchema.parse({
      ...writePlan,
      name: "Write two filesystem files",
      steps: [
        { ...templateStep, id: "first", tool: { ...templateStep.tool, args: { path: "reports/first.txt", content: "first\n" } }, idempotency_key: "${runtime.run_id}_first" },
        { ...templateStep, id: "second", tool: { ...templateStep.tool, args: { path: "reports/second.txt", content: "second\n" } }, idempotency_key: "${runtime.run_id}_second" },
      ],
      outputs: {},
    });
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const run = await engine.prepare(plan);
    await engine.decide(run.run_id, decision(run));
    expect((await engine.execute(run.run_id)).status).toBe("succeeded");
    expect(readFileSync(`${fixture.allowedRoot}/reports/first.txt`, "utf8")).toBe("first\n");
    expect(readFileSync(`${fixture.allowedRoot}/reports/second.txt`, "utf8")).toBe("second\n");
    expect(
      await fixture.db.client`SELECT operation_id FROM filesystem_dispatches WHERE user_id=${fixture.userId} AND run_id=${run.run_id}`,
    ).toHaveLength(2);
  });
});
