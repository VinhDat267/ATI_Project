import { describe, expect, it } from "vitest";
import { WorkflowEngine, type Gateway, type EngineTool } from "../src/index.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

const tool: EngineTool = {
  server: "task_hub",
  name: "list_cards",
  sideEffect: "read",
  policyVersion: "b-local-1",
  artifactHash: "a".repeat(64),
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
};

function gateway(options: {
  ensureConnected?: () => Promise<void>;
  tools?: readonly EngineTool[];
  inspectServers?: Gateway["inspectServers"];
  catalogCheck?: Gateway["catalogCheck"];
}): Gateway {
  return {
    userId: USER_ID,
    tools: options.tools ?? [],
    ensureConnected: options.ensureConnected,
    inspectServers: options.inspectServers,
    catalogCheck: options.catalogCheck,
    async assertCurrent() {},
    async call() {
      return { structuredContent: {} };
    },
    async close() {},
  };
}

describe("reviewed server catalog", () => {
  it("uses stable disconnected defaults when no gateway is configured", async () => {
    const engine = new WorkflowEngine({} as never, undefined, USER_ID);

    await expect(
      engine.serverCatalog({ observedAt: "2026-09-17T00:00:00.000Z" }),
    ).resolves.toEqual([
      {
        slug: "task_hub",
        status: "disconnected",
        policy_version: "b-local-1",
        observed_at: "2026-09-17T00:00:00.000Z",
        tools: [],
      },
      {
        slug: "filesystem",
        status: "disconnected",
        policy_version: "b-local-fs-1",
        observed_at: "2026-09-17T00:00:00.000Z",
        tools: [],
      },
    ]);
  });

  it("does not ensure a connection for a disconnected read", async () => {
    let ensureCalls = 0;
    const engine = new WorkflowEngine(
      {} as never,
      gateway({
        ensureConnected: async () => {
          ensureCalls++;
        },
      }),
      USER_ID,
    );

    const catalog = await engine.serverCatalog({
      connect: false,
      observedAt: "2026-09-17T00:00:00.000Z",
    });
    expect(ensureCalls).toBe(0);
    expect(catalog.map((entry) => entry.slug)).toEqual([
      "task_hub",
      "filesystem",
    ]);
    expect(catalog.every((entry) => entry.status === "disconnected")).toBe(
      true,
    );
    expect(catalog.every((entry) => entry.tools.length === 0)).toBe(true);
    expect(
      catalog.every(
        (entry) => entry.observed_at === "2026-09-17T00:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("ensures only when connect is requested and projects reviewed tools", async () => {
    let ensureCalls = 0;
    const engine = new WorkflowEngine(
      {} as never,
      gateway({
        ensureConnected: async () => {
          ensureCalls++;
        },
        tools: [tool],
      }),
      USER_ID,
    );

    const catalog = await engine.serverCatalog({ connect: true });
    expect(ensureCalls).toBe(1);
    expect(catalog[0]).toMatchObject({
      slug: "task_hub",
      status: "connected",
      tools: [
        {
          server: "task_hub",
          name: "list_cards",
          side_effect: "read",
          policy_version: "b-local-1",
          artifact_hash: "a".repeat(64),
        },
      ],
    });
    expect(catalog[1]?.tools).toEqual([]);
  });

  it("uses an independent active catalog check without ensuring execution connectivity", async () => {
    let ensureCalls = 0;
    let catalogChecks = 0;
    const engine = new WorkflowEngine(
      {} as never,
      gateway({
        ensureConnected: async () => {
          ensureCalls++;
        },
        catalogCheck: async () => {
          catalogChecks++;
          return [
            {
              server: "task_hub",
              status: "connected",
              policyVersion: "b-local-1",
              tools: [tool],
            },
            {
              server: "filesystem",
              status: "error",
              policyVersion: "b-local-fs-1",
              tools: [],
            },
          ];
        },
      }),
      USER_ID,
    );

    const catalog = await engine.serverCatalog({ connect: true });

    expect(ensureCalls).toBe(0);
    expect(catalogChecks).toBe(1);
    expect(catalog[0]).toMatchObject({ status: "connected" });
    expect(catalog[1]).toMatchObject({ status: "error", tools: [] });
  });

  it("inspects each server independently and preserves clone-safe reviewed schemas", async () => {
    const inputSchema = {
      type: "object",
      properties: { board_id: { type: "string" } },
    };
    const outputSchema = {
      type: "object",
      properties: { cards: { type: "array" } },
    };
    const inspectedTool: EngineTool = {
      ...tool,
      inputSchema,
      outputSchema,
    };
    let ensureCalls = 0;
    const engine = new WorkflowEngine(
      {} as never,
      gateway({
        ensureConnected: async () => {
          ensureCalls++;
        },
        inspectServers: async () => [
          {
            server: "task_hub",
            status: "connected",
            policyVersion: "b-local-1",
            tools: [inspectedTool],
          },
          {
            server: "filesystem",
            status: "error",
            policyVersion: "b-local-fs-1",
            tools: [],
          },
        ],
      }),
      USER_ID,
    );

    const catalog = await engine.serverCatalog({ connect: true });
    expect(ensureCalls).toBe(1);
    expect(catalog[0]).toMatchObject({
      status: "connected",
      policy_version: "b-local-1",
      tools: [
        {
          server: "task_hub",
          name: "list_cards",
          side_effect: "read",
          policy_version: "b-local-1",
          artifact_hash: "a".repeat(64),
          input_schema: inputSchema,
          output_schema: outputSchema,
        },
      ],
    });
    expect(catalog[1]).toMatchObject({ status: "error", tools: [] });

    const published = catalog[0]!.tools[0]!;
    (published.input_schema.properties as Record<string, unknown>).board_id = {
      type: "number",
    };
    expect(inputSchema.properties.board_id).toEqual({ type: "string" });
    expect(outputSchema.properties.cards).toEqual({ type: "array" });
  });

  it("downgrades invalid connected inspections instead of publishing tools", async () => {
    const mixedPolicyTools = [
      tool,
      { ...tool, name: "get_card", policyVersion: "b-local-other" },
    ];
    const engine = new WorkflowEngine(
      {} as never,
      gateway({
        inspectServers: async () => [
          {
            server: "task_hub",
            status: "connected",
            policyVersion: "b-local-1",
            tools: mixedPolicyTools,
          },
          {
            server: "filesystem",
            status: "disconnected",
            policyVersion: "b-local-fs-1",
            tools: [],
          },
        ],
      }),
      USER_ID,
    );

    const catalog = await engine.serverCatalog();
    expect(catalog[0]).toMatchObject({
      slug: "task_hub",
      status: "unreviewed",
      policy_version: null,
      tools: [],
    });
  });

  it("downgrades a consistently drifted reviewed policy instead of publishing it", async () => {
    const driftedTool = {
      ...tool,
      policyVersion: "b-local-evil",
    };
    const engine = new WorkflowEngine(
      {} as never,
      gateway({
        inspectServers: async () => [
          {
            server: "task_hub",
            status: "connected",
            policyVersion: "b-local-evil",
            tools: [driftedTool],
          },
          {
            server: "filesystem",
            status: "disconnected",
            policyVersion: "b-local-fs-1",
            tools: [],
          },
        ],
      }),
      USER_ID,
    );

    const catalog = await engine.serverCatalog();

    expect(catalog[0]).toMatchObject({
      slug: "task_hub",
      status: "unreviewed",
      policy_version: null,
      tools: [],
    });
  });

  it("suppresses all tools for registry drift without leaking the error", async () => {
    const drifting: Gateway = {
      ...gateway({ tools: [tool] }),
      async assertCurrent() {
        throw new Error("private executable and credential");
      },
    };
    const engine = new WorkflowEngine({} as never, drifting, USER_ID);

    const catalog = await engine.serverCatalog({ connect: true });
    expect(catalog[0]).toMatchObject({
      slug: "task_hub",
      status: "error",
      tools: [],
    });
    expect(JSON.stringify(catalog)).not.toContain("private executable");
    expect(JSON.stringify(catalog)).not.toContain("credential");
  });
});
