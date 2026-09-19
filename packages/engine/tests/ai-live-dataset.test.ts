import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseLiveDataset,
  toLiveCaseInput,
  LiveDatasetError,
  assertNoGoldCanaryInPayload,
  validateSealedHoldoutBundle,
  parseLiveEvalConfigFile,
  type ParsedLiveDataset,
} from "../src/ai/live-evaluation/dataset.js";
import {
  type LiveCaseInput,
  type LiveCaseOracle,
  type LiveExposure,
  type SealedHoldoutBundle,
} from "../src/ai/live-evaluation/contracts.js";
import {
  AiPlannerAdapter,
  type PlanValidator,
} from "../src/ai/planner.js";
import type {
  StructuredModelClient,
  StructuredModelResponse,
} from "../src/ai/ports.js";
import type { ToolRetriever } from "../src/ai/retrieval.js";
import type { ReviewedCatalogTool } from "../src/ai/catalog.js";

type StructuredModelRequest = Parameters<StructuredModelClient["complete"]>[0];

const root = fileURLToPath(new URL("../../../", import.meta.url));

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

const rawTestCases = readJson("testdata/test-cases.json");
const rawManifest = readJson("testdata/experiment-manifest.json");
const rawRubric = readJson("testdata/ai-live-rubric.json");
const rawConfig = readJson("testdata/ai-live-eval-config.json");

