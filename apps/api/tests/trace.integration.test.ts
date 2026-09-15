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
        for (let i = 0; i < 251; i++) {
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
      await fixture.db
        .client`UPDATE step_attempts SET result=${fixture.db.client.json({ index: "changed", token: "secret" })} WHERE step_state_id IN (SELECT id FROM step_states WHERE run_id=${run_id})`;

      const second = await fixture.call(
        `/runs/${run_id}/trace?cursor=${encodeURIComponent(firstBody.next_cursor!)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as typeof firstBody;
      expect(secondBody.attempts).toHaveLength(100);
      const third = await fixture.call(
        `/runs/${run_id}/trace?cursor=${encodeURIComponent(secondBody.next_cursor!)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(third.status).toBe(200);
      const thirdBody = (await third.json()) as typeof firstBody;
      expect(thirdBody.attempts).toHaveLength(51);
      expect(thirdBody.next_cursor).toBeNull();
      const indexes = [
        ...firstBody.attempts,
        ...secondBody.attempts,
        ...thirdBody.attempts,
      ].map((attempt) => attempt.result.index);
      expect(new Set(indexes)).toEqual(
        new Set(Array.from({ length: 251 }, (_, i) => i)),
      );

      const fresh = await fixture.call(`/runs/${run_id}/trace`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(
        ((await fresh.json()) as typeof firstBody).attempts.every(
          (attempt) => attempt.result.index === "changed",
        ),
      ).toBe(true);
      await fixture.db
        .client`UPDATE http_trace_snapshots SET expires_at=now()-interval '1 second' WHERE run_id=${run_id}`;
      const expired = await fixture.call(
        `/runs/${run_id}/trace?cursor=${encodeURIComponent(firstBody.next_cursor!)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(expired.status).toBe(400);

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
