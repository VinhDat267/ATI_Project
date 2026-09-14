import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { WorkflowPlanSchema } from "@wap/dsl";
import { WorkflowEngine, openLocalGateway, type Gateway } from "../src/index.js";
import { BeforeDispatchError } from "../src/snapshot.js";
import { makeFilesystemFixture } from "./filesystem-fixture.js";

let fixture: Awaited<ReturnType<typeof makeFilesystemFixture>>;
let gateway: Gateway;

const readPlan = WorkflowPlanSchema.parse({
  version: "1.0",
  name: "Read filesystem demo",
  source_prompt: "Đọc notes.txt trong root filesystem demo.",
  inputs: {},
  steps: [
    {
      id: "read",
      description: "Read notes",
      tool: { server: "filesystem", name: "read_file", args: { path: "notes.txt" } },
      depends_on: [],
      condition: null,
      retry: { max_attempts: 1, backoff: "exponential", initial_delay_ms: 0 },
      idempotency_key: null,
      side_effect: "read",
      on_error: "fail",
      timeout_ms: 30000,
    },
  ],
  outputs: { text: "${steps.read.output.text}" },
});

beforeAll(async () => {
  fixture = await makeFilesystemFixture();
  gateway = await openLocalGateway(fixture.gatewayConfig);
});

afterAll(async () => {
  await gateway?.close();
  await fixture?.close();
});

describe("approved filesystem read adapter", () => {
  it("publishes the two reviewed filesystem tools alongside the eight task_hub tools", () => {
    expect(gateway.tools).toHaveLength(10);
    expect(gateway.tools.filter((tool) => tool.server === "filesystem")).toEqual([
      expect.objectContaining({
        name: "read_file",
        sideEffect: "read",
        policyVersion: "b-local-fs-1",
      }),
      expect.objectContaining({
        name: "write_file",
        sideEffect: "write",
        policyVersion: "b-local-fs-1",
      }),
    ]);
  });

  it("reads the exact UTF-8 fixture through the real upstream MCP server", async () => {
    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId);
    const result = await engine.prepare(readPlan);
    expect(result.status).toBe("succeeded");
    expect((await engine.events(result.run_id)).events.at(-1)?.payload).toMatchObject({
      outputs: { text: "Tiến độ ATI\nAPI: Done\n" },
    });
  });

  it("rejects traversal before raw MCP dispatch", async () => {
    const outside = `${fixture.outsideRoot}/sentinel.txt`;
    await expect(
      gateway.call(
        { server: "filesystem", name: "read_file" },
        { path: "../outside/sentinel.txt" },
        undefined,
        30000,
      ),
    ).rejects.toBeInstanceOf(BeforeDispatchError);
    expect(readFileSync(outside, "utf8")).toBe("OUTSIDE_SENTINEL");
  });

  it("rejects a root marker changed after launch", async () => {
    const markerPath = `${fixture.allowedRoot}/.ati-root.json`;
    const original = readFileSync(markerPath, "utf8");
    const changed = JSON.parse(original);
    changed.root_id = "22222222-2222-4222-8222-222222222222";
    writeFileSync(markerPath, JSON.stringify(changed));
    try {
      await expect(
        gateway.call(
          { server: "filesystem", name: "read_file" },
          { path: "notes.txt" },
          undefined,
          30000,
        ),
      ).rejects.toBeInstanceOf(BeforeDispatchError);
    } finally {
      writeFileSync(markerPath, original);
    }
  });
});
