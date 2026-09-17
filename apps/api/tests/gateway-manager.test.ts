import { expect, it } from "vitest";
import type { Gateway } from "@wap/engine";
import { createGatewayManager } from "../src/gateway-manager.js";

it("keeps disconnected reads inert, retries failed opens and shares one live connection", async () => {
  let opens = 0;
  let closes = 0;
  let connected = true;
  const live: Gateway = {
    userId: "owner",
    tools: [],
    isConnected: () => connected,
    async assertCurrent() {},
    async call() {
      return { structuredContent: { ok: true } };
    },
    async close() {
      closes++;
      connected = false;
    },
  };
  const manager = createGatewayManager("owner", async () => {
    opens++;
    if (opens === 1) throw new Error("private-connection-detail");
    connected = true;
    return live;
  });
  expect(manager.tools).toEqual([]);
  await expect(manager.assertCurrent()).rejects.toThrow("unavailable");
  expect(opens).toBe(0);
  await expect(manager.ensureConnected!()).rejects.toThrow(
    "Reviewed MCP connection is unavailable",
  );
  await Promise.all([manager.ensureConnected!(), manager.ensureConnected!()]);
  expect(opens).toBe(2);
  await expect(manager.assertCurrent()).resolves.toBeUndefined();
  connected = false;
  await Promise.all([manager.ensureConnected!(), manager.ensureConnected!()]);
  expect(opens).toBe(3);
  expect(manager.isConnected!()).toBe(true);
  await manager.close();
  expect(closes).toBe(2);
  await expect(manager.assertCurrent()).rejects.toThrow("unavailable");
});

it("exposes per-server inspection only after a reviewed connection exists", async () => {
  let inspectCalls = 0;
  const live: Gateway = {
    userId: "owner",
    tools: [],
    async inspectServers() {
      inspectCalls++;
      return [];
    },
    async assertCurrent() {},
    async call() {
      return { structuredContent: {} };
    },
    async close() {},
  };
  const manager = createGatewayManager("owner", async () => live);

  expect(manager.inspectServers).toBeUndefined();
  await manager.ensureConnected!();
  expect(manager.inspectServers).toBeTypeOf("function");
  await manager.inspectServers!();
  expect(inspectCalls).toBe(1);
});
