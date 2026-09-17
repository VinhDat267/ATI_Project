import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WorkflowEngine } from "@wap/engine";
import { createApi, type ApiRuntime } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { makeApiFixture } from "./fixture.js";

type Fixture = Awaited<ReturnType<typeof makeApiFixture>>;

async function login(
  baseUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { token: string }).token;
}

async function createPlanningRun(fixture: Fixture, token: string) {
  const response = await fixture.call("/runs", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ source_prompt: fixture.b02Prompt }),
  });
  expect(response.status).toBe(202);
  return ((await response.json()) as { run_id: string }).run_id;
}

async function runState(fixture: Fixture, runId: string) {
  return fixture.db.client`
    SELECT
      r.status::text,
      r.next_event_seq,
      r.claimed_by::text,
      r.claimed_at::text,
      r.cancel_requested_at::text,
      (SELECT count(*)::int FROM run_events WHERE run_id=r.id) AS events,
      (SELECT count(*)::int FROM run_outbox WHERE run_id=r.id) AS outbox,
      (SELECT count(*)::int FROM run_outbox WHERE run_id=r.id AND delivered_at IS NOT NULL) AS delivered,
      (SELECT count(*)::int FROM approvals WHERE run_id=r.id) AS approvals,
      (SELECT count(*)::int FROM tool_operations WHERE run_id=r.id) AS operations,
      (SELECT count(*)::int FROM http_trace_snapshots WHERE run_id=r.id) AS trace_snapshots
    FROM runs r
    WHERE r.id=${runId}`;
}

