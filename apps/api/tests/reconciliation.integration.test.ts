import { describe, expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

describe("API-03 reconciliation projection", () => {
  it("returns a read-only receipt projection without mutating the run", async () => {
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
      const { run_id } = (await accepted.json()) as { run_id: string };
      const before = await fixture.db
        .client`SELECT status,next_event_seq FROM runs WHERE id=${run_id}`;
      const response = await fixture.call(`/runs/${run_id}/reconciliation`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        run_id,
        read_only: true,
        operations: [],
      });
      const after = await fixture.db
        .client`SELECT status,next_event_seq FROM runs WHERE id=${run_id}`;
      expect(after).toEqual(before);
    } finally {
      await fixture.close();
    }
  });
});
