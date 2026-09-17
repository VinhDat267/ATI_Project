import { expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

it("finishes an explicit planner refusal without creating a version or write", async () => {
  const f = await makeApiFixture({
    plannerMode: "dev_fixture",
    workerEnabled: true,
    planner: {
      mode: "dev_fixture",
      async produce() {
        return { kind: "refusal", reason: "No reviewed tool supports this request" };
      },
    },
  });
  try {
    const token = await f.login();
    const created = await f.call("/runs", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ source_prompt: "unsupported reviewed request" }),
    });
    expect(created.status).toBe(202);
    const { run_id } = (await created.json()) as { run_id: string };
    const deadline = Date.now() + 15_000;
    let detail: Record<string, unknown> = {};
    while (Date.now() < deadline) {
      const response = await f.call(`/runs/${run_id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      detail = (await response.json()) as Record<string, unknown>;
      if (detail.status === "refused") break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    expect(detail).toMatchObject({
      status: "refused",
      workflow_version_id: null,
      approval: null,
      planner_result: { kind: "refusal" },
    });
    expect(
      await f.db.client`
        SELECT
          (SELECT count(*)::int
             FROM workflow_versions v
             JOIN runs r ON r.workflow_id=v.workflow_id
            WHERE r.id=${run_id}) AS versions,
          (SELECT count(*)::int FROM approvals WHERE run_id=${run_id}) AS approvals,
          (SELECT count(*)::int FROM tool_operations WHERE run_id=${run_id}) AS operations,
          (SELECT count(*)::int FROM hub_receipts WHERE user_id=${f.userId}) AS receipts`,
    ).toEqual([{ versions: 0, approvals: 0, operations: 0, receipts: 0 }]);
  } finally {
    await f.close();
  }
}, 30_000);

it("rolls back every admission record when durable outbox insert fails", async () => {
  const f = await makeApiFixture({ plannerMode: "dev_fixture" });
  try {
    const token = await f.login();
    await f.db.client.unsafe(
      `CREATE FUNCTION reject_audit_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected admission failure'; END; $$`,
    );
    await f.db.client.unsafe(
      "CREATE TRIGGER audit_outbox_failure BEFORE INSERT ON run_outbox FOR EACH ROW EXECUTE FUNCTION reject_audit_outbox()",
    );
    const response = await f.call("/runs", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ source_prompt: f.b02Prompt }),
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("injected admission failure");
    const [counts] = await f.db
      .client`SELECT (SELECT count(*)::int FROM workflows) AS workflows,(SELECT count(*)::int FROM runs) AS runs,(SELECT count(*)::int FROM run_events) AS events,(SELECT count(*)::int FROM run_outbox) AS jobs`;
    expect(counts).toEqual({ workflows: 0, runs: 0, events: 0, jobs: 0 });
  } finally {
    await f.close();
  }
});

it("finishes unknown demo input as needs_input and rejects a prepared plan without writes", async () => {
  const f = await makeApiFixture({
    plannerMode: "dev_fixture",
    workerEnabled: true,
  });
  try {
    const token = await f.login();
    const headers = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    async function create(prompt: string) {
      const created = await f.call("/runs", {
        method: "POST",
        headers,
        body: JSON.stringify({ source_prompt: prompt }),
      });
      expect(created.status).toBe(202);
      return ((await created.json()) as { run_id: string }).run_id;
    }
    async function wait(id: string, expected: string) {
      const end = Date.now() + 15000;
      while (Date.now() < end) {
        const response = await f.call(`/runs/${id}`, { headers });
        const detail = (await response.json()) as {
          status: string;
          approval: {
            id: string;
            workflow_version_id: string;
            snapshot_hash: string;
          } | null;
        };
        if (detail.status === expected) return detail;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      throw new Error(`Expected ${expected}`);
    }
    const unknown = await create("This is not an allowlisted demo prompt");
    await wait(unknown, "needs_input");
    expect((await f.engine.events(unknown)).events.at(-1)?.type).toBe(
      "run.finished",
    );
    const run = await create(f.b02Prompt);
    const prepared = await wait(run, "awaiting_approval");
    const a = prepared.approval!;
    const response = await f.call(`/runs/${run}/approval`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        approval_id: a.id,
        workflow_version_id: a.workflow_version_id,
        snapshot_hash: a.snapshot_hash,
        decision: "rejected",
      }),
    });
    expect(response.status).toBe(200);
    await wait(run, "rejected");
    expect((await f.engine.events(run)).events.at(-1)?.type).toBe(
      "run.finished",
    );
    expect(
      await f.db.client`SELECT count(*)::int AS n FROM hub_receipts`,
    ).toEqual([{ n: 0 }]);
    expect(
      await f.db
        .client`SELECT cells FROM hub_sheets WHERE workbook_id='dest' AND user_id=${f.userId}`,
    ).toEqual([{ cells: [] }]);
  } finally {
    await f.close();
  }
}, 30000);
