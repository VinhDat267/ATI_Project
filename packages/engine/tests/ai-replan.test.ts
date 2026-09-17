import { describe, expect, it, vi } from "vitest";
import {
  WorkflowPlanSchema,
  type LlmPlanDraft,
  type PlannerResult,
  type WorkflowPlan,
} from "@wap/dsl";
import {
  AiReplanAdapter,
  validateLocalScopeInvariants,
} from "../src/ai/replan.js";
import { AiPlannerError } from "../src/ai/planner.js";
import type {
  LocalReplanInput,
  StructuredModelClient,
  StructuredModelResponse,
} from "../src/ai/ports.js";
import type { ToolRetriever } from "../src/ai/retrieval.js";
import { makeTool } from "./ai-fixtures.js";

const tool1 = makeTool({ name: "list_cards", sideEffect: "read" });
const tool2 = makeTool({ name: "create_card", sideEffect: "write" });

function response(output: unknown): StructuredModelResponse {
  return {
    output,
    provider: "fake-provider",
    model: "fake-model",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    requestId: "fake-replan-req",
  };
}

function retriever(): ToolRetriever {
  return {
    async retrieve(input) {
      return {
        tools: [tool1, tool2],
        scores: [],
        variant: input.variant,
        topK: input.topK,
        queryHash: "b".repeat(64),
        latencyMs: 2,
      };
    },
  };
}

function initialDraft(): LlmPlanDraft {
  return {
    version: "1.0" as const,
    name: "Two-step workflow",
    source_prompt: "List and create",
    steps: [
      {
        id: "step_read",
        description: "List cards",
        tool: { server: "task_hub", name: "list_cards", args: {} },
        side_effect: "read" as const,
        on_error: "replan" as const,
      },
      {
        id: "step_write",
        description: "Create card",
        tool: {
          server: "task_hub",
          name: "create_card",
          args: { title: "New Card", list_id: "inbox" },
        },
        side_effect: "write" as const,
        idempotency_key: "create-card-1",
        on_error: "replan" as const,
        depends_on: ["step_read"],
      },
    ],
    outputs: {},
  };
}

function initialPlan(): WorkflowPlan {
  return WorkflowPlanSchema.parse(initialDraft());
}

function clientFrom(outputs: unknown[]): {
  client: StructuredModelClient;
  prompts: string[];
} {
  const prompts: string[] = [];
  let index = 0;
  return {
    prompts,
    client: {
      async complete(input) {
        prompts.push(input.userPrompt);
        return response(outputs[index++]);
      },
    },
  };
}

