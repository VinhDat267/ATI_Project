import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EngineError,
  WorkflowEngine,
  openLocalGateway,
  type Gateway,
} from "@wap/engine";
import { makeApiFixture } from "./fixture.js";
import { createPrepareWorker } from "../src/worker.js";
import { loadDevPlanner } from "../src/dev-planner.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await check()) return;
    await pause();
  }
  throw new Error("Worker regression timed out");
}
function inert(userId: string): Gateway {
  return {
    userId,
    tools: [],
    assertCurrent: async () => {},
    close: async () => {},
    call: async () => {
      throw new Error("Unexpected tool dispatch");
    },
  };
}

describe("audit worker invariants", () => {
  it("waits for successful recovery and never replans an already claimed orphan", async () => {
    const f = await makeApiFixture({ plannerMode: "dev_fixture" });
    const gateway = inert(f.userId);
    const engine = new WorkflowEngine(f.db, gateway, f.userId);
    const accepted = await engine.accept({ source_prompt: "orphan" });
    await f.db
      .client`UPDATE runs SET claimed_by=${randomUUID()},claimed_at=now() WHERE id=${accepted.run_id}`;
    const lease = f.db.createWorkerClient(() => {});
    await lease`SELECT pg_advisory_lock(638019814)`;
    let produced = 0;
    const worker = createPrepareWorker({
      db: f.db,
      userId: f.userId,
      engine,
      intervalMs: 20,
      planner: {
        mode: "dev_fixture",
        produce: async () => {
          produced++;
          return { kind: "clarification", question: "unexpected replay" };
        },
      },
    });
    try {
      worker.start();
      await pause(100);
      await lease`SELECT pg_advisory_unlock(638019814)`;
      await until(async () =>
        ["failed", "needs_input"].includes(
          (await engine.detail(accepted.run_id)).status,
        ),
      );
      expect((await engine.detail(accepted.run_id)).status).toBe("failed");
      expect(produced).toBe(0);
      expect((await engine.events(accepted.run_id)).events.at(-1)?.type).toBe(
        "run.finished",
      );
    } finally {
      await worker.stop();
      await lease.end();
      await f.close();
    }
  });

  it("consumes a prepare job with its claim before invoking the planner", async () => {
    const f = await makeApiFixture();
    const engine = new WorkflowEngine(f.db, inert(f.userId), f.userId);
    const accepted = await engine.accept({
      source_prompt: "claim transaction",
    });
    try {
      await engine.prepareAccepted(accepted.run_id, {
        mode: "dev_fixture",
        produce: async () => {
          const [row] = await f.db
            .client`SELECT r.claimed_by,o.delivered_at FROM runs r JOIN run_outbox o ON o.run_id=r.id WHERE r.id=${accepted.run_id} AND o.job_kind='prepare'`;
          expect(row!.claimed_by).toBeTruthy();
          expect(row!.delivered_at).not.toBeNull();
          return {
            kind: "clarification",
            question: "request more information",
          };
        },
      });
      // prepare catches planner exceptions, so the final status also proves its assertions ran successfully.
      expect((await engine.detail(accepted.run_id)).status).toBe("needs_input");
    } finally {
      await f.close();
    }
  });

  it("records a terminal event on a prepare registry failure after claim", async () => {
    const f = await makeApiFixture();
    const base = await openLocalGateway({
      root,
      databaseUrl: f.databaseUrl,
      userId: f.userId,
    });
    const gateway: Gateway = {
      ...base,
      assertCurrent: async () => {
        throw new EngineError("REGISTRY_CHANGED", "Injected artifact drift");
      },
    };
    const engine = new WorkflowEngine(f.db, gateway, f.userId);
    const planner = loadDevPlanner(root);
    const accepted = await engine.accept({ source_prompt: planner.b02Prompt });
    const worker = createPrepareWorker({
      db: f.db,
      userId: f.userId,
      engine,
      planner,
      intervalMs: 20,
    });
    try {
      worker.start();
      await until(
        async () => (await engine.detail(accepted.run_id)).status === "failed",
      );
      const events = (await engine.events(accepted.run_id)).events;
      expect(events.at(-1)?.type).toBe("run.finished");
      expect(events.filter((e) => e.type === "run.finished")).toHaveLength(1);
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
      expect(
        (await f.db.client`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n,
      ).toBe(0);
    } finally {
      await worker.stop();
      await base.close();
      await f.close();
    }
  });

  it("settles execute failure before dispatch and releases admission even after expiry", async () => {
    const f = await makeApiFixture();
    const base = await openLocalGateway({
      root,
      databaseUrl: f.databaseUrl,
      userId: f.userId,
    });
    let drift = false;
    const gateway: Gateway = {
      ...base,
      assertCurrent: async () => {
        if (drift)
          throw new EngineError("REGISTRY_CHANGED", "Injected artifact drift");
        await base.assertCurrent();
      },
    };
    const engine = new WorkflowEngine(f.db, gateway, f.userId);
    const planner = loadDevPlanner(root);
    const accepted = await engine.accept({ source_prompt: planner.b02Prompt });
    const prepared = await engine.prepareAccepted(accepted.run_id, planner);
    const a = prepared.approval!;
    await engine.decide(accepted.run_id, {
      approval_id: a.id,
      workflow_version_id: a.workflow_version_id,
      snapshot_hash: a.snapshot_hash,
      decision: "approved",
    });
    drift = true;
    await f.db
      .client`UPDATE approvals SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${a.id}`;
    const worker = createPrepareWorker({
      db: f.db,
      userId: f.userId,
      engine,
      planner,
      intervalMs: 20,
    });
    try {
      worker.start();
      await until(async () =>
        ["failed", "expired"].includes(
          (await engine.detail(accepted.run_id)).status,
        ),
      );
      expect((await engine.events(accepted.run_id)).events.at(-1)?.type).toBe(
        "run.finished",
      );
      expect(
        (await f.db.client`SELECT count(*)::int AS n FROM hub_receipts`)[0]!.n,
      ).toBe(0);
      expect(
        (
          await f.db
            .client`SELECT delivered_at FROM run_outbox WHERE run_id=${accepted.run_id} AND job_kind='execute'`
        )[0]!.delivered_at,
      ).not.toBeNull();
      await expect(
        engine.accept({ source_prompt: "next intentional run" }),
      ).resolves.toMatchObject({ status: "planning" });
    } finally {
      await worker.stop();
      await base.close();
      await f.close();
    }
  }, 20000);
});
