import { describe, expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

describe("API-02 asynchronous preparation", () => {
  it("prepares the accepted b02 run through real PostgreSQL and MCP read", async () => {
    const fixture = await makeApiFixture({
      workerEnabled: true,
      plannerMode: "dev_fixture",
    });
    try {
      const token = await fixture.login();
      const acceptedResponse = await fixture.call("/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ source_prompt: fixture.b02Prompt }),
      });
      expect(acceptedResponse.status).toBe(202);
      const accepted = (await acceptedResponse.json()) as { run_id: string };
      let detail: Record<string, any> | undefined;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const response = await fixture.call(`/runs/${accepted.run_id}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(200);
        detail = (await response.json()) as Record<string, any>;
        if (
          detail.status !== "planning" &&
          detail.status !== "validating" &&
          detail.status !== "dry_running"
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(detail?.status).toBe("awaiting_approval");
      expect(detail?.planner_result?.kind).toBe("plan");
      expect(detail?.approval?.actions).toHaveLength(2);
      expect(detail?.approval?.actions[0]).toMatchObject({
        step_id: "append",
        server: "task_hub",
        tool: "append_sheet_rows",
        resolved_args: {
          spreadsheet_id: "dest",
          sheet_name: "Report",
          rows: [
            ["API", "Done"],
            ["UI", "Doing"],
          ],
        },
      });
      expect(detail?.approval?.actions[1]).toMatchObject({
        step_id: "notify",
        server: "task_hub",
        tool: "send_slack_message",
        resolved_args: { channel: "#team", text: "Đã chép 2 dòng." },
      });
      expect(
        await fixture.db.client`SELECT count(*)::int AS n FROM hub_receipts`,
      ).toEqual([{ n: 0 }]);
      expect(
        await fixture.db.client`SELECT count(*)::int AS n FROM hub_messages`,
      ).toEqual([{ n: 0 }]);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
