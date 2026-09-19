import { describe, expect, it } from "vitest";
import {
  createAiRuntimePorts,
  type AiRuntimePortsOptions,
} from "../src/ai-runtime.js";
import { readAiProviderConfig } from "@wap/engine";

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
});
