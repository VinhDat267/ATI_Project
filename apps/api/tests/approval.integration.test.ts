import { describe, expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

async function waitForApproval(
  fixture: Awaited<ReturnType<typeof makeApiFixture>>,
  token: string,
  runId: string,
) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await fixture.call(`/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as {
      status: string;
      approval?: {
        id: string;
        workflow_version_id: string;
        snapshot_hash: string;
      } | null;
    };
    if (body.status === "awaiting_approval") return body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("approval timeout");
}

describe("API-04 approval and execution", () => {
  it("accepts exactly one concurrent approval and executes through the outbox", async () => {
    const fixture = await makeApiFixture({
      plannerMode: "dev_fixture",
      workerEnabled: true,
    });
    try {
      const token = await fixture.login();
      const created = await fixture.call("/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ source_prompt: fixture.b02Prompt }),
      });
      expect(created.status).toBe(202);
      const { run_id } = (await created.json()) as { run_id: string };
      const prepared = await waitForApproval(fixture, token, run_id);
      const approval = prepared.approval!;
      const decision = {
        approval_id: approval.id,
        workflow_version_id: approval.workflow_version_id,
        snapshot_hash: approval.snapshot_hash,
        decision: "approved",
      };
      const stale = await fixture.call(`/runs/${run_id}/approval`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...decision,
          workflow_version_id: "00000000-0000-4000-8000-000000000099",
        }),
      });
      expect(stale.status).toBe(409);
      expect(
        await fixture.db.client`
          SELECT count(*)::int AS n FROM run_outbox
          WHERE run_id=${run_id} AND job_kind='execute'`,
      ).toEqual([{ n: 0 }]);
      const replies = await Promise.all([
        fixture.call(`/runs/${run_id}/approval`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(decision),
        }),
        fixture.call(`/runs/${run_id}/approval`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(decision),
        }),
      ]);
      expect(replies.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const deadline = Date.now() + 20_000;
      let terminal = "";
      while (Date.now() < deadline) {
        const response = await fixture.call(`/runs/${run_id}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const body = (await response.json()) as { status: string };
        terminal = body.status;
        if (
          ["succeeded", "failed", "reconciliation_required"].includes(terminal)
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      expect(terminal).toBe("succeeded");
      expect(
        await fixture.db
          .client`SELECT count(*)::int AS n FROM run_outbox WHERE run_id=${run_id} AND job_kind='execute'`,
      ).toEqual([{ n: 1 }]);
    } finally {
      await fixture.close();
    }
  }, 45_000);
});
