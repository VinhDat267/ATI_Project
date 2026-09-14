import { describe, expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

describe("API-03 owned run read model", () => {
  it("lists runs newest first and exposes source metadata in detail", async () => {
    const fixture = await makeApiFixture({
      workerEnabled: false,
      plannerMode: "dev_fixture",
    });
    try {
      const token = await fixture.login();
      const accepted = await fixture.call("/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ source_prompt: fixture.b02Prompt }),
      });
      expect(accepted.status).toBe(202);
      const { run_id } = (await accepted.json()) as { run_id: string };

      const list = await fixture.call("/runs", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(list.status).toBe(200);
      const rows = (await list.json()) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.run_id).toBe(run_id);
      expect(rows[0]?.source_prompt).toBe(fixture.b02Prompt);

      const detail = await fixture.call(`/runs/${run_id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(detail.status).toBe(200);
      const body = (await detail.json()) as Record<string, unknown>;
      expect(body.source_prompt).toBe(fixture.b02Prompt);
      expect(typeof body.created_at).toBe("string");
      expect(body.read_outputs).toEqual({});
    } finally {
      await fixture.close();
    }
  });
});
