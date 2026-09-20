import { describe, expect, it } from "vitest";
import {
  priceProviderCall,
  validateProviderPriceCard,
  calculateReservationBoundMicros,
} from "../src/ai/live-evaluation/pricing.js";

describe("ai-live price card accounting", () => {
  it("prices input, cached input and output with conservative micro-USD rounding", () => {
    expect(
      priceProviderCall(
        "planning",
        "model-1",
        { inputTokens: 1_000_001, cachedInputTokens: 1, outputTokens: 1 },
        {
          version: "test-price-v1",
          entries: {
            "model-1": {
              inputMicrosPerMillion: 2_000_000,
              cachedInputMicrosPerMillion: 1_000_000,
              outputMicrosPerMillion: 4_000_000,
            },
          },
        },
      ),
    ).toBe(2_000_005);
  });

  it("keeps cost unknown when usage or required price is missing", () => {
    const card = { version: "test-price-v1", entries: {} };
    expect(priceProviderCall("embedding", "model-1", null, card)).toBeNull();
    expect(
      priceProviderCall("embedding", "model-1", { inputTokens: 10 }, card),
    ).toBeNull();
  });

  it("rejects impossible cached usage", () => {
    expect(() =>
      priceProviderCall(
        "planning",
        "model-1",
        { inputTokens: 1, cachedInputTokens: 2 },
        { version: "test-price-v1", entries: { "model-1": {} } },
      ),
    ).toThrow(/cached input tokens/i);
  });

  it("requires a provider and API mode binding for an evaluated price entry", () => {
    const card = {
      version: "test-price-v2",
      entries: {
        "google:interactions:planning:model-1": {
          inputMicrosPerMillion: 1_000_000,
          outputMicrosPerMillion: 2_000_000,
        },
      },
    };
    expect(
      priceProviderCall(
        "planning",
        "model-1",
        { inputTokens: 2, outputTokens: 3 },
        card,
        { provider: "google", apiMode: "interactions" },
      ),
    ).toBe(8);
    expect(
      priceProviderCall(
        "planning",
        "model-1",
        { inputTokens: 2, outputTokens: 3 },
        card,
        { provider: "openai", apiMode: "responses" },
      ),
    ).toBeNull();
  });
  it("keeps cost unknown when usage only contains totalTokens without input/output breakdown", () => {
    expect(
      priceProviderCall(
        "planning",
        "m",
        { totalTokens: 20 },
        {
          version: "synthetic",
          entries: {
            m: {
              inputMicrosPerMillion: 1_000_000,
              outputMicrosPerMillion: 1_000_000,
            },
          },
        },
      ),
    ).toBeNull();
  });

  it("keeps cost unknown when empty usage is provided for a billable model", () => {
    expect(
      priceProviderCall(
        "planning",
        "m",
        {},
        {
          version: "synthetic",
          entries: {
            m: {
              inputMicrosPerMillion: 1_000_000,
              outputMicrosPerMillion: 1_000_000,
            },
          },
        },
      ),
    ).toBeNull();
  });

  it("validates price card schema and rejects negative rates or non-integer rates", () => {
    expect(() =>
      validateProviderPriceCard({
        version: "bad",
        entries: {
          m: { inputMicrosPerMillion: -1 },
        } as any,
      }),
    ).toThrow();
    expect(() =>
      validateProviderPriceCard({
        version: "bad",
        entries: {
          m: { inputMicrosPerMillion: 1.5 },
        } as any,
      }),
    ).toThrow();
  });

  it("calculates conservative reservation bound and returns null when price entry is missing", () => {
    const card = {
      version: "test-card",
      entries: {
        "openai:responses:planning:gpt-5.6": {
          inputMicrosPerMillion: 2_000_000,
          outputMicrosPerMillion: 8_000_000,
        },
      },
    };
    const bound = calculateReservationBoundMicros({
      purpose: "planning",
      model: "gpt-5.6",
      inputLimitTokens: 2000,
      outputCapTokens: 1000,
      priceCard: card,
      context: { provider: "openai", apiMode: "responses" },
    });
    // 2000 * 2 + 1000 * 8 = 4000 + 8000 = 12000 micro-USD
    expect(bound).toBe(12_000);

    expect(
      calculateReservationBoundMicros({
        purpose: "planning",
        model: "unknown-model",
        inputLimitTokens: 2000,
        outputCapTokens: 1000,
        priceCard: card,
        context: { provider: "openai", apiMode: "responses" },
      }),
    ).toBeNull();
  });

  it("never mixes pricing entries when two providers share the same model name", () => {
    const card = {
      version: "shared-test",
      entries: {
        "openai:responses:planning:model-x": {
          inputMicrosPerMillion: 1_000_000,
          outputMicrosPerMillion: 2_000_000,
        },
        "google:interactions:planning:model-x": {
          inputMicrosPerMillion: 500_000,
          outputMicrosPerMillion: 1_000_000,
        },
      },
    };
    const openAiCost = priceProviderCall(
      "planning",
      "model-x",
      { inputTokens: 1000, outputTokens: 1000 },
      card,
      { provider: "openai", apiMode: "responses" },
    );
    const googleCost = priceProviderCall(
      "planning",
      "model-x",
      { inputTokens: 1000, outputTokens: 1000 },
      card,
      { provider: "google", apiMode: "interactions" },
    );
    expect(openAiCost).toBe(3_000);
    expect(googleCost).toBe(1_500);

    const openAiBound = calculateReservationBoundMicros({
      purpose: "planning",
      model: "model-x",
      inputLimitTokens: 10_000,
      outputCapTokens: 5_000,
      priceCard: card,
      context: { provider: "openai", apiMode: "responses" },
    });
    const googleBound = calculateReservationBoundMicros({
      purpose: "planning",
      model: "model-x",
      inputLimitTokens: 10_000,
      outputCapTokens: 5_000,
      priceCard: card,
      context: { provider: "google", apiMode: "interactions" },
    });
    expect(openAiBound).toBe(20_000);
    expect(googleBound).toBe(10_000);
  });

});
