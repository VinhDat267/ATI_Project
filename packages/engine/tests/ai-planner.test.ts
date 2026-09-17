import { describe, expect, it, vi } from "vitest";
import type { PlannerResult } from "@wap/dsl";
import { AiPlannerAdapter, AiPlannerError } from "../src/ai/planner.js";
import type {
  StructuredModelClient,
  StructuredModelResponse,
} from "../src/ai/ports.js";
import type { ToolRetriever } from "../src/ai/retrieval.js";
import { makeTool } from "./ai-fixtures.js";

const tool = makeTool({ name: "list_cards" });

function response(output: unknown): StructuredModelResponse {
  return {
    output,
    provider: "fake-provider",
    model: "fake-model",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    requestId: "fake-request",
  };
}

function retriever(): ToolRetriever {
  return {
    async retrieve(input) {
      return {
        tools: [tool],
        scores: [],
        variant: input.variant,
        topK: input.topK,
        queryHash: "a".repeat(64),
        latencyMs: 1,
      };
    },
  };
}

function validPlan(): PlannerResult {
  return {
    kind: "plan",
    plan: {
      version: "1.0",
      name: "List cards",
      source_prompt: "List cards",
      steps: [
        {
          id: "read_cards",
          description: "Read cards",
          tool: { server: "task_hub", name: "list_cards", args: {} },
          side_effect: "read",
        },
      ],
    },
  };
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

describe("offline AI planner adapter", () => {
  const input = {
    runId: "run-1",
    userId: "user-1",
    request: {
      source_prompt: "List",
      inputs: { board: "board-7" },
      time_zone: "Asia/Ho_Chi_Minh",
    },
    runtime: { today: "2026-09-17" },
  };

  it("keeps catalog, runtime and declared inputs in repair prompts", async () => {
    const { client, prompts } = clientFrom([{}, validPlan()]);
    await new AiPlannerAdapter({
      retriever: retriever(),
      model: client,
      validatePlan: () => [],
    }).produce(input);
    expect(prompts[1]).toContain('"name":"list_cards"');
    expect(prompts[1]).toContain("2026-09-17");
    expect(prompts[1]).toContain("board-7");
  });

  it("rejects unknown tools with the real engine validator even with a permissive callback", async () => {
    const bad = validPlan();
    if (bad.kind === "plan") bad.plan.steps[0]!.tool.name = "unreviewed";
    const { client, prompts } = clientFrom([bad, validPlan()]);
    await expect(
      new AiPlannerAdapter({
        retriever: retriever(),
        model: client,
        validatePlan: () => [],
      }).produce(input),
    ).resolves.toEqual(validPlan());
    expect(prompts).toHaveLength(2);
  });

  it.each(["retrieval", "model"])(
    "bounds a hung %s even when it ignores abort",
    async (stage) => {
      vi.useFakeTimers();
      try {
        let observed: AbortSignal | undefined;
        const adapter = new AiPlannerAdapter({
          retriever:
            stage === "retrieval"
              ? {
                  retrieve: ({ signal }) => {
                    observed = signal;
                    return new Promise(() => {});
                  },
                }
              : retriever(),
          model: {
            complete: ({ signal }) => {
              observed = signal;
              return new Promise(() => {});
            },
          },
          validatePlan: () => [],
          deadlineMs: 100,
        });
        let outcome: unknown;
        const pending = adapter.produce(input).catch((error) => {
          outcome = error;
        });
        await vi.advanceTimersByTimeAsync(101);
        expect(outcome).toMatchObject({ code: "DEADLINE_EXCEEDED" });
        expect(observed?.aborted).toBe(true);
        await pending;
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("reports metadata for every model call without logging raw outputs", async () => {
    const events: unknown[] = [];
    const { client } = clientFrom([{}, validPlan()]);
    await new AiPlannerAdapter({
      retriever: retriever(),
      model: client,
      validatePlan: () => [],
      onModelCall: (event) => events.push(event),
    }).produce(input);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      attempt: 1,
      provider: "fake-provider",
      model: "fake-model",
      requestId: "fake-request",
      usage: { totalTokens: 2 },
      status: "received",
    });
    expect(events[1]).toMatchObject({ attempt: 2, runId: "run-1" });
    expect(events[0]).not.toHaveProperty("output");
  });

  it("shares one deadline across retrieval and repair calls", async () => {
    vi.useFakeTimers();
    try {
      const events: unknown[] = [];
      const base = retriever();
      const adapter = new AiPlannerAdapter({
        retriever: {
          async retrieve(request) {
            await new Promise((resolve) => setTimeout(resolve, 40));
            return base.retrieve(request);
          },
        },
        model: {
          async complete() {
            await new Promise((resolve) => setTimeout(resolve, 40));
            return response({});
          },
        },
        validatePlan: () => [],
        deadlineMs: 100,
        onModelCall: (event) => events.push(event),
      });
      const result = adapter.produce(input).catch((error) => error);
      await vi.advanceTimersByTimeAsync(101);
      expect(await result).toMatchObject({
        code: "DEADLINE_EXCEEDED",
        attempts: 2,
      });
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        status: "DEADLINE_EXCEEDED",
        usage: null,
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(events).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a non-cooperative model without waiting for its response", async () => {
    const controller = new AbortController();
    const events: unknown[] = [];
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const adapter = new AiPlannerAdapter({
      retriever: retriever(),
      model: {
        complete() {
          entered();
          return new Promise(() => {});
        },
      },
      validatePlan: () => [],
      onModelCall: (event) => events.push(event),
    });
    const result = adapter
      .produce({ ...input, signal: controller.signal })
      .catch((error) => error);
    await started;
    controller.abort();
    expect(await result).toMatchObject({ code: "CANCELLED", attempts: 1 });
    expect(events).toEqual([
      expect.objectContaining({ status: "CANCELLED", usage: null }),
    ]);
  });

  it.each(["side-effect", "cycle"])(
    "repairs a real %s validation failure",
    async (fault) => {
      const bad = validPlan();
      if (bad.kind === "plan") {
        if (fault === "side-effect") bad.plan.steps[0]!.side_effect = "write";
        else bad.plan.steps[0]!.depends_on = ["read_cards"];
      }
      const { client, prompts } = clientFrom([bad, validPlan()]);
      await expect(
        new AiPlannerAdapter({
          retriever: retriever(),
          model: client,
          validatePlan: () => [],
        }).produce(input),
      ).resolves.toEqual(validPlan());
      expect(prompts).toHaveLength(2);
    },
  );
  it("returns a validated plan and supplies the reviewed tool catalog", async () => {
    const { client, prompts } = clientFrom([validPlan()]);
    const adapter = new AiPlannerAdapter({
      retriever: retriever(),
      model: client,
      variant: "all_tools",
      topK: 10,
      validatePlan: () => [],
    });

    await expect(
      adapter.produce({
        runId: "run-1",
        userId: "user-1",
        request: {
          source_prompt: "List cards",
          inputs: {},
          time_zone: "Asia/Ho_Chi_Minh",
        },
        runtime: { today: "2026-09-17" },
      }),
    ).resolves.toEqual(validPlan());
    expect(prompts[0]).toContain('"name":"list_cards"');
  });

  it("returns refusal and clarification without spending repair attempts", async () => {
    const refusal = clientFrom([{ kind: "refusal", reason: "No capability" }]);
    const refusalAdapter = new AiPlannerAdapter({
      retriever: retriever(),
      model: refusal.client,
      validatePlan: () => [
        { layer: "tool", path: [], message: "must not run" },
      ],
    });
    await expect(
      refusalAdapter.produce({
        runId: "run-1",
        userId: "user-1",
        request: {
          source_prompt: "No",
          inputs: {},
          time_zone: "Asia/Ho_Chi_Minh",
        },
        runtime: {},
      }),
    ).resolves.toEqual({ kind: "refusal", reason: "No capability" });
    expect(refusal.prompts).toHaveLength(1);

    const clarification = clientFrom([
      { kind: "clarification", question: "Which board?" },
    ]);
    const clarificationAdapter = new AiPlannerAdapter({
      retriever: retriever(),
      model: clarification.client,
      validatePlan: () => [
        { layer: "tool", path: [], message: "must not run" },
      ],
    });
    await expect(
      clarificationAdapter.produce({
        runId: "run-1",
        userId: "user-1",
        request: {
          source_prompt: "List",
          inputs: {},
          time_zone: "Asia/Ho_Chi_Minh",
        },
        runtime: {},
      }),
    ).resolves.toEqual({ kind: "clarification", question: "Which board?" });
    expect(clarification.prompts).toHaveLength(1);
  });

  it("repairs malformed or invalid output within three total calls", async () => {
    const { client, prompts } = clientFrom([validPlan(), validPlan()]);
    let validations = 0;
    const adapter = new AiPlannerAdapter({
      retriever: retriever(),
      model: client,
      validatePlan: (plan) =>
        validations++ === 0
          ? [{ layer: "schema", path: [], message: "missing steps" }]
          : [],
    });

    await expect(
      adapter.produce({
        runId: "run-1",
        userId: "user-1",
        request: {
          source_prompt: "List",
          inputs: {},
          time_zone: "Asia/Ho_Chi_Minh",
        },
        runtime: {},
      }),
    ).resolves.toEqual(validPlan());
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("missing steps");
  });

  it("fails closed after the bounded repair budget and never falls back", async () => {
    const { client, prompts } = clientFrom([{}, {}, {}]);
    const adapter = new AiPlannerAdapter({
      retriever: retriever(),
      model: client,
      maxPlanningCalls: 3,
      validatePlan: () => [],
    });

    await expect(
      adapter.produce({
        runId: "run-1",
        userId: "user-1",
        request: {
          source_prompt: "List",
          inputs: {},
          time_zone: "Asia/Ho_Chi_Minh",
        },
        runtime: {},
      }),
    ).rejects.toMatchObject({
      code: "PLANNING_EXHAUSTED",
    } satisfies Partial<AiPlannerError>);
    expect(prompts).toHaveLength(3);
  });

  it("propagates provider errors without using a fixture fallback", async () => {
    const adapter = new AiPlannerAdapter({
      retriever: retriever(),
      model: {
        async complete() {
          throw new Error("provider unavailable");
        },
      },
      validatePlan: () => [],
    });
    await expect(
      adapter.produce({
        runId: "run-1",
        userId: "user-1",
        request: {
          source_prompt: "List",
          inputs: {},
          time_zone: "Asia/Ho_Chi_Minh",
        },
        runtime: {},
      }),
    ).rejects.toThrow("provider unavailable");
  });

  it("does not send internal validator exceptions back to the model", async () => {
    const { client, prompts } = clientFrom([
      validPlan(),
      validPlan(),
      validPlan(),
    ]);
    const adapter = new AiPlannerAdapter({
      retriever: retriever(),
      model: client,
      validatePlan: () => {
        throw new Error("internal validator unavailable");
      },
    });
    await expect(adapter.produce(input)).rejects.toThrow(
      "internal validator unavailable",
    );
    expect(prompts).toHaveLength(1);
  });

  it("rejects a late model response after cancellation", async () => {
    let release!: (value: StructuredModelResponse) => void;
    const controller = new AbortController();
    const adapter = new AiPlannerAdapter({
      retriever: retriever(),
      model: {
        complete: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
      validatePlan: () => [],
    });
    const pending = adapter.produce({
      runId: "run-1",
      userId: "user-1",
      request: {
        source_prompt: "List",
        inputs: {},
        time_zone: "Asia/Ho_Chi_Minh",
      },
      runtime: {},
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    release(response(validPlan()));
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
