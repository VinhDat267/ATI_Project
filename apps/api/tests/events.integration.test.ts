import { describe, expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

describe("API-03 event paging", () => {
  it("caps a page at 200 and rejects unsafe since_seq values", async () => {
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
      await fixture.db.client.begin(async (tx) => {
        const row = (
          await tx`SELECT next_event_seq FROM runs WHERE id=${run_id}`
        )[0]!;
        const start = Number(row.next_event_seq);
        for (let i = 0; i < 205; i++) {
          const seq = start + i;
          await tx`INSERT INTO run_events(run_id,seq,type,payload,created_at)
            VALUES (${run_id},${seq},'run.status',${tx.json({ status: "planning", previous: "planning" })},now())`;
        }
        await tx`UPDATE runs SET next_event_seq=${start + 205} WHERE id=${run_id}`;
      });
      const page = await fixture.call(`/runs/${run_id}/events`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(page.status).toBe(200);
      const body = (await page.json()) as {
        events: unknown[];
        next_seq: number;
      };
      expect(body.events).toHaveLength(200);
      expect(body.next_seq).toBe(200);

      for (const value of ["1.0", "1e2", "-1", "01", " "]) {
        const invalid = await fixture.call(
          `/runs/${run_id}/events?since_seq=${encodeURIComponent(value)}`,
          {
            headers: { authorization: `Bearer ${token}` },
          },
        );
        expect(invalid.status, value).toBe(400);
      }
      const repeated = await fixture.call(
        `/runs/${run_id}/events?since_seq=1&since_seq=2`,
        {
          headers: { authorization: `Bearer ${token}` },
        },
      );
      expect(repeated.status).toBe(400);
    } finally {
      await fixture.close();
    }
  });
});
