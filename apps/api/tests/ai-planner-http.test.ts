import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "@wap/db";
import {
  AiPlannerError,
  type WorkflowEngine,
  type StructuredModelClient,
  type StructuredModelResponse,
} from "@wap/engine";
import { createApi, type ApiConfig, type ApiRuntime } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { loadAiPlanner } from "../src/ai-planner.js";
import type { WorkerControl } from "../src/worker.js";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const USER_ID = "00000000-0000-4000-8000-000000000001";
const openApis = new Set<ApiRuntime>();

afterEach(async () => {
  for (const api of openApis) await api.close();
  openApis.clear();
});

async function startApi(options: {
  plannerMode: "disabled" | "dev_fixture" | "ai";
  engine?: WorkflowEngine;
  worker?: WorkerControl;
}) {
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 0,
    userId: USER_ID,
    email: "ai-tester@example.local",
    passwordHash: await hashPassword("ai-test-password"),
    sessionTtlMs: 60_000,
    cursorKey: Buffer.alloc(32, 23),
    plannerMode: options.plannerMode,
  };
  const api = createApi({
    db: {} as Database,
    config,
    principalExists: async () => true,
    engine: options.engine,
    worker: options.worker,
  });
  openApis.add(api);
  const baseUrl = await api.listen();

  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: config.email,
      password: "ai-test-password",
    }),
  });
  const { token } = (await loginRes.json()) as { token: string };

  return { api, baseUrl, token, config };
}

