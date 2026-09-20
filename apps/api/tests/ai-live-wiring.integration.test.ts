import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkflowEngine,
  encodePlannerWire,
  readAiProviderConfig,
  type Gateway,
  type ProviderCallReservation,
} from "@wap/engine";
import type { PlannerResult, WorkflowPlan } from "@wap/dsl";
import { createAiRuntime } from "../src/ai-runtime.js";
import { makeApiFixture, type ApiFixture } from "./fixture.js";

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const openFixtures = new Set<ApiFixture>();

afterEach(async () => {
  for (const fixture of openFixtures) await fixture.close();
  openFixtures.clear();
});

describe("provider-backed API replan wiring", () => {
  it("routes a safe read failure through the scoped provider replan without dispatching a write", async () => {
    const fixture = await makeApiFixture({
      workerEnabled: true,
      filesystemEnabled: true,
    });
    openFixtures.add(fixture);
    const localGateway = fixture.gateway!;

    const gatewayCalls: Array<{ server: string; name: string; sideEffect: string }> = [];
    const gateway: Gateway = {
      ...localGateway,
      async call(target, args, authorization, timeoutMs, context) {
        const tool = localGateway.tools.find(
          (candidate) =>
            candidate.server === target.server && candidate.name === target.name,
        );
        gatewayCalls.push({
          server: target.server,
          name: target.name,
          sideEffect: tool?.sideEffect ?? "unknown",
        });
        return localGateway.call(target, args, authorization, timeoutMs, context);
      },
    };

    const badPlan: WorkflowPlan = {
      version: "1.0",
      name: "Invalid read range",
      source_prompt: "List September cards",
      inputs: {},
      steps: [
        {
          id: "read_1",
          description: "Read cards with inverted dates",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-09-30",
              until: "2026-09-01",
            },
          },
          depends_on: [],
          condition: null,
          retry: { max_attempts: 1, backoff: "exponential", initial_delay_ms: 0 },
          idempotency_key: null,
          timeout_ms: 30_000,
          side_effect: "read",
          on_error: "replan",
        },
      ],
      outputs: { count: "${steps.read_1.output.count}" },
    };
    const repairedPlan: WorkflowPlan = {
      ...badPlan,
      steps: [
        {
          ...badPlan.steps[0]!,
          description: "Read cards with a valid September range",
          tool: {
            server: "task_hub",
            name: "list_cards",
            args: {
              board_id: "board_a",
              since: "2026-09-01",
              until: "2026-09-30",
            },
          },
        },
      ],
    };
    const badProviderPlan: Extract<PlannerResult, { kind: "plan" }>["plan"] = {
      version: badPlan.version,
      name: badPlan.name,
      source_prompt: badPlan.source_prompt,
      inputs: {},
      steps: badPlan.steps.map(
        ({ retry: _retry, timeout_ms: _timeoutMs, ...step }) => step,
      ),
      outputs: badPlan.outputs,
    };
    const repairedProviderPlan: Extract<PlannerResult, { kind: "plan" }>["plan"] = {
      version: repairedPlan.version,
      name: repairedPlan.name,
      source_prompt: repairedPlan.source_prompt,
      inputs: {},
      steps: repairedPlan.steps.map(
        ({ retry: _retry, timeout_ms: _timeoutMs, ...step }) => step,
      ),
      outputs: repairedPlan.outputs,
    };

    const reservations: ProviderCallReservation[] = [];
    let fetchCalls = 0;
    const runtime = createAiRuntime({
      db: fixture.db,
      gateway,
      root,
      userId: fixture.userId,
      config: readAiProviderConfig({
        AI_PLANNING_PROVIDER: "openai",
        AI_PLANNING_MODEL: "gpt-5.6-terra",
        AI_EMBEDDING_PROVIDER: "openai",
        AI_EMBEDDING_MODEL: "text-embedding-3-large",
      }),
      credentials: { OPENAI_API_KEY: "integration-test-key" },
      ledger: {
        async reserve(input) {
          reservations.push(input);
          return `provider-call-${reservations.length}`;
        },
        async settle() {},
      },
      authorizeCall: async () => {},
      fetchImpl: async (_input, init) => {
        fetchCalls++;
        const request = JSON.parse(String(init?.body)) as {
          input?: Array<{ content?: Array<{ text?: string }> }>;
        };
        expect(request.input?.[1]?.content?.[0]?.text).toContain("read_1");
        const result: PlannerResult = {
          kind: "plan",
          plan: repairedProviderPlan,
        };
        return new Response(
          JSON.stringify({
            id: "provider-replan-response",
            model: "gpt-5.6-terra",
            output_text: JSON.stringify(encodePlannerWire(result)),
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              reasoning_tokens: 0,
              total_tokens: 150,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const engine = new WorkflowEngine(fixture.db, gateway, fixture.userId, {
      replan: runtime.replan,
    });
    const accepted = await engine.accept({
      source_prompt: badPlan.source_prompt,
      inputs: {},
    });
    const result = await engine.prepareAccepted(accepted.run_id, {
      mode: "ai",
      async produce() {
        return { kind: "plan", plan: badProviderPlan };
      },
    });

    const events = await fixture.db.client`
      SELECT type, payload FROM run_events WHERE run_id=${accepted.run_id} ORDER BY seq
    `;
    expect(result.status, JSON.stringify({ result, events })).toBe("succeeded");
    expect(fetchCalls).toBe(1);
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      runId: accepted.run_id,
      purpose: "replan",
    });
    expect(gatewayCalls.some((call) => call.sideEffect === "write")).toBe(false);
  });

  it("does not fall back to all_tools when semantic retrieval has no active index", async () => {
    const fixture = await makeApiFixture({
      workerEnabled: true,
      filesystemEnabled: true,
    });
    openFixtures.add(fixture);
    let fetchCalls = 0;
    const runtime = createAiRuntime({
      db: fixture.db,
      gateway: fixture.gateway!,
      root,
      userId: fixture.userId,
      retrievalVariant: "semantic",
      config: readAiProviderConfig({
        AI_PLANNING_PROVIDER: "openai",
        AI_PLANNING_MODEL: "gpt-5.6-terra",
        AI_EMBEDDING_PROVIDER: "openai",
        AI_EMBEDDING_MODEL: "text-embedding-3-large",
      }),
      credentials: { OPENAI_API_KEY: "integration-test-key" },
      ledger: {
        async reserve() {
          throw new Error("provider call must not be reserved without an index");
        },
        async settle() {},
      },
      authorizeCall: async () => {},
      fetchImpl: async () => {
        fetchCalls++;
        throw new Error("provider transport must not be reached without an index");
      },
    });

    await expect(
      runtime.planner.produce({
        runId: "semantic-no-index",
        userId: fixture.userId,
        request: {
          source_prompt: "List September cards",
          inputs: {},
          time_zone: "Asia/Ho_Chi_Minh",
        },
        runtime: { today: "2026-09-21" },
      }),
    ).rejects.toThrow(/active pgvector index|no active/i);
    expect(fetchCalls).toBe(0);
  });
});