describe("AiReplanAdapter unit tests", () => {
  const baseInput: LocalReplanInput = {
    runId: "run-test-1",
    userId: "user-1",
    sourcePrompt: "List and create cards",
    currentPlan: initialPlan(),
    failedStepId: "step_write",
    errorMessage: "Invalid list_id 'inbox'",
    errorClass: "bad_args",
    completedOutputs: {
      step_read: [{ id: "c1", title: "Existing" }],
    },
    failedApproaches: ['{"list_id":"inbox"}: Invalid list_id'],
    replanCount: 1,
    maxReplans: 2,
    runtime: { today: "2026-09-18" },
  };

  it("builds prompt with local scope, completed outputs, and failed approaches", async () => {
    const replanned: PlannerResult = {
      kind: "plan",
      plan: {
        ...initialDraft(),
        steps: [
          initialDraft().steps[0]!,
          {
            ...initialDraft().steps[1]!,
            tool: {
              server: "task_hub",
              name: "create_card",
              args: { title: "New Card", list_id: "todo" },
            },
          },
        ],
      },
    };

    const { client, prompts } = clientFrom([replanned]);
    const adapter = new AiReplanAdapter({
      retriever: retriever(),
      model: client,
    });

    const result = await adapter.replan(baseInput);
    expect(result.kind).toBe("plan");
    expect(prompts[0]).toContain("PHẠM VI SỬA: CỤC BỘ");
    expect(prompts[0]).toContain("step_write");
    expect(prompts[0]).toContain("Invalid list_id 'inbox'");
    expect(prompts[0]).toContain("CÁC CÁCH ĐÃ THỬ VÀ THẤT BẠI");
    expect(prompts[0]).toContain("OUTPUT THẬT CỦA CÁC BƯỚC ĐÃ CHẠY XONG");
    expect(prompts[0]).toContain("Existing");
  });

  it("redacts configured secrets from completed outputs in the prompt", async () => {
    const replanned: PlannerResult = {
      kind: "plan",
      plan: {
        ...initialDraft(),
        steps: [
          initialDraft().steps[0]!,
          {
            ...initialDraft().steps[1]!,
            tool: {
              server: "task_hub",
              name: "create_card",
              args: { title: "New Card", list_id: "todo" },
            },
          },
        ],
      },
    };

    const { client, prompts } = clientFrom([replanned]);
    const adapter = new AiReplanAdapter({
      retriever: retriever(),
      model: client,
      secrets: ["SUPER_SECRET_TOKEN"],
    });

    const inputWithSecret: LocalReplanInput = {
      ...baseInput,
      completedOutputs: {
        step_read: { token: "SUPER_SECRET_TOKEN", cards: [] },
      },
    };

    await adapter.replan(inputWithSecret);
    expect(prompts[0]).not.toContain("SUPER_SECRET_TOKEN");
    expect(prompts[0]).toContain("[REDACTED]");
  });

  it("returns refusal without throwing", async () => {
    const refusal: PlannerResult = {
      kind: "refusal",
      reason: "No available tool to create cards in that workspace",
    };
    const { client } = clientFrom([refusal]);
    const adapter = new AiReplanAdapter({
      retriever: retriever(),
      model: client,
    });

    const result = await adapter.replan(baseInput);
    expect(result).toEqual(refusal);
  });

  it("returns clarification without throwing", async () => {
    const clarification: PlannerResult = {
      kind: "clarification",
      question: "Which list should the card be created in: todo or backlog?",
    };
    const { client } = clientFrom([clarification]);
    const adapter = new AiReplanAdapter({
      retriever: retriever(),
      model: client,
    });

    const result = await adapter.replan(baseInput);
    expect(result).toEqual(clarification);
  });

  it("enforces local scope invariants: rejects plan that alters completed steps", async () => {
    // Attempt 1 alters step_read args (completed step)
    const badPlan: PlannerResult = {
      kind: "plan",
      plan: {
        ...initialDraft(),
        steps: [
          {
            ...initialDraft().steps[0]!,
            tool: { server: "task_hub", name: "list_cards", args: { filter: "changed" } },
          },
          initialDraft().steps[1]!,
        ],
      },
    };

    // Attempt 2 fixes it
    const goodPlan: PlannerResult = {
      kind: "plan",
      plan: {
        ...initialDraft(),
        steps: [
          initialDraft().steps[0]!,
          {
            ...initialDraft().steps[1]!,
            tool: {
              server: "task_hub",
              name: "create_card",
              args: { title: "New Card", list_id: "todo" },
            },
          },
        ],
      },
    };

    const { client, prompts } = clientFrom([badPlan, goodPlan]);
    const adapter = new AiReplanAdapter({
      retriever: retriever(),
      model: client,
    });

    const result = await adapter.replan(baseInput);
    expect(result.kind).toBe("plan");
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain("Already-completed step 'step_read' arguments cannot be changed");
  });

  it("enforces local scope invariants: rejects plan that removes failed step id", async () => {
    const missingFailedStep: PlannerResult = {
      kind: "plan",
      plan: {
        ...initialDraft(),
        steps: [
          initialDraft().steps[0]!,
          {
            ...initialDraft().steps[1]!,
            id: "step_write_different_id",
          },
        ],
      },
    };

    const goodPlan: PlannerResult = {
      kind: "plan",
      plan: {
        ...initialDraft(),
        steps: [
          initialDraft().steps[0]!,
          {
            ...initialDraft().steps[1]!,
            tool: {
              server: "task_hub",
              name: "create_card",
              args: { title: "New Card", list_id: "todo" },
            },
          },
        ],
      },
    };

    const { client, prompts } = clientFrom([missingFailedStep, goodPlan]);
    const adapter = new AiReplanAdapter({
      retriever: retriever(),
      model: client,
    });

    const result = await adapter.replan(baseInput);
    expect(result.kind).toBe("plan");
    expect(prompts.length).toBe(2);
    expect(prompts[1]).toContain("Local replan must retain the failed step id 'step_write'");
  });

  it("exhausts repair attempts and throws AiPlannerError on repeated invalid outputs", async () => {
    const badPlan: PlannerResult = {
      kind: "plan",
      plan: {
        ...initialDraft(),
        steps: [
          {
            ...initialDraft().steps[0]!,
            tool: { server: "task_hub", name: "list_cards", args: { modified: true } },
          },
          initialDraft().steps[1]!,
        ],
      },
    };

    const { client } = clientFrom([badPlan, badPlan, badPlan]);
    const adapter = new AiReplanAdapter({
      retriever: retriever(),
      model: client,
      maxRepairCalls: 3,
    });

    await expect(adapter.replan(baseInput)).rejects.toThrow(AiPlannerError);
  });

  it("aborts when signal is cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("User cancelled"));

    const { client } = clientFrom([{}]);
    const adapter = new AiReplanAdapter({
      retriever: retriever(),
      model: client,
    });

    await expect(
      adapter.replan({ ...baseInput, signal: controller.signal }),
    ).rejects.toThrow(AiPlannerError);
  });
});

describe("validateLocalScopeInvariants helper directly", () => {
  const current = initialPlan();

  it("passes when completed steps are untouched and failed step is present", () => {
    const modified: WorkflowPlan = {
      ...current,
      steps: [
        current.steps[0]!,
        {
          ...current.steps[1]!,
          tool: {
            server: "task_hub",
            name: "create_card",
            args: { title: "Repaired Title", list_id: "inbox" },
          },
        },
      ],
    };
    const issues = validateLocalScopeInvariants(current, modified, "step_write", ["step_read"]);
    expect(issues).toEqual([]);
  });

  it("fails when completed step tool server/name is changed", () => {
    const modified: WorkflowPlan = {
      ...current,
      steps: [
        {
          ...current.steps[0]!,
          tool: { server: "filesystem", name: "read_file", args: {} },
        },
        current.steps[1]!,
      ],
    };
    const issues = validateLocalScopeInvariants(current, modified, "step_write", ["step_read"]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.message).toContain("cannot be changed from task_hub.list_cards");
  });

  it("fails when completed step is omitted entirely", () => {
    const modified: WorkflowPlan = {
      ...current,
      steps: [current.steps[1]!],
    };
    const issues = validateLocalScopeInvariants(current, modified, "step_write", ["step_read"]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.message).toContain("removed already-completed step 'step_read'");
  });
});
