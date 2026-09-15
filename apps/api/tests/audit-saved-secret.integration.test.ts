import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WorkflowEngine, openLocalGateway, type Gateway } from "@wap/engine";
import { makeApiFixture } from "./fixture.js";

const projectRoot = path.resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);

function savedSecretPlan(secret: string) {
  return {
    version: "1.0",
    name: "Saved secret regression",
    source_prompt: "Send one local task hub notification.",
    steps: [
      {
        id: "notify",
        description: "Notify the local team channel",
        tool: {
          server: "task_hub",
          name: "send_slack_message",
          args: {
            channel: "#team",
            text: `Public prefix ${secret} public suffix`,
          },
        },
        side_effect: "write",
        depends_on: [],
        idempotency_key: "${runtime.run_id}_notify",
      },
    ],
    outputs: {},
  };
}

function decision(
  run: Awaited<ReturnType<WorkflowEngine["prepare"]>>,
  value: "approved" | "rejected",
) {
  return {
    approval_id: run.approval!.id,
    workflow_version_id: run.approval!.workflow_version_id,
    snapshot_hash: run.approval!.snapshot_hash,
    decision: value,
  };
}

async function receiverCounts(
  fixture: Awaited<ReturnType<typeof makeApiFixture>>,
) {
  return fixture.db.client`
    SELECT
      (SELECT count(*)::int FROM hub_messages WHERE user_id=${fixture.userId}) AS messages,
      (SELECT count(*)::int FROM hub_receipts WHERE user_id=${fixture.userId}) AS receipts`;
}

async function savedApproval(
  fixture: Awaited<ReturnType<typeof makeApiFixture>>,
  runId: string,
) {
  return fixture.db.client`
    SELECT snapshot_hash,preview::text AS preview
    FROM approvals
    WHERE run_id=${runId}`;
}

async function openGateway(
  fixture: Awaited<ReturnType<typeof makeApiFixture>>,
): Promise<Gateway> {
  return openLocalGateway({
    root: projectRoot,
    databaseUrl: fixture.databaseUrl,
    userId: fixture.userId,
  });
}

describe("saved preview configured-secret guard", () => {
  it("blocks approval after a preview value becomes protected but still permits rejection", async () => {
    const fixture = await makeApiFixture();
    let gateway: Gateway | undefined;
    try {
      gateway = await openGateway(fixture);
      const secret = `saved-secret-${crypto.randomUUID()}`;
      const oldEngine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
      const run = await oldEngine.prepare(savedSecretPlan(secret));
      const snapshotBefore = await savedApproval(fixture, run.run_id);
      const receiverBefore = await receiverCounts(fixture);
      const guardedEngine = new WorkflowEngine(
        fixture.db,
        gateway,
        fixture.userId,
        { secrets: [secret] },
      );

      await expect(
        guardedEngine.decide(run.run_id, decision(run, "approved")),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Saved preview contains protected configuration data",
      });
      expect(await guardedEngine.detail(run.run_id)).toMatchObject({
        status: "awaiting_approval",
        approval: { decision: "pending" },
      });
      expect(await savedApproval(fixture, run.run_id)).toEqual(snapshotBefore);
      expect(await receiverCounts(fixture)).toEqual(receiverBefore);

      await guardedEngine.decide(run.run_id, decision(run, "rejected"));
      expect(await guardedEngine.detail(run.run_id)).toMatchObject({
        status: "rejected",
        approval: { decision: "rejected" },
      });
      expect(await savedApproval(fixture, run.run_id)).toEqual(snapshotBefore);
      expect(await receiverCounts(fixture)).toEqual(receiverBefore);
    } finally {
      await gateway?.close();
      await fixture.close();
    }
  }, 45_000);

  it("blocks an already-approved saved preview before execute reaches the receiver", async () => {
    const fixture = await makeApiFixture();
    let gateway: Gateway | undefined;
    try {
      gateway = await openGateway(fixture);
      const secret = `saved-secret-${crypto.randomUUID()}`;
      const oldEngine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
      const run = await oldEngine.prepare(savedSecretPlan(secret));
      await oldEngine.decide(run.run_id, decision(run, "approved"));
      const snapshotBefore = await savedApproval(fixture, run.run_id);
      const receiverBefore = await receiverCounts(fixture);
      const guardedEngine = new WorkflowEngine(
        fixture.db,
        gateway,
        fixture.userId,
        { secrets: [secret] },
      );

      await expect(guardedEngine.execute(run.run_id)).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Saved preview contains protected configuration data",
      });

      expect(await guardedEngine.detail(run.run_id)).toMatchObject({
        status: "running",
        approval: { decision: "approved" },
      });
      expect(
        await fixture.db.client`
          SELECT claimed_by,delivered_at
          FROM runs
          JOIN run_outbox ON run_outbox.run_id=runs.id
          WHERE runs.id=${run.run_id} AND job_kind='execute'`,
      ).toEqual([{ claimed_by: null, delivered_at: null }]);
      expect(await savedApproval(fixture, run.run_id)).toEqual(snapshotBefore);
      expect(await receiverCounts(fixture)).toEqual(receiverBefore);
    } finally {
      await gateway?.close();
      await fixture.close();
    }
  }, 45_000);
});
