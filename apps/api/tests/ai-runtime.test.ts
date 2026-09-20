import { describe, expect, it } from "vitest";
import {
  createAiRuntime,
  createAiRuntimePorts,
  type AiRuntimePortsOptions,
} from "../src/ai-runtime.js";
import { readAiProviderConfig, type Gateway } from "@wap/engine";
import type { Database } from "@wap/db";

const config = readAiProviderConfig({
  AI_PLANNING_PROVIDER: "openai",
  AI_PLANNING_MODEL: "gpt-5.6-terra",
  AI_EMBEDDING_PROVIDER: "google",
  AI_EMBEDDING_MODEL: "gemini-embedding-2",
});

function options(
  overrides: Partial<AiRuntimePortsOptions> = {},
): AiRuntimePortsOptions {
  return {
    config,
    credentials: {
      OPENAI_API_KEY: "openai-canary",
      GEMINI_API_KEY: "google-canary",
    },
    ...overrides,
  };
}

describe("AI runtime composition", () => {
  it("denies native provider calls by default before fetch or ledger reservation", async () => {
    let fetchCalls = 0;
    const ports = createAiRuntimePorts(
      options({
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("{}", {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    );

    await expect(
      ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} }),
    ).rejects.toMatchObject({ code: "AI_LIVE_NOT_READY" });
    await expect(ports.queryExpansion.expand({ query: "q" })).rejects.toMatchObject({
      code: "AI_LIVE_NOT_READY",
    });
    await expect(
      ports.embedding.embed({ text: "tool", purpose: "query" }),
    ).rejects.toMatchObject({ code: "AI_LIVE_NOT_READY" });
    expect(fetchCalls).toBe(0);
  });

  it("does not turn credentials or a fresh runtime into implicit approval", async () => {
    const first = createAiRuntimePorts(options());
    const second = createAiRuntimePorts(options());
    for (const ports of [first, second]) {
      await expect(
        ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} }),
      ).rejects.toMatchObject({ code: "AI_LIVE_NOT_READY" });
    }
  });

  it("honors an explicit provider-call kill switch before reservation or fetch", async () => {
    let fetchCalls = 0;
    let reserveCalls = 0;
    const ports = createAiRuntimePorts(
      options({
        providerCallsEnabled: false,
        authorizeCall: async () => {
          throw new Error("authorization should not be reached");
        },
        ledger: {
          async reserve() {
            reserveCalls += 1;
            return "call-1";
          },
          async settle() {},
        },
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("{}", {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    );

    await expect(
      ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} }),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_CALLS_DISABLED" });
    expect(reserveCalls).toBe(0);
    expect(fetchCalls).toBe(0);
  });

  it("keeps an API runtime fail-closed when durable accounting is unavailable", async () => {
    const runtime = createAiRuntime({
      db: {} as Database,
      gateway: {
        userId: "00000000-0000-4000-8000-000000000001",
        tools: [],
        assertCurrent: async () => {},
        ensureConnected: async () => {},
      } as unknown as Gateway,
      root: process.cwd(),
      userId: "00000000-0000-4000-8000-000000000001",
      config,
      credentials: { OPENAI_API_KEY: "openai-canary" },
    });
    await expect(
      runtime.forRun("00000000-0000-4000-8000-00000000000c").ports.model.complete({
        systemPrompt: "s",
        userPrompt: "u",
        schema: {},
      }),
    ).rejects.toMatchObject({ code: "AI_LIVE_NOT_READY" });
  });

  it("builds immutable provider contexts from each planner run", async () => {
    const reservations: string[] = [];
    const fakeLedger = {
      async reserve(input: { runId: string }) {
        reservations.push(input.runId);
        return `call-${reservations.length}`;
      },
      async settle() {},
    };
    const runtime = createAiRuntime({
      db: {} as Database,
      gateway: {
        userId: "00000000-0000-4000-8000-000000000001",
        tools: [],
        assertCurrent: async () => {},
        ensureConnected: async () => {},
      } as unknown as Gateway,
      root: process.cwd(),
      userId: "00000000-0000-4000-8000-000000000001",
      config,
      credentials: { OPENAI_API_KEY: "openai-canary" },
      ledger: fakeLedger,
      authorizeCall: async () => {},
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: "resp_123",
            model: "gpt-5.6-terra",
            output_text: JSON.stringify({
              result: {
                kind: "refusal",
                plan: null,
                refusal: { reason: "not allowed" },
                clarification: null,
              },
            }),
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });

    await runtime.forRun("00000000-0000-4000-8000-00000000000a").ports.model.complete({
      systemPrompt: "s",
      userPrompt: "u",
      schema: {},
    });
    await runtime.forRun("00000000-0000-4000-8000-00000000000b").ports.model.complete({
      systemPrompt: "s",
      userPrompt: "u",
      schema: {},
    });
    expect(reservations).toEqual([
      "00000000-0000-4000-8000-00000000000a",
      "00000000-0000-4000-8000-00000000000b",
    ]);
  });
});
