import { describe, expect, it } from "vitest";
import {
  createAiPorts,
  type ProviderCallLedger,
} from "../src/ai/providers/registry.js";
import { readAiProviderConfig } from "../src/ai/providers/config.js";

const config = readAiProviderConfig({
  AI_PLANNING_PROVIDER: "openai",
  AI_PLANNING_MODEL: "gpt-5.6-terra",
  AI_QE_PROVIDER: "google",
  AI_QE_MODEL: "gemini-3.8-flash",
  AI_EMBEDDING_PROVIDER: "google",
  AI_EMBEDDING_MODEL: "gemini-embedding-2",
});

function ledger(): ProviderCallLedger {
  return {
    async reserve(input) {
      return `call-${input.purpose}-${input.provider}`;
    },
    async settle() {},
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("native provider clients with fake transport", () => {
  it("denies every native operation before credentials, reservation, or fetch", async () => {
    let fetchCalls = 0;
    let reserveCalls = 0;
    const denial = Object.assign(new Error("live execution is not enabled"), {
      code: "AI_LIVE_NOT_READY",
    });
    const ports = createAiPorts({
      config,
      credentials: {
        OPENAI_API_KEY: "openai-canary",
        GEMINI_API_KEY: "google-canary",
      },
      ledger: {
        async reserve() {
          reserveCalls += 1;
          return "unexpected-reservation";
        },
        async settle() {},
      },
      authorizeCall: async () => {
        throw denial;
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        return response({});
      },
    });

    await expect(
      ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} }),
    ).rejects.toMatchObject({ code: "AI_LIVE_NOT_READY" });
    await expect(
      ports.queryExpansion.expand({ query: "q" }),
    ).rejects.toMatchObject({
      code: "AI_LIVE_NOT_READY",
    });
    await expect(
      ports.embedding.embed({ text: "tool", purpose: "query" }),
    ).rejects.toMatchObject({ code: "AI_LIVE_NOT_READY" });
    expect(reserveCalls).toBe(0);
    expect(fetchCalls).toBe(0);
  });

  it("uses explicit campaign and run context in every authorization reservation", async () => {
    const reservations: Array<{
      campaignId: string;
      runId: string;
      profileId: string;
      trialId?: string;
      purpose: string;
    }> = [];
    const ports = createAiPorts({
      config,
      credentials: { OPENAI_API_KEY: "openai-canary" },
      ledger: ledger(),
      authorizeCall: async (reservation) => {
        reservations.push({
          campaignId: reservation.campaignId,
          runId: reservation.runId,
          profileId: reservation.profileId,
          trialId: reservation.trialId,
          purpose: reservation.purpose,
        });
      },
      callContext: {
        campaignId: "campaign-42",
        runId: "run-99",
        profileId: "openai-only",
        trialId: "trial-7",
      },
      fetchImpl: async () =>
        response({
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
    });
    await ports.model.complete({
      systemPrompt: "s",
      userPrompt: "u",
      schema: {},
    });
    expect(reservations).toEqual([
      {
        campaignId: "campaign-42",
        runId: "run-99",
        profileId: "openai-only",
        trialId: "trial-7",
        purpose: "planning",
      },
    ]);
  });

  it("keeps Gemini embedding-001 text separate from its taskType for both purposes", async () => {
    const embeddingConfig = readAiProviderConfig({
      AI_PLANNING_PROVIDER: "google",
      AI_PLANNING_MODEL: "gemini-3.8-flash",
      AI_EMBEDDING_PROVIDER: "google",
      AI_EMBEDDING_MODEL: "gemini-embedding-001",
    });
    const bodies: Record<string, unknown>[] = [];
    const ports = createAiPorts({
      config: embeddingConfig,
      credentials: { GEMINI_API_KEY: "google-canary" },
      ledger: ledger(),
      authorizeCall: async () => {},
      fetchImpl: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return response({
          embedding: {
            values: Array.from({ length: 1536 }, (_, index) =>
              index === 0 ? 1 : 0,
            ),
          },
          model: "gemini-embedding-001",
        });
      },
    });
    await ports.embedding.embed({
      text: "unique tool description canary",
      purpose: "document",
    });
    await ports.embedding.embed({
      text: "unique query canary",
      purpose: "query",
    });
    expect((bodies[0]!.content as any).parts[0].text).toBe(
      "unique tool description canary",
    );
    expect(bodies[0]!.taskType).toBe("RETRIEVAL_DOCUMENT");
    expect((bodies[1]!.content as any).parts[0].text).toBe(
      "unique query canary",
    );
    expect(bodies[1]!.taskType).toBe("RETRIEVAL_QUERY");
  });

  it("sends OpenAI Responses JSON schema without leaking the Gemini key", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const ports = createAiPorts({
      config,
      credentials: { OPENAI_API_KEY: "openai-canary" },
      ledger: ledger(),
      authorizeCall: async () => {},
      fetchImpl: async (input, init) => {
        request = { url: String(input), init: init ?? {} };
        return response({
          id: "resp_123",
          model: "gpt-5.6-terra",
          status: "completed",
          output_text: JSON.stringify({
            result: {
              kind: "refusal",
              plan: null,
              refusal: { reason: "not allowed" },
              clarification: null,
            },
          }),
          usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 },
        });
      },
    });

    const result = await ports.model.complete({
      systemPrompt: "system",
      userPrompt: "user",
      schema: { type: "object" },
    });
    expect(result.provider).toBe("openai");
    expect(result.output).toEqual({ kind: "refusal", reason: "not allowed" });
    expect(request?.url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(request?.init.body));
    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.store).toBe(false);
    expect(JSON.stringify(body)).not.toContain("openai-canary");
    expect(JSON.stringify(body)).not.toContain("GEMINI_API_KEY");
  });

  it("sends Gemini Interactions and maps a structured result", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const googleConfig = readAiProviderConfig({
      AI_PLANNING_PROVIDER: "google",
      AI_PLANNING_MODEL: "gemini-3.8-flash",
      AI_EMBEDDING_PROVIDER: "google",
      AI_EMBEDDING_MODEL: "gemini-embedding-2",
    });
    const ports = createAiPorts({
      config: googleConfig,
      credentials: { GEMINI_API_KEY: "google-canary" },
      ledger: ledger(),
      authorizeCall: async () => {},
      fetchImpl: async (input, init) => {
        request = { url: String(input), init: init ?? {} };
        return response({
          model: "gemini-3.8-flash",
          status: "completed",
          output_text: JSON.stringify({
            result: {
              kind: "clarification",
              plan: null,
              refusal: null,
              clarification: { question: "Which sheet?" },
            },
          }),
          usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 5 },
        });
      },
    });

    const result = await ports.model.complete({
      systemPrompt: "system",
      userPrompt: "user",
      schema: { type: "object" },
    });
    expect(result.provider).toBe("google");
    expect(result.output).toEqual({
      kind: "clarification",
      question: "Which sheet?",
    });
    expect(request?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
    expect(
      (request?.init.headers as Record<string, string>)["x-goog-api-key"],
    ).toBe("google-canary");
    expect(JSON.stringify(request?.init.body)).not.toContain("OPENAI_API_KEY");
  });

  it("maps both embedding APIs and preserves document/query purpose", async () => {
    const seen: string[] = [];
    const ports = createAiPorts({
      config,
      credentials: { GEMINI_API_KEY: "google-canary" },
      ledger: ledger(),
      authorizeCall: async () => {},
      fetchImpl: async (input) => {
        seen.push(String(input));
        return response({
          embedding: {
            values: Array.from({ length: 1536 }, (_, index) =>
              index === 0 ? 1 : 0,
            ),
          },
          usageMetadata: { promptTokenCount: 2 },
          model: "gemini-embedding-2",
        });
      },
    });
    const result = await ports.embedding.embed({
      text: "tool text",
      purpose: "document",
    });
    expect(result.provider).toBe("google");
    expect(result.model).toBe("gemini-embedding-2");
    expect(result.purpose).toBe("document");
    expect(result.embedding).toHaveLength(1536);
    expect(result.embedding[0]).toBe(1);
    expect(seen[0]).toContain("gemini-embedding-2:embedContent");
  });

  it("sends OpenAI embeddings through the same provider-neutral port", async () => {
    const openAiConfig = readAiProviderConfig({
      AI_PLANNING_PROVIDER: "openai",
      AI_PLANNING_MODEL: "gpt-5.6-terra",
      AI_EMBEDDING_PROVIDER: "openai",
      AI_EMBEDDING_MODEL: "text-embedding-3-large",
    });
    let request: { url: string; init: RequestInit } | undefined;
    const ports = createAiPorts({
      config: openAiConfig,
      credentials: { OPENAI_API_KEY: "openai-canary" },
      ledger: ledger(),
      authorizeCall: async () => {},
      fetchImpl: async (input, init) => {
        request = { url: String(input), init: init ?? {} };
        return response({
          data: [
            {
              embedding: Array.from({ length: 1536 }, (_, index) =>
                index === 0 ? 1 : 0,
              ),
            },
          ],
          model: "text-embedding-3-large",
          usage: { prompt_tokens: 3, total_tokens: 3 },
        });
      },
    });
    const result = await ports.embedding.embed({
      text: "tool text",
      purpose: "query",
    });
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("text-embedding-3-large");
    expect(result.purpose).toBe("query");
    expect(result.embedding).toHaveLength(1536);
    expect(request?.url).toBe("https://api.openai.com/v1/embeddings");
    expect(JSON.parse(String(request?.init.body)).dimensions).toBe(1536);
  });

  it("supports the Google-planning/OpenAI-embedding mixed profile", async () => {
    const mixedConfig = readAiProviderConfig({
      AI_PLANNING_PROVIDER: "google",
      AI_PLANNING_MODEL: "gemini-3.8-flash",
      AI_EMBEDDING_PROVIDER: "openai",
      AI_EMBEDDING_MODEL: "text-embedding-3-large",
    });
    const ports = createAiPorts({
      config: mixedConfig,
      credentials: {
        OPENAI_API_KEY: "openai-canary",
        GEMINI_API_KEY: "google-canary",
      },
      ledger: ledger(),
      authorizeCall: async () => {},
      fetchImpl: async (input, init) => {
        const url = String(input);
        const headers = init?.headers as Record<string, string>;
        if (url.endsWith("/interactions")) {
          expect(headers["x-goog-api-key"]).toBe("google-canary");
          return response({
            model: "gemini-3.8-flash",
            output_text: JSON.stringify({
              result: {
                kind: "clarification",
                plan: null,
                refusal: null,
                clarification: { question: "Which sheet?" },
              },
            }),
          });
        }
        expect(headers.authorization).toBe("Bearer openai-canary");
        return response({
          model: "text-embedding-3-large",
          data: [
            {
              embedding: Array.from({ length: 1536 }, (_, index) =>
                index === 0 ? 1 : 0,
              ),
            },
          ],
        });
      },
    });
    await expect(
      ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} }),
    ).resolves.toMatchObject({ provider: "google" });
    await expect(
      ports.embedding.embed({ text: "tool", purpose: "document" }),
    ).resolves.toMatchObject({ provider: "openai", purpose: "document" });
  });

  it("settles invalid planner output with provider usage", async () => {
    const settlements: unknown[] = [];
    const ports = createAiPorts({
      config,
      credentials: { OPENAI_API_KEY: "openai-canary" },
      ledger: {
        async reserve() {
          return "invalid-output-call";
        },
        async settle(_callId, outcome) {
          settlements.push(outcome);
        },
      },
      authorizeCall: async () => {},
      fetchImpl: async () =>
        response({
          output_text: "not-json",
          usage: { input_tokens: 9, output_tokens: 1, total_tokens: 10 },
        }),
    });
    await expect(
      ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} }),
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
    expect(settlements[0]).toMatchObject({
      status: "invalid_output",
      usage: { totalTokens: 10 },
    });
  });

  it("settles a usage-bearing planner call with the pinned price card", async () => {
    const settlements: unknown[] = [];
    const ports = createAiPorts({
      config,
      credentials: { OPENAI_API_KEY: "openai-canary" },
      priceCard: {
        version: "test-price-v1",
        entries: {
          "openai:responses:planning:gpt-5.6-terra": {
            inputMicrosPerMillion: 2_000_000,
            outputMicrosPerMillion: 4_000_000,
          },
        },
      },
      ledger: {
        async reserve() {
          return "priced-call";
        },
        async settle(_callId, outcome) {
          settlements.push(outcome);
        },
      },
      authorizeCall: async () => {},
      fetchImpl: async () =>
        response({
          output_text: JSON.stringify({
            result: {
              kind: "refusal",
              plan: null,
              refusal: { reason: "not allowed" },
              clarification: null,
            },
          }),
          model: "gpt-5.6-terra",
          usage: { input_tokens: 1001, output_tokens: 500, total_tokens: 1501 },
        }),
    });

    await ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} });
    expect(settlements.at(-1)).toMatchObject({
      status: "succeeded",
      costMicros: 4002,
    });
  });

  it("routes query expansion to its selected provider and keeps the key boundary", async () => {
    const ports = createAiPorts({
      config,
      credentials: { GEMINI_API_KEY: "google-canary" },
      ledger: ledger(),
      authorizeCall: async () => {},
      fetchImpl: async (_input, init) => {
        expect(
          (init?.headers as Record<string, string>)["x-goog-api-key"],
        ).toBe("google-canary");
        return response({
          model: "gemini-3.8-flash",
          output_text: JSON.stringify({
            queries: ["append rows", "write sheet"],
          }),
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4 },
        });
      },
    });
    await expect(
      ports.queryExpansion.expand({ query: "append" }),
    ).resolves.toMatchObject({
      provider: "google",
      queries: ["append rows", "write sheet"],
    });
  });

  it("turns a transport deadline into an ambiguous settled call", async () => {
    const timeoutConfig = readAiProviderConfig({
      AI_PLANNING_PROVIDER: "openai",
      AI_PLANNING_MODEL: "gpt-5.6-terra",
      AI_EMBEDDING_PROVIDER: "openai",
      AI_EMBEDDING_MODEL: "text-embedding-3-large",
      AI_REQUEST_TIMEOUT_MS: "1",
      AI_TRIAL_DEADLINE_MS: "1",
    });
    const outcomes: unknown[] = [];
    const ports = createAiPorts({
      config: timeoutConfig,
      credentials: { OPENAI_API_KEY: "openai-canary" },
      ledger: {
        async reserve() {
          return "timeout-call";
        },
        async settle(_callId, outcome) {
          outcomes.push(outcome);
        },
      },
      authorizeCall: async () => {},
      fetchImpl: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    });
    await expect(
      ports.model.complete({ systemPrompt: "s", userPrompt: "u", schema: {} }),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(outcomes[0]).toMatchObject({
      status: "ambiguous",
      errorCode: "PROVIDER_TIMEOUT",
    });
  });

  it("fails closed on provider errors and malformed vectors", async () => {
    const ports = createAiPorts({
      config,
      credentials: { GEMINI_API_KEY: "google-canary" },
      ledger: ledger(),
      authorizeCall: async () => {},
      fetchImpl: async () =>
        response({ error: { status: "PERMISSION_DENIED" } }, 403),
    });
    await expect(
      ports.embedding.embed({ text: "tool", purpose: "query" }),
    ).rejects.toMatchObject({ code: "PROVIDER_HTTP_ERROR" });
  });
});