describe("audit owner and session boundaries", () => {
  it("returns no foreign run data from every run route and does not mutate the run", async () => {
    const fixture = await makeApiFixture({
      plannerMode: "dev_fixture",
      workerEnabled: false,
    });
    let foreignApi: ApiRuntime | undefined;
    try {
      const ownerToken = await fixture.login();
      const runId = await createPlanningRun(fixture, ownerToken);
      const before = await runState(fixture, runId);

      const foreignUserId = randomUUID();
      const foreignEmail = `${foreignUserId}@local.invalid`;
      const foreignPassword = `foreign-${randomUUID()}`;
      const foreignPasswordHash = await hashPassword(foreignPassword);
      await fixture.db.client`
        INSERT INTO users(id,email,password_hash,display_name)
        VALUES (${foreignUserId},${foreignEmail},${foreignPasswordHash},'Foreign audit principal')`;
      const foreignConfig = {
        ...fixture.config,
        port: 0,
        userId: foreignUserId,
        email: foreignEmail,
        passwordHash: foreignPasswordHash,
        plannerMode: "disabled" as const,
      };
      const foreignEngine = new WorkflowEngine(
        fixture.db,
        undefined,
        foreignUserId,
        { secrets: [foreignPasswordHash] },
      );
      foreignApi = createApi({
        db: fixture.db,
        config: foreignConfig,
        engine: foreignEngine,
      });
      const foreignBaseUrl = await foreignApi.listen();
      const foreignToken = await login(
        foreignBaseUrl,
        foreignEmail,
        foreignPassword,
      );
      const authorization = { authorization: `Bearer ${foreignToken}` };

      const unauthenticatedReads = await Promise.all(
        [
          "/runs",
          `/runs/${runId}`,
          `/runs/${runId}/events`,
          `/runs/${runId}/trace`,
          `/runs/${runId}/reconciliation`,
        ].map((route) => fetch(`${foreignBaseUrl}${route}`)),
      );
      expect(unauthenticatedReads.map((response) => response.status)).toEqual([
        401, 401, 401, 401, 401,
      ]);
      const unauthenticatedWrites = await Promise.all(
        ["approval", "cancel"].map((route) =>
          fetch(`${foreignBaseUrl}/runs/${runId}/${route}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
        ),
      );
      expect(unauthenticatedWrites.map((response) => response.status)).toEqual([
        401, 401,
      ]);

      const list = await fetch(`${foreignBaseUrl}/runs`, {
        headers: authorization,
      });
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual([]);

      const reads = await Promise.all(
        ["", "/events", "/trace", "/reconciliation"].map((suffix) =>
          fetch(`${foreignBaseUrl}/runs/${runId}${suffix}`, {
            headers: authorization,
          }),
        ),
      );
      expect(reads.map((response) => response.status)).toEqual([
        404, 404, 404, 404,
      ]);
      for (const response of reads)
        expect(await response.json()).toMatchObject({
          error: { code: "NOT_FOUND" },
        });

      const approval = await fetch(`${foreignBaseUrl}/runs/${runId}/approval`, {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          approval_id: randomUUID(),
          workflow_version_id: randomUUID(),
          snapshot_hash: "a".repeat(64),
          decision: "approved",
        }),
      });
      const cancel = await fetch(`${foreignBaseUrl}/runs/${runId}/cancel`, {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect([approval.status, cancel.status]).toEqual([404, 404]);
      expect(await approval.json()).toMatchObject({
        error: { code: "NOT_FOUND" },
      });
      expect(await cancel.json()).toMatchObject({
        error: { code: "NOT_FOUND" },
      });

      expect(await runState(fixture, runId)).toEqual(before);
    } finally {
      await foreignApi?.close();
      await fixture.close();
    }
  }, 45_000);

  it("expires sessions, invalidates them on restart, and keeps owned history readable without MCP", async () => {
    const fixture = await makeApiFixture({
      plannerMode: "dev_fixture",
      workerEnabled: false,
    });
    const runtimes: ApiRuntime[] = [];
    try {
      const initialToken = await fixture.login();
      const runId = await createPlanningRun(fixture, initialToken);
      await fixture.api.close();

      const disconnectedEngine = new WorkflowEngine(
        fixture.db,
        undefined,
        fixture.userId,
        {
          secrets: [
            fixture.config.passwordHash,
            fixture.config.cursorKey.toString("base64"),
          ],
        },
      );
      const shortSessionConfig = {
        ...fixture.config,
        port: 0,
        sessionTtlMs: 250,
      };
      const ttlApi = createApi({
        db: fixture.db,
        config: shortSessionConfig,
        engine: disconnectedEngine,
      });
      runtimes.push(ttlApi);
      const ttlBaseUrl = await ttlApi.listen();
      const expiringToken = await login(
        ttlBaseUrl,
        fixture.email,
        fixture.password,
      );
      const firstRead = await fetch(`${ttlBaseUrl}/runs/${runId}`, {
        headers: { authorization: `Bearer ${expiringToken}` },
      });
      expect(firstRead.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 300));
      const expiredRead = await fetch(`${ttlBaseUrl}/runs/${runId}`, {
        headers: { authorization: `Bearer ${expiringToken}` },
      });
      expect(expiredRead.status).toBe(401);
      const renewedToken = await login(
        ttlBaseUrl,
        fixture.email,
        fixture.password,
      );
      expect(
        await fetch(`${ttlBaseUrl}/runs/${runId}`, {
          headers: { authorization: `Bearer ${renewedToken}` },
        }).then((response) => response.status),
      ).toBe(200);
      await ttlApi.close();

      const restartedApi = createApi({
        db: fixture.db,
        config: fixture.config,
        engine: disconnectedEngine,
      });
      runtimes.push(restartedApi);
      const restartedBaseUrl = await restartedApi.listen();
      const staleAfterRestart = await fetch(
        `${restartedBaseUrl}/runs/${runId}`,
        { headers: { authorization: `Bearer ${renewedToken}` } },
      );
      expect(staleAfterRestart.status).toBe(401);

      const restartedToken = await login(
        restartedBaseUrl,
        fixture.email,
        fixture.password,
      );
      const history = await fetch(`${restartedBaseUrl}/runs`, {
        headers: { authorization: `Bearer ${restartedToken}` },
      });
      expect(history.status).toBe(200);
      expect(await history.json()).toEqual([
        expect.objectContaining({ run_id: runId, status: "planning" }),
      ]);
      const traceWithoutMcp = await fetch(
        `${restartedBaseUrl}/runs/${runId}/trace`,
        { headers: { authorization: `Bearer ${restartedToken}` } },
      );
      expect(traceWithoutMcp.status).toBe(200);
      expect(await traceWithoutMcp.json()).toEqual({
        run_id: runId,
        attempts: [],
        next_cursor: null,
      });
      const servers = await fetch(`${restartedBaseUrl}/servers`, {
        headers: { authorization: `Bearer ${restartedToken}` },
      });
      expect(await servers.json()).toEqual([
        {
          slug: "task_hub",
          status: "disconnected",
          policy_version: "b-local-1",
        },
        {
          slug: "filesystem",
          status: "disconnected",
          policy_version: "b-local-fs-1",
        },
      ]);
    } finally {
      for (const runtime of runtimes) await runtime.close();
      await fixture.close();
    }
  }, 45_000);
});
