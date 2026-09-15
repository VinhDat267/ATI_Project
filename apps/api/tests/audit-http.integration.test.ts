import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/app.js";
import { makeApiFixture } from "./fixture.js";

async function waitForPreparedRun(
  fixture: Awaited<ReturnType<typeof makeApiFixture>>,
  token: string,
  runId: string,
) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await fixture.call(`/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = (await response.json()) as Record<string, any>;
    if (
      body.status === "awaiting_approval" ||
      ["failed", "cancelled", "needs_input", "refused"].includes(body.status)
    )
      return body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("run preparation timeout");
}

describe("audit HTTP integration fixes", () => {
  it("blocks configured secrets before write reservation and persists a safe trace projection", async () => {
    const fixture = await makeApiFixture({
      plannerMode: "dev_fixture",
      workerEnabled: true,
      filesystemEnabled: true,
    });
    try {
      writeFileSync(
        `${fixture.allowedRoot}\\notes.txt`,
        `public prefix ${fixture.config.passwordHash} public suffix`,
      );
      const token = await fixture.login();
      const created = await fixture.call("/runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ source_prompt: fixture.fsCopyPrompt }),
      });
      expect(created.status).toBe(202);
      const { run_id } = (await created.json()) as { run_id: string };

      const detail = await waitForPreparedRun(fixture, token, run_id);
      expect(detail.status).toBe("failed");
      expect(detail.approval).toBeNull();
      expect(
        await fixture.db.client`
          SELECT
            (SELECT count(*)::int FROM approvals WHERE run_id=${run_id}) AS approvals,
            (SELECT count(*)::int FROM tool_operations WHERE run_id=${run_id}) AS operations`,
      ).toEqual([{ approvals: 0, operations: 0 }]);

      const trace = await fixture.call(`/runs/${run_id}/trace`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(trace.status).toBe(200);
      const rawTrace = await trace.text();
      expect(rawTrace).not.toContain(fixture.config.passwordHash);
      expect(rawTrace).toContain("[REDACTED]");

      const snapshots = await fixture.db.client`
        SELECT attempts::text AS attempts
        FROM http_trace_snapshots
        WHERE run_id=${run_id}`;
      expect(snapshots).toHaveLength(1);
      expect(String(snapshots[0]!.attempts)).not.toContain(
        fixture.config.passwordHash,
      );
    } finally {
      await fixture.close();
    }
  }, 45_000);

  it("returns 409 EXPIRED when approval wins the race with maintenance", async () => {
    const fixture = await makeApiFixture({
      plannerMode: "dev_fixture",
      workerEnabled: true,
    });
    let isolatedApi: ReturnType<typeof createApi> | undefined;
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
      const { run_id } = (await created.json()) as { run_id: string };
      const prepared = await waitForPreparedRun(fixture, token, run_id);
      expect(prepared.status).toBe("awaiting_approval");

      await fixture.api.close();
      isolatedApi = createApi({
        db: fixture.db,
        config: fixture.config,
        engine: fixture.engine,
      });
      const baseUrl = await isolatedApi.listen();
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: fixture.email,
          password: fixture.password,
        }),
      });
      const { token: isolatedToken } = (await login.json()) as {
        token: string;
      };
      await fixture.db.client`
        UPDATE approvals
        SET expires_at=clock_timestamp()-interval '1 second'
        WHERE id=${prepared.approval.id}`;

      const response = await fetch(`${baseUrl}/runs/${run_id}/approval`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${isolatedToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          approval_id: prepared.approval.id,
          workflow_version_id: prepared.approval.workflow_version_id,
          snapshot_hash: prepared.approval.snapshot_hash,
          decision: "approved",
        }),
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "EXPIRED" },
      });
      expect(
        await fixture.db.client`
          SELECT status FROM runs WHERE id=${run_id}`,
      ).toEqual([{ status: "expired" }]);
    } finally {
      await isolatedApi?.close();
      await fixture.close();
    }
  }, 45_000);
});
