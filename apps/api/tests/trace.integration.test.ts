import { describe, expect, it } from "vitest";
import { makeApiFixture } from "./fixture.js";

describe("API-03 stable trace cursors", () => {
  it("pages an immutable snapshot and redacts sensitive fields", async () => {
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
        for (let i = 0; i < 101; i++) {
          const [state] = await tx`
            INSERT INTO step_states(run_id,step_id,side_effect,status)
            VALUES (${run_id},${`read_${i}`},'read','succeeded') RETURNING id`;
          await tx`INSERT INTO step_attempts(step_state_id,attempt_no,result,ended_at)
            VALUES (${state!.id},1,${tx.json({ token: "secret", index: i })},now())`;
        }
      });
      const first = await fixture.call(`/runs/${run_id}/trace`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as {
        attempts: Array<{ result: Record<string, unknown> }>;
        next_cursor: string | null;
      };
      expect(firstBody.attempts).toHaveLength(100);
      expect(firstBody.next_cursor).toMatch(/\./);
      expect(firstBody.attempts[0]!.result.token).toBe("[REDACTED]");

      const second = await fixture.call(
        `/runs/${run_id}/trace?cursor=${encodeURIComponent(firstBody.next_cursor!)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(second.status).toBe(200);
      expect(
        ((await second.json()) as { attempts: unknown[] }).attempts,
      ).toHaveLength(1);

      const tampered = await fixture.call(
        `/runs/${run_id}/trace?cursor=${encodeURIComponent(`${firstBody.next_cursor}x`)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(tampered.status).toBe(400);
    } finally {
      await fixture.close();
    }
  });
});
