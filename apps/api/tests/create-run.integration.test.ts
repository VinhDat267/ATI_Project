import { describe, expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

describe("API-02 durable acceptance", () => {
  it("commits an accepted planning run before preparation starts", async () => {
    const fixture = await makeApiFixture({
      workerEnabled: false,
      plannerMode: "dev_fixture",
    });
    try {
      const token = await fixture.login();
      const response = await fixture.call("/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ source_prompt: fixture.b02Prompt }),
      });
      expect(response.status).toBe(202);
      const accepted = (await response.json()) as {
        run_id: string;
        status: string;
      };
      expect(accepted.status).toBe("planning");
      const detail = await fixture.call(`/runs/${accepted.run_id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as Record<string, unknown>;
      expect(body.workflow_version_id).toBeNull();
      const rows = await fixture.db.client`
        SELECT job_kind, delivered_at FROM run_outbox
        WHERE run_id=${accepted.run_id}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.job_kind).toBe("prepare");
      expect(rows[0]!.delivered_at).toBeNull();
    } finally {
      await fixture.close();
    }
  });

  it("rejects a second active run and never accepts client-supplied plan fields", async () => {
    const fixture = await makeApiFixture({ plannerMode: "dev_fixture" });
    try {
      const token = await fixture.login();
      const invalid = await fixture.call("/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ source_prompt: fixture.b02Prompt, plan: {} }),
      });
      expect(invalid.status).toBe(400);
      expect(
        await fixture.db.client`SELECT count(*)::int AS n FROM runs`,
      ).toEqual([{ n: 0 }]);

      const body = JSON.stringify({ source_prompt: fixture.b02Prompt });
      const [first, second] = await Promise.all([
        fixture.call("/runs", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body,
        }),
        fixture.call("/runs", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body,
        }),
      ]);
      expect([first.status, second.status].sort()).toEqual([202, 409]);
      expect(
        await fixture.db.client`SELECT count(*)::int AS n FROM runs`,
      ).toEqual([{ n: 1 }]);
    } finally {
      await fixture.close();
    }
  });
});