describe("AI-02: API Mode Selection & AI Planner Wiring", () => {
  describe("API configuration and routing", () => {
    it("rejects POST /runs when plannerMode is disabled with 503 PLANNER_UNAVAILABLE", async () => {
      const { baseUrl, token } = await startApi({
        plannerMode: "disabled",
        engine: {} as WorkflowEngine,
      });

      const res = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source_prompt: "Liệt kê task Done của board board_a",
          time_zone: "Asia/Ho_Chi_Minh",
        }),
      });

      expect(res.status).toBe(503);
      const data = (await res.json()) as { error: { code: string } };
      expect(data.error.code).toBe("PLANNER_UNAVAILABLE");
    });

    it("accepts POST /runs when plannerMode is ai and triggers worker wake", async () => {
      let woken = false;
      const acceptedRun = {
        run_id: "run-ai-1",
        status: "planning" as const,
      };

      const mockEngine = {
        accept: async () => acceptedRun,
      } as unknown as WorkflowEngine;

      const { baseUrl, token } = await startApi({
        plannerMode: "ai",
        engine: mockEngine,
        worker: {
          start() {},
          wake() {
            woken = true;
          },
          async stop() {},
        },
      });

      const res = await fetch(`${baseUrl}/runs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source_prompt: "Liệt kê task Done của board board_a",
          time_zone: "Asia/Ho_Chi_Minh",
        }),
      });

      expect(res.status).toBe(202);
      const data = (await res.json()) as typeof acceptedRun;
      expect(data.run_id).toBe("run-ai-1");
      expect(data.status).toBe("planning");
      expect(woken).toBe(true);
    });

    it("supports WAP_PLANNER_MODE and API_PLANNER_MODE in loadConfig", async () => {
      const baseEnv = {
        API_DEMO_EMAIL: "test@example.local",
        API_DEMO_PASSWORD_HASH: await hashPassword("password"),
        API_CURSOR_KEY: Buffer.alloc(32, 1).toString("base64"),
      };

      expect(loadConfig({ ...baseEnv, API_PLANNER_MODE: "ai" }).plannerMode).toBe("ai");
      expect(loadConfig({ ...baseEnv, WAP_PLANNER_MODE: "ai" }).plannerMode).toBe("ai");
      expect(loadConfig({ ...baseEnv, WAP_PLANNER_MODE: "dev_fixture" }).plannerMode).toBe("dev_fixture");
      expect(loadConfig(baseEnv).plannerMode).toBe("disabled");
      expect(() => loadConfig({ ...baseEnv, API_PLANNER_MODE: "unsupported" })).toThrow(
        /Invalid configuration API_PLANNER_MODE/,
      );
    });
  });

  describe("loadAiPlanner adapter fail-closed behavior", () => {
    it("fails closed when model provider is unconfigured without falling back to dev_fixture", async () => {
      const planner = loadAiPlanner({ root });
      expect(planner.mode).toBe("ai");

      await expect(
        planner.produce({
          runId: "run-test",
          userId: USER_ID,
          request: {
            source_prompt: "Chép nguyên các dòng Progress!A1:B2", // b02 prompt in dev_fixture
            inputs: {},
            time_zone: "Asia/Ho_Chi_Minh",
          },
          runtime: { today: "2026-09-17" },
        }),
      ).rejects.toThrow(AiPlannerError);

      await expect(
        planner.produce({
          runId: "run-test",
          userId: USER_ID,
          request: {
            source_prompt: "Chép nguyên các dòng Progress!A1:B2",
            inputs: {},
            time_zone: "Asia/Ho_Chi_Minh",
          },
          runtime: { today: "2026-09-17" },
        }),
      ).rejects.toThrow(/unconfigured|credentials/i);
    });

    it("succeeds with structured model producing a valid plan", async () => {
      const fakeModel: StructuredModelClient = {
        async complete(): Promise<StructuredModelResponse> {
          return {
            output: {
              kind: "plan",
              plan: {
                version: "1.0",
                name: "List Cards Plan",
                source_prompt: "Liệt kê task Done của board board_a",
                steps: [
                  {
                    id: "step1",
                    description: "List cards",
                    tool: {
                      server: "task_hub",
                      name: "list_cards",
                      args: { board_id: "board_a" },
                    },
                    side_effect: "read",
                  },
                ],
              },
            },
            provider: "fake-provider",
            model: "fake-model",
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          };
        },
      };

      const planner = loadAiPlanner({ root, modelClient: fakeModel });
      const result = await planner.produce({
        runId: "run-test",
        userId: USER_ID,
        request: {
          source_prompt: "Liệt kê task Done của board board_a",
          inputs: {},
          time_zone: "Asia/Ho_Chi_Minh",
        },
        runtime: { today: "2026-09-17" },
      });

      expect(result.kind).toBe("plan");
      if (result.kind === "plan") {
        expect(result.plan.steps).toHaveLength(1);
        expect(result.plan.steps[0]!.tool.name).toBe("list_cards");
      }
    });

    it("handles model refusal without creating version or approval", async () => {
      const fakeModel: StructuredModelClient = {
        async complete(): Promise<StructuredModelResponse> {
          return {
            output: {
              kind: "refusal",
              reason: "Capability not supported by available reviewed tools.",
            },
            provider: "fake-provider",
            model: "fake-model",
          };
        },
      };

      const planner = loadAiPlanner({ root, modelClient: fakeModel });
      const result = await planner.produce({
        runId: "run-test",
        userId: USER_ID,
        request: {
          source_prompt: "Gửi email tới CEO",
          inputs: {},
          time_zone: "Asia/Ho_Chi_Minh",
        },
        runtime: { today: "2026-09-17" },
      });

      expect(result.kind).toBe("refusal");
      if (result.kind === "refusal") {
        expect(result.reason).toContain("Capability not supported");
      }
    });

    it("handles model clarification question without creating version or approval", async () => {
      const fakeModel: StructuredModelClient = {
        async complete(): Promise<StructuredModelResponse> {
          return {
            output: {
              kind: "clarification",
              question: "Vui lòng cung cấp board_id cần liệt kê.",
            },
            provider: "fake-provider",
            model: "fake-model",
          };
        },
      };

      const planner = loadAiPlanner({ root, modelClient: fakeModel });
      const result = await planner.produce({
        runId: "run-test",
        userId: USER_ID,
        request: {
          source_prompt: "Liệt kê task Done",
          inputs: {},
          time_zone: "Asia/Ho_Chi_Minh",
        },
        runtime: { today: "2026-09-17" },
      });

      expect(result.kind).toBe("clarification");
      if (result.kind === "clarification") {
        expect(result.question).toContain("board_id");
      }
    });

    it("fails closed on provider error and never falls back to dev_fixture", async () => {
      const failingModel: StructuredModelClient = {
        async complete(): Promise<StructuredModelResponse> {
          throw new Error("HTTP 502 Bad Gateway from provider");
        },
      };

      const planner = loadAiPlanner({ root, modelClient: failingModel });
      await expect(
        planner.produce({
          runId: "run-test",
          userId: USER_ID,
          request: {
            source_prompt: "Chép nguyên các dòng Progress!A1:B2", // identical to b02 dev fixture prompt
            inputs: {},
            time_zone: "Asia/Ho_Chi_Minh",
          },
          runtime: { today: "2026-09-17" },
        }),
      ).rejects.toThrow(/HTTP 502 Bad Gateway/);
    });
  });
});
