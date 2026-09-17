import { describe, expect, it } from "vitest";
import { BeforeDispatchError, type EngineTool } from "../src/snapshot.js";
import { composeGateway } from "../src/gateway.js";
import type { GatewayResult, ServerConnection } from "../src/gateway-types.js";

const schema = { type: "object", additionalProperties: false };
const tool = (server: "task_hub" | "filesystem", name: string): EngineTool => ({
  server,
  name,
  sideEffect: "read",
  policyVersion: server === "task_hub" ? "b-local-1" : "b-local-fs-1",
  inputSchema: schema,
  outputSchema: schema,
  artifactHash: "a".repeat(64),
});

function connection(
  server: "task_hub" | "filesystem",
  calls: string[],
): ServerConnection {
  const tools = [tool(server, "read_file")];
  return {
    server,
    userId: "00000000-0000-4000-8000-000000000001",
    tools,
    assertCurrent: async () => undefined,
    call: async (name): Promise<GatewayResult> => {
      calls.push(`${server}:${name}`);
      return { structuredContent: { server, name } };
    },
    close: async () => undefined,
  };
}

describe("server-qualified gateway routing", () => {
  it("routes a colliding tool name only to the selected server", async () => {
    const calls: string[] = [];
    const gateway = composeGateway(
      "00000000-0000-4000-8000-000000000001",
      [connection("task_hub", calls), connection("filesystem", calls)],
    );

    await expect(
      gateway.call(
        { server: "filesystem", name: "read_file" },
        {},
        undefined,
        1000,
      ),
    ).resolves.toEqual({
      structuredContent: { server: "filesystem", name: "read_file" },
    });
    expect(calls).toEqual(["filesystem:read_file"]);
  });

  it("rejects an unknown or wrong-server target before calling a connection", async () => {
    const calls: string[] = [];
    const gateway = composeGateway(
      "00000000-0000-4000-8000-000000000001",
      [connection("task_hub", calls), connection("filesystem", calls)],
    );

    await expect(
      gateway.call(
        { server: "filesystem", name: "missing" },
        {},
        undefined,
        1000,
      ),
    ).rejects.toBeInstanceOf(BeforeDispatchError);
    expect(calls).toEqual([]);
  });

  it("closes every connection even when one close fails", async () => {
    const closed: string[] = [];
    const make = (server: "task_hub" | "filesystem", fail: boolean) => ({
      ...connection(server, []),
      close: async () => {
        closed.push(server);
        if (fail) throw new Error("close failed");
      },
    });
    const gateway = composeGateway(
      "00000000-0000-4000-8000-000000000001",
      [make("task_hub", true), make("filesystem", false)],
    );

    await expect(gateway.close()).rejects.toThrow();
    expect(closed).toEqual(["task_hub", "filesystem"]);
  });

  it("isolates per-server inspection failures and suppresses stale tools", async () => {
    const gateway = composeGateway(
      "00000000-0000-4000-8000-000000000001",
      [
        connection("task_hub", []),
        {
          ...connection("filesystem", []),
          assertCurrent: async () => {
            throw new Error("filesystem registry drift");
          },
        },
      ],
    );

    await expect(gateway.inspectServers!()).resolves.toEqual([
      expect.objectContaining({
        server: "task_hub",
        status: "connected",
        tools: [expect.objectContaining({ server: "task_hub" })],
      }),
      expect.objectContaining({
        server: "filesystem",
        status: "error",
        tools: [],
      }),
    ]);
  });
});
