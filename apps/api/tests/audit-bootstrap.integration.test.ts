import { expect, it } from "vitest";
import { WorkflowEngine, openLocalGateway } from "@wap/engine";
import { makeApiFixture } from "./fixture.js";
import { loadDevPlanner } from "../src/dev-planner.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

it("executes previously approved work even when new planning is disabled", async () => {
  const f = await makeApiFixture({
    plannerMode: "disabled",
    workerEnabled: true,
  });
  const root = path.resolve(
    fileURLToPath(new URL("../../../", import.meta.url)),
  );
  const gateway = await openLocalGateway({
    root,
    databaseUrl: f.databaseUrl,
    userId: f.userId,
  });
  const engine = new WorkflowEngine(f.db, gateway, f.userId);
  try {
    const planner = loadDevPlanner(root);
    // Manual entry represents an existing preview; no disabled POST creates new work.
    const produced = await planner.produce({
      runId: "11111111-1111-4111-8111-111111111111",
      userId: f.userId,
      request: {
        source_prompt: planner.b02Prompt,
        inputs: {},
        time_zone: "Asia/Ho_Chi_Minh",
      },
      runtime: {},
    });
    if (produced.kind !== "plan") throw new Error("Expected fixture plan");
    const detail = await engine.prepare(produced.plan);
    const a = detail.approval!;
    const token = await f.login();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    expect(
      (
        await f.call("/runs", {
          method: "POST",
          headers,
          body: JSON.stringify({ source_prompt: planner.b02Prompt }),
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await f.call(`/runs/${detail.run_id}/approval`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            approval_id: a.id,
            workflow_version_id: a.workflow_version_id,
            snapshot_hash: a.snapshot_hash,
            decision: "approved",
          }),
        })
      ).status,
    ).toBe(200);
    const end = Date.now() + 3000;
    let status = "running";
    while (Date.now() < end) {
      status = (await engine.detail(detail.run_id)).status;
      if (status === "succeeded") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(status).toBe("succeeded");
    expect(
      (await f.db.client`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n,
    ).toBe(2);
  } finally {
    await gateway.close();
    await f.close();
  }
}, 15000);