describe("AI Live Evaluation Dataset & Boundary (Task T5)", () => {
  describe("toLiveCaseInput & gold canary isolation", () => {
    it("explicitly copies only id, prompt, and runtime, omitting all gold oracle fields", () => {
      const parsed = parseLiveDataset(rawTestCases, rawManifest, rawRubric);
      const firstCase = parsed.cases[0]!;

      const liveInput: LiveCaseInput = toLiveCaseInput(firstCase.rawCase, parsed.runtime);

      expect(Object.keys(liveInput).sort()).toEqual(["id", "prompt", "runtime"].sort());
      expect(liveInput.id).toBe("b01");
      expect(liveInput.prompt).toBe(firstCase.input.prompt);
      expect(liveInput.runtime).toEqual(firstCase.input.runtime);

      // Verify no gold fields are attached or accessible
      const rawInput = liveInput as unknown as Record<string, unknown>;
      expect(rawInput.expected_result).toBeUndefined();
      expect(rawInput.read_fixture).toBeUndefined();
      expect(rawInput.expected_writes).toBeUndefined();
      expect(rawInput.expected_outputs).toBeUndefined();
      expect(rawInput.split).toBeUndefined();
      expect(rawInput.exposure).toBeUndefined();
      expect(rawInput.forbid_extra_writes).toBeUndefined();
    });

    it("ensures a unique gold canary in oracle/fixtures is never passed to provider requests across planning and repair", async () => {
      const GOLD_CANARY_SECRET = "GOLD_SECRET_CANARY_DO_NOT_LEAK_987654321";

      // Create a fixture case with the gold canary injected into gold expected results and fixtures
      const fixtureWithCanary = structuredClone((rawTestCases as { cases: unknown[] }).cases[0]!) as Record<string, unknown>;
      (fixtureWithCanary.expected_result as Record<string, unknown>).goldCanary = GOLD_CANARY_SECRET;
      (fixtureWithCanary.read_fixture as Array<Record<string, unknown>>)[0]!.output = {
        cards: [{ id: "c1", secretCanary: GOLD_CANARY_SECRET }],
      };
      (fixtureWithCanary.expected_writes as Array<Record<string, unknown>>).push({
        server: "task_hub",
        name: "canary_write",
        args: { secret: GOLD_CANARY_SECRET },
      });

      // Transform to public LiveCaseInput
      const liveInput = toLiveCaseInput(fixtureWithCanary);

      // Verify liveInput has no canary
      assertNoGoldCanaryInPayload(liveInput, GOLD_CANARY_SECRET);

      // Spy on all requests made to model
      const recordedModelRequests: StructuredModelRequest[] = [];
      const fakeModel: StructuredModelClient = {
        async complete(request: StructuredModelRequest): Promise<StructuredModelResponse> {
          recordedModelRequests.push(request);
          // Return an invalid plan on first attempt to trigger repair flow
          if (recordedModelRequests.length === 1) {
            return {
              output: {
                kind: "plan",
                plan: {
                  version: "1.0",
                  name: "Bad plan",
                  source_prompt: "Liệt kê task Done của board board_a trong tuần này theo giờ Việt Nam.",
                  steps: [],
                  outputs: {},
                },
              },
              usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 },
              provider: "fake",
              model: "fake-v1",
              requestId: "fake-req-1",
            };
          }
          // Return valid plan on second attempt (repair)
          return {
            output: {
              kind: "plan",
              plan: {
                version: "1.0",
                name: "Repaired plan",
                source_prompt: "Liệt kê task Done của board board_a trong tuần này theo giờ Việt Nam.",
                steps: [
                  {
                    id: "read",
                    description: "read",
                    tool: {
                      server: "task_hub",
                      name: "list_cards",
                      args: { board_id: "board_a", list_name: "Done" },
                    },
                    depends_on: [],
                    side_effect: "read",
                  },
                ],
                outputs: {},
              },
            },
            usage: { inputTokens: 50, outputTokens: 50, totalTokens: 100 },
            provider: "fake",
            model: "fake-v1",
            requestId: "fake-req-2",
          };
        },
      };

      const fakeTool: ReviewedCatalogTool = {
        server: "task_hub",
        name: "list_cards",
        description: "List cards on a board",
        inputSchema: { type: "object", properties: { board_id: { type: "string" }, list_name: { type: "string" } } },
        outputSchema: { type: "object" },
        sideEffect: "read",
        policyVersion: "1.0",
        artifactHash: "fake_artifact_hash_1",
      };

      const fakeRetriever: ToolRetriever = {
        async retrieve() {
          return {
            tools: [fakeTool],
            scores: [{ tool: fakeTool, score: 1.0 }],
            variant: "all_tools",
            topK: 5,
            queryHash: "fake_query_hash",
            latencyMs: 1,
          };
        },
      };

      const validatePlan: PlanValidator = (plan) => {
        if (plan.steps.length === 0) {
          return [{ layer: "schema", path: ["steps"], message: "Steps array must not be empty" }];
        }
        return [];
      };

      const planner = new AiPlannerAdapter({
        retriever: fakeRetriever,
        model: fakeModel,
        validatePlan,
        maxPlanningCalls: 2,
      });

      // Plan using the LiveCaseInput
      await planner.produce({
        runId: "test-run",
        userId: "test-user",
        request: {
          source_prompt: liveInput.prompt,
          inputs: {},
          time_zone: liveInput.runtime.time_zone ?? "Asia/Ho_Chi_Minh",
        },
        runtime: liveInput.runtime,
      });

      // Assert that we had 2 model calls (1 initial planning + 1 repair)
      expect(recordedModelRequests.length).toBe(2);

      // Verify that across ALL model requests (planning and repair), the gold canary NEVER appears
      for (const req of recordedModelRequests) {
        assertNoGoldCanaryInPayload(req, GOLD_CANARY_SECRET);
      }
    });
  });

  describe("Exposure tracking (dev vs legacy_regression)", () => {
    it("parses cases preserving original manifest split while establishing honest live exposure", () => {
      const parsed = parseLiveDataset(rawTestCases, rawManifest, rawRubric);

      expect(parsed.cases).toHaveLength(10);

      // b01-b06 are dev
      const devCases = parsed.cases.filter((c) => c.exposure === "dev");
      expect(devCases.map((c) => c.input.id)).toEqual(["b01", "b02", "b03", "b04", "b05", "b06"]);

      // b07-b10 are legacy_regression, NOT sealed holdout
      const regressionCases = parsed.cases.filter((c) => c.exposure === "legacy_regression");
      expect(regressionCases.map((c) => c.input.id)).toEqual(["b07", "b08", "b09", "b10"]);

      // Manifest original splits are preserved separately
      for (const c of devCases) {
        expect(c.originalSplit).toBe("dev");
      }
      for (const c of regressionCases) {
        expect(c.originalSplit).toBe("holdout");
      }
    });

    it("fails if b07–b10 are claimed to be fresh sealed holdouts without user authorization", () => {
      // Manifest or input attempting to relabel b07 as fresh holdout must be rejected
      const maliciousCases = structuredClone(rawTestCases) as { cases: Array<Record<string, unknown>> };
      const b07 = maliciousCases.cases.find((c) => c.id === "b07")!;
      b07.exposure = "sealed_holdout";

      expect(() => parseLiveDataset(maliciousCases, rawManifest, rawRubric)).toThrow(
        LiveDatasetError,
      );
    });

    it("rejects duplicate case IDs or missing required cases", () => {
      const dupCases = structuredClone(rawTestCases) as { cases: Array<Record<string, unknown>> };
      dupCases.cases[1]!.id = "b01";

      expect(() => parseLiveDataset(dupCases, rawManifest, rawRubric)).toThrow(
        /duplicate/i,
      );
    });
  });

  describe("Sealed holdout validation rules", () => {
    it("rejects an automated coding agent self-approving a sealed holdout bundle", () => {
      const agentBundle: SealedHoldoutBundle = {
        format: "ati-ai-live-sealed-holdout-v1",
        approvedBy: "claude-code-agent-auto",
        approvedAt: "2026-09-19T00:00:00Z",
        exposureHistory: "previously_unseen_fresh_holdout",
        casesHash: "a".repeat(64),
        rubricHash: "b".repeat(64),
        budgetCapMicros: 10_000_000,
      };

      expect(() => validateSealedHoldoutBundle(agentBundle)).toThrow(
        /agent.*cannot approve.*holdout/i,
      );
    });

    it("accepts a valid human-approved sealed holdout bundle", () => {
      const humanBundle: SealedHoldoutBundle = {
        format: "ati-ai-live-sealed-holdout-v1",
        approvedBy: "user:vinhdat@ati.vn",
        approvedAt: "2026-09-19T10:00:00Z",
        exposureHistory: "previously_unseen_fresh_holdout",
        casesHash: "a".repeat(64),
        rubricHash: "b".repeat(64),
        budgetCapMicros: 10_000_000,
      };

      expect(validateSealedHoldoutBundle(humanBundle)).toBe(true);
    });
  });

  describe("Live profile configuration validation", () => {
    it("parses testdata/ai-live-eval-config.json and verifies all four required profiles exist", () => {
      const parsedConfig = parseLiveEvalConfigFile(rawConfig);

      expect(parsedConfig.profiles).toBeDefined();
      expect(parsedConfig.profiles["openai-only"]).toBeDefined();
      expect(parsedConfig.profiles["google-only"]).toBeDefined();
      expect(parsedConfig.profiles["openai-google"]).toBeDefined();
      expect(parsedConfig.profiles["google-openai"]).toBeDefined();

      // Check OpenAI-only profile
      const openAiProfile = parsedConfig.profiles["openai-only"]!;
      expect(openAiProfile.planning.provider).toBe("openai");
      expect(openAiProfile.planning.model).toBe("gpt-5.6-terra");
      expect(openAiProfile.embedding.provider).toBe("openai");
      expect(openAiProfile.embedding.model).toBe("text-embedding-3-large");

      // Check Google-only profile
      const googleProfile = parsedConfig.profiles["google-only"]!;
      expect(googleProfile.planning.provider).toBe("google");
      expect(["gemini-3.8-flash", "gemini-2.5-flash"]).toContain(googleProfile.planning.model);
      expect(googleProfile.embedding.provider).toBe("google");
      expect(["gemini-embedding-001", "gemini-embedding-2"]).toContain(googleProfile.embedding.model);
    });

    it("rejects unknown profiles without reading credentials or calling network", () => {
      const parsedConfig = parseLiveEvalConfigFile(rawConfig);
      expect(() => parsedConfig.resolveProfile("unknown-profile")).toThrow(
        /unknown profile/i,
      );
    });
  });
});
